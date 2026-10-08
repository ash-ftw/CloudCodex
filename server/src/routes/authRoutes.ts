import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/index';
import { supabase, supabaseAdmin } from '../config/supabase';
import { authLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest, authMiddleware } from '../middleware/authMiddleware';
import { getUserWorkspacePath } from '../utils/pathSecurity';
import { sendWelcomeEmail, sendLoginEmail } from '../services/emailService';
import fs from 'fs/promises';

const router = Router();

// Validation schemas
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6)
});

const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    username: z.string().min(3).max(30)
});

/**
 * POST /api/auth/register
 * Register a new user with auto-confirmed email via Supabase Admin
 */
router.post('/register', async (req, res: Response, next) => {
    try {
        const { email, password, username } = registerSchema.parse(req.body);

        console.log('=== REGISTER ATTEMPT ===');
        console.log('Email:', email);
        console.log('Username:', username);

        // Check if username is already taken
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('username', username)
            .maybeSingle();

        if (existingProfile) {
            throw new AppError('Username is already taken', 400, 'USERNAME_TAKEN');
        }

        // Register user via Supabase Admin API with auto email_confirm = true
        const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { username }
        });

        console.log('Supabase admin createUser result:', { hasUser: !!newUser?.user, error: error?.message });

        if (error) {
            throw new AppError(error.message, 400, 'REGISTRATION_FAILED');
        }

        if (!newUser.user) {
            throw new AppError('Registration failed', 400, 'REGISTRATION_FAILED');
        }

        const userId = newUser.user.id;

        // Upsert user profile
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: userId,
                username,
                role: 'user',
                storage_quota_mb: 500,
                storage_used_mb: 0
            }, { onConflict: 'id' });

        if (profileError) {
            console.error('Profile creation error:', profileError);
            throw new AppError(`Failed to create profile: ${profileError.message}`, 500, 'PROFILE_CREATION_FAILED');
        }

        // Create user workspace directory
        const workspacePath = getUserWorkspacePath(userId);
        await fs.mkdir(`${workspacePath}/projects`, { recursive: true });

        // Generate JWT
        const token = jwt.sign(
            { sub: userId, email: newUser.user.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        // Send welcome email (fire-and-forget)
        sendWelcomeEmail(email, username);

        res.status(201).json({
            success: true,
            data: {
                user: {
                    id: userId,
                    email: newUser.user.email,
                    username,
                    role: 'user'
                },
                token
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/auth/login
 * Login with email and password (with auto-confirm fallback for legacy unconfirmed users)
 */
router.post('/login', async (req, res: Response, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        console.log('=== LOGIN ATTEMPT ===');
        console.log('Email:', email);

        let { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        // Auto-recovery for unconfirmed emails created previously
        if (error && (error.message?.includes('Email not confirmed') || error.status === 400)) {
            console.log('Attempting auto-confirmation for user email:', email);
            const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
            const foundUser = usersData?.users?.find(u => u.email === email);

            if (foundUser) {
                await supabaseAdmin.auth.admin.updateUserById(foundUser.id, { email_confirm: true });
                // Retry login
                const retry = await supabase.auth.signInWithPassword({ email, password });
                data = retry.data;
                error = retry.error;
            }
        }

        if (error || !data?.user) {
            console.error('Supabase login error:', error?.message);
            throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
        }

        // Get profile
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        // Generate JWT
        const token = jwt.sign(
            { sub: data.user.id, email: data.user.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        // Send login notification email (fire-and-forget)
        sendLoginEmail(email, profile?.username || email.split('@')[0]);

        res.json({
            success: true,
            data: {
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    username: profile?.username || email.split('@')[0],
                    role: profile?.role || 'user'
                },
                token
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/auth/github
 * Initiate GitHub OAuth flow (for login)
 */
router.get('/github', (_req, res: Response) => {
    const state = JSON.stringify({ action: 'login', nonce: Math.random().toString(36).substring(7) });
    const params = new URLSearchParams({
        client_id: config.github.clientId,
        redirect_uri: config.github.callbackUrl,
        scope: 'user:email repo',
        state: Buffer.from(state).toString('base64')
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /api/auth/github/callback
 */
router.get('/github/callback', async (req, res: Response, next) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            throw new AppError('Authorization code missing', 400, 'MISSING_CODE');
        }

        let action = 'login';
        let linkUserId: string | null = null;

        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
                action = decoded.action || 'login';
                linkUserId = decoded.userId || null;
            } catch {
                action = 'login';
            }
        }

        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                client_id: config.github.clientId,
                client_secret: config.github.clientSecret,
                code
            })
        });

        const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

        if (tokenData.error || !tokenData.access_token) {
            throw new AppError('GitHub authentication failed', 400, 'GITHUB_AUTH_FAILED');
        }

        if (action === 'link' && linkUserId) {
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    Accept: 'application/vnd.github.v3+json'
                }
            });

            const githubUser = await userResponse.json() as { id: number; email: string; login: string };

            await supabaseAdmin
                .from('github_tokens')
                .upsert({
                    user_id: linkUserId,
                    access_token: tokenData.access_token
                });

            await supabaseAdmin
                .from('connected_accounts')
                .upsert({
                    user_id: linkUserId,
                    provider: 'github',
                    provider_user_id: githubUser.id.toString(),
                    email: githubUser.email,
                    access_token: tokenData.access_token
                });

            res.redirect(`${config.frontend.url}/profile?github_linked=true`);
            return;
        }

        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });

        const githubUser = await userResponse.json() as { id: number; email: string; login: string };

        // If public email is hidden, fetch primary email from GitHub /user/emails
        if (!githubUser.email) {
            try {
                const emailsRes = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        Authorization: `Bearer ${tokenData.access_token}`,
                        Accept: 'application/vnd.github.v3+json'
                    }
                });
                if (emailsRes.ok) {
                    const emails = await emailsRes.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
                    const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified) || emails[0];
                    if (primary?.email) {
                        githubUser.email = primary.email;
                    }
                }
            } catch (err) {
                console.warn('[GitHub OAuth] Could not fetch private emails:', err);
            }
        }

        let userId!: string;
        let existingUser = false;

        const { data: connectedAccount } = await supabaseAdmin
            .from('connected_accounts')
            .select('user_id')
            .eq('provider', 'github')
            .eq('provider_user_id', githubUser.id.toString())
            .single();

        if (connectedAccount) {
            userId = connectedAccount.user_id;
            existingUser = true;
        } else {
            const { data: existingProfile } = await supabaseAdmin
                .from('profiles')
                .select('*')
                .eq('username', githubUser.login)
                .single();

            if (existingProfile) {
                userId = existingProfile.id;
                existingUser = true;
            } else {
                const githubEmail = githubUser.email || `${githubUser.login}@github.local`;
                const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
                const matchingUser = existingUsers?.users?.find(u => u.email === githubEmail);

                if (matchingUser) {
                    userId = matchingUser.id;
                    existingUser = true;

                    const { data: prof } = await supabaseAdmin
                        .from('profiles')
                        .select('id')
                        .eq('id', userId)
                        .single();

                    if (!prof) {
                        await supabaseAdmin.from('profiles').insert({
                            id: userId,
                            username: githubUser.login,
                            role: 'user'
                        });
                    }
                }
            }
        }

        if (existingUser) {
            await supabaseAdmin
                .from('github_tokens')
                .upsert({
                    user_id: userId!,
                    access_token: tokenData.access_token
                });

            await supabaseAdmin
                .from('connected_accounts')
                .upsert({
                    user_id: userId!,
                    provider: 'github',
                    provider_user_id: githubUser.id.toString(),
                    email: githubUser.email,
                    access_token: tokenData.access_token
                });
        } else {
            const tempPassword = Math.random().toString(36).substring(2, 15);
            const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
                email: githubUser.email || `${githubUser.login}@github.local`,
                password: tempPassword,
                email_confirm: true
            });

            if (error || !newUser.user) {
                console.error('Failed to create user:', error?.message);
                throw new AppError('Failed to create user', 500, 'USER_CREATION_FAILED');
            }

            userId = newUser.user.id;

            await supabaseAdmin.from('profiles').insert({
                id: userId,
                username: githubUser.login,
                role: 'user'
            });

            await supabaseAdmin.from('github_tokens').insert({
                user_id: userId,
                access_token: tokenData.access_token
            });

            await supabaseAdmin.from('connected_accounts').insert({
                user_id: userId,
                provider: 'github',
                provider_user_id: githubUser.id.toString(),
                email: githubUser.email,
                access_token: tokenData.access_token
            });

            const workspacePath = getUserWorkspacePath(userId);
            await fs.mkdir(`${workspacePath}/projects`, { recursive: true });
        }

        if (existingUser) {
            sendLoginEmail(githubUser.email || '', githubUser.login);
        } else {
            sendWelcomeEmail(githubUser.email || '', githubUser.login);
        }

        const token = jwt.sign(
            { sub: userId, email: githubUser.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        res.redirect(`${config.frontend.url}/auth/callback?token=${token}`);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/auth/github/link
 */
router.get('/github/link', (req, res: Response) => {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
        return res.status(400).send('User ID is required');
    }

    const state = JSON.stringify({
        action: 'link',
        userId: userId,
        nonce: Math.random().toString(36).substring(7)
    });
    const params = new URLSearchParams({
        client_id: config.github.clientId,
        redirect_uri: config.github.callbackUrl,
        scope: 'user:email repo',
        state: Buffer.from(state).toString('base64')
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /api/auth/google
 */
router.get('/google', (_req, res: Response) => {
    const state = JSON.stringify({ action: 'login', nonce: Math.random().toString(36).substring(7) });
    const params = new URLSearchParams({
        client_id: config.google.clientId,
        redirect_uri: config.google.callbackUrl,
        scope: 'openid email profile',
        response_type: 'code',
        access_type: 'offline',
        state: Buffer.from(state).toString('base64')
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * GET /api/auth/google/link
 */
router.get('/google/link', (req, res: Response) => {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
        return res.status(400).send('User ID is required');
    }

    const state = JSON.stringify({
        action: 'link',
        userId: userId,
        nonce: Math.random().toString(36).substring(7)
    });
    const params = new URLSearchParams({
        client_id: config.google.clientId,
        redirect_uri: config.google.callbackUrl,
        scope: 'openid email profile',
        response_type: 'code',
        access_type: 'offline',
        state: Buffer.from(state).toString('base64')
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * GET /api/auth/google/callback
 */
router.get('/google/callback', async (req, res: Response, next) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            throw new AppError('Authorization code missing', 400, 'MISSING_CODE');
        }

        let action = 'login';
        let linkUserId: string | null = null;

        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
                action = decoded.action || 'login';
                linkUserId = decoded.userId || null;
            } catch {
                action = 'login';
            }
        }

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: config.google.clientId,
                client_secret: config.google.clientSecret,
                code,
                redirect_uri: config.google.callbackUrl,
                grant_type: 'authorization_code'
            })
        });

        const tokenData = await tokenResponse.json() as {
            access_token?: string;
            refresh_token?: string;
            expires_in?: number;
            error?: string
        };

        if (tokenData.error || !tokenData.access_token) {
            throw new AppError('Google authentication failed', 400, 'GOOGLE_AUTH_FAILED');
        }

        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`
            }
        });

        const googleUser = await userResponse.json() as {
            id: string;
            email: string;
            name: string;
            given_name?: string;
        };

        if (action === 'link' && linkUserId) {
            const { data: existingConnection } = await supabaseAdmin
                .from('connected_accounts')
                .select('user_id')
                .eq('provider', 'google')
                .eq('provider_user_id', googleUser.id)
                .single();

            if (existingConnection) {
                res.redirect(`${config.frontend.url}/profile?error=account_already_linked`);
                return;
            }

            let expiresAt = null;
            if (tokenData.expires_in) {
                expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
            }

            await supabaseAdmin
                .from('connected_accounts')
                .upsert({
                    user_id: linkUserId,
                    provider: 'google',
                    provider_user_id: googleUser.id,
                    email: googleUser.email,
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    expires_at: expiresAt
                });

            res.redirect(`${config.frontend.url}/profile?google_linked=true`);
            return;
        }

        const { data: existingConnection } = await supabaseAdmin
            .from('connected_accounts')
            .select('user_id')
            .eq('provider', 'google')
            .eq('provider_user_id', googleUser.id)
            .single();

        let userId: string;

        if (existingConnection) {
            userId = existingConnection.user_id;

            let expiresAt = null;
            if (tokenData.expires_in) {
                expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
            }

            await supabaseAdmin
                .from('connected_accounts')
                .update({
                    access_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    expires_at: expiresAt
                })
                .eq('user_id', userId)
                .eq('provider', 'google');

            sendLoginEmail(googleUser.email, googleUser.name || googleUser.email.split('@')[0]);
        } else {
            const tempPassword = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
            const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
                email: googleUser.email,
                password: tempPassword,
                email_confirm: true
            });

            if (error || !newUser.user) {
                throw new AppError('Failed to create user', 500, 'USER_CREATION_FAILED');
            }

            userId = newUser.user.id;

            const username = googleUser.given_name || googleUser.name.split(' ')[0] || googleUser.email.split('@')[0];
            await supabaseAdmin.from('profiles').insert({
                id: userId,
                username: username.toLowerCase().replace(/\s+/g, '_'),
                role: 'user'
            });

            let expiresAt = null;
            if (tokenData.expires_in) {
                expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
            }

            await supabaseAdmin.from('connected_accounts').insert({
                user_id: userId,
                provider: 'google',
                provider_user_id: googleUser.id,
                email: googleUser.email,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: expiresAt
            });

            const workspacePath = getUserWorkspacePath(userId);
            await fs.mkdir(`${workspacePath}/projects`, { recursive: true });

            sendWelcomeEmail(googleUser.email, googleUser.given_name || googleUser.name.split(' ')[0]);
        }

        const token = jwt.sign(
            { sub: userId, email: googleUser.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        res.redirect(`${config.frontend.url}/auth/callback?token=${token}`);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, data: { message: 'Logged out successfully' } });
});

/**
 * GET /api/auth/session
 */
router.get('/session', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    res.json({
        success: true,
        data: { user: req.user }
    });
});

export { router as authRoutes };

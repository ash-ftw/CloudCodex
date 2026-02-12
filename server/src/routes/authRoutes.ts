import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config/index';
import { supabase, supabaseAdmin } from '../config/supabase';
import { authLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest, authMiddleware } from '../middleware/authMiddleware';
import { getUserWorkspacePath } from '../utils/pathSecurity';
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
 * Register a new user
 */
router.post('/register', async (req, res: Response, next) => {
    try {
        const { email, password, username } = registerSchema.parse(req.body);

        console.log('=== REGISTER ATTEMPT ===');
        console.log('Email:', email);
        console.log('Username:', username);

        // Register with Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });

        console.log('Supabase signUp result:', { hasUser: !!data?.user, hasSession: !!data?.session, error: error?.message });

        if (error) {
            throw new AppError(error.message, 400, 'REGISTRATION_FAILED');
        }

        if (!data.user) {
            throw new AppError('Registration failed', 400, 'REGISTRATION_FAILED');
        }

        // Create profile (use upsert in case trigger already created it)
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: data.user.id,
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
        const workspacePath = getUserWorkspacePath(data.user.id);
        await fs.mkdir(`${workspacePath}/projects`, { recursive: true });

        // Generate JWT
        const token = jwt.sign(
            { sub: data.user.id, email: data.user.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            data: {
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    username
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
 * Login with email and password
 */
router.post('/login', async (req, res: Response, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        console.log('=== LOGIN ATTEMPT ===');
        console.log('Email:', email);

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        console.log('Supabase signInWithPassword result:', { hasUser: !!data?.user, hasSession: !!data?.session, error: error?.message });

        if (error) {
            // Check if it's an email confirmation issue
            if (error.message?.includes('Email not confirmed') || error.message?.includes('not confirmed')) {
                throw new AppError(
                    'Email not confirmed. Please check your email for a confirmation link, or disable email confirmation in Supabase settings for development.',
                    401,
                    'EMAIL_NOT_CONFIRMED'
                );
            }
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

        res.json({
            success: true,
            data: {
                user: {
                    id: data.user.id,
                    email: data.user.email,
                    username: profile?.username,
                    role: profile?.role
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
 * Handle GitHub OAuth callback (handles both login and linking)
 */
router.get('/github/callback', async (req, res: Response, next) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            throw new AppError('Authorization code missing', 400, 'MISSING_CODE');
        }

        // Decode state to determine action (login or link)
        let action = 'login';
        let linkUserId: string | null = null;

        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
                action = decoded.action || 'login';
                linkUserId = decoded.userId || null;
            } catch {
                // Invalid state, default to login
                action = 'login';
            }
        }

        // Exchange code for access token
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

        // If action is 'link', store the token for the existing user
        if (action === 'link' && linkUserId) {
            // Get GitHub user info for connected_accounts
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    Accept: 'application/vnd.github.v3+json'
                }
            });

            const githubUser = await userResponse.json() as { id: number; email: string; login: string };

            // Save to both tables for backward compatibility
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

            // Redirect back to profile with success flag
            res.redirect(`${config.frontend.url}/profile?github_linked=true`);
            return;
        }

        // Otherwise, handle as login (existing behavior)
        // Get GitHub user info
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });

        const githubUser = await userResponse.json() as { id: number; email: string; login: string };

        // Check if user exists
        const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('username', githubUser.login)
            .single();

        let userId: string;

        if (existingProfile) {
            userId = existingProfile.id;

            // Update GitHub token in both tables
            await supabaseAdmin
                .from('github_tokens')
                .upsert({
                    user_id: userId,
                    access_token: tokenData.access_token
                });

            await supabaseAdmin
                .from('connected_accounts')
                .upsert({
                    user_id: userId,
                    provider: 'github',
                    provider_user_id: githubUser.id.toString(),
                    email: githubUser.email,
                    access_token: tokenData.access_token
                });
        } else {
            // Create new user via Supabase auth
            const tempPassword = Math.random().toString(36).substring(2, 15);
            const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
                email: githubUser.email || `${githubUser.login}@github.local`,
                password: tempPassword,
                email_confirm: true
            });

            if (error || !newUser.user) {
                throw new AppError('Failed to create user', 500, 'USER_CREATION_FAILED');
            }

            userId = newUser.user.id;

            // Create profile
            await supabaseAdmin.from('profiles').insert({
                id: userId,
                username: githubUser.login,
                role: 'user'
            });

            // Store GitHub token in both tables
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

            // Create workspace
            const workspacePath = getUserWorkspacePath(userId);
            await fs.mkdir(`${workspacePath}/projects`, { recursive: true });
        }

        // Generate JWT
        const token = jwt.sign(
            { sub: userId, email: githubUser.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        // Redirect to frontend with token
        res.redirect(`${config.frontend.url}/auth/callback?token=${token}`);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/auth/github/link
 * Initiate GitHub OAuth flow for linking to existing account
 * Note: No authMiddleware because full page redirects don't send Authorization header
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
 * Initiate Google OAuth flow (for login)
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
 * Initiate Google OAuth flow for linking to existing account
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
 * Handle Google OAuth callback (handles both login and linking)
 */
router.get('/google/callback', async (req, res: Response, next) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            throw new AppError('Authorization code missing', 400, 'MISSING_CODE');
        }

        // Decode state to determine action (login or link)
        let action = 'login';
        let linkUserId: string | null = null;

        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString());
                action = decoded.action || 'login';
                linkUserId = decoded.userId || null;
            } catch {
                // Invalid state, default to login
                action = 'login';
            }
        }

        // Exchange code for access token
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

        // Get Google user info
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

        // If action is 'link', store the connection for the existing user
        if (action === 'link' && linkUserId) {
            // Check if this Google account is already linked to another user
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

            // Calculate expiry if provided
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

            // Redirect back to profile with success flag
            res.redirect(`${config.frontend.url}/profile?google_linked=true`);
            return;
        }

        // Otherwise, handle as login
        // Check if user exists by Google ID in connected_accounts
        const { data: existingConnection } = await supabaseAdmin
            .from('connected_accounts')
            .select('user_id')
            .eq('provider', 'google')
            .eq('provider_user_id', googleUser.id)
            .single();

        let userId: string;

        if (existingConnection) {
            userId = existingConnection.user_id;

            // Update tokens
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
        } else {
            // Create new user via Supabase auth
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

            // Create profile
            const username = googleUser.given_name || googleUser.name.split(' ')[0] || googleUser.email.split('@')[0];
            await supabaseAdmin.from('profiles').insert({
                id: userId,
                username: username.toLowerCase().replace(/\s+/g, '_'),
                role: 'user'
            });

            // Store Google connection
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

            // Create workspace
            const workspacePath = getUserWorkspacePath(userId);
            await fs.mkdir(`${workspacePath}/projects`, { recursive: true });
        }

        // Generate JWT
        const token = jwt.sign(
            { sub: userId, email: googleUser.email },
            config.jwt.secret,
            { expiresIn: '7d' }
        );

        // Redirect to frontend with token
        res.redirect(`${config.frontend.url}/auth/callback?token=${token}`);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/auth/logout
 * Logout current session
 */
router.post('/logout', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, data: { message: 'Logged out successfully' } });
});

/**
 * GET /api/auth/session
 * Get current session info
 */
router.get('/session', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    res.json({
        success: true,
        data: { user: req.user }
    });
});

export { router as authRoutes };


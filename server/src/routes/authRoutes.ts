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
router.post('/register', authLimiter, async (req, res: Response, next) => {
    try {
        const { email, password, username } = registerSchema.parse(req.body);

        // Register with Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });

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
router.post('/login', authLimiter, async (req, res: Response, next) => {
    try {
        const { email, password } = loginSchema.parse(req.body);

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
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
 * Initiate GitHub OAuth flow
 */
router.get('/github', (_req, res: Response) => {
    const params = new URLSearchParams({
        client_id: config.github.clientId,
        redirect_uri: config.github.callbackUrl,
        scope: 'user:email repo',
        state: Math.random().toString(36).substring(7)
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GET /api/auth/github/callback
 * Handle GitHub OAuth callback
 */
router.get('/github/callback', async (req, res: Response, next) => {
    try {
        const { code } = req.query;

        if (!code) {
            throw new AppError('Authorization code missing', 400, 'MISSING_CODE');
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

            // Update GitHub token
            await supabaseAdmin
                .from('github_tokens')
                .upsert({
                    user_id: userId,
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

            // Store GitHub token
            await supabaseAdmin.from('github_tokens').insert({
                user_id: userId,
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


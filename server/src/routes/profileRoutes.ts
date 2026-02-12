import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest, authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Validation schema for profile update
const updateProfileSchema = z.object({
    username: z.string().min(3).max(30).optional(),
});

/**
 * GET /api/profile
 * Get current user profile with connected accounts
 */
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const userId = req.user!.id;

        // Get profile
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (profileError || !profile) {
            throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
        }

        // Get connected accounts (without tokens)
        const { data: connectedAccounts, error: accountsError } = await supabaseAdmin
            .from('connected_accounts')
            .select('id, provider, email, created_at')
            .eq('user_id', userId);

        if (accountsError) {
            throw new AppError('Failed to fetch connected accounts', 500, 'FETCH_FAILED');
        }

        res.json({
            success: true,
            data: {
                profile: {
                    id: profile.id,
                    username: profile.username,
                    role: profile.role,
                    storage_quota_mb: profile.storage_quota_mb,
                    storage_used_mb: profile.storage_used_mb,
                    created_at: profile.created_at
                },
                connectedAccounts: connectedAccounts || []
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/profile
 * Update user profile
 */
router.put('/', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const userId = req.user!.id;
        const updates = updateProfileSchema.parse(req.body);

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                throw new AppError('Username already taken', 400, 'USERNAME_TAKEN');
            }
            throw new AppError('Failed to update profile', 500, 'UPDATE_FAILED');
        }

        res.json({
            success: true,
            data: {
                profile: {
                    id: data.id,
                    username: data.username,
                    role: data.role,
                    storage_quota_mb: data.storage_quota_mb,
                    storage_used_mb: data.storage_used_mb,
                    created_at: data.created_at
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/profile/connected-accounts
 * List all connected accounts
 */
router.get('/connected-accounts', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const userId = req.user!.id;

        const { data, error } = await supabaseAdmin
            .from('connected_accounts')
            .select('id, provider, email, created_at')
            .eq('user_id', userId);

        if (error) {
            throw new AppError('Failed to fetch connected accounts', 500, 'FETCH_FAILED');
        }

        res.json({
            success: true,
            data: { connectedAccounts: data || [] }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/profile/disconnect/:provider
 * Disconnect an OAuth account
 */
router.delete('/disconnect/:provider', authMiddleware, async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const userId = req.user!.id;
        const { provider } = req.params;

        if (!['google', 'github'].includes(provider)) {
            throw new AppError('Invalid provider', 400, 'INVALID_PROVIDER');
        }

        // Check if this is the only authentication method
        const { data: connectedAccounts } = await supabaseAdmin
            .from('connected_accounts')
            .select('provider')
            .eq('user_id', userId);

        // Also check if user has email/password auth
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        const hasPasswordAuth = authUser?.user?.app_metadata?.provider === 'email';

        const totalAuthMethods = (connectedAccounts?.length || 0) + (hasPasswordAuth ? 1 : 0);

        if (totalAuthMethods <= 1) {
            throw new AppError(
                'Cannot disconnect your only authentication method',
                400,
                'LAST_AUTH_METHOD'
            );
        }

        // Delete the connected account
        const { error } = await supabaseAdmin
            .from('connected_accounts')
            .delete()
            .eq('user_id', userId)
            .eq('provider', provider);

        if (error) {
            throw new AppError('Failed to disconnect account', 500, 'DISCONNECT_FAILED');
        }

        res.json({
            success: true,
            data: { message: `${provider} account disconnected successfully` }
        });
    } catch (error) {
        next(error);
    }
});

export { router as profileRoutes };

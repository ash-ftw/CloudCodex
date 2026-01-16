import { Router, Response } from 'express';
import Dockerode from 'dockerode';
import { authMiddleware, AuthenticatedRequest, adminMiddleware } from '../middleware/authMiddleware';
import { supabaseAdmin } from '../config/supabase';
import { config } from '../config/index';

const router = Router();
const docker = new Dockerode({ socketPath: config.docker.socket });

router.use(authMiddleware);
router.use(adminMiddleware);

/**
 * GET /api/admin/logs
 * Get execution logs with pagination
 */
router.get('/logs', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;

        const { data: logs, error, count } = await supabaseAdmin
            .from('execution_logs')
            .select('*, projects(name), profiles(username)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data: logs,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/containers
 * Get active Docker containers
 */
router.get('/containers', async (_req: AuthenticatedRequest, res: Response, next) => {
    try {
        const containers = await docker.listContainers({
            filters: {
                label: ['cloudcodex=true']
            }
        });

        res.json({
            success: true,
            data: containers.map((c) => ({
                id: c.Id.slice(0, 12),
                image: c.Image,
                status: c.Status,
                state: c.State,
                created: new Date(c.Created * 1000),
                ports: c.Ports
            }))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/users
 * Get all users with usage stats
 */
router.get('/users', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;

        const { data: users, error, count } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            throw error;
        }

        // Get execution counts per user
        const usersWithStats = await Promise.all(
            (users || []).map(async (user: Record<string, unknown>) => {
                const { count: executionCount } = await supabaseAdmin
                    .from('execution_logs')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user.id);

                const { count: projectCount } = await supabaseAdmin
                    .from('projects')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', user.id);

                return {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    storageQuotaMb: user.storage_quota_mb,
                    storageUsedMb: user.storage_used_mb,
                    createdAt: user.created_at,
                    executionCount: executionCount || 0,
                    projectCount: projectCount || 0
                };
            })
        );

        res.json({
            success: true,
            data: usersWithStats,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/admin/usage
 * Get usage statistics
 */
router.get('/usage', async (_req: AuthenticatedRequest, res: Response, next) => {
    try {
        // Total users
        const { count: totalUsers } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        // Total projects
        const { count: totalProjects } = await supabaseAdmin
            .from('projects')
            .select('*', { count: 'exact', head: true });

        // Total executions
        const { count: totalExecutions } = await supabaseAdmin
            .from('execution_logs')
            .select('*', { count: 'exact', head: true });

        // Executions by status
        const { data: statusCounts } = await supabaseAdmin
            .from('execution_logs')
            .select('status')
            .then(async (result) => {
                const counts: Record<string, number> = {};
                (result.data || []).forEach((log: { status: string }) => {
                    counts[log.status] = (counts[log.status] || 0) + 1;
                });
                return { data: counts };
            });

        // Executions by language
        const { data: languageCounts } = await supabaseAdmin
            .from('execution_logs')
            .select('language')
            .then(async (result) => {
                const counts: Record<string, number> = {};
                (result.data || []).forEach((log: { language: string }) => {
                    counts[log.language] = (counts[log.language] || 0) + 1;
                });
                return { data: counts };
            });

        // Recent activity (last 24 hours)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: recentExecutions } = await supabaseAdmin
            .from('execution_logs')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', oneDayAgo);

        res.json({
            success: true,
            data: {
                users: {
                    total: totalUsers || 0
                },
                projects: {
                    total: totalProjects || 0
                },
                executions: {
                    total: totalExecutions || 0,
                    last24Hours: recentExecutions || 0,
                    byStatus: statusCounts,
                    byLanguage: languageCounts
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/admin/users/:userId/role
 * Update user role
 */
router.post('/users/:userId/role', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!['user', 'admin'].includes(role)) {
            throw new Error('Invalid role');
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ role })
            .eq('id', userId);

        if (error) {
            throw error;
        }

        res.json({ success: true, data: { message: 'Role updated' } });
    } catch (error) {
        next(error);
    }
});

export { router as adminRoutes };


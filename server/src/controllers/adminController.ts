import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { supabaseAdmin } from '../config/supabase';
import { dockerMonitorService } from '../services/dockerMonitorService';
import { auditService } from '../services/auditService';
import { abuseDetectionService } from '../services/abuseDetectionService';
import { AppError } from '../middleware/errorHandler';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { config } from '../config/index';

// ================================================================
// DASHBOARD
// ================================================================

/**
 * GET /api/admin/dashboard
 * Real-time system health summary
 */
export async function getDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        // Parallel queries for speed
        const [
            usersResult,
            projectsResult,
            totalExecResult,
            recentExecResult,
            failedExecResult,
            systemStats,
            activeAlerts
        ] = await Promise.all([
            supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('execution_logs').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('execution_logs')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
            supabaseAdmin.from('execution_logs')
                .select('*', { count: 'exact', head: true })
                .in('status', ['error', 'timeout']),
            dockerMonitorService.getSystemStats().catch(() => ({
                containers: { total: 0, running: 0, paused: 0, stopped: 0 },
                images: 0, cpuCount: 0, totalMemoryMb: 0, usedMemoryMb: 0
            })),
            abuseDetectionService.detectAbusePatterns().catch(() => [])
        ]);

        // Active users (last 24h)
        const { count: activeUsersCount } = await supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gte('last_active_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        res.json({
            success: true,
            data: {
                users: {
                    total: usersResult.count || 0,
                    active: activeUsersCount || 0
                },
                projects: {
                    total: projectsResult.count || 0
                },
                executions: {
                    total: totalExecResult.count || 0,
                    last24Hours: recentExecResult.count || 0,
                    failed: failedExecResult.count || 0
                },
                system: systemStats,
                alerts: activeAlerts
            }
        });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// USERS
// ================================================================

/**
 * GET /api/admin/users
 */
export async function getUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const search = req.query.search as string;
        const status = req.query.status as string;
        const role = req.query.role as string;
        const offset = (page - 1) * limit;

        let query = supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (search) {
            query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
        }
        if (status) {
            query = query.eq('status', status);
        }
        if (role) {
            query = query.eq('role', role);
        }

        const { data: users, error, count } = await query;
        if (error) throw error;

        // Get execution + project counts per user
        const usersWithStats = await Promise.all(
            (users || []).map(async (user: Record<string, unknown>) => {
                const [execResult, projResult] = await Promise.all([
                    supabaseAdmin.from('execution_logs').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
                    supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
                ]);

                return {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    status: user.status || 'active',
                    storageQuotaMb: user.storage_quota_mb,
                    storageUsedMb: user.storage_used_mb,
                    createdAt: user.created_at,
                    lastActiveAt: user.last_active_at,
                    blockedAt: user.blocked_at,
                    blockedReason: user.blocked_reason,
                    executionCount: execResult.count || 0,
                    projectCount: projResult.count || 0
                };
            })
        );

        res.json({
            success: true,
            data: usersWithStats,
            pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/users/:userId
 */
export async function getUserDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { userId } = req.params;

        const { data: user, error } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !user) throw new AppError('User not found', 404, 'NOT_FOUND');

        // Get user's recent activity
        const [execResult, projResult, auditResult] = await Promise.all([
            supabaseAdmin.from('execution_logs')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(20),
            supabaseAdmin.from('projects')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false }),
            supabaseAdmin.from('audit_logs')
                .select('*')
                .eq('target_id', userId)
                .eq('target_type', 'user')
                .order('created_at', { ascending: false })
                .limit(20)
        ]);

        res.json({
            success: true,
            data: {
                ...user,
                recentExecutions: execResult.data || [],
                projects: projResult.data || [],
                auditTrail: auditResult.data || []
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/admin/users/:userId/block
 */
export async function blockUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { userId } = req.params;
        const { reason } = req.body;

        if (userId === req.user!.id) {
            throw new AppError('Cannot block yourself', 400, 'INVALID_OPERATION');
        }

        await abuseDetectionService.blockUser(userId, reason || 'Blocked by admin', req.user!.id);

        res.json({ success: true, data: { message: 'User blocked' } });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/admin/users/:userId/unblock
 */
export async function unblockUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { userId } = req.params;
        await abuseDetectionService.unblockUser(userId, req.user!.id);
        res.json({ success: true, data: { message: 'User unblocked' } });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/admin/users/:userId/role
 */
export async function updateUserRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!['user', 'admin'].includes(role)) {
            throw new AppError('Invalid role', 400, 'INVALID_INPUT');
        }

        if (userId === req.user!.id) {
            throw new AppError('Cannot change your own role', 400, 'INVALID_OPERATION');
        }

        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ role })
            .eq('id', userId);

        if (error) throw error;

        await auditService.log({
            action: 'user.role_change',
            performedBy: req.user!.id,
            targetType: 'user',
            targetId: userId,
            details: { newRole: role },
            severity: 'warning'
        });

        res.json({ success: true, data: { message: 'Role updated' } });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/admin/users/:userId
 */
export async function deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { userId } = req.params;

        if (userId === req.user!.id) {
            throw new AppError('Cannot delete yourself', 400, 'INVALID_OPERATION');
        }

        // Delete from profiles (cascades to projects, logs, etc.)
        const { error } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', userId);

        if (error) throw error;

        await auditService.log({
            action: 'user.delete',
            performedBy: req.user!.id,
            targetType: 'user',
            targetId: userId,
            severity: 'critical'
        });

        res.json({ success: true, data: { message: 'User deleted' } });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// PROJECTS
// ================================================================

/**
 * GET /api/admin/projects
 */
export async function getProjects(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const search = req.query.search as string;
        const offset = (page - 1) * limit;

        let query = supabaseAdmin
            .from('projects')
            .select('*, profiles(username)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (search) {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error, count } = await query;
        if (error) throw error;

        // Calculate workspace sizes
        const projects = (data || []).map((p: any) => {
            let sizeBytes = 0;
            const wsPath = path.join(config.workspace.root, p.id);
            try {
                if (fs.existsSync(wsPath)) {
                    sizeBytes = getDirSizeSync(wsPath);
                }
            } catch (_) { /* ignore */ }

            return {
                id: p.id,
                name: p.name,
                description: p.description,
                language: p.language,
                githubUrl: p.github_url,
                userId: p.user_id,
                username: p.profiles?.username,
                sizeMb: Math.round(sizeBytes / 1024 / 1024 * 100) / 100,
                createdAt: p.created_at,
                updatedAt: p.updated_at
            };
        });

        res.json({
            success: true,
            data: projects,
            pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/projects/:projectId
 */
export async function getProjectDetail(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { projectId } = req.params;

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*, profiles(username)')
            .eq('id', projectId)
            .single();

        if (error || !project) throw new AppError('Project not found', 404, 'NOT_FOUND');

        // Get file listing
        const wsPath = path.join(config.workspace.root, projectId);
        let files: string[] = [];
        let sizeBytes = 0;
        try {
            if (fs.existsSync(wsPath)) {
                files = listFilesRecursive(wsPath, wsPath);
                sizeBytes = getDirSizeSync(wsPath);
            }
        } catch (_) { /* ignore */ }

        // Get execution history
        const { data: executions } = await supabaseAdmin
            .from('execution_logs')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(20);

        res.json({
            success: true,
            data: {
                ...project,
                username: (project as any).profiles?.username,
                files,
                sizeMb: Math.round(sizeBytes / 1024 / 1024 * 100) / 100,
                executions: executions || []
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/admin/projects/:projectId
 */
export async function deleteProject(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { projectId } = req.params;

        // Delete workspace files
        const wsPath = path.join(config.workspace.root, projectId);
        try {
            if (fs.existsSync(wsPath)) {
                fs.rmSync(wsPath, { recursive: true, force: true });
            }
        } catch (_) { /* ignore */ }

        // Delete from DB
        const { error } = await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', projectId);

        if (error) throw error;

        await auditService.log({
            action: 'project.delete',
            performedBy: req.user!.id,
            targetType: 'project',
            targetId: projectId,
            severity: 'warning'
        });

        res.json({ success: true, data: { message: 'Project deleted' } });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/projects/:projectId/download
 */
export async function downloadProject(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { projectId } = req.params;

        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('name')
            .eq('id', projectId)
            .single();

        const wsPath = path.join(config.workspace.root, projectId);
        if (!fs.existsSync(wsPath)) {
            throw new AppError('Project workspace not found', 404, 'NOT_FOUND');
        }

        const zipName = `${project?.name || projectId}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.pipe(res);
        archive.directory(wsPath, false);
        await archive.finalize();

        await auditService.log({
            action: 'project.download',
            performedBy: req.user!.id,
            targetType: 'project',
            targetId: projectId,
            severity: 'info'
        });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// EXECUTIONS
// ================================================================

/**
 * GET /api/admin/executions/active
 */
export async function getActiveExecutions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        // Get running containers with stats
        const [containers, stats] = await Promise.all([
            dockerMonitorService.listContainers(false),
            dockerMonitorService.getAllContainerStats()
        ]);

        const statsMap = new Map(stats.map(s => [s.id, s]));

        const activeExecutions = containers.map(c => {
            const containerStats = statsMap.get(c.id);
            return {
                containerId: c.id,
                image: c.image,
                status: c.status,
                state: c.state,
                created: c.created,
                labels: c.labels,
                userId: c.labels?.['user_id'] || 'unknown',
                language: c.labels?.['language'] || c.image.replace('cloudcodex-', ''),
                projectId: c.labels?.['project_id'] || 'unknown',
                cpu: containerStats?.cpuPercent || 0,
                memoryMb: containerStats?.memoryUsageMb || 0,
                memoryLimitMb: containerStats?.memoryLimitMb || 0,
                memoryPercent: containerStats?.memoryPercent || 0,
                pids: containerStats?.pids || 0
            };
        });

        res.json({ success: true, data: activeExecutions });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/executions/:containerId/kill
 */
export async function killExecution(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.killContainer(containerId);

        if (!result.success) {
            throw new AppError(result.message, 500, 'KILL_FAILED');
        }

        await auditService.log({
            action: 'execution.kill',
            performedBy: req.user!.id,
            targetType: 'container',
            targetId: containerId,
            severity: 'warning'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/executions/:containerId/logs
 */
export async function getExecutionLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const tail = parseInt(req.query.tail as string) || 200;
        const logs = await dockerMonitorService.getContainerLogs(containerId, tail);
        res.json({ success: true, data: { logs } });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// CONTAINERS
// ================================================================

/**
 * GET /api/admin/containers
 */
export async function getContainers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const all = req.query.all === 'true';
        const containers = await dockerMonitorService.listContainers(all);
        const stats = await dockerMonitorService.getAllContainerStats();
        const statsMap = new Map(stats.map(s => [s.id, s]));

        const data = containers.map(c => ({
            ...c,
            stats: statsMap.get(c.id) || null
        }));

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/containers/:containerId/stop
 */
export async function stopContainer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.stopContainer(containerId);

        await auditService.log({
            action: 'container.stop',
            performedBy: req.user!.id,
            targetType: 'container',
            targetId: containerId,
            severity: 'info'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/containers/:containerId/restart
 */
export async function restartContainer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.restartContainer(containerId);

        await auditService.log({
            action: 'container.restart',
            performedBy: req.user!.id,
            targetType: 'container',
            targetId: containerId,
            severity: 'info'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/admin/containers/:containerId
 */
export async function removeContainer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.removeContainer(containerId);

        await auditService.log({
            action: 'container.remove',
            performedBy: req.user!.id,
            targetType: 'container',
            targetId: containerId,
            severity: 'warning'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/containers/:containerId/pause
 */
export async function pauseContainer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.pauseContainer(containerId);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/containers/:containerId/unpause
 */
export async function unpauseContainer(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { containerId } = req.params;
        const result = await dockerMonitorService.unpauseContainer(containerId);
        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/admin/containers/cleanup
 */
export async function cleanupContainers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const maxAgeHours = parseInt(req.body.maxAgeHours as string) || 24;
        const result = await dockerMonitorService.cleanupOldContainers(maxAgeHours);

        await auditService.log({
            action: 'container.cleanup',
            performedBy: req.user!.id,
            targetType: 'system',
            targetId: 'containers',
            details: { maxAgeHours, removed: result.removed, errors: result.errors },
            severity: 'info'
        });

        res.json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// LOGS & AUDIT
// ================================================================

/**
 * GET /api/admin/logs
 */
export async function getExecutionLogsList(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;
        const userId = req.query.userId as string;
        const status = req.query.status as string;
        const language = req.query.language as string;

        let query = supabaseAdmin
            .from('execution_logs')
            .select('*, projects(name), profiles(username)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (userId) query = query.eq('user_id', userId);
        if (status) query = query.eq('status', status);
        if (language) query = query.eq('language', language);

        const { data, error, count } = await query;
        if (error) throw error;

        res.json({
            success: true,
            data: data || [],
            pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/audit-logs
 */
export async function getAuditLogs(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const result = await auditService.query({
            action: req.query.action as string,
            performedBy: req.query.performedBy as string,
            targetType: req.query.targetType as string,
            severity: req.query.severity as string,
            startDate: req.query.startDate as string,
            endDate: req.query.endDate as string,
            page: parseInt(req.query.page as string) || 1,
            limit: parseInt(req.query.limit as string) || 50
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// ANALYTICS
// ================================================================

/**
 * GET /api/admin/analytics
 */
export async function getAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const days = parseInt(req.query.days as string) || 7;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        // Parallel data queries
        const [
            execResult,
            langResult,
            statusResult,
            usersResult,
            topUsersResult
        ] = await Promise.all([
            // Executions over time
            supabaseAdmin.from('execution_logs')
                .select('created_at, language, status, execution_time_ms, memory_used_mb')
                .gte('created_at', startDate)
                .order('created_at', { ascending: true }),

            // Language distribution
            supabaseAdmin.from('execution_logs')
                .select('language')
                .gte('created_at', startDate),

            // Status distribution
            supabaseAdmin.from('execution_logs')
                .select('status')
                .gte('created_at', startDate),

            // User growth
            supabaseAdmin.from('profiles')
                .select('created_at')
                .order('created_at', { ascending: true }),

            // Top active users
            supabaseAdmin.from('execution_logs')
                .select('user_id, profiles(username)')
                .gte('created_at', startDate)
        ]);

        // Process executions per hour
        const execsPerHour: Record<string, number> = {};
        for (const log of (execResult.data || []) as any[]) {
            const hour = new Date(log.created_at).toISOString().slice(0, 13) + ':00:00Z';
            execsPerHour[hour] = (execsPerHour[hour] || 0) + 1;
        }

        // Language distribution
        const langCounts: Record<string, number> = {};
        for (const log of (langResult.data || []) as any[]) {
            langCounts[log.language] = (langCounts[log.language] || 0) + 1;
        }

        // Status distribution
        const statusCounts: Record<string, number> = {};
        for (const log of (statusResult.data || []) as any[]) {
            statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
        }

        // Top users
        const userExecCounts: Record<string, { count: number; username: string }> = {};
        for (const log of (topUsersResult.data || []) as any[]) {
            const uid = log.user_id;
            if (!userExecCounts[uid]) {
                userExecCounts[uid] = { count: 0, username: log.profiles?.username || uid };
            }
            userExecCounts[uid].count++;
        }
        const topUsers = Object.entries(userExecCounts)
            .map(([userId, data]) => ({ userId, username: data.username, executions: data.count }))
            .sort((a, b) => b.executions - a.executions)
            .slice(0, 10);

        // Average execution time and memory
        const execData = (execResult.data || []) as any[];
        const avgTimeMs = execData.length > 0
            ? execData.reduce((acc, l) => acc + (l.execution_time_ms || 0), 0) / execData.length
            : 0;
        const avgMemMb = execData.length > 0
            ? execData.reduce((acc, l) => acc + (l.memory_used_mb || 0), 0) / execData.length
            : 0;

        // Daily user registrations
        const dailyRegistrations: Record<string, number> = {};
        for (const user of (usersResult.data || []) as any[]) {
            const day = new Date(user.created_at).toISOString().slice(0, 10);
            dailyRegistrations[day] = (dailyRegistrations[day] || 0) + 1;
        }

        res.json({
            success: true,
            data: {
                executionsPerHour: execsPerHour,
                languageDistribution: langCounts,
                statusDistribution: statusCounts,
                topUsers,
                averageExecutionTimeMs: Math.round(avgTimeMs),
                averageMemoryUsageMb: Math.round(avgMemMb * 100) / 100,
                dailyRegistrations,
                totalExecutionsInPeriod: execData.length
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/admin/analytics/export
 * Export analytics as CSV
 */
export async function exportAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const { data: logs } = await supabaseAdmin
            .from('execution_logs')
            .select('*, profiles(username), projects(name)')
            .gte('created_at', startDate)
            .order('created_at', { ascending: false });

        // Build CSV
        const headers = ['Timestamp', 'User', 'Project', 'Language', 'Status', 'Duration (ms)', 'Memory (MB)', 'Exit Code'];
        const rows = (logs || []).map((log: any) => [
            log.created_at,
            log.profiles?.username || log.user_id,
            log.projects?.name || log.project_id,
            log.language,
            log.status,
            log.execution_time_ms || '',
            log.memory_used_mb || '',
            log.exit_code ?? ''
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');

        await auditService.log({
            action: 'analytics.export',
            performedBy: req.user!.id,
            targetType: 'system',
            targetId: 'analytics',
            severity: 'info'
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="cloudcodex-analytics-${days}d.csv"`);
        res.send(csv);
    } catch (error) {
        next(error);
    }
}

// ================================================================
// SETTINGS
// ================================================================

/**
 * GET /api/admin/settings
 */
export async function getSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { data, error } = await supabaseAdmin
            .from('system_settings')
            .select('*')
            .order('key');

        if (error) throw error;

        res.json({ success: true, data: data || [] });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/admin/settings
 */
export async function updateSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const { settings } = req.body as { settings: Record<string, string> };

        if (!settings || typeof settings !== 'object') {
            throw new AppError('Settings object required', 400, 'INVALID_INPUT');
        }

        for (const [key, value] of Object.entries(settings)) {
            await abuseDetectionService.updateSetting(key, value, req.user!.id);
        }

        res.json({ success: true, data: { message: 'Settings updated' } });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// ABUSE DETECTION
// ================================================================

/**
 * GET /api/admin/alerts
 */
export async function getAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const alerts = await abuseDetectionService.detectAbusePatterns();
        res.json({ success: true, data: alerts });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// USAGE (backward compatibility)
// ================================================================
export async function getUsage(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        const [usersResult, projectsResult, totalExecResult, recentExecResult] = await Promise.all([
            supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('execution_logs').select('*', { count: 'exact', head: true }),
            supabaseAdmin.from('execution_logs')
                .select('*', { count: 'exact', head: true })
                .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        ]);

        // Language and status counts
        const { data: allLogs } = await supabaseAdmin.from('execution_logs').select('language, status');
        const byLanguage: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const log of (allLogs || []) as any[]) {
            byLanguage[log.language] = (byLanguage[log.language] || 0) + 1;
            byStatus[log.status] = (byStatus[log.status] || 0) + 1;
        }

        res.json({
            success: true,
            data: {
                users: { total: usersResult.count || 0 },
                projects: { total: projectsResult.count || 0 },
                executions: {
                    total: totalExecResult.count || 0,
                    last24Hours: recentExecResult.count || 0,
                    byStatus,
                    byLanguage
                }
            }
        });
    } catch (error) {
        next(error);
    }
}

// ================================================================
// HELPERS
// ================================================================

function getDirSizeSync(dirPath: string): number {
    let total = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                total += getDirSizeSync(fullPath);
            } else {
                total += fs.statSync(fullPath).size;
            }
        }
    } catch (_) { /* ignore */ }
    return total;
}

function listFilesRecursive(dirPath: string, basePath: string): string[] {
    const files: string[] = [];
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                files.push(...listFilesRecursive(fullPath, basePath));
            } else {
                files.push(relativePath);
            }
        }
    } catch (_) { /* ignore */ }
    return files;
}

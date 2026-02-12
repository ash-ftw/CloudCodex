import { Router } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware';
import {
    getDashboard,
    getUsers,
    getUserDetail,
    blockUser,
    unblockUser,
    updateUserRole,
    deleteUser,
    getProjects,
    getProjectDetail,
    deleteProject,
    downloadProject,
    getActiveExecutions,
    killExecution,
    getExecutionLogs,
    getContainers,
    stopContainer,
    restartContainer,
    removeContainer,
    pauseContainer,
    unpauseContainer,
    cleanupContainers,
    getExecutionLogsList,
    getAuditLogs,
    getAnalytics,
    exportAnalytics,
    getSettings,
    updateSettings,
    getAlerts,
    getUsage
} from '../controllers/adminController';

const router = Router();

// All admin routes require auth + admin role
router.use(authMiddleware);
router.use(adminMiddleware);

// ── Dashboard ──────────────────────────────────────────
router.get('/dashboard', getDashboard);
router.get('/usage', getUsage); // backward compat

// ── Users ──────────────────────────────────────────────
router.get('/users', getUsers);
router.get('/users/:userId', getUserDetail);
router.put('/users/:userId/block', blockUser);
router.put('/users/:userId/unblock', unblockUser);
router.put('/users/:userId/role', updateUserRole);
router.post('/users/:userId/role', updateUserRole); // backward compat
router.delete('/users/:userId', deleteUser);

// ── Projects ───────────────────────────────────────────
router.get('/projects', getProjects);
router.get('/projects/:projectId', getProjectDetail);
router.delete('/projects/:projectId', deleteProject);
router.get('/projects/:projectId/download', downloadProject);

// ── Executions ─────────────────────────────────────────
router.get('/executions/active', getActiveExecutions);
router.post('/executions/:containerId/kill', killExecution);
router.get('/executions/:containerId/logs', getExecutionLogs);

// ── Containers ─────────────────────────────────────────
router.get('/containers', getContainers);
router.post('/containers/:containerId/stop', stopContainer);
router.post('/containers/:containerId/restart', restartContainer);
router.post('/containers/:containerId/pause', pauseContainer);
router.post('/containers/:containerId/unpause', unpauseContainer);
router.delete('/containers/:containerId', removeContainer);
router.post('/containers/cleanup', cleanupContainers);

// ── Logs & Audit ───────────────────────────────────────
router.get('/logs', getExecutionLogsList);
router.get('/audit-logs', getAuditLogs);

// ── Analytics ──────────────────────────────────────────
router.get('/analytics', getAnalytics);
router.get('/analytics/export', exportAnalytics);

// ── Settings ───────────────────────────────────────────
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

// ── Alerts / Abuse Detection ───────────────────────────
router.get('/alerts', getAlerts);

export { router as adminRoutes };


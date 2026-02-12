import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import * as gitDockerService from '../services/gitDockerService';

/**
 * Git Controller (Docker-based)
 * 
 * All git operations are delegated to a Docker container (cloudcodex-git-worker).
 * The server never runs git locally. Files live in Supabase Storage (cloud),
 * and the container downloads them, performs the operation, and uploads results.
 */

/**
 * Helper: run a git operation and handle errors uniformly
 */
async function runOp(
    operation: string,
    userId: string,
    projectId: string,
    data: Record<string, any> = {}
) {
    const result = await gitDockerService.runGitOperation(operation, userId, projectId, data);

    if (!result.success) {
        throw new AppError(
            result.error || `Git operation '${operation}' failed`,
            500,
            'GIT_OPERATION_FAILED'
        );
    }

    return result.data;
}

/**
 * GET /api/git/:projectId/validate
 * Validate all prerequisites for pushing to GitHub
 */
export async function validatePushPrerequisites(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('validate', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/git/:projectId/check-repo
 * Check if directory is a Git repository
 */
export async function checkGitRepo(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('check-repo', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/git/:projectId/remote
 * List all remotes
 */
export async function listRemotes(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('list-remotes', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/remote
 * Add remote origin
 */
export async function addRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;
        const { url, branch = 'main' } = req.body;

        if (!url) {
            throw new AppError('Repository URL is required', 400, 'MISSING_URL');
        }

        // Validate GitHub URL format
        const githubUrlPattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+\.git$/;
        if (!githubUrlPattern.test(url) && !url.endsWith('.git')) {
            throw new AppError(
                'Invalid GitHub URL format. Use: https://github.com/username/repo.git',
                400,
                'INVALID_URL'
            );
        }

        const data = await runOp('add-remote', userId, projectId, { url, branch });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/git/:projectId/remote
 * Remove remote
 */
export async function removeRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;
        const { name = 'origin' } = req.body;

        const data = await runOp('remove-remote', userId, projectId, { name });

        // Clear GitHub URL from project if removing origin
        // (Also done in container, but kept here for extra safety)

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/init
 * Initialize a git repository
 */
export async function initRepo(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('init', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/git/:projectId/status
 * Get git status
 */
export async function getStatus(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('status', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/add
 * Stage files
 */
export async function stageFiles(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;
        const { files } = req.body;

        const data = await runOp('add', userId, projectId, { files });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/commit
 * Commit staged changes
 */
export async function commitChanges(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;
        const { message } = req.body;

        if (!message || !message.trim()) {
            throw new AppError('Commit message is required', 400, 'MISSING_MESSAGE');
        }

        const data = await runOp('commit', userId, projectId, { message });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/push
 * Push to remote
 */
export async function pushToRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('push', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/pull
 * Pull from remote
 */
export async function pullFromRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const data = await runOp('pull', userId, projectId);

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/git/:projectId/clone
 * Clone a repository
 */
export async function cloneRepo(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;
        const { url, branch } = req.body;

        if (!url) {
            throw new AppError('Repository URL is required', 400, 'MISSING_URL');
        }

        const data = await runOp('clone', userId, projectId, { url, branch });

        res.json({ success: true, data });
    } catch (error) {
        next(error);
    }
}

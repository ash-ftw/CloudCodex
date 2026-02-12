import { Router, Response } from 'express';
import { z } from 'zod';
import simpleGit, { SimpleGit } from 'simple-git';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { getProjectPath, resolveProjectPath } from '../utils/pathSecurity';
import { supabaseAdmin } from '../config/supabase';
import * as storageService from '../services/storageService';
import * as gitWorkspaceCache from '../services/gitWorkspaceCache';
import {
    validatePushPrerequisites,
    checkGitRepo,
    listRemotes,
    addRemote,
    removeRemote
} from '../controllers/gitController';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const router = Router();

router.use(authMiddleware);

const cloneSchema = z.object({
    url: z.string().url(),
    branch: z.string().optional()
});

const commitSchema = z.object({
    message: z.string().min(1).max(500)
});

const addSchema = z.object({
    files: z.array(z.string()).optional() // Empty means add all
});

/**
 * Setup Git workspace using persistent cache (optimized)
 */
async function setupGitWorkspace(userId: string, projectId: string): Promise<{
    workspace: gitWorkspaceCache.CachedWorkspace;
    tempDir: string | null;
}> {
    const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
    await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);
    return { workspace, tempDir: null };
}

/**
 * Backward compatibility: legacy temp workspace function
 * TODO: Remove this after all routes are updated
 */
async function setupTempGitWorkspace(userId: string, projectId: string): Promise<{
    tempDir: string;
    git: SimpleGit;
}> {
    const { workspace } = await setupGitWorkspace(userId, projectId);
    return { tempDir: workspace.dir, git: workspace.git };
}



/**
 * POST /api/git/:projectId/init
 * Initialize a git repository
 */
router.post('/:projectId/init', async (req: AuthenticatedRequest, res: Response, next) => {
    let workspace: gitWorkspaceCache.CachedWorkspace | null = null;

    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        // Get workspace and sync from cloud
        workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        // Initialize Git
        await workspace.git.init();
        console.log(`[Git Init] ✓ Git initialized`);

        // Configure Git user
        await workspace.git.addConfig('user.email', 'cloudcodex@local', false, 'local');
        await workspace.git.addConfig('user.name', 'CloudCodeX User', false, 'local');
        console.log(`[Git Init] ✓ Git configured`);

        // Create .gitignore
        const gitignore = `# CloudCodeX defaults
node_modules/
.env
*.log
__pycache__/
*.pyc
.DS_Store
`;
        await fs.writeFile(path.join(workspace.dir, '.gitignore'), gitignore);
        console.log(`[Git Init] ✓ .gitignore created`);

        // Upload everything back to cloud (including .git folder)
        await gitWorkspaceCache.syncToCloud(userId, projectId, workspace);

        res.json({
            success: true,
            data: { message: 'Git repository initialized' }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/git/:projectId/validate
 * Validate all push prerequisites
 */
router.get('/:projectId/validate', validatePushPrerequisites);

/**
 * GET /api/git/:projectId/check-repo
 * Check if directory is a Git repository
 */
router.get('/:projectId/check-repo', checkGitRepo);

/**
 * GET /api/git/:projectId/remote
 * List all remotes
 */
router.get('/:projectId/remote', listRemotes);

/**
 * POST /api/git/:projectId/remote
 * Add remote origin
 */
router.post('/:projectId/remote', addRemote);

/**
 * DELETE /api/git/:projectId/remote
 * Remove remote
 */
router.delete('/:projectId/remote', removeRemote);

/**
 * POST /api/git/:projectId/clone
 * Clone a repository (not commonly used with cloud storage)
 */
router.post('/:projectId/clone', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { url, branch } = cloneSchema.parse(req.body);
        const userId = req.user!.id;

        console.log(`[Git Clone] Cloning ${url} to project ${projectId}`);

        // Get workspace
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);

        // Get user's token for authenticated cloning
        const { data: tokenData } = await supabaseAdmin
            .from('github_tokens')
            .select('access_token')
            .eq('user_id', userId)
            .single();

        let cloneUrl = url;
        if (tokenData?.access_token && url.includes('github.com')) {
            cloneUrl = url.replace('https://', `https://${tokenData.access_token}@`);
        }

        const options: string[] = ['--depth', '1'];
        if (branch) {
            options.push('--branch', branch);
        }

        await workspace.git.clone(cloneUrl, workspace.dir, options);

        // Sync cloned files to cloud
        await gitWorkspaceCache.syncToCloud(userId, projectId, workspace);

        // Update project with GitHub URL
        await supabaseAdmin
            .from('projects')
            .update({ github_url: url })
            .eq('id', projectId);

        res.json({
            success: true,
            data: { message: 'Repository cloned successfully' }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/git/:projectId/status
 * Get git status
 */
router.get('/:projectId/status', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        // Get workspace WITHOUT syncing (read-only for status check)
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);

        const status = await workspace.git.status();

        res.json({
            success: true,
            data: {
                current: status.current,
                tracking: status.tracking,
                ahead: status.ahead,
                behind: status.behind,
                staged: status.staged,
                modified: status.modified,
                deleted: status.deleted,
                created: status.created,
                conflicted: status.conflicted,
                isClean: status.isClean()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/git/:projectId/add
 * Stage files
 */
router.post('/:projectId/add', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { files } = addSchema.parse(req.body);
        const userId = req.user!.id;

        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        if (files && files.length > 0) {
            await workspace.git.add(files);
        } else {
            await workspace.git.add('.');
        }

        // Sync only .git folder (staging info is in .git/index)
        await gitWorkspaceCache.syncGitFolderToCloud(userId, projectId, workspace);

        res.json({
            success: true,
            data: { message: 'Files staged' }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/git/:projectId/commit
 * Commit staged changes
 */
router.post('/:projectId/commit', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { message } = commitSchema.parse(req.body);
        const userId = req.user!.id;

        // Get workspace WITHOUT syncing - files are already staged
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);

        const result = await workspace.git.commit(message);

        // Sync only .git folder (commits only change .git/objects, .git/logs, etc)
        await gitWorkspaceCache.syncGitFolderToCloud(userId, projectId, workspace);

        res.json({
            success: true,
            data: {
                commit: result.commit,
                summary: {
                    changed: result.summary.changes,
                    insertions: result.summary.insertions,
                    deletions: result.summary.deletions
                }
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/git/:projectId/pull
 * Pull from remote
 */
router.post('/:projectId/pull', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        const result = await workspace.git.pull();

        // Sync pulled changes back to cloud
        await gitWorkspaceCache.syncToCloud(userId, projectId, workspace);

        res.json({
            success: true,
            data: {
                summary: result.summary,
                created: result.created,
                deleted: result.deleted
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/git/:projectId/push
 * Push to remote
 */
router.post('/:projectId/push', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        await workspace.git.push();

        res.json({
            success: true,
            data: { message: 'Pushed successfully' }
        });
    } catch (error) {
        next(error);
    }
});

export { router as gitRoutes };


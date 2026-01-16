import { Router, Response } from 'express';
import { z } from 'zod';
import simpleGit, { SimpleGit } from 'simple-git';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { getProjectPath, resolveProjectPath } from '../utils/pathSecurity';
import { supabaseAdmin } from '../config/supabase';
import fs from 'fs/promises';

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
 * Get SimpleGit instance for a project with user's GitHub token
 */
async function getGitInstance(userId: string, projectId: string): Promise<{
    git: SimpleGit;
    projectPath: string;
}> {
    const projectPath = getProjectPath(userId, projectId);

    // Get user's GitHub token if available
    const { data: tokenData } = await supabaseAdmin
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    const gitOptions: Record<string, unknown> = {
        baseDir: projectPath,
        maxConcurrentProcesses: 1
    };

    const git = simpleGit(gitOptions);

    // Configure credentials if token exists
    if (tokenData?.access_token) {
        await git.addConfig('credential.helper', 'store');
        await git.addConfig('user.email', 'cloudcodex@local');
        await git.addConfig('user.name', 'CloudCodeX User');
    }

    return { git, projectPath };
}

/**
 * POST /api/git/:projectId/init
 * Initialize a git repository
 */
router.post('/:projectId/init', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { git, projectPath } = await getGitInstance(req.user!.id, projectId);

        await git.init();

        // Create .gitignore
        const gitignore = `# CloudCodeX defaults
node_modules/
.env
*.log
__pycache__/
*.pyc
.DS_Store
`;
        await fs.writeFile(`${projectPath}/.gitignore`, gitignore);

        res.json({
            success: true,
            data: { message: 'Git repository initialized' }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/git/:projectId/clone
 * Clone a repository
 */
router.post('/:projectId/clone', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { url, branch } = cloneSchema.parse(req.body);
        const { git, projectPath } = await getGitInstance(req.user!.id, projectId);

        // Get user's token for authenticated cloning
        const { data: tokenData } = await supabaseAdmin
            .from('github_tokens')
            .select('access_token')
            .eq('user_id', req.user!.id)
            .single();

        let cloneUrl = url;
        // Add token to URL for private repos
        if (tokenData?.access_token && url.includes('github.com')) {
            cloneUrl = url.replace('https://', `https://${tokenData.access_token}@`);
        }

        const options: string[] = ['--depth', '1'];
        if (branch) {
            options.push('--branch', branch);
        }

        await git.clone(cloneUrl, '.', options);

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
        const { git } = await getGitInstance(req.user!.id, projectId);

        const status = await git.status();

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
        const { git } = await getGitInstance(req.user!.id, projectId);

        if (files && files.length > 0) {
            // Validate each file path
            for (const file of files) {
                const resolved = resolveProjectPath(req.user!.id, projectId, file);
                if (!resolved) {
                    throw new AppError(`Invalid path: ${file}`, 400, 'INVALID_PATH');
                }
            }
            await git.add(files);
        } else {
            await git.add('.');
        }

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
        const { git } = await getGitInstance(req.user!.id, projectId);

        const result = await git.commit(message);

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
        const { git } = await getGitInstance(req.user!.id, projectId);

        const result = await git.pull();

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
        const { git } = await getGitInstance(req.user!.id, projectId);

        // Get user's GitHub token
        const { data: tokenData } = await supabaseAdmin
            .from('github_tokens')
            .select('access_token')
            .eq('user_id', req.user!.id)
            .single();

        if (!tokenData?.access_token) {
            throw new AppError('GitHub authentication required for push', 401, 'GITHUB_AUTH_REQUIRED');
        }

        await git.push();

        res.json({
            success: true,
            data: { message: 'Pushed successfully' }
        });
    } catch (error) {
        next(error);
    }
});

export { router as gitRoutes };


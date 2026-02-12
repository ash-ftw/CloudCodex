import { Response } from 'express';
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { supabaseAdmin } from '../config/supabase';
import * as storageService from '../services/storageService';
import * as gitWorkspaceCache from '../services/gitWorkspaceCache';

interface ValidationResponse {
    gitInitialized: boolean;
    githubAuthenticated: boolean;
    remoteConfigured: boolean;
    hasCommits: boolean;
    canPush: boolean;
    remote?: {
        name: string;
        url: string;
    };
}

interface Remote {
    name: string;
    url: string;
}

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
 */
async function setupTempGitWorkspace(userId: string, projectId: string): Promise<{
    tempDir: string;
    git: SimpleGit;
}> {
    const { workspace } = await setupGitWorkspace(userId, projectId);
    return { tempDir: workspace.dir, git: workspace.git };
}

/**
 * Download ALL files from cloud storage (non-recursive, flat search)
 */
async function downloadAllProjectFiles(
    userId: string,
    projectId: string,
    tempDir: string
): Promise<number> {
    console.log(`[Git Download] Getting all files for project ${projectId}...`);

    // Use the storage service's recursive list function
    const allFiles = await storageService.listAllFilesRecursive(userId, projectId, '');

    console.log(`[Git Download] Found ${allFiles.length} total files`);
    let downloadCount = 0;

    for (const file of allFiles) {
        if (file.isDirectory) {
            continue; // Skip directory markers
        }

        try {
            console.log(`[Git Download] Downloading: ${file.path}`);
            const buffer = await storageService.downloadFile(userId, projectId, file.path);
            const localPath = path.join(tempDir, file.path);

            await fs.mkdir(path.dirname(localPath), { recursive: true });
            await fs.writeFile(localPath, buffer);
            downloadCount++;
        } catch (error: any) {
            console.error(`[Git Download] Failed to download ${file.path}:`, error.message);
        }
    }

    // Create essential Git directories that might not exist in cloud storage (empty dirs)
    const gitDir = path.join(tempDir, '.git');
    const requiredDirs = [
        path.join(gitDir, 'refs', 'heads'),
        path.join(gitDir, 'refs', 'tags'),
        path.join(gitDir, 'objects', 'info'),
        path.join(gitDir, 'objects', 'pack')
    ];

    for (const dir of requiredDirs) {
        try {
            await fs.mkdir(dir, { recursive: true });
            console.log(`[Git Download] Created directory: ${path.relative(tempDir, dir)}`);
        } catch (error) {
            // Directory might already exist
        }
    }

    console.log(`[Git Download] Downloaded ${downloadCount} files successfully`);
    return downloadCount;
}

/**
 * Cleanup temporary directory
 */
async function cleanupTemp(tempDir: string): Promise<void> {
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
        console.error(`Failed to cleanup temp directory:`, error);
    }
}

/**
 * Sync files from temp to cloud
 */
async function syncTempToCloud(userId: string, projectId: string, tempDir: string): Promise<void> {
    const files = await getAllFilesRecursive(tempDir);

    for (const file of files) {
        const buffer = await fs.readFile(file.fullPath);
        await storageService.uploadFile(userId, projectId, file.relativePath, buffer);
    }
}

/**
 * Get all files recursively
 */
async function getAllFilesRecursive(dirPath: string): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const files: Array<{ fullPath: string; relativePath: string }> = [];

    async function scan(currentPath: string, basePath: string) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                await scan(fullPath, basePath);
            } else {
                files.push({ fullPath, relativePath });
            }
        }
    }

    await scan(dirPath, dirPath);
    return files;
}

/**
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

        // Get workspace WITHOUT syncing (read-only for validation)
        // This prevents repeated downloads on every validation call
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        const git = workspace.git;

        console.log(`[Git Validate] Using cached workspace for validation`);

        const validation: ValidationResponse = {
            gitInitialized: false,
            githubAuthenticated: false,
            remoteConfigured: false,
            hasCommits: false,
            canPush: false
        };

        // Check 1: Is Git initialized?
        try {
            await git.revparse(['--is-inside-work-tree']);
            validation.gitInitialized = true;
        } catch (error: any) {
            validation.gitInitialized = false;
        }

        // Check 2: Does user have GitHub token?
        const { data: tokenData } = await supabaseAdmin
            .from('github_tokens')
            .select('access_token')
            .eq('user_id', userId)
            .single();

        validation.githubAuthenticated = !!tokenData?.access_token;

        // Check 3: Is remote configured?
        const { data: projectData } = await supabaseAdmin
            .from('projects')
            .select('github_url')
            .eq('user_id', userId)
            .eq('id', projectId)
            .single();

        if (projectData?.github_url) {
            validation.remoteConfigured = true;
            validation.remote = {
                name: 'origin',
                url: projectData.github_url
            };
        }

        // Check 4: Are there commits?
        if (validation.gitInitialized) {
            try {
                await git.log(['-1']);
                validation.hasCommits = true;
            } catch {
                validation.hasCommits = false;
            }
        }

        // Check 5: Are there uncommitted changes?
        let hasUncommittedChanges = false;
        if (validation.gitInitialized) {
            try {
                const status = await git.status();
                hasUncommittedChanges = !status.isClean();
            } catch {
                hasUncommittedChanges = false;
            }
        }

        validation.canPush =
            validation.gitInitialized &&
            validation.githubAuthenticated &&
            validation.remoteConfigured &&
            validation.hasCommits &&
            !hasUncommittedChanges;

        res.json({
            success: true,
            data: {
                ...validation,
                hasUncommittedChanges
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Check if directory is a Git repository
 */
export async function checkGitRepo(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    let tempDir: string | null = null;

    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const workspace = await setupTempGitWorkspace(userId, projectId);
        tempDir = workspace.tempDir;
        const git = workspace.git;

        let isRepo = false;
        try {
            await git.revparse(['--is-inside-work-tree']);
            isRepo = true;
        } catch {
            isRepo = false;
        }

        res.json({
            success: true,
            data: { isRepo }
        });
    } catch (error) {
        next(error);
    } finally {
        if (tempDir) await cleanupTemp(tempDir);
    }
}

/**
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

        // Get workspace WITHOUT syncing (read-only operation)
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);

        const remotes = await workspace.git.getRemotes(true);
        const formattedRemotes: Remote[] = remotes.map(r => ({
            name: r.name,
            url: r.refs.fetch || r.refs.push || ''
        }));

        res.json({
            success: true,
            data: formattedRemotes
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Add remote origin
 */
export async function addRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const { url, branch = 'main' } = req.body;
        const userId = req.user!.id;

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

        // Get workspace and sync from cloud
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        // Check if origin already exists
        const remotes = await workspace.git.getRemotes();
        const originExists = remotes.some(r => r.name === 'origin');

        if (originExists) {
            await workspace.git.removeRemote('origin');
        }

        // Add remote
        await workspace.git.addRemote('origin', url);

        // Set upstream branch
        try {
            await workspace.git.branch(['-M', branch]);
        } catch {
            // Branch might not exist, ignore
        }

        // Sync only .git folder to cloud (.git/config updated)
        await gitWorkspaceCache.syncGitFolderToCloud(userId, projectId, workspace);

        // Update project with GitHub URL
        await supabaseAdmin
            .from('projects')
            .update({ github_url: url })
            .eq('id', projectId);

        res.json({
            success: true,
            data: {
                message: 'Remote added successfully',
                remote: { name: 'origin', url },
                branch
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Remove remote
 */
export async function removeRemote(
    req: AuthenticatedRequest,
    res: Response,
    next: Function
): Promise<void> {
    try {
        const { projectId } = req.params;
        const { name = 'origin' } = req.body;
        const userId = req.user!.id;

        // Get workspace and sync from cloud
        const workspace = await gitWorkspaceCache.getWorkspace(userId, projectId);
        await gitWorkspaceCache.syncFromCloud(userId, projectId, workspace);

        await workspace.git.removeRemote(name);

        // Sync only .git folder to cloud
        await gitWorkspaceCache.syncGitFolderToCloud(userId, projectId, workspace);

        // Clear GitHub URL from project if removing origin
        if (name === 'origin') {
            await supabaseAdmin
                .from('projects')
                .update({ github_url: null })
                .eq('id', projectId);
        }

        res.json({
            success: true,
            data: { message: `Remote '${name}' removed` }
        });
    } catch (error) {
        next(error);
    }
}

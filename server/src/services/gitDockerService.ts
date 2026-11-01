import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import * as storageService from './storageService';

/**
 * Git Service (Production-ready simple-git implementation)
 * 
 * Replaces Docker git worker with native simple-git execution.
 * Compatible with serverless / containerless platforms like Render free tier.
 * Operates on ephemeral workspaces in os.tmpdir(), syncing state with Supabase Storage.
 */

export interface GitOperationResult {
    success: boolean;
    data?: any;
    error?: string;
}

// ── Ephemeral Workspace Storage Helpers ─────────────────────────────────────

async function getAllLocalFiles(dir: string, base: string = dir): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const results: Array<{ fullPath: string; relativePath: string }> = [];
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.name === '.workspace-meta.json') continue;
            if (entry.isDirectory()) {
                results.push(...await getAllLocalFiles(fullPath, base));
            } else {
                results.push({
                    fullPath,
                    relativePath: path.relative(base, fullPath).replace(/\\/g, '/')
                });
            }
        }
    } catch {
        // Directory may not exist
    }
    return results;
}

async function downloadProject(userId: string, projectId: string, targetDir: string): Promise<number> {
    console.log(`[GitService] Downloading project ${projectId} files from cloud...`);
    const files = await storageService.listAllFilesRecursive(userId, projectId, '');
    let count = 0;

    for (const file of files) {
        if (file.isDirectory) continue;
        try {
            const buffer = await storageService.downloadFile(userId, projectId, file.path);
            const localPath = path.join(targetDir, file.path);
            await fs.mkdir(path.dirname(localPath), { recursive: true });
            await fs.writeFile(localPath, buffer);
            count++;
        } catch (err: any) {
            console.warn(`[GitService] Download skipped for ${file.path}:`, err.message);
        }
    }

    // Ensure .git required directories exist if .git is present
    const gitDir = path.join(targetDir, '.git');
    const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
    if (gitExists) {
        const requiredDirs = [
            path.join(gitDir, 'refs', 'heads'),
            path.join(gitDir, 'refs', 'tags'),
            path.join(gitDir, 'objects', 'info'),
            path.join(gitDir, 'objects', 'pack')
        ];
        for (const dir of requiredDirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    console.log(`[GitService] Downloaded ${count} files to ephemeral workspace`);
    return count;
}

async function uploadProject(userId: string, projectId: string, workspaceDir: string): Promise<number> {
    console.log(`[GitService] Uploading workspace to cloud...`);
    const files = await getAllLocalFiles(workspaceDir);
    let count = 0;

    for (const file of files) {
        const buffer = await fs.readFile(file.fullPath);
        await storageService.uploadFile(userId, projectId, file.relativePath, buffer);
        count++;
    }

    console.log(`[GitService] Uploaded ${count} files`);
    return count;
}

async function uploadGitFolder(userId: string, projectId: string, workspaceDir: string): Promise<number> {
    console.log(`[GitService] Uploading .git folder to cloud...`);
    const gitDir = path.join(workspaceDir, '.git');
    const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
    if (!gitExists) return 0;

    const files = await getAllLocalFiles(gitDir, workspaceDir);
    let count = 0;

    for (const file of files) {
        const buffer = await fs.readFile(file.fullPath);
        await storageService.uploadFile(userId, projectId, file.relativePath, buffer);
        count++;
    }

    console.log(`[GitService] Uploaded ${count} .git files`);
    return count;
}

// ── Git Operation Handlers ──────────────────────────────────────────────────

async function opInit(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    await git.init();
    await git.addConfig('user.email', 'cloudcodex@local');
    await git.addConfig('user.name', 'CloudCodeX User');

    // Create default .gitignore if not present
    const gitignorePath = path.join(workspaceDir, '.gitignore');
    const gitignoreExists = await fs.access(gitignorePath).then(() => true).catch(() => false);
    if (!gitignoreExists) {
        const defaultGitignore = [
            '# CloudCodeX defaults',
            'node_modules/',
            '.env',
            '*.log',
            '__pycache__/',
            '*.pyc',
            '.DS_Store',
            ''
        ].join('\n');
        await fs.writeFile(gitignorePath, defaultGitignore);
    }

    await uploadProject(userId, projectId, workspaceDir);
    return { message: 'Git repository initialized' };
}

async function opStatus(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    const isRepo = await git.checkIsRepo().catch(() => false);
    if (!isRepo) {
        return {
            current: null,
            tracking: null,
            ahead: 0,
            behind: 0,
            staged: [],
            modified: [],
            deleted: [],
            created: [],
            conflicted: [],
            isClean: true
        };
    }

    const status = await git.status();
    return {
        current: status.current || 'main',
        tracking: status.tracking || null,
        ahead: status.ahead || 0,
        behind: status.behind || 0,
        staged: status.staged,
        modified: status.modified,
        deleted: status.deleted,
        created: status.not_added,
        conflicted: status.conflicted,
        isClean: status.isClean()
    };
}

async function opAdd(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    const files = data?.files;
    if (files && Array.isArray(files) && files.length > 0) {
        await git.add(files);
    } else {
        await git.add('.');
    }

    await uploadGitFolder(userId, projectId, workspaceDir);
    return { message: 'Files staged' };
}

async function opCommit(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    const message = data?.message || 'Commit from CloudCodeX';
    const commitResult = await git.commit(message);

    await uploadGitFolder(userId, projectId, workspaceDir);

    return {
        commit: commitResult.commit || 'unknown',
        summary: {
            changed: commitResult.summary?.changes || 0,
            insertions: commitResult.summary?.insertions || 0,
            deletions: commitResult.summary?.deletions || 0
        }
    };
}

async function opPush(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    // Fetch GitHub access token from database
    const { data: tokenData, error: tokenError } = await supabaseAdmin
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    if (tokenError || !tokenData?.access_token) {
        throw new Error('GitHub token not found. Please connect your GitHub account first.');
    }

    // Check remotes
    const remotes = await git.getRemotes(true);
    let origin = remotes.find(r => r.name === 'origin');

    if (!origin) {
        // Fallback: check database for repository URL
        const { data: projectData } = await supabaseAdmin
            .from('projects')
            .select('github_url')
            .eq('id', projectId)
            .single();

        if (projectData?.github_url) {
            console.log(`[GitService] Auto-adding origin remote from database: ${projectData.github_url}`);
            await git.addRemote('origin', projectData.github_url);
            origin = { name: 'origin', refs: { fetch: projectData.github_url, push: projectData.github_url } };
        } else {
            throw new Error('No remote "origin" configured. Please add a remote in the "Configure Repository" step first.');
        }
    }

    const originalUrl = origin.refs.push || origin.refs.fetch || '';
    let authenticatedUrl = originalUrl;
    if (originalUrl.includes('github.com')) {
        authenticatedUrl = originalUrl.replace('https://', `https://${tokenData.access_token}@`);
        await git.remote(['set-url', 'origin', authenticatedUrl]);
    }

    try {
        const branchSummary = await git.branchLocal().catch(() => null);
        const currentBranch = branchSummary?.current || 'main';

        await git.push('origin', currentBranch, ['-u']);
    } finally {
        // Always restore original URL without credential token
        if (originalUrl) {
            await git.remote(['set-url', 'origin', originalUrl]).catch(() => {});
        }
    }

    await uploadGitFolder(userId, projectId, workspaceDir);
    return { message: 'Pushed successfully' };
}

async function opPull(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    const { data: tokenData } = await supabaseAdmin
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    const remotes = await git.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    const originalUrl = origin?.refs.fetch || '';

    if (tokenData?.access_token && originalUrl && originalUrl.includes('github.com')) {
        const authenticatedUrl = originalUrl.replace('https://', `https://${tokenData.access_token}@`);
        await git.remote(['set-url', 'origin', authenticatedUrl]);
    }

    let pullOutput: any;
    try {
        pullOutput = await git.pull();
    } finally {
        if (originalUrl) {
            await git.remote(['set-url', 'origin', originalUrl]).catch(() => {});
        }
    }

    await uploadProject(userId, projectId, workspaceDir);
    return {
        message: 'Pulled successfully',
        output: typeof pullOutput === 'string' ? pullOutput : JSON.stringify(pullOutput)
    };
}

async function opClone(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) {
    const { url, branch } = data;
    if (!url) throw new Error('Repository URL is required');

    const { data: tokenData } = await supabaseAdmin
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    let cloneUrl = url;
    if (tokenData?.access_token && url.includes('github.com')) {
        cloneUrl = url.replace('https://', `https://${tokenData.access_token}@`);
    }

    const cloneOptions: string[] = ['--depth', '1'];
    if (branch) {
        cloneOptions.push('--branch', branch);
    }

    await git.clone(cloneUrl, workspaceDir, cloneOptions);

    // Reset origin URL to non-token version
    if (tokenData?.access_token) {
        await git.remote(['set-url', 'origin', url]).catch(() => {});
    }

    await uploadProject(userId, projectId, workspaceDir);

    // Update project github_url in database
    await supabaseAdmin
        .from('projects')
        .update({ github_url: url })
        .eq('id', projectId);

    return { message: 'Repository cloned successfully' };
}

async function opValidate(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);

    const validation = {
        gitInitialized: false,
        githubAuthenticated: false,
        remoteConfigured: false,
        hasCommits: false,
        hasUncommittedChanges: false,
        canPush: false,
        remote: null as { name: string; url: string } | null
    };

    validation.gitInitialized = await git.checkIsRepo().catch(() => false);

    const { data: tokenData } = await supabaseAdmin
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();
    validation.githubAuthenticated = !!tokenData?.access_token;

    const { data: projectData } = await supabaseAdmin
        .from('projects')
        .select('github_url')
        .eq('id', projectId)
        .single();

    if (validation.gitInitialized) {
        const remotes = await git.getRemotes(true).catch(() => []);
        const origin = remotes.find(r => r.name === 'origin');
        const originUrl = origin?.refs.push || origin?.refs.fetch;

        if (originUrl) {
            validation.remoteConfigured = true;
            validation.remote = { name: 'origin', url: originUrl };
            if (!projectData?.github_url || projectData.github_url !== originUrl) {
                await supabaseAdmin
                    .from('projects')
                    .update({ github_url: originUrl })
                    .eq('id', projectId);
            }
        } else if (projectData?.github_url) {
            try {
                await git.addRemote('origin', projectData.github_url);
                await uploadGitFolder(userId, projectId, workspaceDir);
                validation.remoteConfigured = true;
                validation.remote = { name: 'origin', url: projectData.github_url };
            } catch {
                validation.remoteConfigured = false;
            }
        }
    } else if (projectData?.github_url) {
        validation.remoteConfigured = true;
        validation.remote = { name: 'origin', url: projectData.github_url };
    }

    if (validation.gitInitialized) {
        const log = await git.log(['-1']).catch(() => null);
        validation.hasCommits = !!log && !!log.latest;

        const status = await git.status().catch(() => null);
        validation.hasUncommittedChanges = status ? !status.isClean() : false;
    }

    validation.canPush =
        validation.gitInitialized &&
        validation.githubAuthenticated &&
        validation.remoteConfigured &&
        validation.hasCommits &&
        !validation.hasUncommittedChanges;

    return validation;
}

async function opCheckRepo(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);
    const isRepo = await git.checkIsRepo().catch(() => false);
    return { isRepo };
}

async function opListRemotes(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, _data: any) {
    await downloadProject(userId, projectId, workspaceDir);
    const remotes = await git.getRemotes(true).catch(() => []);
    return remotes.map(r => ({
        name: r.name,
        url: r.refs.fetch || r.refs.push || ''
    }));
}

async function opAddRemote(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) {
    const { url, branch = 'main' } = data;
    if (!url) throw new Error('Repository URL is required');

    await downloadProject(userId, projectId, workspaceDir);

    const remotes = await git.getRemotes(false).catch(() => []);
    if (remotes.some(r => r.name === 'origin')) {
        await git.removeRemote('origin').catch(() => {});
    }

    await git.addRemote('origin', url);
    await git.branch(['-M', branch]).catch(() => {});

    await uploadGitFolder(userId, projectId, workspaceDir);

    await supabaseAdmin
        .from('projects')
        .update({ github_url: url })
        .eq('id', projectId);

    return {
        message: 'Remote added successfully',
        remote: { name: 'origin', url },
        branch
    };
}

async function opRemoveRemote(git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) {
    const { name = 'origin' } = data;
    await downloadProject(userId, projectId, workspaceDir);

    await git.removeRemote(name);
    await uploadGitFolder(userId, projectId, workspaceDir);

    if (name === 'origin') {
        await supabaseAdmin
            .from('projects')
            .update({ github_url: null })
            .eq('id', projectId);
    }

    return { message: `Remote '${name}' removed` };
}

// ── Main Operation Router ───────────────────────────────────────────────────

const OPERATIONS: Record<string, (git: SimpleGit, userId: string, projectId: string, workspaceDir: string, data: any) => Promise<any>> = {
    'init': opInit,
    'status': opStatus,
    'add': opAdd,
    'commit': opCommit,
    'push': opPush,
    'pull': opPull,
    'clone': opClone,
    'validate': opValidate,
    'check-repo': opCheckRepo,
    'list-remotes': opListRemotes,
    'add-remote': opAddRemote,
    'remove-remote': opRemoveRemote
};

/**
 * Run a git operation using simple-git in an ephemeral workspace
 */
export async function runGitOperation(
    operation: string,
    userId: string,
    projectId: string,
    operationData: Record<string, any> = {}
): Promise<GitOperationResult> {
    const handler = OPERATIONS[operation];
    if (!handler) {
        return {
            success: false,
            error: `Unknown git operation: '${operation}'`
        };
    }

    // Create unique temporary workspace directory
    const workspaceId = `git-${projectId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const workspaceDir = path.join(os.tmpdir(), 'cloudcodex-workspaces', workspaceId);

    try {
        await fs.mkdir(workspaceDir, { recursive: true });

        const git: SimpleGit = simpleGit({
            baseDir: workspaceDir,
            maxConcurrentProcesses: 1,
            trimmed: true
        });

        console.log(`[GitService] Starting '${operation}' for project ${projectId} in ${workspaceDir}`);
        const result = await handler(git, userId, projectId, workspaceDir, operationData);
        console.log(`[GitService] '${operation}' completed successfully`);

        return {
            success: true,
            data: result
        };
    } catch (err: any) {
        console.error(`[GitService] Operation '${operation}' failed:`, err.message || err);
        return {
            success: false,
            error: err.message || `Git operation '${operation}' failed`
        };
    } finally {
        // Ephemeral cleanup: remove temporary files from disk
        try {
            await fs.rm(workspaceDir, { recursive: true, force: true });
            console.log(`[GitService] Cleaned up ephemeral workspace ${workspaceDir}`);
        } catch (cleanupErr: any) {
            console.warn(`[GitService] Ephemeral workspace cleanup warning:`, cleanupErr.message);
        }
    }
}

/**
 * Check if git binary is available on the hosting system
 */
export async function isGitWorkerAvailable(): Promise<boolean> {
    try {
        const git = simpleGit();
        const version = await git.version();
        return !!version.installed;
    } catch {
        return false;
    }
}

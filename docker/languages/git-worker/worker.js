/**
 * CloudCodeX Git Worker
 * 
 * Runs inside a Docker container. Receives operation config via environment variables,
 * downloads project files from Supabase Storage, performs git operations, 
 * uploads results back, and outputs JSON result to stdout.
 * 
 * Environment Variables:
 *   GIT_OPERATION      - The operation to perform (init, status, add, commit, push, pull, clone, validate, check-repo, list-remotes, add-remote, remove-remote)
 *   GIT_OPERATION_DATA - JSON string with operation-specific parameters
 *   SUPABASE_URL       - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Supabase service role key
 *   PROJECT_ID         - The project ID
 *   USER_ID            - The user ID
 */

const { createClient } = require('@supabase/supabase-js');
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_DIR = '/workspace';
const BUCKET_NAME = 'project-files';

// ── Supabase Client ────────────────────────────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    outputResult({ success: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY' });
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Helpers ────────────────────────────────────────────────────────────────

function outputResult(result) {
    // Write result as JSON to stdout with a delimiter so the server can parse it
    console.log('__GIT_RESULT_START__');
    console.log(JSON.stringify(result));
    console.log('__GIT_RESULT_END__');
}

function getStoragePath(userId, projectId, filePath) {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${userId}/${projectId}/${normalized}`;
}

function git(args, cwd = WORKSPACE_DIR) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 60000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    if (result.error) {
        throw new Error(`Git command failed: ${result.error.message}`);
    }
    return {
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
        exitCode: result.status
    };
}

function gitOrFail(args, cwd = WORKSPACE_DIR) {
    const result = git(args, cwd);
    if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result;
}

// ── Storage Operations ─────────────────────────────────────────────────────

async function listAllFiles(userId, projectId, directory = '') {
    const prefix = directory
        ? `${userId}/${projectId}/${directory}`
        : `${userId}/${projectId}`;

    const allFiles = [];

    async function listRecursive(currentPrefix) {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .list(currentPrefix, { limit: 10000, sortBy: { column: 'name', order: 'asc' } });

        if (error) throw new Error(`List failed: ${error.message}`);

        for (const item of (data || [])) {
            const itemPath = `${currentPrefix}/${item.name}`;
            const relativePath = itemPath.replace(`${userId}/${projectId}/`, '');

            // Check if it's a folder (no id = folder in Supabase)
            const isFolder = item.id === null;

            if (isFolder) {
                await listRecursive(itemPath);
            } else {
                allFiles.push({
                    storagePath: itemPath,
                    relativePath,
                    size: item.metadata?.size || 0
                });
            }
        }
    }

    await listRecursive(prefix);
    return allFiles;
}

async function downloadFile(storagePath) {
    const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) throw new Error(`Download failed for ${storagePath}: ${error.message}`);
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function uploadFile(storagePath, buffer) {
    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, buffer, {
            contentType: 'application/octet-stream',
            upsert: true
        });

    if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
}

async function deleteFiles(storagePaths) {
    if (storagePaths.length === 0) return;
    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(storagePaths);
    if (error) throw new Error(`Delete failed: ${error.message}`);
}

// ── Download project from cloud to workspace ───────────────────────────────

async function downloadProject(userId, projectId) {
    console.error('[Worker] Downloading project files from cloud...');
    const files = await listAllFiles(userId, projectId);
    let count = 0;

    for (const file of files) {
        const buffer = await downloadFile(file.storagePath);
        const localPath = path.join(WORKSPACE_DIR, file.relativePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, buffer);
        count++;
    }

    // Ensure .git required directories exist if .git is present
    const gitDir = path.join(WORKSPACE_DIR, '.git');
    if (fs.existsSync(gitDir)) {
        const requiredDirs = [
            path.join(gitDir, 'refs', 'heads'),
            path.join(gitDir, 'refs', 'tags'),
            path.join(gitDir, 'objects', 'info'),
            path.join(gitDir, 'objects', 'pack')
        ];
        for (const dir of requiredDirs) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    console.error(`[Worker] Downloaded ${count} files`);
    return count;
}

// ── Upload workspace back to cloud ─────────────────────────────────────────

function getAllLocalFiles(dir, base = dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.workspace-meta.json') continue;
        if (entry.isDirectory()) {
            results.push(...getAllLocalFiles(fullPath, base));
        } else {
            results.push({
                fullPath,
                relativePath: path.relative(base, fullPath).replace(/\\/g, '/')
            });
        }
    }
    return results;
}

async function uploadProject(userId, projectId) {
    console.error('[Worker] Uploading workspace to cloud...');
    const files = getAllLocalFiles(WORKSPACE_DIR);
    let count = 0;

    for (const file of files) {
        const buffer = fs.readFileSync(file.fullPath);
        const storagePath = getStoragePath(userId, projectId, file.relativePath);
        await uploadFile(storagePath, buffer);
        count++;
    }

    console.error(`[Worker] Uploaded ${count} files`);
    return count;
}

async function uploadGitFolder(userId, projectId) {
    console.error('[Worker] Uploading .git folder to cloud...');
    const gitDir = path.join(WORKSPACE_DIR, '.git');
    if (!fs.existsSync(gitDir)) return 0;

    const files = getAllLocalFiles(gitDir, WORKSPACE_DIR);
    let count = 0;

    for (const file of files) {
        const buffer = fs.readFileSync(file.fullPath);
        const storagePath = getStoragePath(userId, projectId, file.relativePath);
        await uploadFile(storagePath, buffer);
        count++;
    }

    console.error(`[Worker] Uploaded ${count} .git files`);
    return count;
}

// ── Operations ─────────────────────────────────────────────────────────────

async function opInit(userId, projectId, data) {
    await downloadProject(userId, projectId);

    gitOrFail(['init']);
    gitOrFail(['config', 'user.email', 'cloudcodex@local']);
    gitOrFail(['config', 'user.name', 'CloudCodeX User']);

    // Create .gitignore if not exists
    const gitignorePath = path.join(WORKSPACE_DIR, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, [
            '# CloudCodeX defaults',
            'node_modules/',
            '.env',
            '*.log',
            '__pycache__/',
            '*.pyc',
            '.DS_Store',
            ''
        ].join('\n'));
    }

    await uploadProject(userId, projectId);

    return { message: 'Git repository initialized' };
}

async function opStatus(userId, projectId, data) {
    await downloadProject(userId, projectId);

    const isRepo = git(['rev-parse', '--is-inside-work-tree']).exitCode === 0;
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

    const branchResult = git(['branch', '--show-current']);
    const current = branchResult.stdout || 'main';

    const statusResult = gitOrFail(['status', '--porcelain']);
    const lines = statusResult.stdout ? statusResult.stdout.split('\n').filter(Boolean) : [];

    const staged = [];
    const modified = [];
    const deleted = [];
    const created = [];
    const conflicted = [];

    for (const line of lines) {
        const x = line[0]; // index status
        const y = line[1]; // working tree status
        const file = line.substring(3);

        if (x === 'U' || y === 'U') conflicted.push(file);
        else if (x === 'A' || x === 'M' || x === 'D' || x === 'R') staged.push(file);

        if (y === 'M') modified.push(file);
        if (y === 'D') deleted.push(file);
        if (y === '?') created.push(file);
    }

    return {
        current,
        tracking: null,
        ahead: 0,
        behind: 0,
        staged,
        modified,
        deleted,
        created,
        conflicted,
        isClean: lines.length === 0
    };
}

async function opAdd(userId, projectId, data) {
    await downloadProject(userId, projectId);

    const files = data?.files;
    if (files && files.length > 0) {
        gitOrFail(['add', ...files]);
    } else {
        gitOrFail(['add', '.']);
    }

    await uploadGitFolder(userId, projectId);

    return { message: 'Files staged' };
}

async function opCommit(userId, projectId, data) {
    await downloadProject(userId, projectId);

    const message = data?.message || 'Commit from CloudCodeX';
    const result = gitOrFail(['commit', '-m', message]);

    // Parse commit output
    const commitMatch = result.stdout.match(/\[[\w\s]+\s([a-f0-9]+)\]/);
    const statsMatch = result.stdout.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?)?(?:,\s+(\d+)\s+deletions?)?/);

    await uploadGitFolder(userId, projectId);

    return {
        commit: commitMatch ? commitMatch[1] : 'unknown',
        summary: {
            changed: statsMatch ? parseInt(statsMatch[1]) : 0,
            insertions: statsMatch && statsMatch[2] ? parseInt(statsMatch[2]) : 0,
            deletions: statsMatch && statsMatch[3] ? parseInt(statsMatch[3]) : 0
        }
    };
}

async function opPush(userId, projectId, data) {
    await downloadProject(userId, projectId);

    // Get GitHub token from database
    const { data: tokenData, error: tokenError } = await supabase
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    if (tokenError || !tokenData?.access_token) {
        throw new Error('GitHub token not found. Please connect your GitHub account first.');
    }

    // Get remote URL
    let remoteResult = git(['remote', 'get-url', 'origin']);
    if (remoteResult.exitCode !== 0) {
        // Remote missing from git config — try to recover from database
        const { data: projectData } = await supabase
            .from('projects')
            .select('github_url')
            .eq('id', projectId)
            .single();

        if (projectData?.github_url) {
            console.error('Remote "origin" missing from git config but found in database. Auto-adding...');
            gitOrFail(['remote', 'add', 'origin', projectData.github_url]);
            remoteResult = git(['remote', 'get-url', 'origin']);
        }

        if (remoteResult.exitCode !== 0) {
            throw new Error('No remote "origin" configured. Please add a remote in the "Configure Repository" step first.');
        }
    }

    let remoteUrl = remoteResult.stdout;
    // Inject token for authentication
    if (remoteUrl.includes('github.com')) {
        const authUrl = remoteUrl.replace('https://', `https://${tokenData.access_token}@`);
        gitOrFail(['remote', 'set-url', 'origin', authUrl]);
    }

    // Detect branch
    const branchResult = git(['branch', '--show-current']);
    const branch = branchResult.stdout || 'main';

    // Push with upstream tracking
    const pushResult = git(['push', '-u', 'origin', branch]);

    // Restore original URL (without token) - security measure
    gitOrFail(['remote', 'set-url', 'origin', remoteUrl]);

    if (pushResult.exitCode !== 0) {
        throw new Error(`Push failed: ${pushResult.stderr}`);
    }

    await uploadGitFolder(userId, projectId);

    return { message: 'Pushed successfully' };
}

async function opPull(userId, projectId, data) {
    await downloadProject(userId, projectId);

    // Get GitHub token
    const { data: tokenData } = await supabase
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    if (tokenData?.access_token) {
        const remoteResult = git(['remote', 'get-url', 'origin']);
        if (remoteResult.exitCode === 0) {
            const remoteUrl = remoteResult.stdout;
            if (remoteUrl.includes('github.com')) {
                const authUrl = remoteUrl.replace('https://', `https://${tokenData.access_token}@`);
                gitOrFail(['remote', 'set-url', 'origin', authUrl]);
            }
        }
    }

    const pullResult = git(['pull']);

    // Restore original URL
    if (tokenData?.access_token) {
        const remoteResult = git(['remote', 'get-url', 'origin']);
        if (remoteResult.exitCode === 0) {
            const cleanUrl = remoteResult.stdout.replace(/https:\/\/[^@]+@/, 'https://');
            gitOrFail(['remote', 'set-url', 'origin', cleanUrl]);
        }
    }

    if (pullResult.exitCode !== 0) {
        throw new Error(`Pull failed: ${pullResult.stderr}`);
    }

    // Upload everything (pulled files + updated .git)
    await uploadProject(userId, projectId);

    return {
        message: 'Pulled successfully',
        output: pullResult.stdout
    };
}

async function opClone(userId, projectId, data) {
    const { url, branch } = data;

    // Get GitHub token for authenticated cloning
    const { data: tokenData } = await supabase
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();

    let cloneUrl = url;
    if (tokenData?.access_token && url.includes('github.com')) {
        cloneUrl = url.replace('https://', `https://${tokenData.access_token}@`);
    }

    const args = ['clone', '--depth', '1'];
    if (branch) args.push('--branch', branch);
    args.push(cloneUrl, WORKSPACE_DIR);

    const cloneResult = git(args, '/tmp');
    if (cloneResult.exitCode !== 0) {
        throw new Error(`Clone failed: ${cloneResult.stderr}`);
    }

    // Reset URL to non-authenticated version
    if (tokenData?.access_token) {
        gitOrFail(['remote', 'set-url', 'origin', url]);
    }

    // Upload cloned project to cloud
    await uploadProject(userId, projectId);

    // Update project github_url
    await supabase
        .from('projects')
        .update({ github_url: url })
        .eq('id', projectId);

    return { message: 'Repository cloned successfully' };
}

async function opValidate(userId, projectId, data) {
    await downloadProject(userId, projectId);

    const validation = {
        gitInitialized: false,
        githubAuthenticated: false,
        remoteConfigured: false,
        hasCommits: false,
        hasUncommittedChanges: false,
        canPush: false,
        remote: null
    };

    // Check 1: Git initialized?
    validation.gitInitialized = git(['rev-parse', '--is-inside-work-tree']).exitCode === 0;

    // Check 2: GitHub token?
    const { data: tokenData } = await supabase
        .from('github_tokens')
        .select('access_token')
        .eq('user_id', userId)
        .single();
    validation.githubAuthenticated = !!(tokenData?.access_token);

    // Check 3: Remote configured? (check both git config and database)
    const { data: projectData } = await supabase
        .from('projects')
        .select('github_url')
        .eq('user_id', userId)
        .eq('id', projectId)
        .single();

    if (validation.gitInitialized) {
        const gitRemoteResult = git(['remote', 'get-url', 'origin']);
        if (gitRemoteResult.exitCode === 0 && gitRemoteResult.stdout) {
            // Git config has the remote
            validation.remoteConfigured = true;
            validation.remote = { name: 'origin', url: gitRemoteResult.stdout };
            // Sync database if it's out of date
            if (!projectData?.github_url || projectData.github_url !== gitRemoteResult.stdout) {
                await supabase
                    .from('projects')
                    .update({ github_url: gitRemoteResult.stdout })
                    .eq('id', projectId);
            }
        } else if (projectData?.github_url) {
            // Database has URL but git config doesn't — restore it
            try {
                gitOrFail(['remote', 'add', 'origin', projectData.github_url]);
                await uploadGitFolder(userId, projectId);
                validation.remoteConfigured = true;
                validation.remote = { name: 'origin', url: projectData.github_url };
            } catch (e) {
                // Failed to restore — mark as not configured
                validation.remoteConfigured = false;
            }
        }
    } else if (projectData?.github_url) {
        // Git not initialized but database has URL — still mark as configured
        validation.remoteConfigured = true;
        validation.remote = { name: 'origin', url: projectData.github_url };
    }

    // Check 4: Has commits?
    if (validation.gitInitialized) {
        validation.hasCommits = git(['log', '-1', '--oneline']).exitCode === 0;
    }

    // Check 5: Uncommitted changes?
    if (validation.gitInitialized) {
        const statusResult = git(['status', '--porcelain']);
        const lines = (statusResult.stdout || '').split('\n').filter(Boolean);
        validation.hasUncommittedChanges = lines.length > 0;
    }

    validation.canPush =
        validation.gitInitialized &&
        validation.githubAuthenticated &&
        validation.remoteConfigured &&
        validation.hasCommits &&
        !validation.hasUncommittedChanges;

    return validation;
}

async function opCheckRepo(userId, projectId, data) {
    await downloadProject(userId, projectId);
    const isRepo = git(['rev-parse', '--is-inside-work-tree']).exitCode === 0;
    return { isRepo };
}

async function opListRemotes(userId, projectId, data) {
    await downloadProject(userId, projectId);
    const result = git(['remote', '-v']);
    if (result.exitCode !== 0) {
        return [];
    }

    const remotes = {};
    for (const line of result.stdout.split('\n').filter(Boolean)) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
            remotes[parts[0]] = parts[1];
        }
    }

    return Object.entries(remotes).map(([name, url]) => ({ name, url }));
}

async function opAddRemote(userId, projectId, data) {
    const { url, branch = 'main' } = data;

    if (!url) throw new Error('Repository URL is required');

    await downloadProject(userId, projectId);

    // Remove existing origin if any
    const remotes = git(['remote']);
    if (remotes.stdout.split('\n').includes('origin')) {
        gitOrFail(['remote', 'remove', 'origin']);
    }

    gitOrFail(['remote', 'add', 'origin', url]);

    // Set branch name
    try {
        gitOrFail(['branch', '-M', branch]);
    } catch {
        // Branch might not exist yet
    }

    await uploadGitFolder(userId, projectId);

    // Update project github_url in database
    await supabase
        .from('projects')
        .update({ github_url: url })
        .eq('id', projectId);

    return {
        message: 'Remote added successfully',
        remote: { name: 'origin', url },
        branch
    };
}

async function opRemoveRemote(userId, projectId, data) {
    const { name = 'origin' } = data;

    await downloadProject(userId, projectId);
    gitOrFail(['remote', 'remove', name]);
    await uploadGitFolder(userId, projectId);

    if (name === 'origin') {
        await supabase
            .from('projects')
            .update({ github_url: null })
            .eq('id', projectId);
    }

    return { message: `Remote '${name}' removed` };
}

// ── Main ───────────────────────────────────────────────────────────────────

const OPERATIONS = {
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

async function main() {
    const operation = process.env.GIT_OPERATION;
    const userId = process.env.USER_ID;
    const projectId = process.env.PROJECT_ID;
    let operationData = {};

    try {
        operationData = JSON.parse(process.env.GIT_OPERATION_DATA || '{}');
    } catch {
        operationData = {};
    }

    if (!operation || !userId || !projectId) {
        outputResult({
            success: false,
            error: 'Missing required environment variables: GIT_OPERATION, USER_ID, PROJECT_ID'
        });
        process.exit(1);
    }

    const handler = OPERATIONS[operation];
    if (!handler) {
        outputResult({
            success: false,
            error: `Unknown operation: ${operation}`
        });
        process.exit(1);
    }

    try {
        console.error(`[Worker] Starting operation: ${operation}`);
        const result = await handler(userId, projectId, operationData);
        outputResult({ success: true, data: result });
        console.error(`[Worker] Operation completed: ${operation}`);
    } catch (error) {
        console.error(`[Worker] Operation failed: ${error.message}`);
        outputResult({
            success: false,
            error: error.message || 'Unknown error'
        });
        process.exit(1);
    }
}

main();

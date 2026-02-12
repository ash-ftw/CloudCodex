import { supabaseAdmin } from '../config/supabase';
import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import * as storageService from './storageService';

/**
 * Git Workspace Cache Service
 * Manages persistent Git workspaces to avoid re-downloading unchanged files
 */

const WORKSPACE_BASE_DIR = path.join(os.tmpdir(), 'git-workspaces');
const WORKSPACE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_WORKSPACES = 10;

interface WorkspaceMetadata {
    projectId: string;
    userId: string;
    lastSync: number;
    lastAccess: number;
    fileHashes: Record<string, string>; // path -> etag/hash
}

export interface CachedWorkspace {
    dir: string;
    git: SimpleGit;
    metadata: WorkspaceMetadata;
}

/**
 * Get workspace directory path
 */
function getWorkspaceDir(projectId: string): string {
    return path.join(WORKSPACE_BASE_DIR, projectId);
}

/**
 * Get metadata file path
 */
function getMetadataPath(projectId: string): string {
    return path.join(getWorkspaceDir(projectId), '.workspace-meta.json');
}

/**
 * Load workspace metadata
 */
async function loadMetadata(projectId: string): Promise<WorkspaceMetadata | null> {
    try {
        const metaPath = getMetadataPath(projectId);
        const content = await fs.readFile(metaPath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/**
 * Save workspace metadata
 */
async function saveMetadata(projectId: string, metadata: WorkspaceMetadata): Promise<void> {
    const metaPath = getMetadataPath(projectId);
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * Calculate file hash for change detection
 */
function calculateHash(content: Buffer): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Get or create persistent workspace for a project
 */
export async function getWorkspace(userId: string, projectId: string): Promise<CachedWorkspace> {
    const workspaceDir = getWorkspaceDir(projectId);
    let metadata = await loadMetadata(projectId);

    // Check if workspace exists
    const workspaceExists = await fs.access(workspaceDir).then(() => true).catch(() => false);

    if (!workspaceExists || !metadata) {
        // Create new workspace
        console.log(`[Git Cache] Creating new workspace for project ${projectId}`);
        await fs.mkdir(workspaceDir, { recursive: true });

        metadata = {
            projectId,
            userId,
            lastSync: 0,
            lastAccess: Date.now(),
            fileHashes: {}
        };

        await saveMetadata(projectId, metadata);
    } else {
        console.log(`[Git Cache] Using existing workspace for project ${projectId}`);
        // Update last access
        metadata.lastAccess = Date.now();
        await saveMetadata(projectId, metadata);
    }

    const git = simpleGit({
        baseDir: workspaceDir,
        maxConcurrentProcesses: 1
    });

    return { dir: workspaceDir, git, metadata };
}

/**
 * Detect which files have changed in cloud storage
 */
async function detectChangedFiles(
    userId: string,
    projectId: string,
    metadata: WorkspaceMetadata
): Promise<string[]> {
    console.log(`[Git Cache] Detecting changed files...`);

    // Get all files with metadata from cloud
    const cloudFiles = await storageService.listAllFilesWithMetadata(userId, projectId, '');
    const changedFiles: string[] = [];

    for (const file of cloudFiles) {
        if (file.isDirectory) continue;

        const cachedHash = metadata.fileHashes[file.path];
        const cloudHash = file.metadata?.eTag || file.metadata?.cacheControl || '';

        if (!cachedHash || cachedHash !== cloudHash) {
            changedFiles.push(file.path);
        }
    }

    // Check for deleted files (in cache but not in cloud)
    const cloudPaths = new Set(cloudFiles.filter((f: any) => !f.isDirectory).map((f: any) => f.path));
    const cachedPaths = Object.keys(metadata.fileHashes);

    for (const cachedPath of cachedPaths) {
        if (!cloudPaths.has(cachedPath)) {
            changedFiles.push(cachedPath);
        }
    }

    console.log(`[Git Cache] Detected ${changedFiles.length} changed files`);
    return changedFiles;
}

/**
 * Sync workspace from cloud (only download changed files)
 */
export async function syncFromCloud(
    userId: string,
    projectId: string,
    workspace: CachedWorkspace
): Promise<void> {
    const startTime = Date.now();

    // Detect changed files
    const changedFiles = await detectChangedFiles(userId, projectId, workspace.metadata);

    if (changedFiles.length === 0) {
        console.log(`[Git Cache] No changes detected, skipping download`);
        return;
    }

    console.log(`[Git Cache] Downloading ${changedFiles.length} changed files...`);

    // Get all cloud files for metadata update
    const cloudFiles = await storageService.listAllFilesWithMetadata(userId, projectId, '');
    const newFileHashes: Record<string, string> = {};

    for (const file of cloudFiles) {
        if (file.isDirectory) continue;

        const fileHash = file.metadata?.eTag || file.metadata?.cacheControl || '';
        newFileHashes[file.path] = fileHash;

        // Only download if changed
        if (changedFiles.includes(file.path)) {
            try {
                const buffer = await storageService.downloadFile(userId, projectId, file.path);
                const localPath = path.join(workspace.dir, file.path);

                await fs.mkdir(path.dirname(localPath), { recursive: true });

                // Retry logic for locked files (Windows EPERM errors)
                let retries = 3;
                let success = false;

                while (retries > 0 && !success) {
                    try {
                        await fs.writeFile(localPath, buffer);
                        success = true;
                        console.log(`[Git Cache] ✓ Downloaded: ${file.path}`);
                    } catch (writeError: any) {
                        if (writeError.code === 'EPERM' && retries > 1) {
                            // File is locked by Git, wait and retry
                            await new Promise(resolve => setTimeout(resolve, 100));
                            retries--;
                        } else if (writeError.code === 'EPERM') {
                            // After retries, check if file exists and has correct hash
                            try {
                                const existingBuffer = await fs.readFile(localPath);
                                const existingHash = calculateHash(existingBuffer);
                                if (existingHash === fileHash) {
                                    console.log(`[Git Cache] ⚠ Skipped locked file (already correct): ${file.path}`);
                                    success = true;
                                } else {
                                    throw writeError;
                                }
                            } catch {
                                throw writeError;
                            }
                        } else {
                            throw writeError;
                        }
                    }
                }
            } catch (error: any) {
                console.error(`[Git Cache] ✗ Failed to download ${file.path}:`, error.message);
            }
        }
    }

    // Delete files that were removed from cloud
    const cloudPaths = new Set(cloudFiles.filter((f: any) => !f.isDirectory).map((f: any) => f.path));
    for (const cachedPath of Object.keys(workspace.metadata.fileHashes)) {
        if (!cloudPaths.has(cachedPath)) {
            try {
                const localPath = path.join(workspace.dir, cachedPath);
                await fs.unlink(localPath);
                console.log(`[Git Cache] ✓ Deleted: ${cachedPath}`);
            } catch {
                // File might already be gone
            }
        }
    }

    // Update metadata
    workspace.metadata.fileHashes = newFileHashes;
    workspace.metadata.lastSync = Date.now();
    await saveMetadata(projectId, workspace.metadata);

    const elapsed = Date.now() - startTime;
    console.log(`[Git Cache] Sync completed in ${elapsed}ms (${changedFiles.length} files)`);
}

/**
 * Sync workspace changes back to cloud (SMART - only uploads changed files)
 */
export async function syncToCloud(
    userId: string,
    projectId: string,
    workspace: CachedWorkspace
): Promise<void> {
    console.log(`[Git Cache] Syncing workspace to cloud (smart upload)...`);
    const startTime = Date.now();

    const files = await getAllFilesRecursive(workspace.dir);
    const newFileHashes: Record<string, string> = {};
    let uploadedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
        const buffer = await fs.readFile(file.fullPath);
        const hash = calculateHash(buffer);
        newFileHashes[file.relativePath] = hash;

        // Only upload if file changed or is new
        const cachedHash = workspace.metadata.fileHashes[file.relativePath];
        if (!cachedHash || cachedHash !== hash) {
            await storageService.uploadFile(userId, projectId, file.relativePath, buffer);
            uploadedCount++;
            console.log(`[Git Cache] ✓ Uploaded changed file: ${file.relativePath}`);
        } else {
            skippedCount++;
        }
    }

    // Delete files that were removed from workspace
    const workspacePaths = new Set(files.map(f => f.relativePath));
    for (const cachedPath of Object.keys(workspace.metadata.fileHashes)) {
        if (!workspacePaths.has(cachedPath)) {
            await storageService.deleteFile(userId, projectId, cachedPath);
            console.log(`[Git Cache] ✓ Deleted removed file: ${cachedPath}`);
        }
    }

    // Update metadata
    workspace.metadata.fileHashes = newFileHashes;
    workspace.metadata.lastSync = Date.now();
    await saveMetadata(projectId, workspace.metadata);

    const elapsed = Date.now() - startTime;
    console.log(`[Git Cache] ✓ Smart sync completed in ${elapsed}ms (uploaded ${uploadedCount}, skipped ${skippedCount})`);
}

/**
 * Sync only .git folder to cloud (for commit/add operations where project files didn't change)
 */
export async function syncGitFolderToCloud(
    userId: string,
    projectId: string,
    workspace: CachedWorkspace
): Promise<void> {
    console.log(`[Git Cache] Syncing .git folder only...`);
    const startTime = Date.now();

    // Get all files in .git directory
    const gitDir = path.join(workspace.dir, '.git');
    const files = await getAllFilesRecursive(gitDir);
    const newFileHashes: Record<string, string> = {};
    let uploadedCount = 0;

    for (const file of files) {
        const buffer = await fs.readFile(file.fullPath);
        const hash = calculateHash(buffer);

        // Make path relative to workspace (not .git)
        const relativePath = path.relative(workspace.dir, file.fullPath).replace(/\\/g, '/');
        newFileHashes[relativePath] = hash;

        // Only upload if file changed
        const cachedHash = workspace.metadata.fileHashes[relativePath];
        if (!cachedHash || cachedHash !== hash) {
            await storageService.uploadFile(userId, projectId, relativePath, buffer);
            uploadedCount++;
        }
    }

    // Update metadata (only .git files)
    for (const [path, hash] of Object.entries(newFileHashes)) {
        workspace.metadata.fileHashes[path] = hash;
    }
    workspace.metadata.lastSync = Date.now();
    await saveMetadata(projectId, workspace.metadata);

    const elapsed = Date.now() - startTime;
    console.log(`[Git Cache] ✓ .git folder synced in ${elapsed}ms (uploaded ${uploadedCount} changed files)`);
}

/**
 * Get all files recursively in a directory
 */
async function getAllFilesRecursive(dirPath: string): Promise<Array<{ fullPath: string; relativePath: string }>> {
    const files: Array<{ fullPath: string; relativePath: string }> = [];

    async function scan(currentPath: string, basePath: string) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');

            // Skip .workspace-meta.json
            if (entry.name === '.workspace-meta.json') continue;

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
 * Cleanup old workspaces (LRU)
 */
export async function cleanupOldWorkspaces(): Promise<void> {
    try {
        await fs.mkdir(WORKSPACE_BASE_DIR, { recursive: true });
        const entries = await fs.readdir(WORKSPACE_BASE_DIR, { withFileTypes: true });

        const workspaces: Array<{ projectId: string; lastAccess: number }> = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const metadata = await loadMetadata(entry.name);
            if (metadata) {
                workspaces.push({ projectId: entry.name, lastAccess: metadata.lastAccess });
            }
        }

        // Sort by last access (oldest first)
        workspaces.sort((a, b) => a.lastAccess - b.lastAccess);

        const now = Date.now();
        let deletedCount = 0;

        // Delete workspaces that are too old or exceed max count
        for (let i = 0; i < workspaces.length; i++) {
            const ws = workspaces[i];
            const age = now - ws.lastAccess;
            const shouldDelete = age > WORKSPACE_TTL || i < workspaces.length - MAX_WORKSPACES;

            if (shouldDelete) {
                const workspaceDir = getWorkspaceDir(ws.projectId);
                await fs.rm(workspaceDir, { recursive: true, force: true });
                deletedCount++;
                console.log(`[Git Cache] Cleaned up workspace: ${ws.projectId}`);
            }
        }

        if (deletedCount > 0) {
            console.log(`[Git Cache] Cleaned up ${deletedCount} old workspaces`);
        }
    } catch (error) {
        console.error('[Git Cache] Cleanup failed:', error);
    }
}

/**
 * Manually invalidate a workspace (force re-download on next use)
 */
export async function invalidateWorkspace(projectId: string): Promise<void> {
    const workspaceDir = getWorkspaceDir(projectId);
    try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
        console.log(`[Git Cache] Invalidated workspace: ${projectId}`);
    } catch {
        // Workspace might not exist
    }
}

// Periodic cleanup (run every 15 minutes)
setInterval(() => {
    cleanupOldWorkspaces().catch(err => console.error('[Git Cache] Auto-cleanup error:', err));
}, 15 * 60 * 1000);

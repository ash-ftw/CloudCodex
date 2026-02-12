import path from 'path';
import fs from 'fs/promises';
import { config } from '../config/index';
import { supabaseAdmin } from '../config/supabase';

/**
 * Security utilities for path validation and protection against
 * directory traversal attacks, symlink abuse, and other file system exploits.
 */

const DANGEROUS_CHARS = /[<>:"|?*\x00-\x1f]/g;
const TRAVERSAL_PATTERNS = /(\.\.|\.\/|\/\.|\\\.\.|\.\.\/)|\0/g;

/**
 * Sanitize a path by removing dangerous characters
 */
export function sanitizePath(inputPath: string): string {
    // Normalize path separators
    let sanitized = inputPath.replace(/\\/g, '/');

    // Remove null bytes and other dangerous characters
    sanitized = sanitized.replace(DANGEROUS_CHARS, '');

    // Remove any double slashes
    sanitized = sanitized.replace(/\/+/g, '/');

    // Remove leading/trailing slashes
    sanitized = sanitized.replace(/^\/+|\/+$/g, '');

    return sanitized;
}

/**
 * Check if a path contains directory traversal attempts
 */
export function containsTraversal(inputPath: string): boolean {
    return TRAVERSAL_PATTERNS.test(inputPath);
}

/**
 * Check if a path is safe (no traversal, within allowed directory)
 */
export function isPathSafe(inputPath: string, baseDir: string): boolean {
    // Check for obvious traversal patterns
    if (containsTraversal(inputPath)) {
        return false;
    }

    // Resolve the full path
    const resolvedPath = path.resolve(baseDir, inputPath);
    const resolvedBase = path.resolve(baseDir);

    // Ensure the resolved path stays within the base directory
    return resolvedPath.startsWith(resolvedBase + path.sep) || resolvedPath === resolvedBase;
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string {
    return path.resolve(config.workspace.root);
}

/**
 * Get the user's workspace directory
 */
export function getUserWorkspacePath(userId: string): string {
    const sanitizedUserId = sanitizePath(userId);
    return path.join(getWorkspaceRoot(), sanitizedUserId);
}

/**
 * Get the project directory path
 */
export function getProjectPath(userId: string, projectId: string): string {
    const sanitizedUserId = sanitizePath(userId);
    const sanitizedProjectId = sanitizePath(projectId);
    return path.join(getWorkspaceRoot(), sanitizedUserId, 'projects', sanitizedProjectId);
}

/**
 * Resolve a path within a user's project directory safely
 * Returns null if the path is unsafe
 */
export function resolveProjectPath(
    userId: string,
    projectId: string,
    relativePath: string
): string | null {
    const projectDir = getProjectPath(userId, projectId);
    const sanitizedRelative = sanitizePath(relativePath);

    if (!isPathSafe(sanitizedRelative, projectDir)) {
        return null;
    }

    return path.join(projectDir, sanitizedRelative);
}

/**
 * Check if a file or directory is a symlink
 */
export async function isSymlink(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.lstat(filePath);
        return stats.isSymbolicLink();
    } catch {
        return false;
    }
}

/**
 * Recursively check a directory for symlinks
 * Returns array of symlink paths found
 */
export async function findSymlinks(dirPath: string): Promise<string[]> {
    const symlinks: string[] = [];

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isSymbolicLink()) {
                symlinks.push(fullPath);
            } else if (entry.isDirectory()) {
                const nestedSymlinks = await findSymlinks(fullPath);
                symlinks.push(...nestedSymlinks);
            }
        }
    } catch {
        // Directory might not exist or be accessible
    }

    return symlinks;
}

/**
 * Validate that a path stays within the workspace after resolution
 */
export async function validateWorkspacePath(
    userId: string,
    projectId: string,
    relativePath: string
): Promise<{ valid: boolean; resolvedPath: string | null; error?: string }> {
    const resolvedPath = resolveProjectPath(userId, projectId, relativePath);

    if (!resolvedPath) {
        return {
            valid: false,
            resolvedPath: null,
            error: 'Path contains directory traversal or is outside workspace'
        };
    }

    // Check parent path exists and is not a symlink
    const parentDir = path.dirname(resolvedPath);
    if (await isSymlink(parentDir)) {
        return {
            valid: false,
            resolvedPath: null,
            error: 'Parent directory is a symbolic link'
        };
    }

    return {
        valid: true,
        resolvedPath
    };
}

/**
 * Calculate the total size of files in a directory recursively
 */
export async function getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isFile() && !entry.isSymbolicLink()) {
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
            } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
                totalSize += await getDirectorySize(fullPath);
            }
        }
    } catch {
        // Directory might not exist
    }

    return totalSize;
}

/**
 * Check if a user has exceeded their storage quota
 */
export async function checkStorageQuota(
    userId: string,
    additionalBytes: number = 0
): Promise<{ withinQuota: boolean; usedMb: number; quotaMb: number }> {
    const userWorkspace = getUserWorkspacePath(userId);
    const currentSize = await getDirectorySize(userWorkspace);
    const totalSizeWithAddition = currentSize + additionalBytes;

    const usedMb = Math.round(totalSizeWithAddition / (1024 * 1024) * 100) / 100;
    const quotaMb = config.workspace.maxStoragePerUserMb;

    return {
        withinQuota: usedMb <= quotaMb,
        usedMb,
        quotaMb
    };
}

/**
 * Update user's storage usage in the database
 * Calculates current storage from filesystem and syncs to profiles table
 */
export async function updateUserStorage(userId: string): Promise<number> {
    const userWorkspace = getUserWorkspacePath(userId);
    const currentSize = await getDirectorySize(userWorkspace);
    const usedMb = Math.round(currentSize / (1024 * 1024) * 100) / 100;

    // Update the database
    await supabaseAdmin
        .from('profiles')
        .update({ storage_used_mb: usedMb })
        .eq('id', userId);

    return usedMb;
}


import { Router, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import {
    resolveProjectPath,
    getProjectPath,
    isSymlink,
    checkStorageQuota
} from '../utils/pathSecurity';
import { FileNode } from '../types/index';
import { emitFileChange } from '../services/socketService';

const router = Router();

router.use(authMiddleware);

const createFileSchema = z.object({
    type: z.enum(['file', 'directory']),
    content: z.string().optional()
});

const updateFileSchema = z.object({
    content: z.string()
});

const renameSchema = z.object({
    newName: z.string().min(1).max(255)
});

/**
 * GET /api/files/:projectId
 * List files in a project
 */
router.get('/:projectId', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = (req.query.path as string) || '';

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        const files = await listDirectory(resolvedPath, getProjectPath(req.user!.id, projectId));

        res.json({ success: true, data: files });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/files/:projectId/*
 * Read file content
 */
router.get('/:projectId/content/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        // Check if it's a symlink
        if (await isSymlink(resolvedPath)) {
            throw new AppError('Cannot read symlinks', 400, 'SYMLINK_NOT_ALLOWED');
        }

        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
            throw new AppError('Cannot read directory as file', 400, 'IS_DIRECTORY');
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');

        res.json({
            success: true,
            data: {
                path: relativePath,
                content,
                size: stats.size,
                modifiedAt: stats.mtime
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/files/:projectId/*
 * Create file or directory
 */
router.post('/:projectId/create/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { type, content = '' } = createFileSchema.parse(req.body);

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        // Check storage quota
        const quota = await checkStorageQuota(req.user!.id, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        if (type === 'directory') {
            await fs.mkdir(resolvedPath, { recursive: true });
        } else {
            // Ensure parent directory exists
            await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
            await fs.writeFile(resolvedPath, content);
        }

        // Emit file change event
        const io = req.app.get('io');
        emitFileChange(io, projectId, 'created', relativePath);

        res.status(201).json({
            success: true,
            data: { path: relativePath, type }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/files/:projectId/*
 * Update file content
 */
router.put('/:projectId/content/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { content } = updateFileSchema.parse(req.body);

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        // Check storage quota
        const quota = await checkStorageQuota(req.user!.id, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        await fs.writeFile(resolvedPath, content);

        // Emit file change event
        const io = req.app.get('io');
        emitFileChange(io, projectId, 'modified', relativePath);

        res.json({
            success: true,
            data: { path: relativePath, size: content.length }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PATCH /api/files/:projectId/rename/*
 * Rename file or directory
 */
router.patch('/:projectId/rename/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { newName } = renameSchema.parse(req.body);

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        const newPath = path.join(path.dirname(resolvedPath), newName);
        const newRelativePath = path.join(path.dirname(relativePath), newName);

        // Verify new path is still within project
        const projectPath = getProjectPath(req.user!.id, projectId);
        if (!newPath.startsWith(projectPath)) {
            throw new AppError('Invalid new path', 400, 'INVALID_PATH');
        }

        await fs.rename(resolvedPath, newPath);

        // Emit file change events
        const io = req.app.get('io');
        emitFileChange(io, projectId, 'deleted', relativePath);
        emitFileChange(io, projectId, 'created', newRelativePath);

        res.json({
            success: true,
            data: { oldPath: relativePath, newPath: newRelativePath }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/files/:projectId/*
 * Delete file or directory
 */
router.delete('/:projectId/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, relativePath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        // Prevent deleting project root
        const projectPath = getProjectPath(req.user!.id, projectId);
        if (resolvedPath === projectPath) {
            throw new AppError('Cannot delete project root', 400, 'CANNOT_DELETE_ROOT');
        }

        const stats = await fs.stat(resolvedPath);
        if (stats.isDirectory()) {
            await fs.rm(resolvedPath, { recursive: true });
        } else {
            await fs.unlink(resolvedPath);
        }

        // Emit file change event
        const io = req.app.get('io');
        emitFileChange(io, projectId, 'deleted', relativePath);

        res.json({ success: true, data: { path: relativePath } });
    } catch (error) {
        next(error);
    }
});

// Helper function to list directory contents
async function listDirectory(dirPath: string, basePath: string): Promise<FileNode[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: FileNode[] = [];

    for (const entry of entries) {
        if (entry.isSymbolicLink()) continue; // Skip symlinks

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);
        const stats = await fs.stat(fullPath);

        const node: FileNode = {
            name: entry.name,
            path: relativePath.replace(/\\/g, '/'),
            type: entry.isDirectory() ? 'directory' : 'file',
            modifiedAt: stats.mtime
        };

        if (entry.isFile()) {
            node.size = stats.size;
        }

        files.push(node);
    }

    // Sort: directories first, then alphabetically
    return files.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
}

export { router as fileRoutes };


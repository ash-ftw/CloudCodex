import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { FileNode } from '../types/index';
import { emitFileChange } from '../services/socketService';
import * as storageService from '../services/storageService';
import { checkStorageQuota } from '../utils/pathSecurity';
import { supabaseAdmin } from '../config/supabase';
import { getProjectAccess } from '../services/projectAccessService';

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
 * List files in a project directory
 */
router.get('/:projectId', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = (req.query.path as string) || '';
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found or access denied', 404, 'PROJECT_NOT_FOUND');
        }

        // List files from cloud storage under project owner's scope
        const files = await storageService.listFiles(access.ownerId, projectId, relativePath);

        const fileNodes: FileNode[] = files.map(file => ({
            name: file.name,
            path: file.path,
            type: file.isDirectory ? 'directory' : 'file',
            size: file.size,
            modifiedAt: file.updatedAt
        }));

        fileNodes.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        res.json({ success: true, data: fileNodes });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/files/:projectId/content/*
 * Read file content
 */
router.get('/:projectId/content/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found or access denied', 404, 'PROJECT_NOT_FOUND');
        }

        const buffer = await storageService.downloadFile(access.ownerId, projectId, relativePath);
        const content = buffer.toString('utf-8');

        res.json({
            success: true,
            data: {
                path: relativePath,
                content,
                size: buffer.length,
                modifiedAt: new Date()
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/files/:projectId/create/*
 * Create file or directory
 */
router.post('/:projectId/create/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { type, content = '' } = createFileSchema.parse(req.body);
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        if (access.role === 'viewer') {
            throw new AppError('Viewers cannot create files or directories', 403, 'FORBIDDEN');
        }

        const quota = await checkStorageQuota(access.ownerId, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded for project owner', 400, 'QUOTA_EXCEEDED');
        }

        if (type === 'directory') {
            const gitkeepPath = relativePath.endsWith('/')
                ? `${relativePath}.gitkeep`
                : `${relativePath}/.gitkeep`;
            await storageService.uploadFile(access.ownerId, projectId, gitkeepPath, Buffer.from(''));
        } else {
            const buffer = Buffer.from(content, 'utf-8');
            await storageService.uploadFile(access.ownerId, projectId, relativePath, buffer);
        }

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
 * PUT /api/files/:projectId/content/*
 * Update file content
 */
router.put('/:projectId/content/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { content } = updateFileSchema.parse(req.body);
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        if (access.role === 'viewer') {
            throw new AppError('Viewers cannot edit files', 403, 'FORBIDDEN');
        }

        const quota = await checkStorageQuota(access.ownerId, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded for project owner', 400, 'QUOTA_EXCEEDED');
        }

        const buffer = Buffer.from(content, 'utf-8');
        await storageService.uploadFile(access.ownerId, projectId, relativePath, buffer);

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
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        if (access.role === 'viewer') {
            throw new AppError('Viewers cannot rename files', 403, 'FORBIDDEN');
        }

        const pathParts = relativePath.split('/');
        pathParts[pathParts.length - 1] = newName;
        const newRelativePath = pathParts.join('/');

        await storageService.moveFile(access.ownerId, projectId, relativePath, newRelativePath);

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
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || !access.ownerId) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        if (access.role === 'viewer') {
            throw new AppError('Viewers cannot delete files', 403, 'FORBIDDEN');
        }

        if (!relativePath || relativePath === '' || relativePath === '/') {
            throw new AppError('Cannot delete project root', 400, 'CANNOT_DELETE_ROOT');
        }

        const files = await storageService.listFiles(access.ownerId, projectId, relativePath);

        if (files.length > 0) {
            await storageService.deleteDirectory(access.ownerId, projectId, relativePath);
        } else {
            await storageService.deleteFile(access.ownerId, projectId, relativePath);
        }

        const io = req.app.get('io');
        emitFileChange(io, projectId, 'deleted', relativePath);

        res.json({ success: true, data: { path: relativePath } });
    } catch (error) {
        next(error);
    }
});

export { router as fileRoutes };

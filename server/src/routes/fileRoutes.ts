import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { FileNode } from '../types/index';
import { emitFileChange } from '../services/socketService';
import * as storageService from '../services/storageService';
import { checkStorageQuota } from '../utils/pathSecurity';
import { supabaseAdmin } from '../config/supabase';

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

        console.log(`[Files] List request: projectId=${projectId}, path=${relativePath}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // List files from cloud storage
        const files = await storageService.listFiles(userId, projectId, relativePath);

        const fileNodes: FileNode[] = files.map(file => ({
            name: file.name,
            path: file.path,
            type: file.isDirectory ? 'directory' : 'file',
            size: file.size,
            modifiedAt: file.updatedAt
        }));

        // Sort: directories first, then alphabetically
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

        console.log(`[Files] Read file: ${relativePath}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Download file from cloud storage
        const buffer = await storageService.downloadFile(userId, projectId, relativePath);
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

        console.log(`[Files] Create ${type}: ${relativePath}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Check storage quota
        const quota = await checkStorageQuota(userId, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        if (type === 'directory') {
            // For directories, create a .gitkeep file to represent the directory
            const gitkeepPath = relativePath.endsWith('/')
                ? `${relativePath}.gitkeep`
                : `${relativePath}/.gitkeep`;
            await storageService.uploadFile(userId, projectId, gitkeepPath, Buffer.from(''));
        } else {
            // Upload file to cloud storage
            const buffer = Buffer.from(content, 'utf-8');
            await storageService.uploadFile(userId, projectId, relativePath, buffer);
        }

        // Update storage usage in database
        const storageUsage = await storageService.getStorageUsage(userId);
        const usageMb = Math.round(storageUsage / (1024 * 1024) * 100) / 100;

        await supabaseAdmin
            .from('profiles')
            .update({ storage_used_mb: usageMb })
            .eq('id', userId);

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
 * PUT /api/files/:projectId/content/*
 * Update file content
 */
router.put('/:projectId/content/*', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const relativePath = decodeURIComponent(req.params[0] || '');
        const { content } = updateFileSchema.parse(req.body);
        const userId = req.user!.id;

        console.log(`[Files] Update file: ${relativePath}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Check storage quota
        const quota = await checkStorageQuota(userId, content.length);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        // Upload file to cloud storage (upsert mode)
        const buffer = Buffer.from(content, 'utf-8');
        await storageService.uploadFile(userId, projectId, relativePath, buffer);

        // Update storage usage in database
        const storageUsage = await storageService.getStorageUsage(userId);
        const usageMb = Math.round(storageUsage / (1024 * 1024) * 100) / 100;

        await supabaseAdmin
            .from('profiles')
            .update({ storage_used_mb: usageMb })
            .eq('id', userId);

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
        const userId = req.user!.id;

        console.log(`[Files] Rename: ${relativePath} → ${newName}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Calculate new path
        const pathParts = relativePath.split('/');
        pathParts[pathParts.length - 1] = newName;
        const newRelativePath = pathParts.join('/');

        // Move file in cloud storage
        await storageService.moveFile(userId, projectId, relativePath, newRelativePath);

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
        const userId = req.user!.id;

        console.log(`[Files] Delete: ${relativePath}`);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Prevent deleting project root
        if (!relativePath || relativePath === '' || relativePath === '/') {
            throw new AppError('Cannot delete project root', 400, 'CANNOT_DELETE_ROOT');
        }

        // Check if it's a directory by looking for files with this prefix
        const files = await storageService.listFiles(userId, projectId, relativePath);

        if (files.length > 0) {
            // It's a directory, delete recursively
            await storageService.deleteDirectory(userId, projectId, relativePath);
        } else {
            // It's a file, delete it
            await storageService.deleteFile(userId, projectId, relativePath);
        }

        // Update storage usage in database
        const storageUsage = await storageService.getStorageUsage(userId);
        const usageMb = Math.round(storageUsage / (1024 * 1024) * 100) / 100;

        await supabaseAdmin
            .from('profiles')
            .update({ storage_used_mb: usageMb })
            .eq('id', userId);

        // Emit file change event
        const io = req.app.get('io');
        emitFileChange(io, projectId, 'deleted', relativePath);

        res.json({ success: true, data: { path: relativePath } });
    } catch (error) {
        next(error);
    }
});

export { router as fileRoutes };

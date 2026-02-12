import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { checkStorageQuota } from '../utils/pathSecurity';
import { config } from '../config/index';
import { supabaseAdmin } from '../config/supabase';
import * as storageService from '../services/storageService';

const router = Router();

// Configure multer for ZIP uploads
const upload = multer({
    limits: {
        fileSize: config.workspace.maxZipSizeMb * 1024 * 1024
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed'));
        }
    }
});

router.use(authMiddleware);

const exportSelectionSchema = z.object({
    paths: z.array(z.string()).min(1)
});

/**
 * POST /api/zip/:projectId/import
 * Import a ZIP file into a project (upload to cloud storage)
 */
router.post('/:projectId/import', upload.single('file'), async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        if (!req.file) {
            throw new AppError('No file uploaded', 400, 'NO_FILE');
        }

        console.log(`[ZIP Import] Uploading ${req.file.size} bytes to project ${projectId}`);

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

        // Check storage quota (estimate extracted size)
        const quota = await checkStorageQuota(userId, req.file.size * 3);
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        // Upload ZIP to cloud storage and extract
        await storageService.uploadProjectZip(userId, projectId, req.file.buffer);

        // Update storage usage in database
        const storageUsage = await storageService.getStorageUsage(userId);
        const usageMb = Math.round(storageUsage / (1024 * 1024) * 100) / 100;

        await supabaseAdmin
            .from('profiles')
            .update({ storage_used_mb: usageMb })
            .eq('id', userId);

        res.json({
            success: true,
            data: {
                message: `ZIP file imported successfully`
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/zip/:projectId/export
 * Export entire project as ZIP (download from cloud storage)
 */
router.get('/:projectId/export', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        console.log(`[ZIP Export] Creating ZIP for project ${projectId}`);

        // Verify user owns this  project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('name')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // Download project as ZIP from cloud storage
        const zipBuffer = await storageService.downloadProjectZip(userId, projectId);

        // Sanitize filename
        const safeName = (project.name || projectId).replace(/[^a-zA-Z0-9_-]/g, '_');

        // Set headers for download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);
        res.setHeader('Content-Length', zipBuffer.length.toString());

        res.send(zipBuffer);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/zip/:projectId/export
 * Export selected files/folders as ZIP
 * Note: For cloud storage, we'll export the entire project for now
 * TODO: Implement selective file export if needed
 */
router.post('/:projectId/export', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { paths } = exportSelectionSchema.parse(req.body);
        const userId = req.user!.id;

        console.log(`[ZIP Export] Creating selective ZIP for project ${projectId}, paths:`, paths);

        // Verify user owns this project
        const { data: project } = await supabaseAdmin
            .from('projects')
            .select('name')
            .eq('id', projectId)
            .eq('user_id', userId)
            .single();

        if (!project) {
            throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
        }

        // For now, export entire project
        // TODO: Implement selective file export from cloud storage
        const zipBuffer = await storageService.downloadProjectZip(userId, projectId);

        // Set headers for download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${projectId}-selection.zip"`);
        res.setHeader('Content-Length', zipBuffer.length.toString());

        res.send(zipBuffer);
    } catch (error) {
        next(error);
    }
});

export { router as zipRoutes };

import { Router, Response } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { getProjectPath, resolveProjectPath, checkStorageQuota, sanitizePath, containsTraversal } from '../utils/pathSecurity';
import { config } from '../config/index';

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
 * Import a ZIP file into a project
 */
router.post('/:projectId/import', upload.single('file'), async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const targetPath = (req.query.path as string) || '';

        if (!req.file) {
            throw new AppError('No file uploaded', 400, 'NO_FILE');
        }

        const resolvedPath = resolveProjectPath(req.user!.id, projectId, targetPath);
        if (!resolvedPath) {
            throw new AppError('Invalid path', 400, 'INVALID_PATH');
        }

        // Check storage quota
        const quota = await checkStorageQuota(req.user!.id, req.file.size * 3); // Estimate extracted size
        if (!quota.withinQuota) {
            throw new AppError('Storage quota exceeded', 400, 'QUOTA_EXCEEDED');
        }

        // Create a read stream from the buffer
        const bufferStream = require('stream').Readable.from(req.file.buffer);
        let extractedCount = 0;

        await new Promise<void>((resolve, reject) => {
            bufferStream
                .pipe(unzipper.Parse())
                .on('entry', async (entry: unzipper.Entry) => {
                    const entryPath = entry.path;

                    // Security checks
                    if (containsTraversal(entryPath)) {
                        entry.autodrain();
                        return;
                    }

                    const sanitized = sanitizePath(entryPath);
                    const fullPath = path.join(resolvedPath, sanitized);

                    // Ensure path stays within project
                    const projectPath = getProjectPath(req.user!.id, projectId);
                    if (!fullPath.startsWith(projectPath)) {
                        entry.autodrain();
                        return;
                    }

                    if (entry.type === 'Directory') {
                        await fs.mkdir(fullPath, { recursive: true });
                        entry.autodrain();
                    } else {
                        await fs.mkdir(path.dirname(fullPath), { recursive: true });
                        entry.pipe(require('fs').createWriteStream(fullPath));
                        extractedCount++;
                    }
                })
                .on('finish', resolve)
                .on('error', reject);
        });

        res.json({
            success: true,
            data: {
                message: `Extracted ${extractedCount} files`,
                extractedCount
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/zip/:projectId/export
 * Export entire project as ZIP
 */
router.get('/:projectId/export', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const includeGit = req.query.includeGit === 'true';
        const projectName = (req.query.name as string) || projectId;

        const projectPath = getProjectPath(req.user!.id, projectId);

        // Sanitize filename - remove any unsafe characters
        const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');

        // Set headers for download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(res);

        // Add files to archive
        archive.directory(projectPath, false, (entry) => {
            // Skip .git directory unless explicitly included
            if (!includeGit && entry.name.startsWith('.git')) {
                return false;
            }
            return entry;
        });

        await archive.finalize();
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/zip/:projectId/export
 * Export selected files/folders as ZIP
 */
router.post('/:projectId/export', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { projectId } = req.params;
        const { paths } = exportSelectionSchema.parse(req.body);

        const projectPath = getProjectPath(req.user!.id, projectId);

        // Validate all paths
        for (const p of paths) {
            const resolved = resolveProjectPath(req.user!.id, projectId, p);
            if (!resolved) {
                throw new AppError(`Invalid path: ${p}`, 400, 'INVALID_PATH');
            }
        }

        // Set headers for download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${projectId}-selection.zip"`);

        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', (err) => {
            throw err;
        });

        archive.pipe(res);

        // Add selected paths to archive
        for (const p of paths) {
            const fullPath = path.join(projectPath, sanitizePath(p));
            const stats = await fs.stat(fullPath);

            if (stats.isDirectory()) {
                archive.directory(fullPath, path.basename(p));
            } else {
                archive.file(fullPath, { name: path.basename(p) });
            }
        }

        await archive.finalize();
    } catch (error) {
        next(error);
    }
});

export { router as zipRoutes };


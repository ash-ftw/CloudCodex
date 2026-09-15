import { Router, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabase';
import { authMiddleware, AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { Project } from '../types/index';
import * as storageService from '../services/storageService';
import { getProjectAccess } from '../services/projectAccessService';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    language: z.string().optional()
});

const updateProjectSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    language: z.string().optional()
});

/**
 * GET /api/projects
 * List all projects owned by or shared with the current user
 */
router.get('/', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const userId = req.user!.id;

        // Fetch owned projects
        const { data: ownedProjects, error: ownedErr } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });

        if (ownedErr) {
            throw new AppError(`Failed to fetch owned projects: ${ownedErr.message}`, 500, 'DB_ERROR');
        }

        // Fetch shared projects via project_collaborators
        const { data: sharedCollabs } = await supabaseAdmin
            .from('project_collaborators')
            .select(`
                role,
                projects:project_id (*)
            `)
            .eq('user_id', userId)
            .eq('status', 'accepted');

        const sharedProjects = (sharedCollabs || [])
            .map((sc: any) => sc.projects)
            .filter(Boolean);

        // Combine and map
        const allProjectsMap = new Map<string, any>();

        for (const p of (ownedProjects || [])) {
            allProjectsMap.set(p.id, { ...p, role: 'owner' });
        }

        for (const p of sharedProjects) {
            if (!allProjectsMap.has(p.id)) {
                allProjectsMap.set(p.id, { ...p, role: 'collaborator' });
            }
        }

        const projectList = Array.from(allProjectsMap.values());

        res.json({
            success: true,
            data: projectList.map(p => ({
                id: p.id,
                userId: p.user_id,
                name: p.name,
                description: p.description,
                language: p.language,
                githubUrl: p.github_url,
                role: p.role || 'owner',
                createdAt: p.created_at,
                updatedAt: p.updated_at
            }))
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/projects
 * Create a new project
 */
router.post('/', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { name, description, language } = createProjectSchema.parse(req.body);
        const projectId = uuidv4();

        // Create project in database
        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .insert({
                id: projectId,
                user_id: req.user!.id,
                name,
                description,
                language
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to create project', 500, 'DB_ERROR');
        }

        // Create project in cloud storage with initial README
        await storageService.ensureProjectExists(req.user!.id, projectId, name);

        res.status(201).json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                role: 'owner',
                createdAt: project.created_at,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/projects/:id
 * Get a specific project by id (checks ownership or collaborator status)
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, id);
        if (!access.hasAccess) {
            throw new AppError('Project not found or access denied', 404, 'NOT_FOUND');
        }

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        res.json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                githubUrl: project.github_url,
                ownerId: access.ownerId,
                role: access.role,
                createdAt: project.created_at,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * PUT /api/projects/:id
 * Update a project (owner or editor)
 */
router.put('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const updates = updateProjectSchema.parse(req.body);
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, id);
        if (!access.hasAccess || access.role === 'viewer') {
            throw new AppError('Editor or owner permissions required', 403, 'FORBIDDEN');
        }

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        res.json({
            success: true,
            data: {
                id: project.id,
                name: project.name,
                description: project.description,
                language: project.language,
                updatedAt: project.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
});

/**
 * DELETE /api/projects/:id
 * Delete a project (owner only)
 */
router.delete('/:id', async (req: AuthenticatedRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, id);
        if (!access.hasAccess || access.role !== 'owner') {
            throw new AppError('Only the project owner can delete this project', 403, 'FORBIDDEN');
        }

        await storageService.deleteProject(access.ownerId!, id);

        await supabaseAdmin
            .from('projects')
            .delete()
            .eq('id', id);

        res.json({ success: true, data: { message: 'Project deleted' } });
    } catch (error) {
        next(error);
    }
});

export { router as projectRoutes };

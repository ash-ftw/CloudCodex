import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/authMiddleware';
import { AppError } from '../middleware/errorHandler';
import { supabaseAdmin } from '../config/supabase';
import { getProjectAccess } from '../services/projectAccessService';
import { createRevisionSnapshot } from '../services/collaborationService';

const inviteCollaboratorSchema = z.object({
    emailOrUsername: z.string().min(1),
    role: z.enum(['editor', 'viewer']).default('editor')
});

const updateRoleSchema = z.object({
    role: z.enum(['editor', 'viewer'])
});

/**
 * GET /api/projects/:projectId/collaborators
 * List collaborators for a project
 */
export async function getCollaborators(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess) {
            throw new AppError('Access denied', 403, 'FORBIDDEN');
        }

        const { data: collaborators, error } = await supabaseAdmin
            .from('project_collaborators')
            .select(`
                id,
                role,
                status,
                created_at,
                profiles:user_id (id, username)
            `)
            .eq('project_id', projectId);

        if (error) {
            throw new AppError(`Failed to fetch collaborators: ${error.message}`, 500, 'DB_ERROR');
        }

        // Fetch owner details
        const { data: ownerProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, username')
            .eq('id', access.ownerId)
            .single();

        res.json({
            success: true,
            data: {
                owner: ownerProfile ? { id: ownerProfile.id, username: ownerProfile.username, role: 'owner' } : null,
                collaborators: collaborators.map((c: any) => ({
                    id: c.id,
                    userId: c.profiles?.id,
                    username: c.profiles?.username || 'Unknown',
                    role: c.role,
                    status: c.status,
                    createdAt: c.created_at
                })),
                currentUserRole: access.role
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/projects/:projectId/collaborators
 * Invite a collaborator by email or username
 */
export async function inviteCollaborator(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const { emailOrUsername, role } = inviteCollaboratorSchema.parse(req.body);
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || access.role !== 'owner') {
            throw new AppError('Only the project owner can invite collaborators', 403, 'FORBIDDEN');
        }

        // Find user by username or email in profiles / auth
        const { data: targetProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, username')
            .eq('username', emailOrUsername)
            .maybeSingle();

        let targetUserId = targetProfile?.id;

        if (!targetUserId) {
            const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
            const foundUser = usersData.users.find(u => u.email === emailOrUsername);
            if (foundUser) {
                targetUserId = foundUser.id;
            }
        }

        if (!targetUserId) {
            throw new AppError('User not found with provided email/username', 444, 'USER_NOT_FOUND');
        }

        if (targetUserId === access.ownerId) {
            throw new AppError('User is already the owner of this project', 400, 'INVALID_ACTION');
        }

        const { data: collaborator, error: collabErr } = await supabaseAdmin
            .from('project_collaborators')
            .upsert({
                project_id: projectId,
                user_id: targetUserId,
                role,
                status: 'accepted',
                invited_by: userId
            })
            .select('*, profiles:user_id(username)')
            .single();

        if (collabErr) {
            throw new AppError(`Failed to add collaborator: ${collabErr.message}`, 500, 'DB_ERROR');
        }

        res.status(201).json({
            success: true,
            data: {
                id: collaborator.id,
                userId: collaborator.user_id,
                username: collaborator.profiles?.username || emailOrUsername,
                role: collaborator.role,
                status: collaborator.status
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * PATCH /api/projects/:projectId/collaborators/:collaboratorId
 * Update collaborator role
 */
export async function updateCollaboratorRole(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId, collaboratorId } = req.params;
        const { role } = updateRoleSchema.parse(req.body);
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || access.role !== 'owner') {
            throw new AppError('Only the project owner can update permissions', 403, 'FORBIDDEN');
        }

        const { data: updated, error } = await supabaseAdmin
            .from('project_collaborators')
            .update({ role })
            .eq('id', collaboratorId)
            .eq('project_id', projectId)
            .select()
            .single();

        if (error || !updated) {
            throw new AppError('Collaborator not found or update failed', 404, 'NOT_FOUND');
        }

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
}

/**
 * DELETE /api/projects/:projectId/collaborators/:collaboratorId
 * Remove a collaborator
 */
export async function removeCollaborator(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId, collaboratorId } = req.params;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || access.role !== 'owner') {
            throw new AppError('Only the project owner can remove collaborators', 403, 'FORBIDDEN');
        }

        const { error } = await supabaseAdmin
            .from('project_collaborators')
            .delete()
            .eq('id', collaboratorId)
            .eq('project_id', projectId);

        if (error) {
            throw new AppError(`Failed to remove collaborator: ${error.message}`, 500, 'DB_ERROR');
        }

        res.json({ success: true, data: { message: 'Collaborator removed' } });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/projects/:projectId/revisions
 * Get file version history
 */
export async function getFileRevisions(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const filePath = req.query.path as string;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess) {
            throw new AppError('Access denied', 403, 'FORBIDDEN');
        }

        let query = supabaseAdmin
            .from('file_revisions')
            .select('id, file_path, version_tag, created_at, created_by, profiles:created_by(username)')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });

        if (filePath) {
            query = query.eq('file_path', filePath);
        }

        const { data: revisions, error } = await query;

        if (error) {
            throw new AppError(`Failed to fetch version history: ${error.message}`, 500, 'DB_ERROR');
        }

        res.json({
            success: true,
            data: revisions.map((r: any) => ({
                id: r.id,
                filePath: r.file_path,
                versionTag: r.version_tag,
                createdAt: r.created_at,
                author: r.profiles?.username || 'System'
            }))
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/projects/:projectId/revisions
 * Save manual version snapshot
 */
export async function createSnapshot(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const { filePath, content, versionTag } = req.body;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || access.role === 'viewer') {
            throw new AppError('Editor or owner permissions required to save revisions', 403, 'FORBIDDEN');
        }

        await createRevisionSnapshot(projectId, filePath, content, userId, versionTag);

        res.status(201).json({ success: true, data: { message: 'Revision snapshot saved successfully' } });
    } catch (error) {
        next(error);
    }
}

// In-memory fallback and cache for room passwords
const roomPasswordCache = new Map<string, string>();

async function fetchProjectRoomPassword(projectId: string): Promise<string | null> {
    try {
        const { data, error } = await supabaseAdmin
            .from('projects')
            .select('room_password')
            .eq('id', projectId)
            .maybeSingle();

        if (!error && data && 'room_password' in data && (data as any).room_password) {
            return (data as any).room_password;
        }
    } catch {
        // Table column room_password might not exist in Supabase schema
    }
    return roomPasswordCache.get(projectId) || null;
}

async function saveProjectRoomPassword(projectId: string, password: string | null): Promise<void> {
    const clean = password ? String(password).trim() : null;
    if (clean) {
        roomPasswordCache.set(projectId, clean);
    } else {
        roomPasswordCache.delete(projectId);
    }

    try {
        await supabaseAdmin
            .from('projects')
            .update({ room_password: clean })
            .eq('id', projectId);
    } catch (e: any) {
        console.warn('[collaborationController] room_password column not in table, kept in memory fallback:', e?.message);
    }
}

/**
 * GET /api/projects/:projectId/room-info
 * Returns the Room ID and Room Password (only visible to owner or members)
 */
export async function getRoomInfo(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess) {
            throw new AppError('Access denied', 403, 'FORBIDDEN');
        }

        const { data: project, error } = await supabaseAdmin
            .from('projects')
            .select('id, name, user_id')
            .eq('id', projectId)
            .single();

        if (error || !project) {
            throw new AppError('Project not found', 404, 'NOT_FOUND');
        }

        const isOwner = project.user_id === userId;
        const password = await fetchProjectRoomPassword(projectId);

        res.json({
            success: true,
            data: {
                roomId: project.id,
                roomPassword: isOwner ? (password || '') : (password ? '••••••••' : ''),
                hasPassword: !!password,
                isOwner
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * PUT /api/projects/:projectId/room-password
 * Set or update room password (Owner only)
 */
export async function updateRoomPassword(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { projectId } = req.params;
        const { roomPassword } = req.body;
        const userId = req.user!.id;

        const access = await getProjectAccess(userId, projectId);
        if (!access.hasAccess || access.role !== 'owner') {
            throw new AppError('Only the project owner can change the room password', 403, 'FORBIDDEN');
        }

        const cleaned = roomPassword ? String(roomPassword).trim() : null;
        await saveProjectRoomPassword(projectId, cleaned);

        res.json({
            success: true,
            data: { message: 'Room password updated successfully', roomPassword: cleaned || '' }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/projects/join-room
 * Any authenticated user can join a collaborative room using Room ID & Room Password
 */
export async function joinRoom(req: AuthenticatedRequest, res: Response, next: any) {
    try {
        const { roomId, roomPassword } = req.body;
        const userId = req.user!.id;

        if (!roomId || !String(roomId).trim()) {
            throw new AppError('Room ID is required', 400, 'MISSING_ROOM_ID');
        }

        const cleanRoomId = String(roomId).trim();

        const { data: project, error: projectErr } = await supabaseAdmin
            .from('projects')
            .select('id, name, user_id')
            .eq('id', cleanRoomId)
            .maybeSingle();

        if (projectErr || !project) {
            throw new AppError('Room not found with provided Room ID', 404, 'ROOM_NOT_FOUND');
        }

        // If user is already the owner, let them in immediately
        if (project.user_id === userId) {
            return res.json({
                success: true,
                data: {
                    projectId: project.id,
                    projectName: project.name,
                    role: 'owner'
                }
            });
        }

        // Verify password if project has a password set
        const expectedPassword = await fetchProjectRoomPassword(cleanRoomId);
        if (expectedPassword && expectedPassword.trim() !== '') {
            const inputPassword = roomPassword ? String(roomPassword).trim() : '';
            if (inputPassword !== expectedPassword.trim()) {
                throw new AppError('Incorrect room password', 403, 'INVALID_ROOM_PASSWORD');
            }
        }

        // Add or update collaborator membership with accepted editor access
        try {
            await supabaseAdmin
                .from('project_collaborators')
                .upsert({
                    project_id: project.id,
                    user_id: userId,
                    role: 'editor',
                    status: 'accepted'
                }, { onConflict: 'project_id, user_id' });
        } catch (collabErr: any) {
            console.warn('[joinRoom] Collaborator table record warning:', collabErr?.message);
        }

        res.json({
            success: true,
            data: {
                projectId: project.id,
                projectName: project.name,
                role: 'editor'
            }
        });
    } catch (error) {
        next(error);
    }
}


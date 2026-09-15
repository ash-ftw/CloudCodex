import { supabaseAdmin } from '../config/supabase';

export interface ProjectAccessResult {
    hasAccess: boolean;
    role: 'owner' | 'editor' | 'viewer' | null;
    ownerId: string | null;
    projectName: string | null;
}

/**
 * Checks if a user has access to a project (as owner or accepted collaborator)
 * Returns access status, user role, and the project owner's user_id.
 */
export async function getProjectAccess(userId: string, projectId: string): Promise<ProjectAccessResult> {
    try {
        const { data: project, error: projectError } = await supabaseAdmin
            .from('projects')
            .select('id, user_id, name')
            .eq('id', projectId)
            .single();

        if (projectError || !project) {
            console.warn(`[projectAccessService] Project ${projectId} not found in DB:`, projectError?.message);
            return { hasAccess: false, role: null, ownerId: null, projectName: null };
        }

        // Check if user is project owner
        if (project.user_id === userId) {
            return {
                hasAccess: true,
                role: 'owner',
                ownerId: project.user_id,
                projectName: project.name
            };
        }

        // Check if user is an accepted collaborator
        try {
            const { data: collaborator } = await supabaseAdmin
                .from('project_collaborators')
                .select('role, status')
                .eq('project_id', projectId)
                .eq('user_id', userId)
                .eq('status', 'accepted')
                .maybeSingle();

            if (collaborator) {
                return {
                    hasAccess: true,
                    role: collaborator.role as 'owner' | 'editor' | 'viewer',
                    ownerId: project.user_id,
                    projectName: project.name
                };
            }
        } catch (collabErr) {
            console.warn('[projectAccessService] project_collaborators check skipped (table might not exist yet):', collabErr);
        }

        console.warn(`[projectAccessService] User ${userId} is not owner (${project.user_id}) nor collaborator of project ${projectId}`);
        return { hasAccess: false, role: null, ownerId: project.user_id, projectName: project.name };
    } catch (err) {
        console.error('[projectAccessService] Error evaluating project access:', err);
        return { hasAccess: false, role: null, ownerId: null, projectName: null };
    }
}

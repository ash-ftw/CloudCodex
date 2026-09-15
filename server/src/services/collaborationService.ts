import * as Y from 'yjs';
import { supabaseAdmin } from '../config/supabase';

interface ActiveUserPresence {
    socketId: string;
    userId: string;
    username: string;
    userColor: string;
    activeFile?: string;
    cursorPosition?: { line: number; column: number };
    selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    joinedAt: number;
}

const COLOR_PALETTE = [
    '#F43F5E', // Rose
    '#3B82F6', // Blue
    '#10B981', // Emerald
    '#8B5CF6', // Violet
    '#F59E0B', // Amber
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#84CC16', // Lime
];

// In-memory Y.Doc cache keyed by "projectId:filePath"
const docMap = new Map<string, Y.Doc>();

// Active user presence per project room
const projectPresenceMap = new Map<string, Map<string, ActiveUserPresence>>();

/**
 * Gets or creates a Yjs document for a specific project file
 */
export function getOrCreateYDoc(projectId: string, filePath: string, initialContent: string = ''): Y.Doc {
    const docKey = `${projectId}:${filePath}`;
    if (!docMap.has(docKey)) {
        const doc = new Y.Doc();
        const yText = doc.getText('monaco');
        if (initialContent && yText.length === 0) {
            yText.insert(0, initialContent);
        }
        docMap.set(docKey, doc);
    }
    return docMap.get(docKey)!;
}

/**
 * Applies a binary Yjs update chunk to the cached Y.Doc
 */
export function applyYDocUpdate(projectId: string, filePath: string, updateBuffer: Uint8Array): Uint8Array {
    const doc = getOrCreateYDoc(projectId, filePath);
    Y.applyUpdate(doc, updateBuffer);
    return Y.encodeStateAsUpdate(doc);
}

/**
 * Gets the current plain text content of a Y.Doc
 */
export function getYDocContent(projectId: string, filePath: string): string {
    const docKey = `${projectId}:${filePath}`;
    const doc = docMap.get(docKey);
    return doc ? doc.getText('monaco').toString() : '';
}

/**
 * Returns the full encoded state of a Y.Doc for initial client sync.
 * Returns null if no doc exists yet for this project+file.
 */
export function getYDocState(projectId: string, filePath: string): Uint8Array | null {
    const docKey = `${projectId}:${filePath}`;
    const doc = docMap.get(docKey);
    if (!doc) return null;
    return Y.encodeStateAsUpdate(doc);
}

/**
 * Adds or updates presence for a socket in a project room
 */
export function setPresence(
    projectId: string,
    socketId: string,
    user: { userId: string; username: string; activeFile?: string; cursorPosition?: any; selection?: any }
): ActiveUserPresence {
    if (!projectPresenceMap.has(projectId)) {
        projectPresenceMap.set(projectId, new Map());
    }

    const roomPresence = projectPresenceMap.get(projectId)!;
    const existing = roomPresence.get(socketId);

    // Assign color based on index or existing presence
    const colorIndex = roomPresence.size % COLOR_PALETTE.length;
    const userColor = existing?.userColor || COLOR_PALETTE[colorIndex];

    const presence: ActiveUserPresence = {
        socketId,
        userId: user.userId,
        username: user.username,
        userColor,
        activeFile: user.activeFile || existing?.activeFile,
        cursorPosition: user.cursorPosition || existing?.cursorPosition,
        selection: user.selection || existing?.selection,
        joinedAt: existing?.joinedAt || Date.now()
    };

    roomPresence.set(socketId, presence);
    return presence;
}

/**
 * Removes socket presence from a project room
 */
export function removePresence(projectId: string, socketId: string): void {
    const roomPresence = projectPresenceMap.get(projectId);
    if (roomPresence) {
        roomPresence.delete(socketId);
        if (roomPresence.size === 0) {
            projectPresenceMap.delete(projectId);
        }
    }
}

/**
 * Get all active users in a project room
 */
export function getRoomPresence(projectId: string): ActiveUserPresence[] {
    const roomPresence = projectPresenceMap.get(projectId);
    if (!roomPresence) return [];
    return Array.from(roomPresence.values());
}

/**
 * Save a file revision snapshot in database
 */
export async function createRevisionSnapshot(
    projectId: string,
    filePath: string,
    content: string,
    userId: string,
    versionTag?: string
): Promise<void> {
    try {
        await supabaseAdmin.from('file_revisions').insert({
            project_id: projectId,
            file_path: filePath,
            content,
            version_tag: versionTag || `v${Date.now()}`,
            created_by: userId
        });
    } catch (err) {
        console.error('[collaborationService] Failed to create revision snapshot:', err);
    }
}

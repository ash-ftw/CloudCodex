import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index';
import {
    setPresence,
    removePresence,
    getRoomPresence,
    applyYDocUpdate,
    getOrCreateYDoc,
    getYDocState
} from './collaborationService';

interface AuthenticatedSocket extends Socket {
    userId?: string;
    currentProjectId?: string;
}

const userSockets = new Map<string, Set<string>>();

export function setupSocketHandlers(io: SocketIOServer): void {
    // Authentication middleware
    io.use((socket: AuthenticatedSocket, next) => {
        const token = socket.handshake.auth.token;

        if (!token) {
            next(new Error('Authentication required'));
            return;
        }

        try {
            const decoded = jwt.verify(token, config.jwt.secret) as { sub: string };
            socket.userId = decoded.sub;
            next();
        } catch {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket: AuthenticatedSocket) => {
        const userId = socket.userId;

        if (userId) {
            if (!userSockets.has(userId)) {
                userSockets.set(userId, new Set());
            }
            userSockets.get(userId)!.add(socket.id);
            socket.join(`user:${userId}`);
            console.log(`[Socket] User ${userId} connected (${socket.id})`);
        }

        // Join project collaboration session
        socket.on('join-project', (data: string | { projectId: string; username?: string }) => {
            const projectId = typeof data === 'string' ? data : data.projectId;
            const username = typeof data === 'object' ? data.username || 'Collaborator' : 'Collaborator';

            socket.currentProjectId = projectId;
            socket.join(`project:${projectId}`);

            if (userId) {
                setPresence(projectId, socket.id, { userId, username });
                io.to(`project:${projectId}`).emit('presence-update', getRoomPresence(projectId));
            }

            console.log(`[Socket] ${socket.id} joined project ${projectId}`);
        });

        // Leave project room
        socket.on('leave-project', (projectId: string) => {
            socket.leave(`project:${projectId}`);
            removePresence(projectId, socket.id);
            socket.currentProjectId = undefined;

            io.to(`project:${projectId}`).emit('presence-update', getRoomPresence(projectId));
            console.log(`[Socket] ${socket.id} left project ${projectId}`);
        });

        // Presence & Cursor tracking heartbeat
        socket.on('presence-heartbeat', (data: {
            projectId: string;
            activeFile?: string;
            cursorPosition?: { line: number; column: number };
            selection?: any;
        }) => {
            if (!userId || !data.projectId) return;

            setPresence(data.projectId, socket.id, {
                userId,
                username: 'Collaborator',
                activeFile: data.activeFile,
                cursorPosition: data.cursorPosition,
                selection: data.selection
            });

            socket.to(`project:${data.projectId}`).emit('presence-update', getRoomPresence(data.projectId));
        });

        // Real-time CRDT update broadcast
        socket.on('crdt-update', (data: {
            projectId: string;
            filePath: string;
            update: number[];
        }) => {
            if (!data.projectId || !data.filePath || !data.update) return;

            try {
                const updateBuffer = new Uint8Array(data.update);
                applyYDocUpdate(data.projectId, data.filePath, updateBuffer);

                // Broadcast update to all other collaborators in the room
                socket.to(`project:${data.projectId}`).emit('crdt-update', {
                    filePath: data.filePath,
                    update: data.update,
                    senderSocketId: socket.id
                });
            } catch (err) {
                console.error('[Socket] CRDT update error:', err);
            }
        });

        // Sync request: send the current Y.Doc state for a file to a newly joining client
        socket.on('crdt-sync-request', (data: { projectId: string; filePath: string; initialContent?: string }) => {
            if (!data.projectId || !data.filePath) return;

            try {
                // Ensure the server-side doc exists. If it's brand new, seed it with the client's initial content.
                const doc = getOrCreateYDoc(data.projectId, data.filePath, data.initialContent || '');
                const docContent = doc.getText('monaco').toString();
                console.log(`[Socket] crdt-sync-request for ${data.filePath} from ${socket.id} (doc length: ${docContent.length})`);

                const state = getYDocState(data.projectId, data.filePath);
                if (state) {
                    socket.emit('crdt-sync-response', {
                        filePath: data.filePath,
                        state: Array.from(state)
                    });
                    console.log(`[Socket] crdt-sync-response sent to ${socket.id} (state size: ${state.length} bytes)`);
                }
            } catch (err) {
                console.error('[Socket] crdt-sync-request error:', err);
            }
        });

        socket.on('disconnect', () => {
            if (userId && userSockets.has(userId)) {
                userSockets.get(userId)!.delete(socket.id);
                if (userSockets.get(userId)!.size === 0) {
                    userSockets.delete(userId);
                }
            }

            if (socket.currentProjectId) {
                removePresence(socket.currentProjectId, socket.id);
                io.to(`project:${socket.currentProjectId}`).emit('presence-update', getRoomPresence(socket.currentProjectId));
            }

            console.log(`[Socket] ${socket.id} disconnected`);
        });
    });
}

/**
 * Emit execution output to target user and broadcast to project collaborators
 */
export function emitExecutionOutput(
    io: SocketIOServer,
    userId: string,
    executionId: string,
    type: 'stdout' | 'stderr' | 'status',
    data: string,
    projectId?: string
): void {
    const payload = {
        executionId,
        type,
        data,
        timestamp: Date.now()
    };

    io.to(`user:${userId}`).emit('execution-output', payload);

    if (projectId) {
        io.to(`project:${projectId}`).emit('execution-output', payload);
    }
}

/**
 * Emit file change notification to project members
 */
export function emitFileChange(
    io: SocketIOServer,
    projectId: string,
    type: 'created' | 'modified' | 'deleted',
    path: string
): void {
    io.to(`project:${projectId}`).emit('file-change', {
        type,
        path,
        projectId,
        timestamp: Date.now()
    });
}

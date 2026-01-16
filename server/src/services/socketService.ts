import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index';

interface AuthenticatedSocket extends Socket {
    userId?: string;
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
            // Track user's sockets
            if (!userSockets.has(userId)) {
                userSockets.set(userId, new Set());
            }
            userSockets.get(userId)!.add(socket.id);

            // Join user's room for targeted messages
            socket.join(`user:${userId}`);

            console.log(`User ${userId} connected (socket: ${socket.id})`);
        }

        // Join project room for file sync
        socket.on('join-project', (projectId: string) => {
            socket.join(`project:${projectId}`);
            console.log(`Socket ${socket.id} joined project ${projectId}`);
        });

        socket.on('leave-project', (projectId: string) => {
            socket.leave(`project:${projectId}`);
            console.log(`Socket ${socket.id} left project ${projectId}`);
        });

        socket.on('disconnect', () => {
            if (userId && userSockets.has(userId)) {
                userSockets.get(userId)!.delete(socket.id);
                if (userSockets.get(userId)!.size === 0) {
                    userSockets.delete(userId);
                }
            }
            console.log(`Socket ${socket.id} disconnected`);
        });
    });
}

/**
 * Emit execution output to a user
 */
export function emitExecutionOutput(
    io: SocketIOServer,
    userId: string,
    executionId: string,
    type: 'stdout' | 'stderr' | 'status',
    data: string
): void {
    io.to(`user:${userId}`).emit('execution-output', {
        executionId,
        type,
        data,
        timestamp: Date.now()
    });
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


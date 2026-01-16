import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        const token = useAuthStore.getState().token;

        socket = io('/', {
            auth: { token },
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            console.log('WebSocket connected');
        });

        socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
        });
    }

    return socket;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}

export function joinProject(projectId: string): void {
    getSocket().emit('join-project', projectId);
}

export function leaveProject(projectId: string): void {
    getSocket().emit('leave-project', projectId);
}

export interface ExecutionOutput {
    executionId: string;
    type: 'stdout' | 'stderr' | 'status';
    data: string;
    timestamp: number;
}

export interface FileChange {
    type: 'created' | 'modified' | 'deleted';
    path: string;
    projectId: string;
    timestamp: number;
}

export function onExecutionOutput(callback: (output: ExecutionOutput) => void): () => void {
    const socket = getSocket();
    socket.on('execution-output', callback);
    return () => socket.off('execution-output', callback);
}

export function onFileChange(callback: (change: FileChange) => void): () => void {
    const socket = getSocket();
    socket.on('file-change', callback);
    return () => socket.off('file-change', callback);
}

// Core TypeScript types for CloudCodeX

export interface User {
    id: string;
    email: string;
    username: string;
    role: 'user' | 'admin';
    storageQuotaMb: number;
    storageUsedMb: number;
    createdAt: Date;
}

export interface Project {
    id: string;
    userId: string;
    name: string;
    description?: string;
    language?: string;
    github_url?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: FileNode[];
    modifiedAt?: Date;
}

export interface ExecutionRequest {
    projectId: string;
    filePath: string;
    language: SupportedLanguage;
    stdin?: string;
}

export interface ExecutionResult {
    executionId: string;
    status: ExecutionStatus;
    stdout: string;
    stderr: string;
    exitCode?: number;
    executionTimeMs?: number;
    memoryUsedMb?: number;
}

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'timeout' | 'error';

export type SupportedLanguage =
    | 'c'
    | 'cpp'
    | 'java'
    | 'python'
    | 'javascript'
    | 'go'
    | 'rust'
    | 'php'
    | 'ruby'
    | 'bash';

export interface LanguageConfig {
    name: string;
    extension: string;
    dockerImage: string;
    compileCommand?: string;
    runCommand: string;
    timeout: number;
    memoryLimit: string;
}

export interface GitOperation {
    type: 'init' | 'clone' | 'status' | 'add' | 'commit' | 'pull' | 'push';
    projectId: string;
    args?: Record<string, string>;
}

export interface GitResult {
    success: boolean;
    output: string;
    error?: string;
}

export interface ZipImportOptions {
    projectId: string;
    targetPath?: string;
    overwrite?: boolean;
}

export interface ZipExportOptions {
    projectId: string;
    paths?: string[];
    includeGit?: boolean;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
    };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

// WebSocket Events
export interface WsExecutionOutput {
    executionId: string;
    type: 'stdout' | 'stderr' | 'status';
    data: string;
    timestamp: number;
}

export interface WsFileChange {
    type: 'created' | 'modified' | 'deleted';
    path: string;
    projectId: string;
}


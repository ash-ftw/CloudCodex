import { useAuthStore } from '../store/authStore';

const API_URL = '/api';

interface ApiOptions {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
    const token = useAuthStore.getState().token;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    // Handle non-OK responses
    if (!response.ok) {
        // Auto-logout on invalid/expired token
        if (response.status === 401) {
            const authStore = useAuthStore.getState();
            if (authStore.isAuthenticated) {
                console.warn('Session expired or token invalid — clearing auth state');
                localStorage.removeItem('auth-storage');
                // Clear state directly instead of calling logout() which makes another API call
                useAuthStore.setState({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    sessionChecked: true
                });
            }
        }

        // Try to parse error as JSON, fallback to status text
        let errorMessage = `Request failed: ${response.status} ${response.statusText}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
        } catch {
            // JSON parse failed, use default message
        }
        throw new Error(errorMessage);
    }

    // Parse successful response
    try {
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error?.message || 'Request failed');
        }
        return data.data;
    } catch (parseError) {
        throw new Error('Failed to parse server response');
    }
}

// Projects API
export const projectsApi = {
    list: () => apiRequest<any[]>('/projects'),

    get: (id: string) => apiRequest<any>(`/projects/${id}`),

    create: (data: { name: string; description?: string; language?: string }) =>
        apiRequest<any>('/projects', { method: 'POST', body: data }),

    update: (id: string, data: { name?: string; description?: string; language?: string }) =>
        apiRequest<any>(`/projects/${id}`, { method: 'PUT', body: data }),

    delete: (id: string) =>
        apiRequest<void>(`/projects/${id}`, { method: 'DELETE' }),

    createStructure: (id: string, type = 'react') =>
        apiRequest<{ message: string }>(`/projects/${id}/structure`, { method: 'POST', body: { type } })
};

// Files API
export const filesApi = {
    list: (projectId: string, path = '') =>
        apiRequest<any[]>(`/files/${projectId}?path=${encodeURIComponent(path)}`),

    read: (projectId: string, filePath: string) =>
        apiRequest<{ content: string }>(`/files/${projectId}/content/${encodeURIComponent(filePath)}`),

    create: (projectId: string, filePath: string, type: 'file' | 'directory', content = '') =>
        apiRequest<any>(`/files/${projectId}/create/${encodeURIComponent(filePath)}`, {
            method: 'POST',
            body: { type, content }
        }),

    update: (projectId: string, filePath: string, content: string) =>
        apiRequest<any>(`/files/${projectId}/content/${encodeURIComponent(filePath)}`, {
            method: 'PUT',
            body: { content }
        }),

    rename: (projectId: string, filePath: string, newName: string) =>
        apiRequest<any>(`/files/${projectId}/rename/${encodeURIComponent(filePath)}`, {
            method: 'PATCH',
            body: { newName }
        }),

    delete: (projectId: string, filePath: string) =>
        apiRequest<void>(`/files/${projectId}/${encodeURIComponent(filePath)}`, { method: 'DELETE' })
};

// Execution API
export const executeApi = {
    run: (projectId: string, filePath: string, language: string, stdin?: string) =>
        apiRequest<{ executionId: string }>('/execute', {
            method: 'POST',
            body: { projectId, filePath, language, stdin }
        }),

    stop: (executionId: string) =>
        apiRequest<void>(`/execute/${executionId}`, { method: 'DELETE' }),

    status: (executionId: string) =>
        apiRequest<any>(`/execute/${executionId}`)
};

// Git API
export const gitApi = {
    init: (projectId: string) =>
        apiRequest<any>(`/git/${projectId}/init`, { method: 'POST' }),

    clone: (projectId: string, url: string, branch?: string) =>
        apiRequest<any>(`/git/${projectId}/clone`, { method: 'POST', body: { url, branch } }),

    status: (projectId: string) =>
        apiRequest<any>(`/git/${projectId}/status`),

    add: (projectId: string, files?: string[]) =>
        apiRequest<any>(`/git/${projectId}/add`, { method: 'POST', body: { files } }),

    commit: (projectId: string, message: string) =>
        apiRequest<any>(`/git/${projectId}/commit`, { method: 'POST', body: { message } }),

    pull: (projectId: string) =>
        apiRequest<any>(`/git/${projectId}/pull`, { method: 'POST' }),

    push: (projectId: string) =>
        apiRequest<any>(`/git/${projectId}/push`, { method: 'POST' }),

    validatePush: (projectId: string) =>
        apiRequest<{
            gitInitialized: boolean;
            githubAuthenticated: boolean;
            remoteConfigured: boolean;
            hasCommits: boolean;
            hasUncommittedChanges: boolean;
            canPush: boolean;
            remote?: { name: string; url: string };
        }>(`/git/${projectId}/validate`),

    checkRepo: (projectId: string) =>
        apiRequest<{ isRepo: boolean }>(`/git/${projectId}/check-repo`),

    addRemote: (projectId: string, url: string, branch?: string) =>
        apiRequest<any>(`/git/${projectId}/remote`, { method: 'POST', body: { url, branch } }),

    listRemotes: (projectId: string) =>
        apiRequest<Array<{ name: string; url: string }>>(`/git/${projectId}/remote`)
};

// ZIP API
export const zipApi = {
    import: async (projectId: string, file: File, path = '') => {
        const token = useAuthStore.getState().token;
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(
            `${API_URL}/zip/${projectId}/import?path=${encodeURIComponent(path)}`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            }
        );

        const data = await response.json();
        if (!data.success) throw new Error(data.error?.message || 'Import failed');
        return data.data;
    },

    exportProject: (projectId: string, projectName?: string) => {
        const token = useAuthStore.getState().token;
        const name = encodeURIComponent(projectName || projectId);
        window.open(`${API_URL}/zip/${projectId}/export?token=${token}&name=${name}`, '_blank');
    },

    exportSelection: async (projectId: string, paths: string[]) => {
        const token = useAuthStore.getState().token;
        const response = await fetch(`${API_URL}/zip/${projectId}/export`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ paths })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectId}-selection.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
        }
    }
};

// Admin API
export const adminApi = {
    // Dashboard
    dashboard: () =>
        apiRequest<any>('/admin/dashboard'),

    usage: () =>
        apiRequest<any>('/admin/usage'),

    // Users
    users: (page = 1, limit = 50, search?: string, status?: string, role?: string) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (search) params.set('search', search);
        if (status) params.set('status', status);
        if (role) params.set('role', role);
        return apiRequest<any>(`/admin/users?${params}`);
    },

    userDetail: (userId: string) =>
        apiRequest<any>(`/admin/users/${userId}`),

    blockUser: (userId: string, reason?: string) =>
        apiRequest<any>(`/admin/users/${userId}/block`, { method: 'PUT', body: { reason } }),

    unblockUser: (userId: string) =>
        apiRequest<any>(`/admin/users/${userId}/unblock`, { method: 'PUT' }),

    updateRole: (userId: string, role: 'user' | 'admin') =>
        apiRequest<any>(`/admin/users/${userId}/role`, { method: 'PUT', body: { role } }),

    deleteUser: (userId: string) =>
        apiRequest<any>(`/admin/users/${userId}`, { method: 'DELETE' }),

    // Projects
    projects: (page = 1, limit = 50, search?: string) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (search) params.set('search', search);
        return apiRequest<any>(`/admin/projects?${params}`);
    },

    projectDetail: (projectId: string) =>
        apiRequest<any>(`/admin/projects/${projectId}`),

    deleteProject: (projectId: string) =>
        apiRequest<any>(`/admin/projects/${projectId}`, { method: 'DELETE' }),

    downloadProject: (projectId: string) => {
        const token = useAuthStore.getState().token;
        window.open(`/api/admin/projects/${projectId}/download?token=${token}`, '_blank');
    },

    // Executions
    activeExecutions: () =>
        apiRequest<any[]>('/admin/executions/active'),

    killExecution: (containerId: string) =>
        apiRequest<any>(`/admin/executions/${containerId}/kill`, { method: 'POST' }),

    executionLogs: (containerId: string) =>
        apiRequest<any>(`/admin/executions/${containerId}/logs`),

    // Containers
    containers: (all = false) =>
        apiRequest<any[]>(`/admin/containers?all=${all}`),

    stopContainer: (containerId: string) =>
        apiRequest<any>(`/admin/containers/${containerId}/stop`, { method: 'POST' }),

    restartContainer: (containerId: string) =>
        apiRequest<any>(`/admin/containers/${containerId}/restart`, { method: 'POST' }),

    pauseContainer: (containerId: string) =>
        apiRequest<any>(`/admin/containers/${containerId}/pause`, { method: 'POST' }),

    unpauseContainer: (containerId: string) =>
        apiRequest<any>(`/admin/containers/${containerId}/unpause`, { method: 'POST' }),

    removeContainer: (containerId: string) =>
        apiRequest<any>(`/admin/containers/${containerId}`, { method: 'DELETE' }),

    cleanupContainers: (maxAgeHours = 24) =>
        apiRequest<any>('/admin/containers/cleanup', { method: 'POST', body: { maxAgeHours } }),

    // Logs
    logs: (page = 1, limit = 50, filters?: { userId?: string; status?: string; language?: string }) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (filters?.userId) params.set('userId', filters.userId);
        if (filters?.status) params.set('status', filters.status);
        if (filters?.language) params.set('language', filters.language);
        return apiRequest<any>(`/admin/logs?${params}`);
    },

    auditLogs: (page = 1, limit = 50, filters?: { action?: string; severity?: string; targetType?: string }) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (filters?.action) params.set('action', filters.action);
        if (filters?.severity) params.set('severity', filters.severity);
        if (filters?.targetType) params.set('targetType', filters.targetType);
        return apiRequest<any>(`/admin/audit-logs?${params}`);
    },

    // Analytics
    analytics: (days = 7) =>
        apiRequest<any>(`/admin/analytics?days=${days}`),

    exportAnalytics: (days = 30) => {
        const token = useAuthStore.getState().token;
        window.open(`/api/admin/analytics/export?days=${days}&token=${token}`, '_blank');
    },

    // Settings
    settings: () =>
        apiRequest<any[]>('/admin/settings'),

    updateSettings: (settings: Record<string, string>) =>
        apiRequest<any>('/admin/settings', { method: 'PUT', body: { settings } }),

    // Alerts
    alerts: () =>
        apiRequest<any[]>('/admin/alerts')
};

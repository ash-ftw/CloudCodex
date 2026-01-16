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
        // Try to parse error as JSON, fallback to status text
        try {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `Request failed: ${response.status}`);
        } catch {
            throw new Error(`Request failed: ${response.status} ${response.statusText}`);
        }
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
        apiRequest<any>(`/git/${projectId}/push`, { method: 'POST' })
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
    logs: (page = 1, limit = 50) =>
        apiRequest<any>(`/admin/logs?page=${page}&limit=${limit}`),

    containers: () =>
        apiRequest<any[]>('/admin/containers'),

    users: (page = 1, limit = 50) =>
        apiRequest<any>(`/admin/users?page=${page}&limit=${limit}`),

    usage: () =>
        apiRequest<any>('/admin/usage'),

    updateRole: (userId: string, role: 'user' | 'admin') =>
        apiRequest<any>(`/admin/users/${userId}/role`, { method: 'POST', body: { role } })
};

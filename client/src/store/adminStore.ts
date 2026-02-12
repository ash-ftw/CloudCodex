import { create } from 'zustand';
import { adminApi } from '../services/api';

// ─── Types ───────────────────────────────────────────────

export interface DashboardStats {
    users: { total: number; active: number };
    projects: { total: number };
    executions: { total: number; last24Hours: number; failed: number };
    system: {
        containers: { total: number; running: number; paused: number; stopped: number };
        images: number;
        cpuCount: number;
        totalMemoryMb: number;
        usedMemoryMb: number;
    };
    alerts: AbuseAlert[];
}

export interface AdminUser {
    id: string;
    username: string;
    email: string;
    role: 'user' | 'admin';
    status: 'active' | 'blocked' | 'suspended';
    storageQuotaMb: number;
    storageUsedMb: number;
    createdAt: string;
    lastActiveAt: string | null;
    blockedAt: string | null;
    blockedReason: string | null;
    executionCount: number;
    projectCount: number;
}

export interface AdminProject {
    id: string;
    name: string;
    description: string;
    language: string;
    githubUrl: string | null;
    userId: string;
    username: string;
    sizeMb: number;
    createdAt: string;
    updatedAt: string;
}

export interface ActiveExecution {
    containerId: string;
    image: string;
    status: string;
    state: string;
    created: string;
    userId: string;
    language: string;
    projectId: string;
    cpu: number;
    memoryMb: number;
    memoryLimitMb: number;
    memoryPercent: number;
    pids: number;
}

export interface ContainerInfo {
    id: string;
    name: string;
    image: string;
    status: string;
    state: string;
    created: string;
    stats: {
        cpuPercent: number;
        memoryUsageMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
    } | null;
}

export interface AuditLogEntry {
    id: string;
    action: string;
    performed_by: string;
    target_type: string;
    target_id: string;
    details: Record<string, unknown>;
    severity: string;
    created_at: string;
    profiles?: { username: string };
}

export interface AbuseAlert {
    userId: string;
    username: string;
    issue: string;
    severity: 'warning' | 'critical';
    details: Record<string, unknown>;
}

export interface SystemSetting {
    key: string;
    value: string;
    description: string;
    updated_by: string | null;
    updated_at: string;
}

export interface AnalyticsData {
    executionsPerHour: Record<string, number>;
    languageDistribution: Record<string, number>;
    statusDistribution: Record<string, number>;
    topUsers: Array<{ userId: string; username: string; executions: number }>;
    averageExecutionTimeMs: number;
    averageMemoryUsageMb: number;
    dailyRegistrations: Record<string, number>;
    totalExecutionsInPeriod: number;
}

export interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

// ─── Store Types ─────────────────────────────────────────

type AdminTab = 'overview' | 'users' | 'projects' | 'executions' | 'containers' | 'logs' | 'audit' | 'analytics' | 'settings' | 'alerts';

interface AdminState {
    // UI State
    activeTab: AdminTab;
    isLoading: boolean;
    error: string | null;

    // Data
    dashboard: DashboardStats | null;
    users: AdminUser[];
    usersPagination: Pagination | null;
    projects: AdminProject[];
    projectsPagination: Pagination | null;
    activeExecutions: ActiveExecution[];
    containers: ContainerInfo[];
    executionLogs: any[];
    logsPagination: Pagination | null;
    auditLogs: AuditLogEntry[];
    auditPagination: Pagination | null;
    analytics: AnalyticsData | null;
    settings: SystemSetting[];
    alerts: AbuseAlert[];

    // Actions
    setActiveTab: (tab: AdminTab) => void;
    loadDashboard: () => Promise<void>;
    loadUsers: (page?: number, search?: string, status?: string, role?: string) => Promise<void>;
    loadProjects: (page?: number, search?: string) => Promise<void>;
    loadActiveExecutions: () => Promise<void>;
    loadContainers: (all?: boolean) => Promise<void>;
    loadLogs: (page?: number, filters?: { userId?: string; status?: string; language?: string }) => Promise<void>;
    loadAuditLogs: (page?: number, filters?: { action?: string; severity?: string; targetType?: string }) => Promise<void>;
    loadAnalytics: (days?: number) => Promise<void>;
    loadSettings: () => Promise<void>;
    loadAlerts: () => Promise<void>;

    // User actions
    blockUser: (userId: string, reason?: string) => Promise<void>;
    unblockUser: (userId: string) => Promise<void>;
    updateUserRole: (userId: string, role: 'user' | 'admin') => Promise<void>;
    deleteUser: (userId: string) => Promise<void>;

    // Project actions
    deleteProject: (projectId: string) => Promise<void>;

    // Execution actions
    killExecution: (containerId: string) => Promise<void>;

    // Container actions
    stopContainer: (containerId: string) => Promise<void>;
    restartContainer: (containerId: string) => Promise<void>;
    removeContainer: (containerId: string) => Promise<void>;
    cleanupContainers: (maxAgeHours?: number) => Promise<void>;

    // Settings actions
    updateSettings: (settings: Record<string, string>) => Promise<void>;
}

// ─── Store ───────────────────────────────────────────────

export const useAdminStore = create<AdminState>()((set, get) => ({
    // Initial state
    activeTab: 'overview',
    isLoading: false,
    error: null,
    dashboard: null,
    users: [],
    usersPagination: null,
    projects: [],
    projectsPagination: null,
    activeExecutions: [],
    containers: [],
    executionLogs: [],
    logsPagination: null,
    auditLogs: [],
    auditPagination: null,
    analytics: null,
    settings: [],
    alerts: [],

    setActiveTab: (tab) => set({ activeTab: tab }),

    // ── Dashboard ──────────────────────────────────────
    loadDashboard: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.dashboard();
            set({ dashboard: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    // ── Users ──────────────────────────────────────────
    loadUsers: async (page = 1, search?, status?, role?) => {
        set({ isLoading: true, error: null });
        try {
            const result = await adminApi.users(page, 50, search, status, role);
            set({
                users: result.data || result,
                usersPagination: result.pagination || null,
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    blockUser: async (userId, reason?) => {
        try {
            await adminApi.blockUser(userId, reason);
            await get().loadUsers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    unblockUser: async (userId) => {
        try {
            await adminApi.unblockUser(userId);
            await get().loadUsers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    updateUserRole: async (userId, role) => {
        try {
            await adminApi.updateRole(userId, role);
            await get().loadUsers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    deleteUser: async (userId) => {
        try {
            await adminApi.deleteUser(userId);
            await get().loadUsers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    // ── Projects ───────────────────────────────────────
    loadProjects: async (page = 1, search?) => {
        set({ isLoading: true, error: null });
        try {
            const result = await adminApi.projects(page, 50, search);
            set({
                projects: result.data || result,
                projectsPagination: result.pagination || null,
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    deleteProject: async (projectId) => {
        try {
            await adminApi.deleteProject(projectId);
            await get().loadProjects();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    // ── Executions ─────────────────────────────────────
    loadActiveExecutions: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.activeExecutions();
            set({ activeExecutions: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    killExecution: async (containerId) => {
        try {
            await adminApi.killExecution(containerId);
            await get().loadActiveExecutions();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    // ── Containers ─────────────────────────────────────
    loadContainers: async (all = false) => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.containers(all);
            set({ containers: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    stopContainer: async (containerId) => {
        try {
            await adminApi.stopContainer(containerId);
            await get().loadContainers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    restartContainer: async (containerId) => {
        try {
            await adminApi.restartContainer(containerId);
            await get().loadContainers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    removeContainer: async (containerId) => {
        try {
            await adminApi.removeContainer(containerId);
            await get().loadContainers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    cleanupContainers: async (maxAgeHours = 24) => {
        try {
            await adminApi.cleanupContainers(maxAgeHours);
            await get().loadContainers();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    // ── Logs ───────────────────────────────────────────
    loadLogs: async (page = 1, filters?) => {
        set({ isLoading: true, error: null });
        try {
            const result = await adminApi.logs(page, 50, filters);
            set({
                executionLogs: result.data || result,
                logsPagination: result.pagination || null,
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    loadAuditLogs: async (page = 1, filters?) => {
        set({ isLoading: true, error: null });
        try {
            const result = await adminApi.auditLogs(page, 50, filters);
            set({
                auditLogs: result.data || result,
                auditPagination: result.pagination || null,
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    // ── Analytics ──────────────────────────────────────
    loadAnalytics: async (days = 7) => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.analytics(days);
            set({ analytics: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    // ── Settings ───────────────────────────────────────
    loadSettings: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.settings();
            set({ settings: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    updateSettings: async (settings) => {
        try {
            await adminApi.updateSettings(settings);
            await get().loadSettings();
        } catch (err: any) {
            set({ error: err.message });
        }
    },

    // ── Alerts ─────────────────────────────────────────
    loadAlerts: async () => {
        set({ isLoading: true, error: null });
        try {
            const data = await adminApi.alerts();
            set({ alerts: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    }
}));

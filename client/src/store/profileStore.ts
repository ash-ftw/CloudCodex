import { create } from 'zustand';

interface ConnectedAccount {
    id: string;
    provider: 'google' | 'github';
    email: string;
    created_at: string;
}

interface Profile {
    id: string;
    username: string;
    role: 'user' | 'admin';
    storage_quota_mb: number;
    storage_used_mb: number;
    created_at: string;
}

interface ProfileState {
    profile: Profile | null;
    connectedAccounts: ConnectedAccount[];
    isLoading: boolean;
    error: string | null;

    fetchProfile: () => Promise<void>;
    updateProfile: (data: { username?: string }) => Promise<void>;
    connectAccount: (provider: 'google' | 'github', userId: string) => void;
    disconnectAccount: (provider: 'google' | 'github') => Promise<void>;
    clearError: () => void;
}

const API_URL = '/api';

export const useProfileStore = create<ProfileState>()((set, get) => ({
    profile: null,
    connectedAccounts: [],
    isLoading: false,
    error: null,

    fetchProfile: async () => {
        set({ isLoading: true, error: null });
        try {
            const token = localStorage.getItem('auth-storage');
            if (!token) {
                throw new Error('No authentication token found');
            }

            const authData = JSON.parse(token);

            const response = await fetch(`${API_URL}/profile`, {
                headers: {
                    'Authorization': `Bearer ${authData.state.token}`
                }
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error?.message || 'Failed to fetch profile');
            }

            set({
                profile: data.data.profile,
                connectedAccounts: data.data.connectedAccounts,
                isLoading: false
            });
        } catch (error) {
            set({
                error: (error as Error).message,
                isLoading: false
            });
        }
    },

    updateProfile: async (updates) => {
        set({ isLoading: true, error: null });
        try {
            const token = localStorage.getItem('auth-storage');
            if (!token) {
                throw new Error('No authentication token found');
            }

            const authData = JSON.parse(token);

            const response = await fetch(`${API_URL}/profile`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authData.state.token}`
                },
                body: JSON.stringify(updates)
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error?.message || 'Failed to update profile');
            }

            set({
                profile: data.data.profile,
                isLoading: false
            });
        } catch (error) {
            set({
                error: (error as Error).message,
                isLoading: false
            });
            throw error;
        }
    },

    connectAccount: (provider: 'google' | 'github', userId: string) => {
        // Redirect to OAuth flow
        window.location.href = `${API_URL}/auth/${provider}/link?userId=${userId}`;
    },

    disconnectAccount: async (provider: 'google' | 'github') => {
        set({ isLoading: true, error: null });
        try {
            const token = localStorage.getItem('auth-storage');
            if (!token) {
                throw new Error('No authentication token found');
            }

            const authData = JSON.parse(token);

            const response = await fetch(`${API_URL}/profile/disconnect/${provider}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${authData.state.token}`
                }
            });

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error?.message || 'Failed to disconnect account');
            }

            // Remove the disconnected account from state
            set({
                connectedAccounts: get().connectedAccounts.filter(acc => acc.provider !== provider),
                isLoading: false
            });
        } catch (error) {
            set({
                error: (error as Error).message,
                isLoading: false
            });
            throw error;
        }
    },

    clearError: () => set({ error: null })
}));

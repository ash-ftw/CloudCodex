import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
    id: string;
    email: string;
    username: string;
    role: 'user' | 'admin';
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    sessionChecked: boolean;

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, username: string) => Promise<void>;
    loginWithGitHub: () => void;
    loginWithGoogle: () => void;
    setAuth: (user: User, token: string) => void;
    logout: () => Promise<void>;
    validateSession: () => Promise<void>;
}

const API_URL = '/api';

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            sessionChecked: false,

            login: async (email: string, password: string) => {
                set({ isLoading: true });
                try {
                    const response = await fetch(`${API_URL}/auth/login`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });

                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error?.message || 'Login failed');
                    }

                    set({
                        user: data.data.user,
                        token: data.data.token,
                        isAuthenticated: true,
                        isLoading: false
                    });
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },

            register: async (email: string, password: string, username: string) => {
                set({ isLoading: true });
                try {
                    const response = await fetch(`${API_URL}/auth/register`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password, username })
                    });

                    const data = await response.json();

                    if (!data.success) {
                        throw new Error(data.error?.message || 'Registration failed');
                    }

                    set({
                        user: data.data.user,
                        token: data.data.token,
                        isAuthenticated: true,
                        isLoading: false
                    });
                } catch (error) {
                    set({ isLoading: false });
                    throw error;
                }
            },

            loginWithGitHub: () => {
                window.location.href = `${API_URL}/auth/github`;
            },

            loginWithGoogle: () => {
                window.location.href = `${API_URL}/auth/google`;
            },

            setAuth: (user: User, token: string) => {
                set({
                    user,
                    token,
                    isAuthenticated: true,
                    isLoading: false
                });
            },

            validateSession: async () => {
                const { token, isAuthenticated } = get();
                if (!token || !isAuthenticated) {
                    set({ sessionChecked: true });
                    return;
                }

                try {
                    const response = await fetch(`${API_URL}/auth/session`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) {
                        // Token is invalid/expired — clear auth state silently
                        console.warn('Persisted session invalid, clearing auth state');
                        localStorage.removeItem('auth-storage');
                        set({
                            user: null,
                            token: null,
                            isAuthenticated: false,
                            sessionChecked: true
                        });
                        return;
                    }

                    const data = await response.json();
                    if (data.success && data.data?.user) {
                        // Update user data from server in case it changed
                        set({
                            user: data.data.user,
                            sessionChecked: true
                        });
                    }
                } catch (error) {
                    // Network error — keep existing auth state, don't force logout
                    console.warn('Session validation failed (network):', error);
                    set({ sessionChecked: true });
                }
            },

            logout: async () => {
                try {
                    // Call server logout endpoint (best effort)
                    await fetch(`${API_URL}/auth/logout`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${get().token}`
                        }
                    });
                } catch (error) {
                    console.warn('Server logout failed:', error);
                } finally {
                    // Clear local storage explicitly to be safe
                    localStorage.removeItem('auth-storage');

                    // Reset store state
                    set({
                        user: null,
                        token: null,
                        isAuthenticated: false,
                        sessionChecked: true
                    });
                }
            }
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                user: state.user,
                token: state.token,
                isAuthenticated: state.isAuthenticated
            })
        }
    )
);

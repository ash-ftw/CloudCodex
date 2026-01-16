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

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, username: string) => Promise<void>;
    loginWithGitHub: () => void;
    setAuth: (user: User, token: string) => void;
    logout: () => void;
}

const API_URL = '/api';

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,

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

            setAuth: (user: User, token: string) => {
                set({
                    user,
                    token,
                    isAuthenticated: true,
                    isLoading: false
                });
            },

            logout: () => {
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false
                });
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

import { create } from 'zustand';

type Theme = 'dark' | 'light';

interface ThemeState {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
}

const getInitialTheme = (): Theme => {
    const stored = localStorage.getItem('cloudcodex-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return 'dark';
};

const applyTheme = (theme: Theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cloudcodex-theme', theme);
};

// Apply on load
applyTheme(getInitialTheme());

export const useThemeStore = create<ThemeState>((set) => ({
    theme: getInitialTheme(),
    setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
    },
    toggleTheme: () => {
        set((state) => {
            const next = state.theme === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            return { theme: next };
        });
    },
}));

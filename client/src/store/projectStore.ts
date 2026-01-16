import { create } from 'zustand';

export interface Project {
    id: string;
    name: string;
    description?: string;
    language?: string;
    githubUrl?: string;
    createdAt: string;
    updatedAt: string;
}

interface ProjectState {
    projects: Project[];
    currentProject: Project | null;
    isLoading: boolean;
    error: string | null;

    setProjects: (projects: Project[]) => void;
    setCurrentProject: (project: Project | null) => void;
    addProject: (project: Project) => void;
    updateProject: (id: string, updates: Partial<Project>) => void;
    removeProject: (id: string) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
    projects: [],
    currentProject: null,
    isLoading: false,
    error: null,

    setProjects: (projects) => set({ projects }),

    setCurrentProject: (project) => set({ currentProject: project }),

    addProject: (project) => {
        set({ projects: [project, ...get().projects] });
    },

    updateProject: (id, updates) => {
        set({
            projects: get().projects.map(p =>
                p.id === id ? { ...p, ...updates } : p
            )
        });
    },

    removeProject: (id) => {
        set({ projects: get().projects.filter(p => p.id !== id) });
    },

    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error })
}));

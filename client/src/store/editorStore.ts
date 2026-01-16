import { create } from 'zustand';

export interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    children?: FileNode[];
    isExpanded?: boolean;
}

export interface OpenFile {
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    language: string;
}

interface EditorState {
    files: FileNode[];
    openFiles: OpenFile[];
    activeFile: string | null;
    isLoading: boolean;
    error: string | null;

    setFiles: (files: FileNode[]) => void;
    toggleDirectory: (path: string) => void;
    setDirectoryChildren: (dirPath: string, children: FileNode[]) => void;
    openFile: (file: OpenFile) => void;
    closeFile: (path: string) => void;
    setActiveFile: (path: string) => void;
    updateFileContent: (path: string, content: string) => void;
    markFileSaved: (path: string) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
    files: [],
    openFiles: [],
    activeFile: null,
    isLoading: false,
    error: null,

    setFiles: (files) => set({ files }),

    toggleDirectory: (path) => {
        const toggleNode = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => {
                if (node.path === path) {
                    return { ...node, isExpanded: !node.isExpanded };
                }
                if (node.children) {
                    return { ...node, children: toggleNode(node.children) };
                }
                return node;
            });
        };
        set({ files: toggleNode(get().files) });
    },

    setDirectoryChildren: (dirPath, children) => {
        const updateNode = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => {
                if (node.path === dirPath) {
                    return { ...node, children, isExpanded: true };
                }
                if (node.children) {
                    return { ...node, children: updateNode(node.children) };
                }
                return node;
            });
        };
        set({ files: updateNode(get().files) });
    },

    openFile: (file) => {
        const { openFiles, activeFile } = get();
        const exists = openFiles.find(f => f.path === file.path);

        if (!exists) {
            set({ openFiles: [...openFiles, file], activeFile: file.path });
        } else {
            set({ activeFile: file.path });
        }
    },

    closeFile: (path) => {
        const { openFiles, activeFile } = get();
        const filtered = openFiles.filter(f => f.path !== path);
        const newActive = activeFile === path
            ? (filtered.length > 0 ? filtered[filtered.length - 1].path : null)
            : activeFile;

        set({ openFiles: filtered, activeFile: newActive });
    },

    setActiveFile: (path) => set({ activeFile: path }),

    updateFileContent: (path, content) => {
        set({
            openFiles: get().openFiles.map(f =>
                f.path === path ? { ...f, content, isDirty: true } : f
            )
        });
    },

    markFileSaved: (path) => {
        set({
            openFiles: get().openFiles.map(f =>
                f.path === path ? { ...f, isDirty: false } : f
            )
        });
    },

    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),

    reset: () => set({
        files: [],
        openFiles: [],
        activeFile: null,
        isLoading: false,
        error: null
    })
}));

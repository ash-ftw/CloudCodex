import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useEditorStore, FileNode } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { filesApi, executeApi, projectsApi } from '../services/api';
import { joinProject, leaveProject, onExecutionOutput, onFileChange, ExecutionOutput } from '../services/socket';
import {
    ChevronLeft, Play, Square, Save, FolderTree, Terminal, Settings,
    ChevronRight, ChevronDown, File, Folder, Plus, X, MoreHorizontal, Keyboard,
    RefreshCw, Code2, Loader2, FilePlus, FolderPlus
} from 'lucide-react';
import '../styles/editor.css';

const LANGUAGE_MAP: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    sh: 'bash',
    md: 'markdown',
    json: 'json',
    html: 'html',
    css: 'css',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml'
};

export default function EditorPage() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

    const { currentProject, setCurrentProject } = useProjectStore();
    const {
        files, openFiles, activeFile,
        setFiles, openFile, closeFile, setActiveFile, updateFileContent, markFileSaved, setDirectoryChildren, reset
    } = useEditorStore();

    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [consoleOpen, setConsoleOpen] = useState(true);
    const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null);
    const [stdinInput, setStdinInput] = useState('');
    const [showInput, setShowInput] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createType, setCreateType] = useState<'file' | 'directory'>('file');
    const [createParentPath, setCreateParentPath] = useState<string>('');

    // Use ref to track current execution ID to avoid stale closure issues
    const executionIdRef = useRef<string | null>(null);

    // Load project and files
    useEffect(() => {
        if (!projectId) return;

        // Reset editor state when switching projects
        reset();

        const loadProject = async () => {
            try {
                const project = await projectsApi.get(projectId);
                setCurrentProject(project);

                const fileList = await filesApi.list(projectId);
                setFiles(buildFileTree(fileList));

                joinProject(projectId);
            } catch (error) {
                console.error('Failed to load project:', error);
                navigate('/dashboard');
            }
        };

        loadProject();

        // Subscribe to execution output
        const unsubExec = onExecutionOutput((output: ExecutionOutput) => {
            // Use ref to get current execution ID (avoids stale closure)
            if (output.executionId === executionIdRef.current) {
                if (output.type === 'status') {
                    setIsRunning(output.data === 'running');
                } else {
                    setConsoleOutput(prev => [...prev, output.data]);
                }
            }
        });

        // Subscribe to file changes
        const unsubFile = onFileChange((change) => {
            if (change.projectId === projectId) {
                refreshFiles();
            }
        });

        return () => {
            leaveProject(projectId);
            unsubExec();
            unsubFile();
        };
    }, [projectId]);

    const refreshFiles = async () => {
        if (!projectId) return;
        const fileList = await filesApi.list(projectId);
        setFiles(buildFileTree(fileList));
    };

    const handleFileClick = async (node: FileNode) => {
        if (node.type === 'directory') {
            // Toggle directory expansion handled in store
            return;
        }

        // Check if already open
        const existing = openFiles.find(f => f.path === node.path);
        if (existing) {
            setActiveFile(node.path);
            return;
        }

        try {
            const { content } = await filesApi.read(projectId!, node.path);
            const ext = node.name.split('.').pop() || '';
            const language = LANGUAGE_MAP[ext] || 'plaintext';

            openFile({
                path: node.path,
                name: node.name,
                content,
                isDirty: false,
                language
            });
        } catch (error) {
            console.error('Failed to read file:', error);
        }
    };

    const handleSave = useCallback(async () => {
        const current = openFiles.find(f => f.path === activeFile);
        if (!current || !current.isDirty) return;

        setIsSaving(true);
        try {
            await filesApi.update(projectId!, current.path, current.content);
            markFileSaved(current.path);
        } catch (error) {
            console.error('Failed to save file:', error);
        } finally {
            setIsSaving(false);
        }
    }, [activeFile, openFiles, projectId, markFileSaved]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleSave]);

    const handleRun = async () => {
        const current = openFiles.find(f => f.path === activeFile);
        if (!current || !currentProject) return;

        // Save before running
        if (current.isDirty) {
            await handleSave();
        }

        // Detect language from file extension
        const ext = current.name.split('.').pop() || '';
        const languageForExecution = getExecutionLanguage(ext);

        setConsoleOutput([`> Running ${current.name}...\n`]);
        setIsRunning(true);

        try {
            const result = await executeApi.run(
                projectId!,
                current.path,
                languageForExecution,
                stdinInput || undefined
            );
            setCurrentExecutionId(result.executionId);
            executionIdRef.current = result.executionId;
        } catch (error) {
            setConsoleOutput(prev => [...prev, `Error: ${(error as Error).message}\n`]);
            setIsRunning(false);
        }
    };

    const handleStop = async () => {
        if (!currentExecutionId) return;

        try {
            await executeApi.stop(currentExecutionId);
            setIsRunning(false);
            setConsoleOutput(prev => [...prev, '\n> Execution stopped\n']);
        } catch (error) {
            console.error('Failed to stop execution:', error);
        }
    };

    const handleCreateFile = async (name: string, type: 'file' | 'directory') => {
        if (!projectId || !name.trim()) return;

        // Combine parent path with name
        const fullPath = createParentPath ? `${createParentPath}/${name}` : name;

        try {
            await filesApi.create(projectId, fullPath, type, type === 'file' ? '' : undefined);

            // If created in a subfolder, refresh that folder's children
            if (createParentPath) {
                const files = await filesApi.list(projectId, createParentPath);
                const children = files.map((f: any) => ({
                    name: f.name,
                    path: f.path,
                    type: f.type,
                    size: f.size,
                    isExpanded: false,
                    children: f.type === 'directory' ? [] : undefined
                }));
                setDirectoryChildren(createParentPath, children);
            } else {
                // Created at root level, refresh entire file list
                await refreshFiles();
            }

            setShowCreateModal(false);
            setCreateParentPath('');
        } catch (error) {
            console.error('Failed to create:', error);
            alert(`Failed to create ${type}: ${(error as Error).message}`);
        }
    };

    const handleCreateInFolder = (folderPath: string, type: 'file' | 'directory') => {
        setCreateParentPath(folderPath);
        setCreateType(type);
        setShowCreateModal(true);
    };

    const currentOpenFile = openFiles.find(f => f.path === activeFile);

    return (
        <div className="editor-page">
            {/* Header */}
            <header className="editor-header">
                <div className="header-left">
                    <button className="btn-icon" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft size={20} />
                    </button>
                    <div className="project-info">
                        <Code2 size={18} />
                        <span>{currentProject?.name || 'Loading...'}</span>
                    </div>
                </div>

                <div className="header-center">
                    <button
                        className={`run-btn ${isRunning ? 'running' : ''}`}
                        onClick={isRunning ? handleStop : handleRun}
                        disabled={!activeFile}
                    >
                        {isRunning ? <Square size={16} /> : <Play size={16} />}
                        {isRunning ? 'Stop' : 'Run'}
                    </button>
                    <button
                        className="btn-icon"
                        onClick={handleSave}
                        disabled={!currentOpenFile?.isDirty || isSaving}
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    </button>
                </div>

                <div className="header-right">
                    <button
                        className={`btn-icon ${sidebarOpen ? 'active' : ''}`}
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                    >
                        <FolderTree size={18} />
                    </button>
                    <button
                        className={`btn-icon ${consoleOpen ? 'active' : ''}`}
                        onClick={() => setConsoleOpen(!consoleOpen)}
                    >
                        <Terminal size={18} />
                    </button>
                    <button className="btn-icon">
                        <Settings size={18} />
                    </button>
                </div>
            </header>

            <div className="editor-body">
                {/* Sidebar */}
                {sidebarOpen && (
                    <aside className="editor-sidebar">
                        <div className="sidebar-header">
                            <span>Files</span>
                            <div className="sidebar-actions">
                                <button className="btn-icon" onClick={refreshFiles} title="Refresh">
                                    <RefreshCw size={14} />
                                </button>
                                <button
                                    className="btn-icon"
                                    onClick={() => { setCreateType('file'); setShowCreateModal(true); }}
                                    title="New File"
                                >
                                    <FilePlus size={14} />
                                </button>
                                <button
                                    className="btn-icon"
                                    onClick={() => { setCreateType('directory'); setShowCreateModal(true); setCreateParentPath(''); }}
                                    title="New Folder"
                                >
                                    <FolderPlus size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="file-tree">
                            {files.length === 0 ? (
                                <div className="empty-tree">
                                    <p>No files yet</p>
                                    <button
                                        className="btn btn-sm"
                                        onClick={() => { setCreateType('file'); setShowCreateModal(true); }}
                                    >
                                        <Plus size={14} /> Create File
                                    </button>
                                </div>
                            ) : (
                                files.map(node => (
                                    <FileTreeNode
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        onFileClick={handleFileClick}
                                        activeFile={activeFile}
                                        projectId={projectId!}
                                        onRefresh={refreshFiles}
                                        onCreateInFolder={handleCreateInFolder}
                                    />
                                ))
                            )}
                        </div>
                    </aside>
                )}

                {/* Main Editor Area */}
                <main className="editor-main">
                    {/* Tabs */}
                    <div className="editor-tabs">
                        {openFiles.map(file => (
                            <div
                                key={file.path}
                                className={`tab ${file.path === activeFile ? 'active' : ''}`}
                                onClick={() => setActiveFile(file.path)}
                            >
                                <File size={14} />
                                <span>{file.name}</span>
                                {file.isDirty && <span className="dirty-indicator">•</span>}
                                <button
                                    className="close-tab"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        closeFile(file.path);
                                    }}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Monaco Editor */}
                    <div className="monaco-container">
                        {currentOpenFile ? (
                            <Editor
                                height="100%"
                                language={currentOpenFile.language}
                                value={currentOpenFile.content}
                                onChange={(value) => updateFileContent(currentOpenFile.path, value || '')}
                                theme="vs-dark"
                                options={{
                                    fontSize: 14,
                                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                    minimap: { enabled: true },
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    tabSize: 2,
                                    wordWrap: 'on',
                                    padding: { top: 16 }
                                }}
                            />
                        ) : (
                            <div className="no-file-open">
                                <Code2 size={48} />
                                <p>Select a file to start editing</p>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Console */}
            {consoleOpen && (
                <div className="editor-console">
                    <div className="console-header">
                        <Terminal size={14} />
                        <span>Console</span>
                        <div className="console-status">
                            {isRunning && <span className="running-indicator">Running</span>}
                        </div>
                        <button
                            className={`btn-icon ${showInput ? 'active' : ''}`}
                            onClick={() => setShowInput(!showInput)}
                            title="Toggle Input"
                        >
                            <Keyboard size={14} />
                        </button>
                        <button className="btn-icon" onClick={() => setConsoleOutput([])} title="Clear Output">
                            <X size={14} />
                        </button>
                    </div>
                    <div className="console-body">
                        {showInput && (
                            <div className="stdin-panel">
                                <div className="stdin-header">
                                    <span>Input (stdin)</span>
                                </div>
                                <textarea
                                    className="stdin-textarea"
                                    placeholder="Enter input for your program here..."
                                    value={stdinInput}
                                    onChange={(e) => setStdinInput(e.target.value)}
                                    disabled={isRunning}
                                />
                            </div>
                        )}
                        <pre className="console-output">
                            {consoleOutput.join('')}
                            {consoleOutput.length === 0 && (
                                <span className="console-placeholder">Output will appear here...</span>
                            )}
                        </pre>
                    </div>
                </div>
            )}

            {/* Create File/Folder Modal */}
            {showCreateModal && (
                <CreateItemModal
                    type={createType}
                    parentPath={createParentPath}
                    onClose={() => { setShowCreateModal(false); setCreateParentPath(''); }}
                    onCreate={handleCreateFile}
                />
            )}
        </div>
    );
}

function CreateItemModal({
    type,
    parentPath,
    onClose,
    onCreate
}: {
    type: 'file' | 'directory';
    parentPath: string;
    onClose: () => void;
    onCreate: (name: string, type: 'file' | 'directory') => void;
}) {
    const [name, setName] = useState('');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3>Create New {type === 'file' ? 'File' : 'Folder'}</h3>
                {parentPath && (
                    <p className="parent-path-info">In: {parentPath}/</p>
                )}
                <div className="form-group">
                    <input
                        type="text"
                        className="input"
                        placeholder={type === 'file' ? 'filename.js' : 'folder-name'}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && name.trim()) {
                                onCreate(name, type);
                            }
                        }}
                    />
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onCreate(name, type)}
                        disabled={!name.trim()}
                    >
                        Create
                    </button>
                </div>
            </div>
        </div>
    );
}

function FileTreeNode({
    node,
    depth,
    onFileClick,
    activeFile,
    projectId,
    onRefresh,
    onCreateInFolder
}: {
    node: FileNode;
    depth: number;
    onFileClick: (node: FileNode) => void;
    activeFile: string | null;
    projectId: string;
    onRefresh: () => void;
    onCreateInFolder: (folderPath: string, type: 'file' | 'directory') => void;
}) {
    const { toggleDirectory, setDirectoryChildren } = useEditorStore();
    const [showMenu, setShowMenu] = useState(false);
    const [_isLoading, setIsLoading] = useState(false);
    const isActive = node.path === activeFile;

    const handleClick = async () => {
        if (node.type === 'directory') {
            // If expanding and no children loaded yet, fetch them
            if (!node.isExpanded && (!node.children || node.children.length === 0)) {
                setIsLoading(true);
                try {
                    const files = await filesApi.list(projectId, node.path);
                    const children = files.map((f: any) => ({
                        name: f.name,
                        path: f.path,
                        type: f.type,
                        size: f.size,
                        isExpanded: false,
                        children: f.type === 'directory' ? [] : undefined
                    }));
                    setDirectoryChildren(node.path, children);
                } catch (error) {
                    console.error('Failed to load directory:', error);
                }
                setIsLoading(false);
            } else {
                toggleDirectory(node.path);
            }
            return;
        }
        onFileClick(node);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete ${node.name}?`)) return;
        try {
            await filesApi.delete(projectId, node.path);
            onRefresh();
        } catch (error) {
            alert(`Failed to delete: ${(error as Error).message}`);
        }
        setShowMenu(false);
    };

    const handleNewFile = () => {
        onCreateInFolder(node.path, 'file');
        setShowMenu(false);
    };

    const handleNewFolder = () => {
        onCreateInFolder(node.path, 'directory');
        setShowMenu(false);
    };

    return (
        <>
            <div
                className={`tree-node ${isActive ? 'active' : ''}`}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={handleClick}
                onContextMenu={(e) => { e.preventDefault(); setShowMenu(!showMenu); }}
            >
                {node.type === 'directory' ? (
                    <>
                        {node.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <Folder size={14} className="folder-icon" />
                    </>
                ) : (
                    <File size={14} className="file-icon" />
                )}
                <span className="node-name">{node.name}</span>
                <button
                    className="node-menu-btn"
                    onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                >
                    <MoreHorizontal size={14} />
                </button>
                {showMenu && (
                    <div className="node-menu" onClick={e => e.stopPropagation()}>
                        {node.type === 'directory' && (
                            <>
                                <button onClick={handleNewFile}>New File</button>
                                <button onClick={handleNewFolder}>New Folder</button>
                                <hr />
                            </>
                        )}
                        <button onClick={handleDelete} className="danger">Delete</button>
                    </div>
                )}
            </div>
            {node.type === 'directory' && node.isExpanded && node.children?.map(child => (
                <FileTreeNode
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    onFileClick={onFileClick}
                    activeFile={activeFile}
                    projectId={projectId}
                    onRefresh={onRefresh}
                    onCreateInFolder={onCreateInFolder}
                />
            ))}
        </>
    );
}

function buildFileTree(files: any[]): FileNode[] {
    return files.map(f => ({
        name: f.name,
        path: f.path,
        type: f.type,
        size: f.size,
        isExpanded: false,
        children: f.type === 'directory' ? [] : undefined
    }));
}

function getExecutionLanguage(ext: string): string {
    const execMap: Record<string, string> = {
        py: 'python',
        js: 'javascript',
        ts: 'javascript', // Execute TS as JS for node
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        go: 'go',
        rs: 'rust',
        php: 'php',
        rb: 'ruby',
        sh: 'bash'
    };
    return execMap[ext] || 'python';
}

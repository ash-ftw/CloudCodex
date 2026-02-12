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
    RefreshCw, Loader2, FilePlus, FolderPlus, BookOpen, Code2, HardDrive,
    Zap, Shield, KeyRound
} from 'lucide-react';
import { useModal } from '../hooks/useModal';
import ConfirmModal from '../components/ConfirmModal';
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
    const { modalState, showAlert, showConfirm, closeModal } = useModal();
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
    const [showWelcome, setShowWelcome] = useState(false);

    // Show welcome guidelines on first open of each project (unless globally dismissed)
    useEffect(() => {
        if (!projectId) return;
        const neverShow = localStorage.getItem('editor_guide_never_show');
        if (neverShow === 'true') return;
        const seenForProject = localStorage.getItem(`editor_guide_seen_${projectId}`);
        if (!seenForProject) {
            setShowWelcome(true);
        }
    }, [projectId]);

    const dismissWelcome = (neverShowAgain: boolean) => {
        if (projectId) {
            localStorage.setItem(`editor_guide_seen_${projectId}`, 'true');
        }
        if (neverShowAgain) {
            localStorage.setItem('editor_guide_never_show', 'true');
        }
        setShowWelcome(false);
    };

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
            showAlert(`Failed to create ${type}: ${(error as Error).message}`);
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
                        <img src="/favicon.svg" width={18} height={18} alt="CloudCodeX logo" />
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
                                        showAlert={showAlert}
                                        showConfirm={showConfirm}
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
                                <img src="/favicon.svg" width={48} height={48} alt="CloudCodeX logo" style={{ opacity: 0.5 }} />
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

            <ConfirmModal
                isOpen={modalState.isOpen}
                title={modalState.title}
                message={modalState.message}
                variant={modalState.variant}
                confirmLabel={modalState.confirmLabel}
                cancelLabel={modalState.cancelLabel}
                showCancel={modalState.showCancel}
                onConfirm={modalState.onConfirm}
                onCancel={closeModal}
            />

            {showWelcome && <WelcomeGuidelinesModal onClose={dismissWelcome} />}
        </div>
    );
}

function WelcomeGuidelinesModal({ onClose }: { onClose: (neverShowAgain: boolean) => void }) {
    const [neverShow, setNeverShow] = useState(false);

    return (
        <div className="modal-overlay" onClick={() => onClose(neverShow)}>
            <div className="welcome-modal" onClick={e => e.stopPropagation()}>
                <div className="welcome-header">
                    <div className="welcome-icon">
                        <BookOpen size={28} />
                    </div>
                    <h2>Welcome to the Editor</h2>
                    <p className="welcome-subtitle">Here's everything you need to get started</p>
                </div>

                <div className="welcome-sections">
                    {/* Available Languages */}
                    <div className="welcome-section">
                        <div className="section-title">
                            <Code2 size={16} />
                            <span>Supported Languages</span>
                        </div>
                        <div className="language-grid">
                            {[
                                { name: 'Python', ext: '.py' },
                                { name: 'JavaScript', ext: '.js' },
                                { name: 'TypeScript', ext: '.ts' },
                                { name: 'Java', ext: '.java' },
                                { name: 'C', ext: '.c' },
                                { name: 'C++', ext: '.cpp' },
                                { name: 'Go', ext: '.go' },
                                { name: 'Rust', ext: '.rs' },
                                { name: 'PHP', ext: '.php' },
                                { name: 'Ruby', ext: '.rb' },
                                { name: 'Bash', ext: '.sh' },
                            ].map(lang => (
                                <div key={lang.ext} className="language-chip">
                                    <span className="lang-name">{lang.name}</span>
                                    <span className="lang-ext">{lang.ext}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Execution Rules */}
                    <div className="welcome-section">
                        <div className="section-title">
                            <Zap size={16} />
                            <span>Execution Rules</span>
                        </div>
                        <ul className="guide-list">
                            <li>Files are <strong>auto-saved before execution</strong> — unsaved changes will be saved when you hit Run.</li>
                            <li>Only one program can run at a time. Stop the current execution before starting another.</li>
                            <li>Use the <strong>Input (stdin)</strong> panel to provide input before running your program.</li>
                            <li>Execution runs in an isolated container with resource limits for security.</li>
                            <li>Long-running programs will be <strong>automatically terminated</strong> after the timeout period.</li>
                        </ul>
                    </div>

                    {/* File Saving */}
                    <div className="welcome-section">
                        <div className="section-title">
                            <HardDrive size={16} />
                            <span>File Management</span>
                        </div>
                        <ul className="guide-list">
                            <li>A <strong>yellow dot (•)</strong> on a tab indicates unsaved changes.</li>
                            <li>Create files and folders using the buttons in the sidebar header or by right-clicking a folder.</li>
                            <li>File names must include the correct extension (e.g., <code>main.py</code>, <code>app.js</code>) for syntax highlighting and execution.</li>
                            <li>Deleting a file is permanent — there is no recycle bin.</li>
                        </ul>
                    </div>

                    {/* Keyboard Shortcuts */}
                    <div className="welcome-section">
                        <div className="section-title">
                            <KeyRound size={16} />
                            <span>Keyboard Shortcuts</span>
                        </div>
                        <div className="shortcuts-grid">
                            <div className="shortcut-row">
                                <kbd>Ctrl</kbd> + <kbd>S</kbd>
                                <span>Save current file</span>
                            </div>
                        </div>
                    </div>

                    {/* Safety */}
                    <div className="welcome-section">
                        <div className="section-title">
                            <Shield size={16} />
                            <span>Safety & Limits</span>
                        </div>
                        <ul className="guide-list">
                            <li>Code executes in a sandboxed environment — your system is never at risk.</li>
                            <li>Network access from executed code is restricted.</li>
                            <li>Memory and CPU usage are capped per execution.</li>
                        </ul>
                    </div>
                </div>

                <div className="welcome-footer">
                    <label className="never-show-label">
                        <input
                            type="checkbox"
                            checked={neverShow}
                            onChange={(e) => setNeverShow(e.target.checked)}
                        />
                        <span>Don't show this again for new projects</span>
                    </label>
                    <button className="btn btn-primary welcome-btn" onClick={() => onClose(neverShow)}>
                        Got it, let's code!
                    </button>
                </div>
            </div>
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
    onCreateInFolder,
    showAlert,
    showConfirm
}: {
    node: FileNode;
    depth: number;
    onFileClick: (node: FileNode) => void;
    activeFile: string | null;
    projectId: string;
    onRefresh: () => void;
    onCreateInFolder: (folderPath: string, type: 'file' | 'directory') => void;
    showAlert: (message: string, variant?: any, title?: string) => void;
    showConfirm: (options: { title: string; message: string; confirmLabel?: string; variant?: any }) => Promise<boolean>;
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
        const confirmed = await showConfirm({
            title: 'Delete File',
            message: `Are you sure you want to delete "${node.name}"?`,
            confirmLabel: 'Delete',
        });
        if (!confirmed) return;
        try {
            await filesApi.delete(projectId, node.path);
            onRefresh();
        } catch (error) {
            showAlert(`Failed to delete: ${(error as Error).message}`);
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
                    showAlert={showAlert}
                    showConfirm={showConfirm}
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

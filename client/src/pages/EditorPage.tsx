import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useEditorStore, FileNode } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { filesApi, executeApi, projectsApi } from '../services/api';
import { joinProject, leaveProject, onExecutionOutput, onFileChange, ExecutionOutput } from '../services/socket';
import {
    ChevronLeft, Play, Square, Save, FolderTree, Terminal,
    ChevronRight, ChevronDown, File, Folder, Plus, X, Keyboard,
    RefreshCw, Loader2, FilePlus, FolderPlus, BookOpen, Code2, HardDrive,
    Zap, Shield, KeyRound
} from 'lucide-react';
import { useModal } from '../hooks/useModal';
import ConfirmModal from '../components/ConfirmModal';
import SettingsDropdown from '../components/SettingsDropdown';
import { useThemeStore } from '../store/themeStore';
import { useCollaboration, isCrdtDrivenChange } from '../hooks/useCollaboration';
import { CollaboratorBar } from '../components/CollaboratorBar';
import { ShareProjectModal } from '../components/ShareProjectModal';
import { VersionHistoryModal } from '../components/VersionHistoryModal';
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
    const map: Record<string, string> = {
        py: 'python',
        js: 'javascript',
        ts: 'typescript',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        go: 'go',
        rs: 'rust',
        php: 'php',
        rb: 'ruby',
        sh: 'bash'
    };
    return map[ext] || 'javascript';
}

export default function EditorPage() {
    const { projectId } = useParams<{ projectId: string }>();
    const navigate = useNavigate();

    const { user } = useAuthStore();
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
    const { theme } = useThemeStore();

    // Collaborative Modals & Role state
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    const [editorInstance, setEditorInstance] = useState<editor.IStandaloneCodeEditor | null>(null);
    const [userRole, setUserRole] = useState<string>('owner');

    const executionIdRef = useRef<string | null>(null);
    const savePromiseRef = useRef<Promise<void> | null>(null);

    // Collaboration Hook
    const { collaborators, jumpToCollaborator } = useCollaboration({
        projectId,
        activeFilePath: activeFile,
        editor: editorInstance,
        username: user?.username || user?.email?.split('@')[0] || 'Collaborator'
    });

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

    // Load project and files
    useEffect(() => {
        if (!projectId) return;

        reset();

        const loadProject = async () => {
            try {
                const project = await projectsApi.get(projectId);
                setCurrentProject(project);
                setUserRole(project.role || 'owner');

                const fileList = await filesApi.list(projectId);
                setFiles(buildFileTree(fileList));

                joinProject(projectId);
            } catch (error) {
                console.error('Failed to load project:', error);
                navigate('/dashboard');
            }
        };

        loadProject();

        const unsubExec = onExecutionOutput((output: ExecutionOutput) => {
            if (output.executionId === executionIdRef.current || output.type === 'stdout' || output.type === 'stderr') {
                if (output.type === 'status') {
                    setIsRunning(output.data === 'running');
                } else {
                    setConsoleOutput(prev => [...prev, output.data]);
                }
            }
        });

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

    const handleEditorMount: OnMount = (editor) => {
        setEditorInstance(editor);
    };

    const handleFileClick = async (node: FileNode) => {
        if (node.type === 'directory') return;

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
        if (userRole === 'viewer') return;

        const { openFiles: latestOpenFiles, activeFile: latestActiveFile } = useEditorStore.getState();
        const current = latestOpenFiles.find(f => f.path === latestActiveFile);
        if (!current || !current.isDirty) return;

        setIsSaving(true);
        const promise = (async () => {
            try {
                await filesApi.update(projectId!, current.path, current.content);
                markFileSaved(current.path);
            } catch (error) {
                console.error('Failed to save file:', error);
            } finally {
                setIsSaving(false);
                savePromiseRef.current = null;
            }
        })();
        savePromiseRef.current = promise;
        await promise;
    }, [projectId, markFileSaved, userRole]);

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
        if (userRole === 'viewer') return;

        if (savePromiseRef.current) {
            await savePromiseRef.current;
        }

        const { openFiles: latestOpenFiles, activeFile: latestActiveFile } = useEditorStore.getState();
        const current = latestOpenFiles.find(f => f.path === latestActiveFile);
        if (!current || !currentProject) return;

        if (current.isDirty) {
            await handleSave();
        }

        const ext = current.name.split('.').pop() || '';
        const languageForExecution = getExecutionLanguage(ext);

        executionIdRef.current = null;
        setCurrentExecutionId(null);

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
        if (!projectId || !name.trim() || userRole === 'viewer') return;

        const fullPath = createParentPath ? `${createParentPath}/${name}` : name;

        try {
            await filesApi.create(projectId, fullPath, type, type === 'file' ? '' : undefined);

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
        if (userRole === 'viewer') return;
        setCreateParentPath(folderPath);
        setCreateType(type);
        setShowCreateModal(true);
    };

    const handleRestoreRevisionContent = (content: string) => {
        if (!activeFile || userRole === 'viewer') return;
        updateFileContent(activeFile, content);
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
                        <img src="/favicon.svg" width={18} height={18} alt="CodeSphere logo" />
                        <span>{currentProject?.name || 'Loading...'}</span>
                    </div>
                </div>

                <div className="header-center">
                    <button
                        className={`run-btn ${isRunning ? 'running' : ''}`}
                        onClick={isRunning ? handleStop : handleRun}
                        disabled={!activeFile || userRole === 'viewer'}
                    >
                        {isRunning ? <Square size={16} /> : <Play size={16} />}
                        {isRunning ? 'Stop' : 'Run'}
                    </button>
                    <button
                        className="btn-icon"
                        onClick={handleSave}
                        disabled={!currentOpenFile?.isDirty || isSaving || userRole === 'viewer'}
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
                    <SettingsDropdown />
                </div>
            </header>

            {/* Real-Time Collaborator Presence Bar */}
            <CollaboratorBar
                collaborators={collaborators}
                currentUserRole={userRole}
                onJumpToUser={jumpToCollaborator}
                onOpenShareModal={() => setShareModalOpen(true)}
                onOpenVersionModal={() => setVersionModalOpen(true)}
            />

            <div className="editor-body">
                {/* Sidebar */}
                {sidebarOpen && (
                    <aside className="editor-sidebar">
                        <div className="sidebar-header">
                            <span>Files</span>
                            {userRole !== 'viewer' && (
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
                            )}
                        </div>
                        <div className="file-tree">
                            {files.length === 0 ? (
                                <div className="empty-tree">
                                    <p>No files yet</p>
                                    {userRole !== 'viewer' && (
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => { setCreateType('file'); setShowCreateModal(true); }}
                                        >
                                            <Plus size={14} /> Create File
                                        </button>
                                    )}
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
                                        userRole={userRole}
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
                                key={currentOpenFile.path}
                                height="100%"
                                language={currentOpenFile.language}
                                defaultValue={currentOpenFile.content}
                                onMount={handleEditorMount}
                                onChange={(value) => {
                                    if (userRole !== 'viewer' && !isCrdtDrivenChange()) {
                                        updateFileContent(currentOpenFile.path, value || '');
                                    }
                                }}
                                theme={theme === 'light' ? 'vs' : 'vs-dark'}
                                options={{
                                    fontSize: 14,
                                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                                    minimap: { enabled: true },
                                    scrollBeyondLastLine: false,
                                    automaticLayout: true,
                                    tabSize: 2,
                                    wordWrap: 'on',
                                    padding: { top: 16 },
                                    readOnly: userRole === 'viewer'
                                }}
                            />
                        ) : (
                            <div className="no-file-open">
                                <img src="/favicon.svg" width={48} height={48} alt="CodeSphere logo" style={{ opacity: 0.5 }} />
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
                                    disabled={isRunning || userRole === 'viewer'}
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

            {/* Share & Version History Modals */}
            <ShareProjectModal
                isOpen={shareModalOpen}
                projectId={projectId!}
                onClose={() => setShareModalOpen(false)}
            />

            <VersionHistoryModal
                isOpen={versionModalOpen}
                projectId={projectId!}
                activeFilePath={activeFile}
                currentContent={currentOpenFile?.content || ''}
                onRestoreContent={handleRestoreRevisionContent}
                onClose={() => setVersionModalOpen(false)}
            />

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
                    <h2>Welcome to CodeSphere Collaborative IDE</h2>
                    <p className="welcome-subtitle">Here's everything you need to get started</p>
                </div>

                <div className="welcome-sections">
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

                    <div className="welcome-section">
                        <div className="section-title">
                            <Zap size={16} />
                            <span>Real-Time Collaboration</span>
                        </div>
                        <ul className="guide-list">
                            <li>Invite team members using the <strong>Share</strong> button.</li>
                            <li>Edit files simultaneously with live Yjs CRDT synchronization and remote cursors.</li>
                            <li>View online collaborators and click their badge to follow their cursor position.</li>
                            <li>Track file version history and compare side-by-side diffs using the <strong>History</strong> button.</li>
                        </ul>
                    </div>

                    <div className="welcome-section">
                        <div className="section-title">
                            <HardDrive size={16} />
                            <span>File Management</span>
                        </div>
                        <ul className="guide-list">
                            <li>A <strong>yellow dot (•)</strong> on a tab indicates unsaved changes.</li>
                            <li>Create files and folders using the buttons in the sidebar header.</li>
                            <li>File names must include the correct extension for execution.</li>
                        </ul>
                    </div>

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

                    <div className="welcome-section">
                        <div className="section-title">
                            <Shield size={16} />
                            <span>Safety & Limits</span>
                        </div>
                        <ul className="guide-list">
                            <li>Code executes in a sandboxed Docker environment.</li>
                            <li>Permissions enforce Owner, Editor, or Read-Only Viewer modes.</li>
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
    showConfirm,
    userRole
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
    userRole: string;
}) {
    const { toggleDirectory, setDirectoryChildren } = useEditorStore();
    const [showMenu, setShowMenu] = useState(false);
    const [_isLoading, setIsLoading] = useState(false);
    const isActive = node.path === activeFile;

    const handleClick = async () => {
        if (node.type === 'directory') {
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
        if (userRole === 'viewer') return;
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

    return (
        <>
            <div
                className={`tree-node ${isActive ? 'active' : ''}`}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={handleClick}
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

                {userRole !== 'viewer' && (
                    <div className="node-actions" onClick={e => e.stopPropagation()}>
                        <button
                            className="btn-icon btn-sm"
                            onClick={() => setShowMenu(!showMenu)}
                        >
                            <Plus size={12} />
                        </button>
                    </div>
                )}
            </div>

            {showMenu && userRole !== 'viewer' && (
                <div className="context-menu" style={{ left: `${20 + depth * 16}px` }}>
                    {node.type === 'directory' && (
                        <>
                            <button onClick={() => { onCreateInFolder(node.path, 'file'); setShowMenu(false); }}>
                                New File
                            </button>
                            <button onClick={() => { onCreateInFolder(node.path, 'directory'); setShowMenu(false); }}>
                                New Folder
                            </button>
                        </>
                    )}
                    <button onClick={handleDelete} className="text-danger">
                        Delete
                    </button>
                </div>
            )}

            {node.type === 'directory' && node.isExpanded && node.children && (
                <div className="tree-children">
                    {node.children.map(child => (
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
                            userRole={userRole}
                        />
                    ))}
                </div>
            )}
        </>
    );
}

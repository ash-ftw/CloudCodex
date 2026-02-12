import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProjectStore, Project } from '../store/projectStore';
import { projectsApi, zipApi, gitApi } from '../services/api';
import { useModal } from '../hooks/useModal';
import ConfirmModal from '../components/ConfirmModal';
import {
    Plus, Folder, LogOut, Settings, Search,
    Calendar, MoreVertical, Edit3, Trash2, Download, Github,
    ChevronRight, Sparkles, User, Package, Link, AlertTriangle, Lightbulb, Loader
} from 'lucide-react';
import GitHubSetupModal from '../components/GitHubSetupModal';
import '../styles/dashboard.css';
import '../styles/github-modal.css';

export default function DashboardPage() {
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const { projects, setProjects, addProject, removeProject, updateProject, setLoading, isLoading } = useProjectStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const { modalState, showAlert, showConfirm, closeModal } = useModal();
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showGitHubSetupModal, setShowGitHubSetupModal] = useState(false);
    const [projectToRename, setProjectToRename] = useState<Project | null>(null);
    const [projectToPush, setProjectToPush] = useState<Project | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    useEffect(() => {
        loadProjects();
    }, []);

    useEffect(() => {
        // Close menu when clicking outside
        const handleClickOutside = () => setActiveMenu(null);
        if (activeMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [activeMenu]);

    const loadProjects = async () => {
        setLoading(true);
        try {
            const data = await projectsApi.list();
            setProjects(data);
        } catch (error) {
            console.error('Failed to load projects:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateProject = async (name: string, description: string) => {
        try {
            const project = await projectsApi.create({ name, description });
            addProject(project);
            setShowCreateModal(false);
            navigate(`/editor/${project.id}`);
        } catch (error) {
            console.error('Failed to create project:', error);
        }
    };

    const handleDeleteProject = async (id: string) => {
        const confirmed = await showConfirm({
            title: 'Delete Project',
            message: 'Are you sure you want to delete this project? This action cannot be undone.',
            confirmLabel: 'Delete',
            variant: 'confirm',
        });
        if (!confirmed) return;

        try {
            await projectsApi.delete(id);
            removeProject(id);
        } catch (error) {
            console.error('Failed to delete project:', error);
        }
    };

    const handleRenameProject = async (id: string, newName: string) => {
        try {
            const updated = await projectsApi.update(id, { name: newName });
            updateProject(id, { name: updated.name });
            setShowRenameModal(false);
            setProjectToRename(null);
        } catch (error) {
            console.error('Failed to rename project:', error);
            showAlert(`Failed to rename: ${(error as Error).message}`);
        }
    };

    const handleExportProject = (id: string, name: string) => {
        try {
            zipApi.exportProject(id, name);
        } catch (error) {
            console.error('Failed to export project:', error);
            showAlert(`Failed to export: ${(error as Error).message}`);
        }
    };

    const handlePushToGitHub = (project: Project) => {
        // Open modal immediately - the modal handles its own validation
        setProjectToPush(project);
        setShowGitHubSetupModal(true);
    };

    const filteredProjects = projects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="dashboard">
            {/* Header */}
            <header className="dashboard-header">
                <div className="header-left">
                    <div className="logo-small">
                        <img src="/favicon.svg" width={28} height={28} alt="CloudCodeX logo" />
                    </div>
                    <h1>CloudCodeX</h1>
                </div>

                <div className="header-right">
                    <div className="search-box">
                        <Search size={18} />
                        <input
                            type="text"
                            placeholder="Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <div className="user-menu">
                        <button
                            className="user-button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenu(activeMenu === 'user-menu' ? null : 'user-menu');
                            }}
                        >
                            <div className="avatar">{user?.username?.[0]?.toUpperCase() || 'U'}</div>
                            <span>{user?.username}</span>
                        </button>

                        {activeMenu === 'user-menu' && (
                            <div className="user-dropdown" onClick={e => e.stopPropagation()}>
                                <button onClick={() => navigate('/profile')}>
                                    <User size={16} /> Profile
                                </button>
                                {user?.role === 'admin' && (
                                    <button onClick={() => navigate('/admin')}>
                                        <Settings size={16} /> Admin Dashboard
                                    </button>
                                )}
                                <button onClick={logout} className="logout-btn">
                                    <LogOut size={16} /> Sign Out
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="dashboard-main">
                <div className="dashboard-content">
                    {/* Welcome Section */}
                    <section className="welcome-section">
                        <div className="welcome-text">
                            <h2>Welcome back, {user?.username}! <Sparkles size={24} className="sparkle" /></h2>
                            <p>Create multi-language projects with full file system support.</p>
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                            <Plus size={18} /> New Project
                        </button>
                    </section>

                    {/* Projects Grid */}
                    <section className="projects-section">
                        <div className="section-header">
                            <h3><Folder size={20} /> Your Projects</h3>
                            <span className="project-count">{projects.length} projects</span>
                        </div>

                        {isLoading ? (
                            <div className="loading-grid">
                                {[1, 2, 3].map(i => (
                                    <div key={i} className="project-card skeleton"></div>
                                ))}
                            </div>
                        ) : filteredProjects.length === 0 ? (
                            <div className="empty-state">
                                <Folder size={48} />
                                <h4>No projects yet</h4>
                                <p>Create your first project to get started</p>
                                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                                    <Plus size={18} /> Create Project
                                </button>
                            </div>
                        ) : (
                            <div className="projects-grid">
                                {filteredProjects.map(project => (
                                    <ProjectCard
                                        key={project.id}
                                        project={project}
                                        isMenuOpen={activeMenu === project.id}
                                        onMenuToggle={() => setActiveMenu(activeMenu === project.id ? null : project.id)}
                                        onOpen={() => navigate(`/editor/${project.id}`)}
                                        onDelete={() => handleDeleteProject(project.id)}
                                        onRename={() => {
                                            setProjectToRename(project);
                                            setShowRenameModal(true);
                                            setActiveMenu(null);
                                        }}
                                        onExport={() => {
                                            handleExportProject(project.id, project.name);
                                            setActiveMenu(null);
                                        }}
                                        onPushToGitHub={() => {
                                            handlePushToGitHub(project);
                                            setActiveMenu(null);
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {/* Create Project Modal */}
            {showCreateModal && (
                <CreateProjectModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateProject}
                />
            )}

            {/* Rename Project Modal */}
            {showRenameModal && projectToRename && (
                <RenameProjectModal
                    project={projectToRename}
                    onClose={() => { setShowRenameModal(false); setProjectToRename(null); }}
                    onRename={(newName) => handleRenameProject(projectToRename.id, newName)}
                />
            )}

            {/* GitHub Setup Modal */}
            {showGitHubSetupModal && projectToPush && (
                <GitHubSetupModal
                    project={projectToPush}
                    onClose={() => {
                        setShowGitHubSetupModal(false);
                        setProjectToPush(null);
                    }}
                    onSuccess={() => {
                        // Refresh projects list
                        loadProjects();
                    }}
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
        </div>
    );
}

function ProjectCard({
    project,
    isMenuOpen,
    onMenuToggle,
    onOpen,
    onDelete,
    onRename,
    onExport,
    onPushToGitHub
}: {
    project: Project;
    isMenuOpen: boolean;
    onMenuToggle: () => void;
    onOpen: () => void;
    onDelete: () => void;
    onRename: () => void;
    onExport: () => void;
    onPushToGitHub: () => void;
}) {
    const date = new Date(project.updatedAt).toLocaleDateString();

    return (
        <div className="project-card" onClick={onOpen}>
            <div className="project-header">
                <div className="project-icon"><Folder size={20} /></div>
                <button
                    className="menu-btn"
                    onClick={(e) => {
                        e.stopPropagation();
                        onMenuToggle();
                    }}
                >
                    <MoreVertical size={18} />
                </button>

                {isMenuOpen && (
                    <div className="project-menu" onClick={e => e.stopPropagation()}>
                        <button onClick={onRename}><Edit3 size={14} /> Rename</button>
                        <button onClick={onExport}><Download size={14} /> Export</button>
                        <button onClick={onPushToGitHub}><Github size={14} /> Push to GitHub</button>
                        <button className="danger" onClick={onDelete}>
                            <Trash2 size={14} /> Delete
                        </button>
                    </div>
                )}
            </div>

            <h4>{project.name}</h4>
            <p className="project-desc">{project.description || 'No description'}</p>

            <div className="project-footer">
                <span className="project-date">
                    <Calendar size={14} /> {date}
                </span>
                <ChevronRight size={18} className="arrow" />
            </div>
        </div>
    );
}

function RenameProjectModal({
    project,
    onClose,
    onRename
}: {
    project: Project;
    onClose: () => void;
    onRename: (newName: string) => void;
}) {
    const [name, setName] = useState(project.name);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
                <h3>Rename Project</h3>
                <div className="form-group">
                    <input
                        type="text"
                        className="input"
                        placeholder="New project name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && name.trim()) {
                                onRename(name);
                            }
                        }}
                    />
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onRename(name)}
                        disabled={!name.trim() || name === project.name}
                    >
                        Rename
                    </button>
                </div>
            </div>
        </div>
    );
}

function CreateProjectModal({
    onClose,
    onCreate
}: {
    onClose: () => void;
    onCreate: (name: string, description: string) => void;
}) {
    const [importType, setImportType] = useState<'manual' | 'zip' | 'folder' | 'git'>('manual');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [zipFile, setZipFile] = useState<File | null>(null);
    const [folderFiles, setFolderFiles] = useState<FileList | null>(null);
    const [gitUrl, setGitUrl] = useState('');
    const [gitBranch, setGitBranch] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [error, setError] = useState('');

    const handleZipFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (!file.name.endsWith('.zip')) {
                setError('Only ZIP files are allowed');
                return;
            }
            setZipFile(file);
            setError('');
            // Auto-fill project name from ZIP filename
            if (!name) {
                setName(file.name.replace('.zip', ''));
            }
        }
    };

    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            setFolderFiles(files);
            setError('');
            // Auto-fill project name from folder name
            if (!name && files[0].webkitRelativePath) {
                const folderName = files[0].webkitRelativePath.split('/')[0];
                setName(folderName);
            }
        }
    };

    const handleGitUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const url = e.target.value;
        setGitUrl(url);
        setError('');
        // Auto-fill project name from repo URL
        if (!name && url) {
            const match = url.match(/\/([^\/]+?)(\.git)?$/);
            if (match) {
                setName(match[1]);
            }
        }
    };

    const createZipFromFolder = async (files: FileList): Promise<File> => {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = file.webkitRelativePath.split('/').slice(1).join('/');
            zip.file(relativePath, file);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        return new File([blob], `${name || 'folder'}.zip`, { type: 'application/zip' });
    };

    const handleSubmit = async () => {
        setError('');
        setIsImporting(true);

        try {
            if (importType === 'manual') {
                onCreate(name, description);
            } else if (importType === 'zip' && zipFile) {
                // Create project first
                const project = await projectsApi.create({ name, description });
                // Upload ZIP
                await zipApi.import(project.id, zipFile);
                // Navigate to editor
                window.location.href = `/editor/${project.id}`;
            } else if (importType === 'folder' && folderFiles) {
                // Convert folder to ZIP
                const zipFileFromFolder = await createZipFromFolder(folderFiles);
                // Create project
                const project = await projectsApi.create({ name, description });
                // Upload ZIP
                await zipApi.import(project.id, zipFileFromFolder);
                // Navigate to editor
                window.location.href = `/editor/${project.id}`;
            } else if (importType === 'git' && gitUrl) {
                // Create project first
                const project = await projectsApi.create({ name, description });
                // Clone repository
                await gitApi.clone(project.id, gitUrl, gitBranch || undefined);
                // Navigate to editor
                window.location.href = `/editor/${project.id}`;
            }
        } catch (err) {
            setError((err as Error).message || 'Import failed');
            setIsImporting(false);
        }
    };

    const isSubmitDisabled = () => {
        if (!name.trim()) return true;
        if (importType === 'zip' && !zipFile) return true;
        if (importType === 'folder' && !folderFiles) return true;
        if (importType === 'git' && !gitUrl.trim()) return true;
        return isImporting;
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Create New Project</h2>

                {/* Import Type Tabs */}
                <div className="import-tabs">
                    <button
                        className={`import-tab ${importType === 'manual' ? 'active' : ''}`}
                        onClick={() => setImportType('manual')}
                    >
                        <Sparkles size={14} /> New Project
                    </button>
                    <button
                        className={`import-tab ${importType === 'zip' ? 'active' : ''}`}
                        onClick={() => setImportType('zip')}
                    >
                        <Package size={14} /> Import ZIP
                    </button>
                    <button
                        className={`import-tab ${importType === 'folder' ? 'active' : ''}`}
                        onClick={() => setImportType('folder')}
                    >
                        <Folder size={14} /> Upload Folder
                    </button>
                    <button
                        className={`import-tab ${importType === 'git' ? 'active' : ''}`}
                        onClick={() => setImportType('git')}
                    >
                        <Link size={14} /> Clone Git Repo
                    </button>
                </div>

                {/* Common Fields */}
                <div className="form-group">
                    <label>Project Name</label>
                    <input
                        type="text"
                        className="input"
                        placeholder="my-awesome-project"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus={importType === 'manual'}
                    />
                </div>

                <div className="form-group">
                    <label>Description (optional)</label>
                    <textarea
                        className="input"
                        placeholder="What's this project about?"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={2}
                    />
                </div>

                {/* Type-specific Fields */}
                {importType === 'zip' && (
                    <div className="form-group">
                        <label>ZIP File</label>
                        <input
                            type="file"
                            accept=".zip"
                            className="input"
                            onChange={handleZipFileChange}
                        />
                        {zipFile && (
                            <p className="file-selected"><Package size={14} /> {zipFile.name} ({(zipFile.size / 1024).toFixed(2)} KB)</p>
                        )}
                    </div>
                )}

                {importType === 'folder' && (
                    <div className="form-group">
                        <label>Select Folder</label>
                        <input
                            type="file"
                            // @ts-ignore - webkitdirectory is not in standard types
                            webkitdirectory=""
                            directory=""
                            className="input"
                            onChange={handleFolderChange}
                        />
                        {folderFiles && (
                            <p className="file-selected"><Folder size={14} /> {folderFiles.length} files selected</p>
                        )}
                    </div>
                )}

                {importType === 'git' && (
                    <>
                        <div className="form-group">
                            <label>Repository URL</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="https://github.com/username/repo.git"
                                value={gitUrl}
                                onChange={handleGitUrlChange}
                            />
                        </div>
                        <div className="form-group">
                            <label>Branch (optional)</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="main"
                                value={gitBranch}
                                onChange={(e) => setGitBranch(e.target.value)}
                            />
                        </div>
                    </>
                )}

                {/* Error Message */}
                {error && (
                    <div className="error-box">
                        <span><AlertTriangle size={16} /></span>
                        <p>{error}</p>
                    </div>
                )}

                {/* Info Box */}
                {importType === 'manual' && (
                    <div className="info-box">
                        <span className="info-icon"><Lightbulb size={16} /></span>
                        <p>Your project will start with a README.md file. You can create files in any language!</p>
                    </div>
                )}
                {importType === 'folder' && (
                    <div className="info-box">
                        <span className="info-icon"><Lightbulb size={16} /></span>
                        <p>Select a folder to upload. All files and subdirectories will be preserved.</p>
                    </div>
                )}

                {/* Actions */}
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose} disabled={isImporting}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={isSubmitDisabled()}
                    >
                        {isImporting ? (
                            <><Loader size={16} className="spin" /> Importing...</>
                        ) : importType === 'manual' ? (
                            <><Plus size={18} /> Create Project</>
                        ) : importType === 'git' ? (
                            <><Link size={16} /> Clone Repository</>
                        ) : (
                            <><Package size={16} /> Import Project</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

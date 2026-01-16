import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProjectStore, Project } from '../store/projectStore';
import { projectsApi, zipApi, gitApi } from '../services/api';
import {
    Code2, Plus, Folder, LogOut, Settings, Search,
    Calendar, MoreVertical, Edit3, Trash2, Download, Github,
    ChevronRight, Sparkles, ExternalLink
} from 'lucide-react';
import '../styles/dashboard.css';

export default function DashboardPage() {
    const navigate = useNavigate();
    const { user, logout } = useAuthStore();
    const { projects, setProjects, addProject, removeProject, updateProject, setLoading, isLoading } = useProjectStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showGitHubModal, setShowGitHubModal] = useState(false);
    const [projectToRename, setProjectToRename] = useState<Project | null>(null);
    const [projectToPush, setProjectToPush] = useState<Project | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeMenu, setActiveMenu] = useState<string | null>(null);

    useEffect(() => {
        loadProjects();
    }, []);

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
        if (!confirm('Are you sure you want to delete this project?')) return;

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
            alert(`Failed to rename: ${(error as Error).message}`);
        }
    };

    const handleExportProject = (id: string, name: string) => {
        try {
            zipApi.exportProject(id, name);
        } catch (error) {
            console.error('Failed to export project:', error);
            alert(`Failed to export: ${(error as Error).message}`);
        }
    };

    const handlePushToGitHub = async (project: Project) => {
        try {
            await gitApi.push(project.id);
            alert('Successfully pushed to GitHub!');
        } catch (error) {
            const message = (error as Error).message;
            console.error('Failed to push to GitHub:', error);

            // Check if user needs to connect GitHub
            if (message.includes('GitHub authentication required') || message.includes('GITHUB_AUTH_REQUIRED')) {
                setProjectToPush(project);
                setShowGitHubModal(true);
            } else {
                alert(`Failed to push: ${message}. Make sure you have initialized a Git repository and set up a remote.`);
            }
        }
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
                        <Code2 size={24} />
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
                        <button className="user-button">
                            <div className="avatar">{user?.username?.[0]?.toUpperCase() || 'U'}</div>
                            <span>{user?.username}</span>
                        </button>

                        <div className="user-dropdown">
                            {user?.role === 'admin' && (
                                <button onClick={() => navigate('/admin')}>
                                    <Settings size={16} /> Admin Dashboard
                                </button>
                            )}
                            <button onClick={logout} className="logout-btn">
                                <LogOut size={16} /> Sign Out
                            </button>
                        </div>
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
                <div className="project-icon">📁</div>
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
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h2>Create New Project</h2>
                <p className="modal-subtitle">
                    Projects support all programming languages. Create files of any type!
                </p>

                <div className="form-group">
                    <label>Project Name</label>
                    <input
                        type="text"
                        className="input"
                        placeholder="my-awesome-project"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="form-group">
                    <label>Description (optional)</label>
                    <textarea
                        className="input"
                        placeholder="What's this project about?"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                    />
                </div>

                <div className="info-box">
                    <span className="info-icon">💡</span>
                    <p>Your project will start with a README.md file. You can create files in any language: Python, JavaScript, Java, C++, Go, Rust, and more!</p>
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onCreate(name, description)}
                        disabled={!name.trim()}
                    >
                        <Plus size={18} /> Create Project
                    </button>
                </div>
            </div>
        </div>
    );
}

import { useState, useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { adminApi } from '../../services/api';
import {
    Search, Trash2, Download, Eye, ChevronLeft,
    ChevronRight, FolderOpen, Github, HardDrive
} from 'lucide-react';

export default function AdminProjects() {
    const { projects, projectsPagination, loadProjects, deleteProject } = useAdminStore();
    const [search, setSearch] = useState('');
    const [selectedProject, setSelectedProject] = useState<any>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [, setLoadingDetail] = useState(false);

    useEffect(() => {
        loadProjects(1, search || undefined);
    }, [search]);

    const handlePageChange = (page: number) => {
        loadProjects(page, search || undefined);
    };

    const handleViewProject = async (projectId: string) => {
        setLoadingDetail(true);
        try {
            const detail = await adminApi.projectDetail(projectId);
            setSelectedProject(detail);
        } catch (err) {
            console.error(err);
        } finally {
            setLoadingDetail(false);
        }
    };

    const handleDelete = async (projectId: string) => {
        await deleteProject(projectId);
        setConfirmDelete(null);
    };

    return (
        <div className="admin-projects">
            {/* Toolbar */}
            <div className="admin-toolbar">
                <div className="search-box">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Search projects..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Projects Table */}
            <div className="admin-table-wrapper">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Owner</th>
                            <th>Language</th>
                            <th>Size</th>
                            <th>GitHub</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map((project) => (
                            <tr key={project.id}>
                                <td>
                                    <div className="project-cell">
                                        <FolderOpen size={16} className="text-accent" />
                                        <div>
                                            <span className="project-name">{project.name}</span>
                                            {project.description && (
                                                <span className="project-desc">{project.description}</span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td>{project.username || '-'}</td>
                                <td>
                                    {project.language ? (
                                        <span className="lang-badge">{project.language}</span>
                                    ) : '-'}
                                </td>
                                <td>{project.sizeMb} MB</td>
                                <td>
                                    {project.githubUrl ? (
                                        <a
                                            href={project.githubUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="github-link"
                                        >
                                            <Github size={14} /> Repo
                                        </a>
                                    ) : (
                                        <span className="text-muted">-</span>
                                    )}
                                </td>
                                <td className="text-muted">{new Date(project.createdAt).toLocaleDateString()}</td>
                                <td>
                                    <div className="action-btns">
                                        <button
                                            className="btn-action btn-view"
                                            title="View details"
                                            onClick={() => handleViewProject(project.id)}
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            className="btn-action btn-info"
                                            title="Download ZIP"
                                            onClick={() => adminApi.downloadProject(project.id)}
                                        >
                                            <Download size={14} />
                                        </button>
                                        <button
                                            className="btn-action btn-danger"
                                            title="Delete"
                                            onClick={() => setConfirmDelete(project.id)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {projects.length === 0 && (
                            <tr><td colSpan={7} className="empty-row">No projects found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {projectsPagination && projectsPagination.totalPages > 1 && (
                <div className="admin-pagination">
                    <button
                        disabled={projectsPagination.page <= 1}
                        onClick={() => handlePageChange(projectsPagination.page - 1)}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span>Page {projectsPagination.page} of {projectsPagination.totalPages}</span>
                    <button
                        disabled={projectsPagination.page >= projectsPagination.totalPages}
                        onClick={() => handlePageChange(projectsPagination.page + 1)}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}

            {/* Delete Confirmation */}
            {confirmDelete && (
                <div className="admin-modal-overlay" onClick={() => setConfirmDelete(null)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete Project</h3>
                        <p className="text-danger">This will permanently delete the project and all its files.</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete Project</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Project Detail Drawer */}
            {selectedProject && (
                <div className="admin-modal-overlay" onClick={() => setSelectedProject(null)}>
                    <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="drawer-header">
                            <h3>Project Details</h3>
                            <button className="btn-icon" onClick={() => setSelectedProject(null)}>&times;</button>
                        </div>
                        <div className="drawer-body">
                            <div className="detail-row">
                                <span className="detail-label">Name</span>
                                <span>{selectedProject.name}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Owner</span>
                                <span>{selectedProject.username || selectedProject.user_id}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Language</span>
                                <span>{selectedProject.language || '-'}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Size</span>
                                <span><HardDrive size={14} /> {selectedProject.sizeMb} MB</span>
                            </div>
                            {selectedProject.github_url && (
                                <div className="detail-row">
                                    <span className="detail-label">GitHub</span>
                                    <a href={selectedProject.github_url} target="_blank" rel="noopener noreferrer">
                                        {selectedProject.github_url}
                                    </a>
                                </div>
                            )}
                            <div className="detail-row">
                                <span className="detail-label">Created</span>
                                <span>{new Date(selectedProject.created_at).toLocaleString()}</span>
                            </div>

                            {/* File List */}
                            {selectedProject.files?.length > 0 && (
                                <div className="detail-section">
                                    <h4>Files ({selectedProject.files.length})</h4>
                                    <div className="file-list">
                                        {selectedProject.files.slice(0, 50).map((f: string) => (
                                            <div key={f} className="file-item">{f}</div>
                                        ))}
                                        {selectedProject.files.length > 50 && (
                                            <div className="file-item text-muted">...and {selectedProject.files.length - 50} more</div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Recent Executions */}
                            {selectedProject.executions?.length > 0 && (
                                <div className="detail-section">
                                    <h4>Recent Executions</h4>
                                    {selectedProject.executions.slice(0, 10).map((exec: any) => (
                                        <div key={exec.id} className="mini-log-item">
                                            <span className="lang-badge">{exec.language}</span>
                                            <span className={`status-badge-sm ${exec.status}`}>{exec.status}</span>
                                            <span className="text-muted">{exec.execution_time_ms ? `${exec.execution_time_ms}ms` : '-'}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

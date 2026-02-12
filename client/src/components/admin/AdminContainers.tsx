import { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import {
    Server, Square, RotateCcw, Trash2,
    RefreshCw, Zap
} from 'lucide-react';

export default function AdminContainers() {
    const {
        containers, isLoading, loadContainers,
        stopContainer, restartContainer, removeContainer, cleanupContainers
    } = useAdminStore();
    const [showAll, setShowAll] = useState(false);
    const [showCleanupModal, setShowCleanupModal] = useState(false);
    const [cleanupHours, setCleanupHours] = useState(24);

    useEffect(() => {
        loadContainers(showAll);
        const interval = setInterval(() => loadContainers(showAll), 10000);
        return () => clearInterval(interval);
    }, [showAll]);

    const handleCleanup = async () => {
        await cleanupContainers(cleanupHours);
        setShowCleanupModal(false);
    };

    return (
        <div className="admin-containers">
            <div className="admin-toolbar">
                <h3 className="toolbar-title">
                    <Server size={18} /> Containers
                    <span className="count-badge">{containers.length}</span>
                </h3>
                <div className="toolbar-actions">
                    <label className="toggle-label">
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                        />
                        Show stopped
                    </label>
                    <button className="btn btn-sm btn-warning" onClick={() => setShowCleanupModal(true)}>
                        <Zap size={14} /> Cleanup
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={() => loadContainers(showAll)} disabled={isLoading}>
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {containers.length === 0 ? (
                <div className="admin-empty-state">
                    <Server size={48} />
                    <p>No containers found</p>
                </div>
            ) : (
                <div className="containers-grid-admin">
                    {containers.map((container) => (
                        <div key={container.id} className={`container-card-admin state-${container.state}`}>
                            <div className="container-header-admin">
                                <div className="container-id-row">
                                    <Server size={16} />
                                    <code>{container.id}</code>
                                    <span className={`state-badge ${container.state}`}>{container.state}</span>
                                </div>
                            </div>

                            <div className="container-details">
                                <div className="detail-row">
                                    <span className="detail-label">Image</span>
                                    <span className="detail-value">{container.image}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Name</span>
                                    <span className="detail-value">{container.name || '-'}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Status</span>
                                    <span className="detail-value">{container.status}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Created</span>
                                    <span className="detail-value">{new Date(container.created).toLocaleString()}</span>
                                </div>
                            </div>

                            {container.stats && (
                                <div className="container-stats">
                                    <div className="stat-mini">
                                        <span>CPU</span>
                                        <span className={container.stats.cpuPercent > 80 ? 'text-danger' : ''}>
                                            {container.stats.cpuPercent.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="stat-mini">
                                        <span>Memory</span>
                                        <span className={container.stats.memoryPercent > 80 ? 'text-danger' : ''}>
                                            {container.stats.memoryUsageMb.toFixed(1)} MB
                                        </span>
                                    </div>
                                </div>
                            )}

                            <div className="container-actions-admin">
                                {container.state === 'running' && (
                                    <button
                                        className="btn btn-sm btn-warning"
                                        onClick={() => stopContainer(container.id)}
                                        title="Stop"
                                    >
                                        <Square size={12} /> Stop
                                    </button>
                                )}
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => restartContainer(container.id)}
                                    title="Restart"
                                >
                                    <RotateCcw size={12} /> Restart
                                </button>
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => removeContainer(container.id)}
                                    title="Remove"
                                >
                                    <Trash2 size={12} /> Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Cleanup Modal */}
            {showCleanupModal && (
                <div className="admin-modal-overlay" onClick={() => setShowCleanupModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Cleanup Old Containers</h3>
                        <p>Remove containers older than:</p>
                        <div className="input-group">
                            <input
                                type="number"
                                value={cleanupHours}
                                onChange={(e) => setCleanupHours(parseInt(e.target.value) || 24)}
                                min={1}
                                max={720}
                            />
                            <span>hours</span>
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowCleanupModal(false)}>Cancel</button>
                            <button className="btn btn-warning" onClick={handleCleanup}>Cleanup</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

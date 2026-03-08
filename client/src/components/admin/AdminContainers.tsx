import { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { adminApi } from '../../services/api';
import {
    Server, Square, RotateCcw, Trash2,
    RefreshCw, Zap, Pause, Play, BarChart3
} from 'lucide-react';

export default function AdminContainers() {
    const {
        containers, isLoading, loadContainers,
        stopContainer, restartContainer, removeContainer,
        pauseContainer, unpauseContainer, cleanupContainers
    } = useAdminStore();
    const [showAll, setShowAll] = useState(false);
    const [showCleanupModal, setShowCleanupModal] = useState(false);
    const [cleanupHours, setCleanupHours] = useState(24);
    const [liveStats, setLiveStats] = useState<{ id: string; stats: any } | null>(null);

    useEffect(() => {
        loadContainers(showAll);
        const interval = setInterval(() => loadContainers(showAll), 10000);
        return () => clearInterval(interval);
    }, [showAll]);

    const handleCleanup = async () => {
        await cleanupContainers(cleanupHours);
        setShowCleanupModal(false);
    };

    const handleViewStats = async (containerId: string) => {
        try {
            const stats = await adminApi.containerStats(containerId);
            setLiveStats({ id: containerId, stats });
        } catch (err) {
            console.error(err);
        }
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
                                    <>
                                        <button
                                            className="btn btn-sm btn-info"
                                            onClick={() => handleViewStats(container.id)}
                                            title="Live Stats"
                                        >
                                            <BarChart3 size={12} /> Stats
                                        </button>
                                        <button
                                            className="btn btn-sm btn-warning"
                                            onClick={() => stopContainer(container.id)}
                                            title="Stop"
                                        >
                                            <Square size={12} /> Stop
                                        </button>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => pauseContainer(container.id)}
                                            title="Pause"
                                        >
                                            <Pause size={12} /> Pause
                                        </button>
                                    </>
                                )}
                                {container.state === 'paused' && (
                                    <button
                                        className="btn btn-sm btn-success"
                                        onClick={() => unpauseContainer(container.id)}
                                        title="Unpause"
                                    >
                                        <Play size={12} /> Resume
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

            {/* Live Stats Modal */}
            {liveStats && (
                <div className="admin-modal-overlay" onClick={() => setLiveStats(null)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Container Stats - {liveStats.id}</h3>
                            <button className="btn-icon" onClick={() => setLiveStats(null)}>&times;</button>
                        </div>
                        <div className="container-live-stats">
                            <div className="detail-row">
                                <span className="detail-label">CPU Usage</span>
                                <span className={liveStats.stats.cpuPercent > 80 ? 'text-danger' : ''}>
                                    {liveStats.stats.cpuPercent.toFixed(2)}%
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Memory</span>
                                <span className={liveStats.stats.memoryPercent > 80 ? 'text-danger' : ''}>
                                    {liveStats.stats.memoryUsageMb.toFixed(1)} / {liveStats.stats.memoryLimitMb.toFixed(0)} MB
                                    ({liveStats.stats.memoryPercent.toFixed(1)}%)
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Network RX</span>
                                <span>{liveStats.stats.networkRxMb.toFixed(2)} MB</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Network TX</span>
                                <span>{liveStats.stats.networkTxMb.toFixed(2)} MB</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">PIDs</span>
                                <span>{liveStats.stats.pids}</span>
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => handleViewStats(liveStats.id)}>
                                <RefreshCw size={14} /> Refresh
                            </button>
                            <button className="btn btn-secondary" onClick={() => setLiveStats(null)}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

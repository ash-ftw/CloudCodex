import { useEffect, useState } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { adminApi } from '../../services/api';
import {
    Play, Square,
    Server, Cpu, HardDrive, FileText, RefreshCw
} from 'lucide-react';

export default function AdminExecutions() {
    const { activeExecutions, isLoading, loadActiveExecutions, killExecution } = useAdminStore();
    const [containerLogs, setContainerLogs] = useState<{ id: string; logs: string } | null>(null);

    useEffect(() => {
        loadActiveExecutions();
        const interval = setInterval(loadActiveExecutions, 5000); // refresh every 5s
        return () => clearInterval(interval);
    }, []);

    const handleViewLogs = async (containerId: string) => {
        try {
            const result = await adminApi.executionLogs(containerId);
            setContainerLogs({ id: containerId, logs: result.logs });
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="admin-executions">
            <div className="admin-toolbar">
                <h3 className="toolbar-title">
                    <Play size={18} /> Live Executions
                    <span className="count-badge">{activeExecutions.length}</span>
                </h3>
                <button className="btn btn-secondary btn-sm" onClick={loadActiveExecutions} disabled={isLoading}>
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {activeExecutions.length === 0 ? (
                <div className="admin-empty-state">
                    <Server size={48} />
                    <p>No active executions</p>
                    <span className="text-muted">Executions will appear here in real-time</span>
                </div>
            ) : (
                <div className="execution-cards">
                    {activeExecutions.map((exec) => (
                        <div key={exec.containerId} className="execution-card">
                            <div className="exec-header">
                                <div className="exec-id">
                                    <Server size={16} />
                                    <code>{exec.containerId}</code>
                                </div>
                                <span className={`state-badge ${exec.state}`}>{exec.state}</span>
                            </div>

                            <div className="exec-details">
                                <div className="exec-detail">
                                    <span className="label">Language</span>
                                    <span className="lang-badge">{exec.language}</span>
                                </div>
                                <div className="exec-detail">
                                    <span className="label">User</span>
                                    <span>{exec.userId}</span>
                                </div>
                                <div className="exec-detail">
                                    <span className="label">Status</span>
                                    <span>{exec.status}</span>
                                </div>
                                <div className="exec-detail">
                                    <span className="label">Started</span>
                                    <span>{new Date(exec.created).toLocaleTimeString()}</span>
                                </div>
                            </div>

                            {/* Resource bars */}
                            <div className="exec-resources">
                                <div className="resource-item">
                                    <div className="resource-header">
                                        <Cpu size={12} /> CPU
                                        <span>{exec.cpu.toFixed(1)}%</span>
                                    </div>
                                    <div className="resource-bar-bg">
                                        <div
                                            className="resource-bar-fill"
                                            style={{
                                                width: `${Math.min(100, exec.cpu)}%`,
                                                background: exec.cpu > 80 ? 'var(--accent-error)' : 'var(--accent-primary)'
                                            }}
                                        />
                                    </div>
                                </div>
                                <div className="resource-item">
                                    <div className="resource-header">
                                        <HardDrive size={12} /> Memory
                                        <span>{exec.memoryMb.toFixed(1)} / {exec.memoryLimitMb.toFixed(0)} MB</span>
                                    </div>
                                    <div className="resource-bar-bg">
                                        <div
                                            className="resource-bar-fill"
                                            style={{
                                                width: `${Math.min(100, exec.memoryPercent)}%`,
                                                background: exec.memoryPercent > 80 ? 'var(--accent-error)' : 'var(--accent-success)'
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="exec-actions">
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => handleViewLogs(exec.containerId)}
                                    title="View logs"
                                >
                                    <FileText size={14} /> Logs
                                </button>
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => killExecution(exec.containerId)}
                                    title="Kill execution"
                                >
                                    <Square size={14} /> Kill
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Container Logs Modal */}
            {containerLogs && (
                <div className="admin-modal-overlay" onClick={() => setContainerLogs(null)}>
                    <div className="admin-modal admin-modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Container Logs - {containerLogs.id}</h3>
                            <button className="btn-icon" onClick={() => setContainerLogs(null)}>&times;</button>
                        </div>
                        <pre className="log-viewer">{containerLogs.logs || 'No logs available'}</pre>
                    </div>
                </div>
            )}
        </div>
    );
}

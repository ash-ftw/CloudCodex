import { useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { AlertTriangle, UserX, Cpu, HardDrive, RefreshCw } from 'lucide-react';

export default function AdminAlerts() {
    const { alerts, isLoading, loadAlerts, blockUser } = useAdminStore();

    useEffect(() => {
        loadAlerts();
        const interval = setInterval(loadAlerts, 30000); // refresh every 30s
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="admin-alerts">
            <div className="admin-toolbar">
                <h3 className="toolbar-title">
                    <AlertTriangle size={18} /> Security Alerts & Abuse Detection
                    {alerts.length > 0 && <span className="count-badge danger">{alerts.length}</span>}
                </h3>
                <button className="btn btn-sm btn-secondary" onClick={loadAlerts} disabled={isLoading}>
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {alerts.length === 0 ? (
                <div className="admin-empty-state success">
                    <AlertTriangle size={48} />
                    <p>No active alerts</p>
                    <span className="text-muted">Everything looks good! The system is being monitored continuously.</span>
                </div>
            ) : (
                <div className="alerts-grid">
                    {alerts.map((alert, i) => (
                        <div key={i} className={`alert-card alert-${alert.severity}`}>
                            <div className="alert-card-header">
                                <div className="alert-icon">
                                    {alert.issue.includes('CPU') ? <Cpu size={20} /> :
                                     alert.issue.includes('memory') ? <HardDrive size={20} /> :
                                     <AlertTriangle size={20} />}
                                </div>
                                <div className="alert-card-info">
                                    <span className="alert-title">{alert.issue}</span>
                                    <span className="alert-user-name">{alert.username}</span>
                                </div>
                                <span className={`severity-badge ${alert.severity}`}>{alert.severity}</span>
                            </div>

                            <div className="alert-card-details">
                                {Object.entries(alert.details).map(([key, value]) => (
                                    <div key={key} className="alert-detail">
                                        <span className="detail-key">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                                        <span className="detail-value">{String(value)}</span>
                                    </div>
                                ))}
                            </div>

                            {alert.userId !== 'system' && (
                                <div className="alert-card-actions">
                                    <button
                                        className="btn btn-sm btn-danger"
                                        onClick={() => blockUser(alert.userId, alert.issue)}
                                    >
                                        <UserX size={14} /> Block User
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

import { useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import {
    Users, FolderOpen, Cpu, Clock, Server,
    AlertTriangle, Activity, TrendingUp
} from 'lucide-react';

export default function AdminOverview() {
    const { dashboard, loadDashboard, isLoading } = useAdminStore();

    useEffect(() => {
        loadDashboard();
        const interval = setInterval(loadDashboard, 15000); // refresh every 15s
        return () => clearInterval(interval);
    }, []);

    if (isLoading && !dashboard) {
        return <div className="admin-loading"><div className="spinner" /></div>;
    }

    if (!dashboard) {
        return <div className="admin-empty">No dashboard data available</div>;
    }

    const { users, projects, executions, system, alerts } = dashboard;

    return (
        <div className="admin-overview">
            {/* Quick Stats */}
            <div className="stats-grid">
                <StatCard
                    icon={<Users size={24} />}
                    iconClass="users-icon"
                    value={users.total}
                    label="Total Users"
                    sub={`${users.active} active`}
                />
                <StatCard
                    icon={<FolderOpen size={24} />}
                    iconClass="projects-icon"
                    value={projects.total}
                    label="Total Projects"
                />
                <StatCard
                    icon={<Cpu size={24} />}
                    iconClass="executions-icon"
                    value={executions.total}
                    label="Total Executions"
                    sub={`${executions.last24Hours} today`}
                />
                <StatCard
                    icon={<Clock size={24} />}
                    iconClass="recent-icon"
                    value={executions.last24Hours}
                    label="Last 24 Hours"
                />
                <StatCard
                    icon={<Server size={24} />}
                    iconClass="containers-icon"
                    value={system.containers.running}
                    label="Running Containers"
                    sub={`${system.containers.total} total`}
                />
                <StatCard
                    icon={<AlertTriangle size={24} />}
                    iconClass="alerts-icon"
                    value={executions.failed}
                    label="Failed Executions"
                />
            </div>

            {/* System Resources */}
            <div className="admin-section">
                <h3 className="section-title"><Activity size={18} /> System Resources</h3>
                <div className="resource-bars">
                    <ResourceBar
                        label="Containers Running"
                        current={system.containers.running}
                        max={system.containers.total || 1}
                        color="var(--accent-primary)"
                    />
                    <ResourceBar
                        label="CPU Cores"
                        current={system.cpuCount}
                        max={system.cpuCount || 1}
                        color="var(--accent-success)"
                    />
                    <ResourceBar
                        label={`Memory (${system.totalMemoryMb} MB)`}
                        current={system.usedMemoryMb}
                        max={system.totalMemoryMb || 1}
                        color="var(--accent-warning)"
                    />
                </div>
            </div>

            {/* Active Alerts */}
            {alerts.length > 0 && (
                <div className="admin-section">
                    <h3 className="section-title"><AlertTriangle size={18} /> Active Alerts</h3>
                    <div className="alerts-list">
                        {alerts.map((alert, i) => (
                            <div key={i} className={`alert-item alert-${alert.severity}`}>
                                <AlertTriangle size={16} />
                                <div className="alert-content">
                                    <span className="alert-user">{alert.username}</span>
                                    <span className="alert-issue">{alert.issue}</span>
                                </div>
                                <span className={`severity-badge ${alert.severity}`}>{alert.severity}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Quick Info Cards */}
            <div className="admin-section">
                <h3 className="section-title"><TrendingUp size={18} /> Quick Summary</h3>
                <div className="info-grid">
                    <div className="info-card">
                        <span className="info-label">Docker Images</span>
                        <span className="info-value">{system.images}</span>
                    </div>
                    <div className="info-card">
                        <span className="info-label">Stopped Containers</span>
                        <span className="info-value">{system.containers.stopped}</span>
                    </div>
                    <div className="info-card">
                        <span className="info-label">Paused Containers</span>
                        <span className="info-value">{system.containers.paused}</span>
                    </div>
                    <div className="info-card">
                        <span className="info-label">Active Users (24h)</span>
                        <span className="info-value">{users.active}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Sub-components ─────────────────────────────────────

function StatCard({ icon, iconClass, value, label, sub }: {
    icon: React.ReactNode;
    iconClass: string;
    value: number;
    label: string;
    sub?: string;
}) {
    return (
        <div className="stat-card">
            <div className={`stat-icon ${iconClass}`}>{icon}</div>
            <div className="stat-info">
                <span className="stat-value">{value.toLocaleString()}</span>
                <span className="stat-label">{label}</span>
                {sub && <span className="stat-sub">{sub}</span>}
            </div>
        </div>
    );
}

function ResourceBar({ label, current, max, color }: {
    label: string;
    current: number;
    max: number;
    color: string;
}) {
    const pct = Math.min(100, Math.round((current / max) * 100));
    return (
        <div className="resource-bar-item">
            <div className="resource-bar-header">
                <span>{label}</span>
                <span>{current} / {max} ({pct}%)</span>
            </div>
            <div className="resource-bar-bg">
                <div className="resource-bar-fill" style={{ width: `${pct}%`, background: color }} />
            </div>
        </div>
    );
}

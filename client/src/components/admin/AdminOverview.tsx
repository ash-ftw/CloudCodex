import { useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import {
    Users, FolderOpen, Cpu, Clock,
    AlertTriangle, Activity, CheckCircle,
    XCircle, Zap, BarChart3, UserPlus
} from 'lucide-react';

export default function AdminOverview() {
    const { dashboard, loadDashboard, isLoading } = useAdminStore();

    useEffect(() => {
        loadDashboard();
        const interval = setInterval(loadDashboard, 15000);
        return () => clearInterval(interval);
    }, []);

    if (isLoading && !dashboard) {
        return <div className="admin-loading"><div className="spinner" /></div>;
    }

    if (!dashboard) {
        return <div className="admin-empty">No dashboard data available</div>;
    }

    const { users, projects, executions, alerts, recentExecutions, languageBreakdown, recentUsers, successRate, avgProjectsPerUser } = dashboard;

    return (
        <div className="admin-overview">
            {/* Quick Stats */}
            <div className="stats-grid">
                <StatCard icon={<Users size={24} />} iconClass="users-icon" value={users.total} label="Total Users" sub={`${users.active} active`} />
                <StatCard icon={<FolderOpen size={24} />} iconClass="projects-icon" value={projects.total} label="Total Projects" />
                <StatCard icon={<Cpu size={24} />} iconClass="executions-icon" value={executions.total} label="Total Executions" sub={`${executions.last24Hours} today`} />
                <StatCard icon={<AlertTriangle size={24} />} iconClass="alerts-icon" value={executions.failed} label="Failed Executions" />
            </div>

            {/* Active Alerts (full width, above columns) */}
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

            {/* Two-column layout */}
            <div className="overview-grid-2col">
                {/* Left column */}
                <div className="overview-col">
                    {/* Platform Stats */}
                    <div className="admin-section">
                        <h3 className="section-title"><BarChart3 size={18} /> Platform Stats</h3>
                        <div className="info-grid">
                            <div className="info-card">
                                <span className="info-label">Success Rate</span>
                                <span className="info-value">{successRate}%</span>
                            </div>
                            <div className="info-card">
                                <span className="info-label">Avg Projects/User</span>
                                <span className="info-value">{avgProjectsPerUser}</span>
                            </div>
                            <div className="info-card">
                                <span className="info-label">Active Users (24h)</span>
                                <span className="info-value">{users.active}</span>
                            </div>
                            <div className="info-card">
                                <span className="info-label">Executions Today</span>
                                <span className="info-value">{executions.last24Hours}</span>
                            </div>
                        </div>
                    </div>

                    {/* Recent Signups */}
                    <div className="admin-section">
                        <h3 className="section-title"><UserPlus size={18} /> Recent Signups</h3>
                        {recentUsers.length > 0 ? (
                            <div className="overview-activity-list">
                                {recentUsers.map((user, i) => (
                                    <div key={i} className="overview-activity-item">
                                        <div className="overview-activity-icon">
                                            <span className="user-avatar-mini">{user.username?.[0]?.toUpperCase() || '?'}</span>
                                        </div>
                                        <div className="overview-activity-info">
                                            <span className="overview-activity-user">{user.username}</span>
                                        </div>
                                        <span className="overview-activity-time">
                                            {timeAgo(user.createdAt)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="overview-empty-mini">No recent signups</div>
                        )}
                    </div>
                </div>

                {/* Right column */}
                <div className="overview-col">
                    {/* Top Languages */}
                    {Object.keys(languageBreakdown).length > 0 && (
                        <div className="admin-section">
                            <h3 className="section-title"><Zap size={18} /> Top Languages (7 days)</h3>
                            <div className="overview-lang-bars">
                                {Object.entries(languageBreakdown)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 6)
                                    .map(([lang, count]) => {
                                        const total = Object.values(languageBreakdown).reduce((a, b) => a + b, 0);
                                        const pct = Math.round((count / total) * 100);
                                        return (
                                            <div key={lang} className="overview-lang-item">
                                                <div className="overview-lang-header">
                                                    <span className="lang-badge">{lang}</span>
                                                    <span className="text-muted">{count} ({pct}%)</span>
                                                </div>
                                                <div className="resource-bar-bg">
                                                    <div className="resource-bar-fill" style={{ width: `${pct}%`, background: 'var(--accent-primary)' }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    )}

                    {/* Recent Executions */}
                    <div className="admin-section">
                        <h3 className="section-title"><Activity size={18} /> Recent Executions</h3>
                        {recentExecutions.length > 0 ? (
                            <div className="overview-activity-list">
                                {recentExecutions.map((exec) => (
                                    <div key={exec.id} className="overview-activity-item">
                                        <div className="overview-activity-icon">
                                            {exec.status === 'completed' ? (
                                                <CheckCircle size={14} className="text-success" />
                                            ) : exec.status === 'error' || exec.status === 'timeout' ? (
                                                <XCircle size={14} className="text-error" />
                                            ) : (
                                                <Clock size={14} className="text-muted" />
                                            )}
                                        </div>
                                        <div className="overview-activity-info">
                                            <span className="overview-activity-user">{exec.username}</span>
                                            <span className="lang-badge">{exec.language}</span>
                                        </div>
                                        <div className="overview-activity-meta">
                                            <span className={`status-badge-sm ${exec.status}`}>{exec.status}</span>
                                            <span className="text-muted">{exec.durationMs ? `${exec.durationMs}ms` : '-'}</span>
                                        </div>
                                        <span className="overview-activity-time">
                                            {timeAgo(exec.createdAt)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="overview-empty-mini">No recent executions</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Helpers ────────────────────────────────────────────

function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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

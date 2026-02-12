import { useState, useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import { adminApi } from '../../services/api';
import {
    BarChart3, PieChart, TrendingUp, Users,
    Download, Calendar
} from 'lucide-react';

export default function AdminAnalytics() {
    const { analytics, isLoading, loadAnalytics } = useAdminStore();
    const [days, setDays] = useState(7);

    useEffect(() => {
        loadAnalytics(days);
    }, [days]);

    if (isLoading && !analytics) {
        return <div className="admin-loading"><div className="spinner" /></div>;
    }

    if (!analytics) {
        return <div className="admin-empty">No analytics data available</div>;
    }

    return (
        <div className="admin-analytics">
            {/* Controls */}
            <div className="admin-toolbar">
                <h3 className="toolbar-title"><BarChart3 size={18} /> Analytics & Reports</h3>
                <div className="toolbar-actions">
                    <select value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
                        <option value={1}>Last 24 hours</option>
                        <option value={7}>Last 7 days</option>
                        <option value={14}>Last 14 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                    </select>
                    <button className="btn btn-sm btn-secondary" onClick={() => adminApi.exportAnalytics(days)}>
                        <Download size={14} /> Export CSV
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="analytics-summary">
                <div className="analytics-card">
                    <span className="analytics-value">{analytics.totalExecutionsInPeriod.toLocaleString()}</span>
                    <span className="analytics-label">Total Executions ({days}d)</span>
                </div>
                <div className="analytics-card">
                    <span className="analytics-value">{analytics.averageExecutionTimeMs}ms</span>
                    <span className="analytics-label">Avg. Execution Time</span>
                </div>
                <div className="analytics-card">
                    <span className="analytics-value">{analytics.averageMemoryUsageMb} MB</span>
                    <span className="analytics-label">Avg. Memory Usage</span>
                </div>
                <div className="analytics-card">
                    <span className="analytics-value">{analytics.topUsers.length}</span>
                    <span className="analytics-label">Active Users</span>
                </div>
            </div>

            {/* Charts Section */}
            <div className="charts-grid">
                {/* Language Distribution */}
                <div className="chart-card">
                    <h4><PieChart size={16} /> Language Distribution</h4>
                    <div className="bar-chart">
                        <LanguageChart data={analytics.languageDistribution} />
                    </div>
                </div>

                {/* Status Distribution */}
                <div className="chart-card">
                    <h4><PieChart size={16} /> Execution Status</h4>
                    <div className="bar-chart">
                        <StatusChart data={analytics.statusDistribution} />
                    </div>
                </div>

                {/* Executions Timeline */}
                <div className="chart-card chart-wide">
                    <h4><TrendingUp size={16} /> Executions Over Time</h4>
                    <div className="timeline-chart">
                        <TimelineChart data={analytics.executionsPerHour} />
                    </div>
                </div>

                {/* Top Users */}
                <div className="chart-card">
                    <h4><Users size={16} /> Top Active Users</h4>
                    <div className="top-users-list">
                        {analytics.topUsers.map((user, i) => (
                            <div key={user.userId} className="top-user-item">
                                <span className="rank">#{i + 1}</span>
                                <span className="username">{user.username}</span>
                                <span className="count">{user.executions} executions</span>
                            </div>
                        ))}
                        {analytics.topUsers.length === 0 && (
                            <div className="text-muted">No data</div>
                        )}
                    </div>
                </div>

                {/* Daily Registrations */}
                <div className="chart-card">
                    <h4><Calendar size={16} /> User Registrations</h4>
                    <div className="registrations-list">
                        {Object.entries(analytics.dailyRegistrations)
                            .slice(-10)
                            .reverse()
                            .map(([day, count]) => (
                                <div key={day} className="registration-item">
                                    <span>{day}</span>
                                    <span className="count">{count} users</span>
                                </div>
                            ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Chart Sub-components (CSS-based, no external library needed) ──

function LanguageChart({ data }: { data: Record<string, number> }) {
    const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;
    const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);

    const colors = [
        'var(--accent-primary)', 'var(--accent-success)', 'var(--accent-warning)',
        'var(--accent-error)', '#a371f7', '#f778ba', '#79c0ff', '#d2a8ff',
        '#7ee787', '#ffa657'
    ];

    return (
        <div className="horizontal-bars">
            {sorted.map(([lang, count], i) => (
                <div key={lang} className="h-bar-item">
                    <div className="h-bar-label">
                        <span>{lang}</span>
                        <span>{count} ({Math.round((count / total) * 100)}%)</span>
                    </div>
                    <div className="h-bar-bg">
                        <div
                            className="h-bar-fill"
                            style={{
                                width: `${(count / total) * 100}%`,
                                background: colors[i % colors.length]
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function StatusChart({ data }: { data: Record<string, number> }) {
    const total = Object.values(data).reduce((a, b) => a + b, 0) || 1;

    const statusColors: Record<string, string> = {
        completed: 'var(--accent-success)',
        error: 'var(--accent-error)',
        timeout: 'var(--accent-warning)',
        running: 'var(--accent-primary)'
    };

    return (
        <div className="horizontal-bars">
            {Object.entries(data).map(([status, count]) => (
                <div key={status} className="h-bar-item">
                    <div className="h-bar-label">
                        <span>{status}</span>
                        <span>{count} ({Math.round((count / total) * 100)}%)</span>
                    </div>
                    <div className="h-bar-bg">
                        <div
                            className="h-bar-fill"
                            style={{
                                width: `${(count / total) * 100}%`,
                                background: statusColors[status] || 'var(--text-muted)'
                            }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function TimelineChart({ data }: { data: Record<string, number> }) {
    const entries = Object.entries(data).slice(-48); // last 48 points
    const maxVal = Math.max(...entries.map(e => e[1]), 1);

    if (entries.length === 0) {
        return <div className="text-muted">No data in this period</div>;
    }

    return (
        <div className="mini-timeline">
            <div className="timeline-bars">
                {entries.map(([time, count]) => (
                    <div
                        key={time}
                        className="timeline-bar"
                        style={{ height: `${(count / maxVal) * 100}%` }}
                        title={`${new Date(time).toLocaleString()}: ${count} executions`}
                    />
                ))}
            </div>
            <div className="timeline-labels">
                <span>{entries.length > 0 ? new Date(entries[0][0]).toLocaleDateString() : ''}</span>
                <span>{entries.length > 0 ? new Date(entries[entries.length - 1][0]).toLocaleDateString() : ''}</span>
            </div>
        </div>
    );
}

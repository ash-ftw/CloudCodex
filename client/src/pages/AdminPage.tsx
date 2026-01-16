import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../services/api';
import {
    LayoutDashboard, Users, Activity, Server, ChevronLeft,
    RefreshCw, AlertTriangle, CheckCircle, Clock, Cpu
} from 'lucide-react';
import '../styles/admin.css';

interface UsageStats {
    users: { total: number };
    projects: { total: number };
    executions: {
        total: number;
        last24Hours: number;
        byStatus: Record<string, number>;
        byLanguage: Record<string, number>;
    };
}

export default function AdminPage() {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [containers, setContainers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            if (activeTab === 'overview' || activeTab === 'usage') {
                const usageData = await adminApi.usage();
                setUsage(usageData);
            }
            if (activeTab === 'logs') {
                const logsData = await adminApi.logs();
                setLogs(logsData.data || logsData);
            }
            if (activeTab === 'users') {
                const usersData = await adminApi.users();
                setUsers(usersData.data || usersData);
            }
            if (activeTab === 'containers') {
                const containersData = await adminApi.containers();
                setContainers(containersData);
            }
        } catch (error) {
            console.error('Failed to load admin data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="admin-page">
            {/* Header */}
            <header className="admin-header">
                <div className="header-left">
                    <button className="btn-icon" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft size={20} />
                    </button>
                    <h1>Admin Dashboard</h1>
                </div>
                <button className="btn btn-secondary" onClick={loadData} disabled={isLoading}>
                    <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                    Refresh
                </button>
            </header>

            <div className="admin-content">
                {/* Sidebar */}
                <aside className="admin-sidebar">
                    <nav className="admin-nav">
                        <button
                            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                            onClick={() => setActiveTab('overview')}
                        >
                            <LayoutDashboard size={18} /> Overview
                        </button>
                        <button
                            className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`}
                            onClick={() => setActiveTab('logs')}
                        >
                            <Activity size={18} /> Execution Logs
                        </button>
                        <button
                            className={`nav-item ${activeTab === 'containers' ? 'active' : ''}`}
                            onClick={() => setActiveTab('containers')}
                        >
                            <Server size={18} /> Active Containers
                        </button>
                        <button
                            className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
                            onClick={() => setActiveTab('users')}
                        >
                            <Users size={18} /> Users
                        </button>
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="admin-main">
                    {activeTab === 'overview' && usage && (
                        <div className="overview-grid">
                            <div className="stat-card">
                                <div className="stat-icon users-icon">
                                    <Users size={24} />
                                </div>
                                <div className="stat-info">
                                    <span className="stat-value">{usage.users.total}</span>
                                    <span className="stat-label">Total Users</span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon projects-icon">
                                    <LayoutDashboard size={24} />
                                </div>
                                <div className="stat-info">
                                    <span className="stat-value">{usage.projects.total}</span>
                                    <span className="stat-label">Total Projects</span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon executions-icon">
                                    <Cpu size={24} />
                                </div>
                                <div className="stat-info">
                                    <span className="stat-value">{usage.executions.total}</span>
                                    <span className="stat-label">Total Executions</span>
                                </div>
                            </div>

                            <div className="stat-card">
                                <div className="stat-icon recent-icon">
                                    <Clock size={24} />
                                </div>
                                <div className="stat-info">
                                    <span className="stat-value">{usage.executions.last24Hours}</span>
                                    <span className="stat-label">Last 24 Hours</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'logs' && (
                        <div className="logs-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>User</th>
                                        <th>Language</th>
                                        <th>Status</th>
                                        <th>Duration</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id}>
                                            <td>{new Date(log.created_at).toLocaleString()}</td>
                                            <td>{log.profiles?.username || log.user_id}</td>
                                            <td><span className="lang-badge">{log.language}</span></td>
                                            <td>
                                                <span className={`status-badge ${log.status}`}>
                                                    {log.status === 'completed' && <CheckCircle size={12} />}
                                                    {log.status === 'error' && <AlertTriangle size={12} />}
                                                    {log.status === 'timeout' && <Clock size={12} />}
                                                    {log.status}
                                                </span>
                                            </td>
                                            <td>{log.execution_time_ms ? `${log.execution_time_ms}ms` : '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {activeTab === 'containers' && (
                        <div className="containers-grid">
                            {containers.length === 0 ? (
                                <div className="empty-state">
                                    <Server size={48} />
                                    <p>No active containers</p>
                                </div>
                            ) : (
                                containers.map((container) => (
                                    <div key={container.id} className="container-card">
                                        <div className="container-header">
                                            <Server size={18} />
                                            <span className="container-id">{container.id}</span>
                                        </div>
                                        <div className="container-info">
                                            <span>Image: {container.image}</span>
                                            <span>Status: {container.status}</span>
                                            <span>State: {container.state}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === 'users' && (
                        <div className="users-table">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Username</th>
                                        <th>Role</th>
                                        <th>Projects</th>
                                        <th>Executions</th>
                                        <th>Storage</th>
                                        <th>Joined</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((user) => (
                                        <tr key={user.id}>
                                            <td>{user.username}</td>
                                            <td>
                                                <span className={`role-badge ${user.role}`}>{user.role}</span>
                                            </td>
                                            <td>{user.projectCount}</td>
                                            <td>{user.executionCount}</td>
                                            <td>{user.storageUsedMb?.toFixed(1) || 0} MB</td>
                                            <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

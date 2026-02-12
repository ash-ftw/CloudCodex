import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '../store/adminStore';
import {
    LayoutDashboard, Users, FolderKanban, Activity, Server,
    FileText, BarChart3, Settings, ShieldAlert, ChevronLeft
} from 'lucide-react';
import AdminOverview from '../components/admin/AdminOverview';
import AdminUsers from '../components/admin/AdminUsers';
import AdminProjects from '../components/admin/AdminProjects';
import AdminExecutions from '../components/admin/AdminExecutions';
import AdminContainers from '../components/admin/AdminContainers';
import AdminLogs from '../components/admin/AdminLogs';
import AdminAnalytics from '../components/admin/AdminAnalytics';
import AdminSettings from '../components/admin/AdminSettings';
import AdminAlerts from '../components/admin/AdminAlerts';
import '../styles/admin.css';

type Tab = 'overview' | 'users' | 'projects' | 'executions' | 'containers' | 'logs' | 'analytics' | 'settings' | 'alerts';

const NAV_ITEMS: { tab: Tab; label: string; icon: typeof LayoutDashboard; section?: string }[] = [
    { tab: 'overview', label: 'Overview', icon: LayoutDashboard },
    { tab: 'users', label: 'Users', icon: Users, section: 'Management' },
    { tab: 'projects', label: 'Projects', icon: FolderKanban },
    { tab: 'executions', label: 'Executions', icon: Activity, section: 'Monitoring' },
    { tab: 'containers', label: 'Containers', icon: Server },
    { tab: 'logs', label: 'Logs & Audit', icon: FileText, section: 'System' },
    { tab: 'analytics', label: 'Analytics', icon: BarChart3 },
    { tab: 'settings', label: 'Settings', icon: Settings },
    { tab: 'alerts', label: 'Security Alerts', icon: ShieldAlert },
];

const TAB_COMPONENTS: Record<Tab, React.FC> = {
    overview: AdminOverview,
    users: AdminUsers,
    projects: AdminProjects,
    executions: AdminExecutions,
    containers: AdminContainers,
    logs: AdminLogs,
    analytics: AdminAnalytics,
    settings: AdminSettings,
    alerts: AdminAlerts,
};

export default function AdminPage() {
    const navigate = useNavigate();
    const { activeTab, setActiveTab } = useAdminStore();
    const ActiveComponent = TAB_COMPONENTS[(activeTab as Tab) || 'overview'] || AdminOverview;

    return (
        <div className="admin-page">
            <header className="admin-header">
                <div className="header-left">
                    <button className="btn-icon" onClick={() => navigate('/dashboard')}>
                        <ChevronLeft size={20} />
                    </button>
                    <h1>Admin Console</h1>
                </div>
                <div className="header-right">
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        CloudCodeX Admin
                    </span>
                </div>
            </header>

            <div className="admin-content">
                <aside className="admin-sidebar">
                    <nav className="admin-nav">
                        {NAV_ITEMS.map((item, idx) => (
                            <div key={item.tab}>
                                {item.section && (
                                    <>
                                        {idx > 0 && <div className="nav-divider" />}
                                        <div className="nav-section-label">{item.section}</div>
                                    </>
                                )}
                                <button
                                    className={`nav-item ${activeTab === item.tab ? 'active' : ''}`}
                                    onClick={() => setActiveTab(item.tab)}
                                >
                                    <item.icon size={18} />
                                    {item.label}
                                </button>
                            </div>
                        ))}
                    </nav>
                </aside>

                <main className="admin-main">
                    <ActiveComponent />
                </main>
            </div>
        </div>
    );
}

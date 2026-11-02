import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '../store/adminStore';
import {
    LayoutDashboard, Users, FolderKanban,
    FileText, BarChart3, ChevronLeft
} from 'lucide-react';
import SettingsDropdown from '../components/SettingsDropdown';
import AdminOverview from '../components/admin/AdminOverview';
import AdminUsers from '../components/admin/AdminUsers';
import AdminProjects from '../components/admin/AdminProjects';
import AdminLogs from '../components/admin/AdminLogs';
import AdminAnalytics from '../components/admin/AdminAnalytics';
import '../styles/admin.css';

type Tab = 'overview' | 'users' | 'projects' | 'logs' | 'analytics';

const NAV_ITEMS: { tab: Tab; label: string; icon: typeof LayoutDashboard; section?: string }[] = [
    { tab: 'overview', label: 'Overview', icon: LayoutDashboard },
    { tab: 'users', label: 'Users', icon: Users, section: 'Management' },
    { tab: 'projects', label: 'Projects', icon: FolderKanban },
    { tab: 'logs', label: 'Logs & Audit', icon: FileText, section: 'System' },
    { tab: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const TAB_COMPONENTS: Record<Tab, React.FC> = {
    overview: AdminOverview,
    users: AdminUsers,
    projects: AdminProjects,
    logs: AdminLogs,
    analytics: AdminAnalytics,
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
                    <SettingsDropdown />
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

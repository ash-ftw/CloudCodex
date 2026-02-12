import { useState, useEffect } from 'react';
import { useAdminStore } from '../../store/adminStore';
import {
    ChevronLeft, ChevronRight, AlertTriangle,
    CheckCircle, Clock, FileText, Shield
} from 'lucide-react';

type LogView = 'execution' | 'audit';

export default function AdminLogs() {
    const {
        executionLogs, logsPagination,
        auditLogs, auditPagination,
        loadLogs, loadAuditLogs
    } = useAdminStore();

    const [view, setView] = useState<LogView>('execution');

    // Execution log filters
    const [filterStatus, setFilterStatus] = useState('');
    const [filterLanguage, setFilterLanguage] = useState('');

    // Audit log filters
    const [filterSeverity, setFilterSeverity] = useState('');
    const [filterAction, setFilterAction] = useState('');

    useEffect(() => {
        if (view === 'execution') {
            loadLogs(1, {
                status: filterStatus || undefined,
                language: filterLanguage || undefined
            });
        } else {
            loadAuditLogs(1, {
                severity: filterSeverity || undefined,
                action: filterAction || undefined
            });
        }
    }, [view, filterStatus, filterLanguage, filterSeverity, filterAction]);

    const handleExecPageChange = (page: number) => {
        loadLogs(page, {
            status: filterStatus || undefined,
            language: filterLanguage || undefined
        });
    };

    const handleAuditPageChange = (page: number) => {
        loadAuditLogs(page, {
            severity: filterSeverity || undefined,
            action: filterAction || undefined
        });
    };

    return (
        <div className="admin-logs">
            {/* View Switcher */}
            <div className="admin-toolbar">
                <div className="tab-switcher">
                    <button
                        className={`tab-btn ${view === 'execution' ? 'active' : ''}`}
                        onClick={() => setView('execution')}
                    >
                        <FileText size={14} /> Execution Logs
                    </button>
                    <button
                        className={`tab-btn ${view === 'audit' ? 'active' : ''}`}
                        onClick={() => setView('audit')}
                    >
                        <Shield size={14} /> Audit Trail
                    </button>
                </div>
            </div>

            {/* Execution Logs */}
            {view === 'execution' && (
                <>
                    <div className="admin-toolbar">
                        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                            <option value="">All Status</option>
                            <option value="completed">Completed</option>
                            <option value="error">Error</option>
                            <option value="timeout">Timeout</option>
                            <option value="running">Running</option>
                        </select>
                        <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)}>
                            <option value="">All Languages</option>
                            <option value="python">Python</option>
                            <option value="javascript">JavaScript</option>
                            <option value="java">Java</option>
                            <option value="c">C</option>
                            <option value="cpp">C++</option>
                            <option value="go">Go</option>
                            <option value="rust">Rust</option>
                            <option value="php">PHP</option>
                            <option value="ruby">Ruby</option>
                            <option value="bash">Bash</option>
                        </select>
                    </div>

                    <div className="admin-table-wrapper">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>User</th>
                                    <th>Project</th>
                                    <th>Language</th>
                                    <th>Status</th>
                                    <th>Duration</th>
                                    <th>Memory</th>
                                    <th>Exit Code</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(executionLogs || []).map((log: any) => (
                                    <tr key={log.id}>
                                        <td className="text-muted">{new Date(log.created_at).toLocaleString()}</td>
                                        <td>{log.profiles?.username || log.user_id?.slice(0, 8)}</td>
                                        <td>{log.projects?.name || log.project_id?.slice(0, 8)}</td>
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
                                        <td>{log.memory_used_mb ? `${log.memory_used_mb.toFixed(1)} MB` : '-'}</td>
                                        <td>{log.exit_code ?? '-'}</td>
                                    </tr>
                                ))}
                                {executionLogs.length === 0 && (
                                    <tr><td colSpan={8} className="empty-row">No logs found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {logsPagination && logsPagination.totalPages > 1 && (
                        <div className="admin-pagination">
                            <button
                                disabled={logsPagination.page <= 1}
                                onClick={() => handleExecPageChange(logsPagination.page - 1)}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span>Page {logsPagination.page} of {logsPagination.totalPages} ({logsPagination.total} total)</span>
                            <button
                                disabled={logsPagination.page >= logsPagination.totalPages}
                                onClick={() => handleExecPageChange(logsPagination.page + 1)}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Audit Logs */}
            {view === 'audit' && (
                <>
                    <div className="admin-toolbar">
                        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}>
                            <option value="">All Severity</option>
                            <option value="info">Info</option>
                            <option value="warning">Warning</option>
                            <option value="error">Error</option>
                            <option value="critical">Critical</option>
                        </select>
                        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}>
                            <option value="">All Actions</option>
                            <option value="user.block">User Block</option>
                            <option value="user.unblock">User Unblock</option>
                            <option value="user.role_change">Role Change</option>
                            <option value="user.delete">User Delete</option>
                            <option value="project.delete">Project Delete</option>
                            <option value="execution.kill">Execution Kill</option>
                            <option value="container.stop">Container Stop</option>
                            <option value="container.remove">Container Remove</option>
                            <option value="settings.update">Settings Update</option>
                        </select>
                    </div>

                    <div className="admin-table-wrapper">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Action</th>
                                    <th>Performed By</th>
                                    <th>Target</th>
                                    <th>Severity</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(auditLogs || []).map((log) => (
                                    <tr key={log.id}>
                                        <td className="text-muted">{new Date(log.created_at).toLocaleString()}</td>
                                        <td><code className="action-code">{log.action}</code></td>
                                        <td>{log.profiles?.username || log.performed_by?.slice(0, 8) || 'system'}</td>
                                        <td>
                                            {log.target_type && (
                                                <span className="target-info">
                                                    <span className="target-type">{log.target_type}</span>
                                                    <code>{log.target_id?.slice(0, 8)}</code>
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`severity-badge ${log.severity}`}>{log.severity}</span>
                                        </td>
                                        <td className="details-cell">
                                            {log.details && Object.keys(log.details).length > 0 ? (
                                                <code className="details-json">
                                                    {JSON.stringify(log.details).slice(0, 60)}
                                                </code>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                                {auditLogs.length === 0 && (
                                    <tr><td colSpan={6} className="empty-row">No audit logs found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {auditPagination && auditPagination.totalPages > 1 && (
                        <div className="admin-pagination">
                            <button
                                disabled={auditPagination.page <= 1}
                                onClick={() => handleAuditPageChange(auditPagination.page - 1)}
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <span>Page {auditPagination.page} of {auditPagination.totalPages}</span>
                            <button
                                disabled={auditPagination.page >= auditPagination.totalPages}
                                onClick={() => handleAuditPageChange(auditPagination.page + 1)}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

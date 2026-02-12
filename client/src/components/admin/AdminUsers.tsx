import { useState, useEffect } from 'react';
import { useAdminStore, AdminUser } from '../../store/adminStore';
import {
    Search, UserX, UserCheck, Shield, ShieldOff,
    Trash2, ChevronLeft, ChevronRight, Eye
} from 'lucide-react';

export default function AdminUsers() {
    const {
        users, usersPagination,
        loadUsers, blockUser, unblockUser, updateUserRole, deleteUser
    } = useAdminStore();

    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterRole, setFilterRole] = useState('');
    const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
    const [showBlockModal, setShowBlockModal] = useState<string | null>(null);
    const [blockReason, setBlockReason] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    useEffect(() => {
        loadUsers(1, search || undefined, filterStatus || undefined, filterRole || undefined);
    }, [search, filterStatus, filterRole]);

    const handlePageChange = (page: number) => {
        loadUsers(page, search || undefined, filterStatus || undefined, filterRole || undefined);
    };

    const handleBlock = async (userId: string) => {
        await blockUser(userId, blockReason);
        setShowBlockModal(null);
        setBlockReason('');
    };

    const handleDelete = async (userId: string) => {
        await deleteUser(userId);
        setConfirmDelete(null);
    };

    return (
        <div className="admin-users">
            {/* Toolbar */}
            <div className="admin-toolbar">
                <div className="search-box">
                    <Search size={16} />
                    <input
                        type="text"
                        placeholder="Search users..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="">All Status</option>
                    <option value="active">Active</option>
                    <option value="blocked">Blocked</option>
                    <option value="suspended">Suspended</option>
                </select>
                <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
                    <option value="">All Roles</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                </select>
            </div>

            {/* Users Table */}
            <div className="admin-table-wrapper">
                <table className="admin-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Email</th>
                            <th>Role</th>
                            <th>Projects</th>
                            <th>Executions</th>
                            <th>Storage</th>
                            <th>Status</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user) => (
                            <tr key={user.id} className={user.status === 'blocked' ? 'row-blocked' : ''}>
                                <td className="user-cell">
                                    <span className="user-avatar">{user.username?.[0]?.toUpperCase() || '?'}</span>
                                    <span>{user.username}</span>
                                </td>
                                <td className="text-muted">{user.email || '-'}</td>
                                <td><span className={`role-badge ${user.role}`}>{user.role}</span></td>
                                <td>{user.projectCount}</td>
                                <td>{user.executionCount}</td>
                                <td>{(user.storageUsedMb || 0).toFixed(1)} / {user.storageQuotaMb} MB</td>
                                <td>
                                    <span className={`status-badge-sm ${user.status}`}>{user.status}</span>
                                </td>
                                <td className="text-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
                                <td>
                                    <div className="action-btns">
                                        <button
                                            className="btn-action btn-view"
                                            title="View details"
                                            onClick={() => setSelectedUser(user)}
                                        >
                                            <Eye size={14} />
                                        </button>
                                        {user.status === 'blocked' ? (
                                            <button
                                                className="btn-action btn-success"
                                                title="Unblock"
                                                onClick={() => unblockUser(user.id)}
                                            >
                                                <UserCheck size={14} />
                                            </button>
                                        ) : (
                                            <button
                                                className="btn-action btn-warning"
                                                title="Block"
                                                onClick={() => setShowBlockModal(user.id)}
                                            >
                                                <UserX size={14} />
                                            </button>
                                        )}
                                        {user.role === 'user' ? (
                                            <button
                                                className="btn-action btn-info"
                                                title="Make admin"
                                                onClick={() => updateUserRole(user.id, 'admin')}
                                            >
                                                <Shield size={14} />
                                            </button>
                                        ) : (
                                            <button
                                                className="btn-action btn-muted"
                                                title="Remove admin"
                                                onClick={() => updateUserRole(user.id, 'user')}
                                            >
                                                <ShieldOff size={14} />
                                            </button>
                                        )}
                                        <button
                                            className="btn-action btn-danger"
                                            title="Delete"
                                            onClick={() => setConfirmDelete(user.id)}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && (
                            <tr><td colSpan={9} className="empty-row">No users found</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {usersPagination && usersPagination.totalPages > 1 && (
                <div className="admin-pagination">
                    <button
                        disabled={usersPagination.page <= 1}
                        onClick={() => handlePageChange(usersPagination.page - 1)}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span>Page {usersPagination.page} of {usersPagination.totalPages}</span>
                    <button
                        disabled={usersPagination.page >= usersPagination.totalPages}
                        onClick={() => handlePageChange(usersPagination.page + 1)}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}

            {/* Block Modal */}
            {showBlockModal && (
                <div className="admin-modal-overlay" onClick={() => setShowBlockModal(null)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Block User</h3>
                        <p>Provide a reason for blocking this user:</p>
                        <textarea
                            value={blockReason}
                            onChange={(e) => setBlockReason(e.target.value)}
                            placeholder="Reason..."
                            rows={3}
                        />
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setShowBlockModal(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleBlock(showBlockModal)}>Block User</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            {confirmDelete && (
                <div className="admin-modal-overlay" onClick={() => setConfirmDelete(null)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete User</h3>
                        <p className="text-danger">This action is irreversible. All user data, projects, and logs will be permanently deleted.</p>
                        <div className="modal-actions">
                            <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Delete Permanently</button>
                        </div>
                    </div>
                </div>
            )}

            {/* User Detail Drawer */}
            {selectedUser && (
                <div className="admin-modal-overlay" onClick={() => setSelectedUser(null)}>
                    <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
                        <div className="drawer-header">
                            <h3>User Details</h3>
                            <button className="btn-icon" onClick={() => setSelectedUser(null)}>&times;</button>
                        </div>
                        <div className="drawer-body">
                            <div className="detail-row">
                                <span className="detail-label">Username</span>
                                <span>{selectedUser.username}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Email</span>
                                <span>{selectedUser.email || '-'}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Role</span>
                                <span className={`role-badge ${selectedUser.role}`}>{selectedUser.role}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Status</span>
                                <span className={`status-badge-sm ${selectedUser.status}`}>{selectedUser.status}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Projects</span>
                                <span>{selectedUser.projectCount}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Executions</span>
                                <span>{selectedUser.executionCount}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Storage</span>
                                <span>{(selectedUser.storageUsedMb || 0).toFixed(1)} / {selectedUser.storageQuotaMb} MB</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Joined</span>
                                <span>{new Date(selectedUser.createdAt).toLocaleString()}</span>
                            </div>
                            {selectedUser.lastActiveAt && (
                                <div className="detail-row">
                                    <span className="detail-label">Last Active</span>
                                    <span>{new Date(selectedUser.lastActiveAt).toLocaleString()}</span>
                                </div>
                            )}
                            {selectedUser.blockedReason && (
                                <div className="detail-row">
                                    <span className="detail-label">Block Reason</span>
                                    <span className="text-danger">{selectedUser.blockedReason}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

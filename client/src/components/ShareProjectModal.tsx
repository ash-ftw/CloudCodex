import React, { useState, useEffect } from 'react';
import { X, UserPlus, Copy, Check, Trash2, Shield, Edit3, Eye, Loader2, KeyRound, Hash, Save } from 'lucide-react';
import { collaborationApi } from '../services/api';

interface ShareProjectModalProps {
    isOpen: boolean;
    projectId: string;
    onClose: () => void;
}

export const ShareProjectModal: React.FC<ShareProjectModalProps> = ({
    isOpen,
    projectId,
    onClose
}) => {
    const [collaborators, setCollaborators] = useState<any[]>([]);
    const [owner, setOwner] = useState<any>(null);
    const [currentUserRole, setCurrentUserRole] = useState<string>('owner');
    const [emailOrUsername, setEmailOrUsername] = useState('');
    const [selectedRole, setSelectedRole] = useState<'editor' | 'viewer'>('editor');
    const [loading, setLoading] = useState(false);
    const [inviting, setInviting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Room ID & Password state
    const [roomPassword, setRoomPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordSaved, setPasswordSaved] = useState(false);
    const [copiedId, setCopiedId] = useState(false);
    const [copiedInvite, setCopiedInvite] = useState(false);

    const shareUrl = `${window.location.origin}/editor/${projectId}`;

    const fetchProjectDetails = async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await collaborationApi.getCollaborators(projectId);
            setOwner(data.owner);
            setCollaborators(data.collaborators || []);
            setCurrentUserRole(data.currentUserRole);

            // Fetch room password
            const roomData = await collaborationApi.getRoomInfo(projectId);
            setRoomPassword(roomData.roomPassword || '');
        } catch (err: any) {
            setError(err.message || 'Failed to load project details');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchProjectDetails();
        }
    }, [isOpen, projectId]);

    const handleSavePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingPassword(true);
        setError(null);
        try {
            await collaborationApi.updateRoomPassword(projectId, roomPassword.trim());
            setPasswordSaved(true);
            setTimeout(() => setPasswordSaved(false), 2000);
        } catch (err: any) {
            setError(err.message || 'Failed to update room password');
        } finally {
            setSavingPassword(false);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!emailOrUsername.trim()) return;

        setInviting(true);
        setError(null);
        try {
            await collaborationApi.inviteCollaborator(projectId, emailOrUsername.trim(), selectedRole);
            setEmailOrUsername('');
            await fetchProjectDetails();
        } catch (err: any) {
            setError(err.message || 'Failed to invite collaborator');
        } finally {
            setInviting(false);
        }
    };

    const handleRoleChange = async (collaboratorId: string, role: 'editor' | 'viewer') => {
        try {
            await collaborationApi.updateRole(projectId, collaboratorId, role);
            await fetchProjectDetails();
        } catch (err: any) {
            setError(err.message || 'Failed to update role');
        }
    };

    const handleRemove = async (collaboratorId: string) => {
        try {
            await collaborationApi.removeCollaborator(projectId, collaboratorId);
            await fetchProjectDetails();
        } catch (err: any) {
            setError(err.message || 'Failed to remove collaborator');
        }
    };

    const copyRoomId = () => {
        navigator.clipboard.writeText(projectId);
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
    };

    const copyFullInvitation = () => {
        const text = `CloudCodeX Collaborative Session\nRoom ID: ${projectId}\nPassword: ${roomPassword.trim() || '(No password required)'}\nLink: ${shareUrl}`;
        navigator.clipboard.writeText(text);
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2000);
    };

    if (!isOpen) return null;

    const isOwner = currentUserRole === 'owner';

    return (
        <div className="collab-modal-overlay" onClick={onClose}>
            <div className="collab-modal" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="collab-modal-header">
                    <h3 className="collab-modal-title">
                        <UserPlus size={20} />
                        Room Credentials & Sharing
                    </h3>
                    <button
                        onClick={onClose}
                        className="collab-modal-close"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="collab-modal-body">
                    {/* Section 1: Room ID & Password Card */}
                    <div className="collab-card">
                        <div className="collab-card-header">
                            <span className="collab-label">
                                <Hash size={14} />
                                Room ID
                            </span>
                            <button
                                type="button"
                                onClick={copyRoomId}
                                className="collab-copy-link-btn"
                            >
                                {copiedId ? <Check size={14} style={{ color: '#34d399' }} /> : <Copy size={14} />}
                                <span>{copiedId ? 'Copied ID' : 'Copy ID'}</span>
                            </button>
                        </div>

                        <div className="collab-value-box">
                            {projectId}
                        </div>

                        {/* Room Password (Owner can edit) */}
                        <form onSubmit={handleSavePassword} className="collab-form-group" style={{ marginTop: '4px' }}>
                            <label className="collab-label">
                                <KeyRound size={14} style={{ color: '#fbbf24' }} />
                                Room Password
                            </label>
                            <div className="collab-inline-form">
                                <input
                                    type={isOwner ? 'text' : 'password'}
                                    disabled={!isOwner}
                                    placeholder={isOwner ? "Set a room password (or leave blank)" : "••••••••"}
                                    value={roomPassword}
                                    onChange={e => setRoomPassword(e.target.value)}
                                    className="collab-input collab-input-mono"
                                />
                                {isOwner && (
                                    <button
                                        type="submit"
                                        disabled={savingPassword}
                                        className="collab-btn-action"
                                    >
                                        {savingPassword ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : passwordSaved ? (
                                            <Check size={14} style={{ color: '#34d399' }} />
                                        ) : (
                                            <Save size={14} />
                                        )}
                                        <span>{passwordSaved ? 'Saved' : 'Save'}</span>
                                    </button>
                                )}
                            </div>
                        </form>

                        {/* One-click Full Invitation copy */}
                        <button
                            type="button"
                            onClick={copyFullInvitation}
                            className="collab-btn-primary collab-btn-full"
                            style={{ marginTop: '6px' }}
                        >
                            {copiedInvite ? (
                                <Check size={16} style={{ color: '#10b981' }} />
                            ) : (
                                <Copy size={16} />
                            )}
                            <span>{copiedInvite ? 'Copied Complete Invitation!' : 'Copy Room ID & Password Details'}</span>
                        </button>
                    </div>

                    {/* Section 2: Direct Invite Form (Owner Only) */}
                    {isOwner && (
                        <div className="collab-card">
                            <label className="collab-label-muted">
                                Direct Invite by Username / Email
                            </label>
                            <form onSubmit={handleInvite} className="collab-inline-form">
                                <input
                                    type="text"
                                    placeholder="Username or email"
                                    value={emailOrUsername}
                                    onChange={e => setEmailOrUsername(e.target.value)}
                                    className="collab-input"
                                    style={{ flex: 1 }}
                                />
                                <select
                                    value={selectedRole}
                                    onChange={e => setSelectedRole(e.target.value as any)}
                                    className="collab-select"
                                >
                                    <option value="editor">Editor</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                                <button
                                    type="submit"
                                    disabled={inviting || !emailOrUsername.trim()}
                                    className="collab-btn-action"
                                >
                                    {inviting ? <Loader2 size={14} className="animate-spin" /> : 'Invite'}
                                </button>
                            </form>
                        </div>
                    )}

                    {error && (
                        <div className="collab-error-box">
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Section 3: Project Members List */}
                    <div className="collab-form-group">
                        <label className="collab-label-muted">
                            Active Members
                        </label>

                        {loading ? (
                            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
                                <Loader2 size={20} className="animate-spin" style={{ color: '#9ca3af' }} />
                            </div>
                        ) : (
                            <div className="collab-members-list">
                                {owner && (
                                    <div className="collab-member-item">
                                        <div className="collab-member-info">
                                            <Shield size={16} style={{ color: '#fbbf24' }} />
                                            <span>{owner.username}</span>
                                        </div>
                                        <span className="collab-role-pill collab-role-owner">
                                            Owner
                                        </span>
                                    </div>
                                )}

                                {collaborators.map(collab => (
                                    <div key={collab.id} className="collab-member-item">
                                        <div className="collab-member-info">
                                            {collab.role === 'editor' ? (
                                                <Edit3 size={15} style={{ color: '#60a5fa' }} />
                                            ) : (
                                                <Eye size={15} style={{ color: '#34d399' }} />
                                            )}
                                            <span>{collab.username}</span>
                                        </div>

                                        {isOwner ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <select
                                                    value={collab.role}
                                                    onChange={e => handleRoleChange(collab.id, e.target.value as any)}
                                                    className="collab-select"
                                                    style={{ padding: '4px 8px', fontSize: '0.775rem' }}
                                                >
                                                    <option value="editor">Editor</option>
                                                    <option value="viewer">Viewer</option>
                                                </select>

                                                <button
                                                    type="button"
                                                    onClick={() => handleRemove(collab.id)}
                                                    className="collab-btn-icon-danger"
                                                    title="Remove collaborator"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        ) : (
                                            <span className={`collab-role-pill collab-role-${collab.role}`}>
                                                {collab.role}
                                            </span>
                                        )}
                                    </div>
                                ))}

                                {!owner && collaborators.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '16px', color: '#6b7280', fontSize: '0.825rem' }}>
                                        No other members yet
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="collab-modal-actions">
                        <button
                            type="button"
                            onClick={onClose}
                            className="collab-btn-secondary"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

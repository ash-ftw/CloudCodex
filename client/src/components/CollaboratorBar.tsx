import React from 'react';
import { ActiveCollaborator } from '../hooks/useCollaboration';
import { Users, Share2, History, Shield, Eye, Edit3 } from 'lucide-react';

interface CollaboratorBarProps {
    collaborators: ActiveCollaborator[];
    currentUserRole?: string;
    onJumpToUser: (socketId: string) => void;
    onOpenShareModal: () => void;
    onOpenVersionModal: () => void;
}

export const CollaboratorBar: React.FC<CollaboratorBarProps> = ({
    collaborators,
    currentUserRole = 'owner',
    onJumpToUser,
    onOpenShareModal,
    onOpenVersionModal
}) => {
    return (
        <div className="collaborator-bar">
            {/* Left side: Role badge, online count, active avatars */}
            <div className="collaborator-bar-left">
                {/* User Role Badge */}
                <div className="collaborator-role-badge">
                    {currentUserRole === 'owner' && <Shield size={14} style={{ color: '#fbbf24' }} />}
                    {currentUserRole === 'editor' && <Edit3 size={14} style={{ color: '#60a5fa' }} />}
                    {currentUserRole === 'viewer' && <Eye size={14} style={{ color: '#34d399' }} />}
                    <span>{currentUserRole}</span>
                </div>

                <div className="collaborator-divider" />

                {/* Active Online Collaborators List */}
                <div className="collaborator-online-count">
                    <Users size={14} style={{ color: 'var(--accent-primary, #fff)' }} />
                    <span>{collaborators.length} online</span>
                </div>

                <div className="collaborator-chips">
                    {collaborators.map(collab => {
                        const activeFileName = collab.activeFile ? collab.activeFile.split('/').pop() : null;
                        return (
                            <button
                                key={collab.socketId}
                                onClick={() => onJumpToUser(collab.socketId)}
                                title={`Jump to ${collab.username}'s cursor ${activeFileName ? `(${activeFileName})` : ''}`}
                                className="collab-user-badge"
                            >
                                <span
                                    className="collab-user-dot"
                                    style={{ backgroundColor: collab.userColor }}
                                />
                                <span style={{ maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {collab.username}
                                </span>
                                {activeFileName && (
                                    <span className="collab-file-badge">
                                        {activeFileName}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Right side: Action Buttons: Version History & Share Project */}
            <div className="collaborator-bar-right">
                <button
                    type="button"
                    onClick={onOpenVersionModal}
                    className="collab-btn-sm"
                    title="View file version history"
                >
                    <History size={14} style={{ color: '#67e8f9' }} />
                    <span>History</span>
                </button>

                <button
                    type="button"
                    onClick={onOpenShareModal}
                    className="collab-btn-sm collab-btn-sm-primary"
                    title="Share project & invite collaborators"
                >
                    <Share2 size={14} />
                    <span>Share</span>
                </button>
            </div>
        </div>
    );
};

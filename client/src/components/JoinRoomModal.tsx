import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, LogIn, KeyRound, Hash, Loader2, AlertCircle } from 'lucide-react';
import { collaborationApi } from '../services/api';

interface JoinRoomModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();
    const [roomId, setRoomId] = useState('');
    const [roomPassword, setRoomPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!roomId.trim()) return;

        setLoading(true);
        setError(null);

        try {
            const res = await collaborationApi.joinRoom(roomId.trim(), roomPassword.trim() || undefined);
            onClose();
            navigate(`/editor/${res.projectId}`);
        } catch (err: any) {
            setError(err.message || 'Failed to join room');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="collab-modal-overlay" onClick={onClose}>
            <div className="collab-modal" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="collab-modal-header">
                    <h3>
                        <LogIn size={20} />
                        Join Collaborative Room
                    </h3>
                    <button onClick={onClose} className="collab-modal-close" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleJoin} className="collab-modal-body">
                    <div className="collab-form-group">
                        <label className="collab-label">
                            <Hash size={14} />
                            Room ID
                        </label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. 7c32e54a-5fd1-4bc7-9e45-cf8021b38e07"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            className="collab-input collab-input-mono"
                            autoFocus
                        />
                    </div>

                    <div className="collab-form-group">
                        <label className="collab-label">
                            <KeyRound size={14} />
                            Room Password
                        </label>
                        <input
                            type="password"
                            placeholder="Enter password (leave blank if none required)"
                            value={roomPassword}
                            onChange={(e) => setRoomPassword(e.target.value)}
                            className="collab-input"
                        />
                    </div>

                    {error && (
                        <div className="collab-error-box">
                            <AlertCircle size={16} style={{ flexShrink: 0 }} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="collab-modal-actions">
                        <button
                            type="button"
                            onClick={onClose}
                            className="collab-btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !roomId.trim()}
                            className="collab-btn-primary"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                            <span>Join Session</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

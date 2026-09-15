import React, { useState, useEffect } from 'react';
import { X, History, Save, RotateCcw, Clock, Loader2 } from 'lucide-react';
import { DiffEditor } from '@monaco-editor/react';
import { collaborationApi } from '../services/api';

interface VersionHistoryModalProps {
    isOpen: boolean;
    projectId: string;
    activeFilePath: string | null;
    currentContent: string;
    onRestoreContent: (content: string) => void;
    onClose: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
    isOpen,
    projectId,
    activeFilePath,
    currentContent,
    onRestoreContent,
    onClose
}) => {
    const [revisions, setRevisions] = useState<any[]>([]);
    const [selectedRevision, setSelectedRevision] = useState<any | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [snapshotTag, setSnapshotTag] = useState('');

    const fetchRevisions = async () => {
        if (!projectId || !activeFilePath) return;
        setLoading(true);
        try {
            const data = await collaborationApi.getRevisions(projectId, activeFilePath);
            setRevisions(data || []);
            if (data && data.length > 0) {
                setSelectedRevision(data[0]);
            }
        } catch (err) {
            console.error('Failed to fetch revisions:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchRevisions();
        }
    }, [isOpen, projectId, activeFilePath]);

    const handleCreateSnapshot = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeFilePath || !currentContent) return;

        setSaving(true);
        try {
            await collaborationApi.saveSnapshot(
                projectId,
                activeFilePath,
                currentContent,
                snapshotTag.trim() || undefined
            );
            setSnapshotTag('');
            await fetchRevisions();
        } catch (err) {
            console.error('Failed to save revision snapshot:', err);
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = () => {
        if (!selectedRevision || !selectedRevision.content) return;
        onRestoreContent(selectedRevision.content);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="collab-modal-overlay" onClick={onClose}>
            <div className="collab-modal collab-modal-lg" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="collab-modal-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <History size={20} style={{ color: '#67e8f9' }} />
                        <h3 className="collab-modal-title">Version History</h3>
                        {activeFilePath && (
                            <span className="collab-value-box" style={{ padding: '3px 8px', fontSize: '0.75rem', marginLeft: '6px' }}>
                                {activeFilePath}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="collab-modal-close"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Main Content: Split Sidebar & Diff Editor */}
                <div className="collab-history-layout">
                    {/* Left Revision List Sidebar */}
                    <div className="collab-history-sidebar">
                        {/* Save Snapshot Box */}
                        <form onSubmit={handleCreateSnapshot} className="collab-history-create-form">
                            <label className="collab-label-muted">
                                Save New Revision
                            </label>
                            <div className="collab-inline-form">
                                <input
                                    type="text"
                                    placeholder="Snapshot note/tag"
                                    value={snapshotTag}
                                    onChange={e => setSnapshotTag(e.target.value)}
                                    className="collab-input"
                                    style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem' }}
                                />
                                <button
                                    type="submit"
                                    disabled={saving || !activeFilePath}
                                    className="collab-btn-action"
                                    style={{ padding: '7px 12px', fontSize: '0.8rem' }}
                                >
                                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                    <span>Save</span>
                                </button>
                            </div>
                        </form>

                        {/* Revisions History Timeline */}
                        <div className="collab-history-list">
                            {loading ? (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                                    <Loader2 size={20} className="animate-spin" style={{ color: '#9ca3af' }} />
                                </div>
                            ) : revisions.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '32px 16px', color: '#6b7280', fontSize: '0.8rem' }}>
                                    No revision snapshots yet
                                </div>
                            ) : (
                                revisions.map(rev => {
                                    const isSelected = selectedRevision?.id === rev.id;
                                    return (
                                        <button
                                            key={rev.id}
                                            onClick={() => setSelectedRevision(rev)}
                                            className={`collab-history-item ${isSelected ? 'active' : ''}`}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <span className="collab-history-item-tag">{rev.versionTag}</span>
                                                <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{rev.author}</span>
                                            </div>
                                            <div className="collab-history-item-meta">
                                                <Clock size={12} />
                                                <span>{new Date(rev.createdAt).toLocaleString()}</span>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Right Monaco Diff View */}
                    <div className="collab-history-preview">
                        <div className="collab-history-preview-header">
                            <span>Left: Original Snapshot | Right: Current Workspace File</span>
                            {selectedRevision && selectedRevision.content && (
                                <button
                                    type="button"
                                    onClick={handleRestore}
                                    className="collab-btn-primary"
                                    style={{ padding: '5px 12px', fontSize: '0.775rem' }}
                                >
                                    <RotateCcw size={13} />
                                    <span>Restore Selected Snapshot</span>
                                </button>
                            )}
                        </div>

                        <div className="collab-history-editor-wrap">
                            {selectedRevision ? (
                                <DiffEditor
                                    theme="vs-dark"
                                    original={selectedRevision.content || ''}
                                    modified={currentContent}
                                    options={{
                                        readOnly: true,
                                        renderSideBySide: true,
                                        minimap: { enabled: false }
                                    }}
                                />
                            ) : (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: '0.825rem' }}>
                                    Select a revision snapshot on the left to preview changes
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import type { editor } from 'monaco-editor';
import { getSocket } from '../services/socket';

export interface ActiveCollaborator {
    socketId: string;
    userId: string;
    username: string;
    userColor: string;
    activeFile?: string;
    cursorPosition?: { line: number; column: number };
    selection?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
}

interface UseCollaborationOptions {
    projectId?: string;
    activeFilePath: string | null;
    editor: editor.IStandaloneCodeEditor | null;
    username?: string;
}

/**
 * Shared flag that EditorPage reads to know whether an editor model change
 * was driven by Yjs (remote CRDT / initial sync) rather than user typing.
 * When true, EditorPage should NOT push the change into the Zustand store.
 */
let _suppressStoreUpdate = false;
export function isCrdtDrivenChange(): boolean {
    return _suppressStoreUpdate;
}

export function useCollaboration({
    projectId,
    activeFilePath,
    editor,
    username = 'Collaborator'
}: UseCollaborationOptions) {
    const [collaborators, setCollaborators] = useState<ActiveCollaborator[]>([]);
    const yDocRef = useRef<Y.Doc | null>(null);
    const bindingRef = useRef<MonacoBinding | null>(null);
    const decorationsRef = useRef<string[]>([]);

    // 1. Socket room connection & presence synchronization
    useEffect(() => {
        if (!projectId) return;

        const socket = getSocket();
        if (!socket) return;

        socket.emit('join-project', { projectId, username });

        const handlePresenceUpdate = (users: ActiveCollaborator[]) => {
            setCollaborators(users);
        };

        socket.on('presence-update', handlePresenceUpdate);

        return () => {
            socket.off('presence-update', handlePresenceUpdate);
            socket.emit('leave-project', projectId);
        };
    }, [projectId, username]);

    // 2. Yjs CRDT binding to Monaco Editor for active file
    //
    // CRITICAL FLOW:
    // a) Create an EMPTY Y.Doc (do NOT seed with editor content)
    // b) Send the current editor content to the server via crdt-sync-request
    // c) Server creates/returns the authoritative Y.Doc state (seeded on its side only)
    // d) Apply server state to the local Y.Doc
    // e) THEN create MonacoBinding — it reads Y.Text and sets the model content
    //
    // This ensures only the server ever seeds the Y.Doc, avoiding the Yjs
    // "duplicate on merge" bug that happens when two docs are independently
    // seeded with the same text.
    useEffect(() => {
        if (!projectId || !activeFilePath || !editor) return;

        const socket = getSocket();
        if (!socket) return;

        // Clean up previous binding
        if (bindingRef.current) {
            bindingRef.current.destroy();
            bindingRef.current = null;
        }
        if (yDocRef.current) {
            yDocRef.current.destroy();
            yDocRef.current = null;
        }

        const model = editor.getModel();
        if (!model) return;

        // Capture the current editor content loaded from the API.
        // We send this to the server so it can seed the Y.Doc if none exists yet.
        const existingContent = model.getValue();

        // Create EMPTY Y.Doc — do NOT seed it locally.
        const yDoc = new Y.Doc();
        yDocRef.current = yDoc;

        let disposed = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

        // Helper: create the MonacoBinding (called once, either from sync or fallback)
        const createBinding = () => {
            if (disposed || bindingRef.current || !yDocRef.current) return;
            const yText = yDocRef.current.getText('monaco');
            _suppressStoreUpdate = true;
            bindingRef.current = new MonacoBinding(
                yText,
                model,
                new Set([editor])
            );
            // Give Monaco time to process the setValue from MonacoBinding
            setTimeout(() => { _suppressStoreUpdate = false; }, 100);
        };

        // Emit local CRDT updates over Socket.IO
        const handleYDocUpdate = (update: Uint8Array, origin: any) => {
            // Don't re-broadcast updates that came from the server or init seeding
            if (origin === 'remote' || origin === 'init') return;

            socket.emit('crdt-update', {
                projectId,
                filePath: activeFilePath,
                update: Array.from(update)
            });
        };

        yDoc.on('update', handleYDocUpdate);

        // Receive remote CRDT updates from other collaborators
        const handleCrdtUpdate = (data: { filePath: string; update: number[]; senderSocketId: string }) => {
            if (data.filePath === activeFilePath && yDocRef.current) {
                try {
                    _suppressStoreUpdate = true;
                    const updateBuffer = new Uint8Array(data.update);
                    Y.applyUpdate(yDocRef.current, updateBuffer, 'remote');
                } catch (err) {
                    console.error('Failed to apply remote Yjs update:', err);
                } finally {
                    setTimeout(() => { _suppressStoreUpdate = false; }, 50);
                }
            }
        };

        socket.on('crdt-update', handleCrdtUpdate);

        // Handle the sync response from the server — this is where we create the binding.
        const handleSyncResponse = (data: { filePath: string; state: number[] }) => {
            if (data.filePath !== activeFilePath || !yDocRef.current) return;
            if (bindingRef.current) return; // Already bound (e.g. from fallback)

            // Cancel the fallback timer since we got the server state
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }

            try {
                // Apply the authoritative server state to our empty Y.Doc.
                // This populates Y.Text with the correct file content.
                Y.applyUpdate(yDocRef.current, new Uint8Array(data.state), 'remote');
            } catch (err) {
                console.error('Failed to apply server Y.Doc state:', err);
            }

            // Now create the binding — Y.Text has the correct content,
            // so MonacoBinding will set the model to the right value.
            createBinding();
        };

        socket.on('crdt-sync-response', handleSyncResponse);

        // Request the server's authoritative Y.Doc state.
        // The server will create and seed a Y.Doc if none exists for this file.
        socket.emit('crdt-sync-request', {
            projectId,
            filePath: activeFilePath,
            initialContent: existingContent
        });

        // Fallback: if the server doesn't respond within 500ms,
        // seed locally and create the binding so the user can still type.
        fallbackTimer = setTimeout(() => {
            if (disposed || bindingRef.current) return;
            if (yDocRef.current) {
                const yText = yDocRef.current.getText('monaco');
                if (yText.length === 0 && existingContent) {
                    yDocRef.current.transact(() => {
                        yText.insert(0, existingContent);
                    }, 'init');
                }
            }
            createBinding();
        }, 500);

        return () => {
            disposed = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            yDoc.off('update', handleYDocUpdate);
            socket.off('crdt-update', handleCrdtUpdate);
            socket.off('crdt-sync-response', handleSyncResponse);
            if (bindingRef.current) {
                bindingRef.current.destroy();
                bindingRef.current = null;
            }
            if (yDocRef.current) {
                yDocRef.current.destroy();
                yDocRef.current = null;
            }
            _suppressStoreUpdate = false;
        };
    }, [projectId, activeFilePath, editor]);

    // 3. Cursor & Selection heartbeat emission
    useEffect(() => {
        if (!projectId || !editor) return;

        const socket = getSocket();
        if (!socket) return;

        const sendHeartbeat = () => {
            const position = editor.getPosition();
            const selection = editor.getSelection();

            socket.emit('presence-heartbeat', {
                projectId,
                activeFile: activeFilePath || undefined,
                cursorPosition: position ? { line: position.lineNumber, column: position.column } : undefined,
                selection: selection ? {
                    startLine: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLine: selection.endLineNumber,
                    endColumn: selection.endColumn
                } : undefined
            });
        };

        const cursorListener = editor.onDidChangeCursorPosition(sendHeartbeat);
        const selectionListener = editor.onDidChangeCursorSelection(sendHeartbeat);

        sendHeartbeat();

        return () => {
            cursorListener.dispose();
            selectionListener.dispose();
        };
    }, [projectId, activeFilePath, editor]);

    // 4. Render remote cursors inside Monaco editor
    useEffect(() => {
        if (!editor || !activeFilePath) return;

        const socket = getSocket();
        const currentSocketId = socket?.id;

        const remoteCollaborators = collaborators.filter(
            c => c.socketId !== currentSocketId && c.activeFile === activeFilePath && c.cursorPosition
        );

        const newDecorations: editor.IModelDeltaDecoration[] = [];

        remoteCollaborators.forEach(collab => {
            if (!collab.cursorPosition) return;

            const pos = collab.cursorPosition;

            // Cursor line decoration
            newDecorations.push({
                range: {
                    startLineNumber: pos.line,
                    startColumn: pos.column,
                    endLineNumber: pos.line,
                    endColumn: pos.column + 1
                },
                options: {
                    className: `remote-cursor-${collab.socketId}`,
                    hoverMessage: { value: `**${collab.username}**` },
                    beforeContentClassName: `remote-cursor-badge-${collab.socketId}`
                }
            });
        });

        // Inject dynamic CSS rules for remote cursor colors & tooltips
        remoteCollaborators.forEach(collab => {
            const styleId = `cursor-style-${collab.socketId}`;
            let styleEl = document.getElementById(styleId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                document.head.appendChild(styleEl);
            }
            styleEl.innerHTML = `
                .remote-cursor-${collab.socketId} {
                    border-left: 2px solid ${collab.userColor} !important;
                    position: relative;
                }
                .remote-cursor-badge-${collab.socketId}::before {
                    content: '${collab.username}';
                    position: absolute;
                    top: -18px;
                    left: 0;
                    background-color: ${collab.userColor};
                    color: #ffffff;
                    font-size: 10px;
                    font-weight: 600;
                    padding: 1px 4px;
                    border-radius: 3px;
                    white-space: nowrap;
                    z-index: 10;
                    pointer-events: none;
                }
            `;
        });

        decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    }, [collaborators, activeFilePath, editor]);

    // Jump to collaborator's active line & file
    const jumpToCollaborator = useCallback((targetSocketId: string) => {
        const target = collaborators.find(c => c.socketId === targetSocketId);
        if (!target || !editor || !target.cursorPosition) return;

        editor.revealLineInCenter(target.cursorPosition.line);
        editor.setPosition({
            lineNumber: target.cursorPosition.line,
            column: target.cursorPosition.column
        });
        editor.focus();
    }, [collaborators, editor]);

    return {
        collaborators,
        jumpToCollaborator
    };
}

import { useState, useEffect, useRef } from 'react';
import { Project } from '../store/projectStore';
import { useAuthStore } from '../store/authStore';
import { gitApi } from '../services/api';
import { useModal } from '../hooks/useModal';
import ConfirmModal from './ConfirmModal';
import { CheckCircle2, Circle, Github, GitBranch, Loader, X, ExternalLink, AlertTriangle, Lightbulb, ArrowRight } from 'lucide-react';
import '../styles/github-modal.css';

interface ValidationStatus {
    gitInitialized: boolean;
    githubAuthenticated: boolean;
    remoteConfigured: boolean;
    hasCommits: boolean;
    hasUncommittedChanges: boolean;
    canPush: boolean;
    remote?: { name: string; url: string };
}

interface GitHubSetupModalProps {
    project: Project;
    onClose: () => void;
    onSuccess: () => void;
}

export default function GitHubSetupModal({
    project,
    onClose,
    onSuccess
}: GitHubSetupModalProps) {
    const [validation, setValidation] = useState<ValidationStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [currentStep, setCurrentStep] = useState<number>(1);
    const [autoSetupStatus, setAutoSetupStatus] = useState<string | null>(null);

    // Guard against React StrictMode double-mount
    const initRef = useRef(false);

    // Form state
    const [repoUrl, setRepoUrl] = useState('');
    const [branch, setBranch] = useState('main');
    const [commitMessage, setCommitMessage] = useState('Initial commit');
    const { modalState, showAlert, closeModal } = useModal();

    useEffect(() => {
        // Prevent double initialization from React StrictMode
        if (initRef.current) return;
        initRef.current = true;

        // Reset state when project changes
        setValidation(null);
        setValidationError(null);
        setAutoSetupStatus(null);
        setRepoUrl('');
        setBranch('main');
        setCommitMessage('Initial commit');

        initializeWizard();

        // Check if we just came back from GitHub OAuth linking
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('github_linked') === 'true') {
            window.history.replaceState({}, '', window.location.pathname);
        }

        return () => { initRef.current = false; };
    }, [project.id]);

    /**
     * Smart wizard initialization:
     * 1. Single validate call to check current state
     * 2. Auto-initialize git if needed (no extra validate after)
     * 3. Jump to the first step that needs user input
     */
    const initializeWizard = async () => {
        setAutoSetupStatus('Checking project status...');

        try {
            let result = await gitApi.validatePush(project.id);

            // Auto-init git if not initialized — update state optimistically
            if (!result.gitInitialized) {
                setAutoSetupStatus('Initializing Git repository...');
                try {
                    await gitApi.init(project.id);
                    // Optimistically update — no need for another validate container
                    result = {
                        ...result,
                        gitInitialized: true,
                        hasUncommittedChanges: true // fresh repo always has uncommitted files
                    };
                } catch (initError) {
                    console.error('Auto git-init failed:', initError);
                }
            }

            setValidation(result);
            setAutoSetupStatus(null);
            determineCurrentStep(result);
        } catch (error) {
            console.error('Failed to validate:', error);
            const defaultValidation: ValidationStatus = {
                gitInitialized: false,
                githubAuthenticated: false,
                remoteConfigured: false,
                hasCommits: false,
                hasUncommittedChanges: false,
                canPush: false
            };
            setValidation(defaultValidation);
            setCurrentStep(1);
            setAutoSetupStatus(null);
            setValidationError((error as Error).message);
        }
    };

    const determineCurrentStep = (val: ValidationStatus) => {
        if (!val.gitInitialized) {
            setCurrentStep(1);
        } else if (!val.githubAuthenticated) {
            setCurrentStep(2);
        } else if (!val.remoteConfigured) {
            setCurrentStep(3);
        } else if (!val.hasCommits || val.hasUncommittedChanges) {
            setCurrentStep(4);
        } else {
            setCurrentStep(5);
        }
    };

    /** Helper: optimistically update validation and advance step */
    const updateValidation = (updates: Partial<ValidationStatus>) => {
        setValidation(prev => {
            if (!prev) return prev;
            const updated = { ...prev, ...updates };
            // Recalculate canPush
            updated.canPush =
                updated.gitInitialized &&
                updated.githubAuthenticated &&
                updated.remoteConfigured &&
                updated.hasCommits &&
                !updated.hasUncommittedChanges;
            determineCurrentStep(updated);
            return updated;
        });
    };

    const handleInitGit = async () => {
        setLoading(true);
        try {
            await gitApi.init(project.id);
            // Optimistic: git is now initialized, files are uncommitted
            updateValidation({
                gitInitialized: true,
                hasUncommittedChanges: true
            });
        } catch (error) {
            console.error('Failed to initialize Git:', error);
            showAlert(`Failed to initialize Git: ${(error as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleConnectGitHub = () => {
        const userId = useAuthStore.getState().user?.id;
        if (!userId) {
            showAlert('Please log in first', 'info', 'Authentication Required');
            return;
        }
        window.location.href = `http://localhost:3001/api/auth/github/link?userId=${userId}`;
    };

    const handleAddRemote = async () => {
        if (!repoUrl.trim()) {
            showAlert('Please enter a repository URL', 'info', 'Missing URL');
            return;
        }

        const githubUrlPattern = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+\.git$/;
        if (!githubUrlPattern.test(repoUrl)) {
            showAlert('Invalid GitHub URL format. Use: https://github.com/username/repo.git', 'error', 'Invalid URL');
            return;
        }

        setLoading(true);
        try {
            await gitApi.addRemote(project.id, repoUrl, branch);
            // Optimistic: remote is now configured
            updateValidation({
                remoteConfigured: true,
                remote: { name: 'origin', url: repoUrl }
            });
        } catch (error) {
            console.error('Failed to add remote:', error);
            showAlert(`Failed to add remote: ${(error as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateCommit = async () => {
        setLoading(true);
        try {
            await gitApi.add(project.id);
            await gitApi.commit(project.id, commitMessage);
            // Optimistic: files are now committed
            updateValidation({
                hasCommits: true,
                hasUncommittedChanges: false
            });
        } catch (error) {
            console.error('Failed to commit:', error);
            showAlert(`Failed to create commit: ${(error as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    const handlePush = async () => {
        setLoading(true);
        try {
            await gitApi.push(project.id);
            showAlert('Your code has been successfully pushed to GitHub!', 'success', 'Push Successful');
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Failed to push:', error);
            showAlert(`Failed to push: ${(error as Error).message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!validation) {
        return (
            <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <Loader className="spinner" size={32} />
                        <p>{autoSetupStatus || 'Validating project...'}</p>
                    </div>
                </div>
            </div>
            <ConfirmModal
                isOpen={modalState.isOpen}
                title={modalState.title}
                message={modalState.message}
                variant={modalState.variant}
                confirmLabel={modalState.confirmLabel}
                cancelLabel={modalState.cancelLabel}
                showCancel={modalState.showCancel}
                onConfirm={modalState.onConfirm}
                onCancel={closeModal}
            />
            </>
        );
    }

    return (
        <>
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2><Github size={24} /> Push to GitHub</h2>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="github-setup-content">
                    {/* Validation Error Banner */}
                    {validationError && (
                        <div className="error-box" style={{ marginBottom: '1rem' }}>
                            <AlertTriangle size={16} />
                            <p>{validationError}</p>
                        </div>
                    )}

                    {/* Progress Steps */}
                    <div className="setup-steps">
                        <SetupStep
                            number={1}
                            title="Initialize Git"
                            completed={validation.gitInitialized}
                            active={currentStep === 1}
                            onClick={() => setCurrentStep(1)}
                        />
                        <SetupStep
                            number={2}
                            title="Connect GitHub"
                            completed={validation.githubAuthenticated}
                            active={currentStep === 2}
                            onClick={() => setCurrentStep(2)}
                        />
                        <SetupStep
                            number={3}
                            title="Configure Repository"
                            completed={validation.remoteConfigured}
                            active={currentStep === 3}
                            onClick={() => setCurrentStep(3)}
                        />
                        <SetupStep
                            number={4}
                            title="Create Commit"
                            completed={validation.hasCommits && !validation.hasUncommittedChanges}
                            active={currentStep === 4}
                            onClick={() => setCurrentStep(4)}
                        />
                        <SetupStep
                            number={5}
                            title="Push"
                            completed={false}
                            active={currentStep === 5}
                            onClick={() => validation.canPush ? setCurrentStep(5) : null}
                        />
                    </div>

                    {/* Step Content */}
                    <div className="setup-step-content">
                        {/* Step 1: Initialize Git */}
                        {currentStep === 1 && (
                            <div className="step-panel">
                                <h3>Initialize Git Repository</h3>
                                {validation.gitInitialized ? (
                                    <>
                                        <p style={{ color: 'var(--color-success, #22c55e)' }}>
                                            <CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: '-3px' }} /> Git is already initialized for this project.
                                        </p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => determineCurrentStep(validation)}
                                        >
                                            Continue <ArrowRight size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>This project is not yet a Git repository. Initialize Git to track your code changes.</p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleInitGit}
                                            disabled={loading}
                                        >
                                            {loading ? <Loader className="spinner" size={16} /> : 'Initialize Git'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Step 2: Connect GitHub */}
                        {currentStep === 2 && (
                            <div className="step-panel">
                                <h3>Connect GitHub Account</h3>
                                {validation.githubAuthenticated ? (
                                    <>
                                        <p style={{ color: 'var(--color-success, #22c55e)' }}>
                                            <CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: '-3px' }} /> GitHub account is connected.
                                        </p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => determineCurrentStep(validation)}
                                        >
                                            Continue <ArrowRight size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>You need to authenticate with GitHub to push your code.</p>
                                        <button
                                            className="btn btn-github"
                                            onClick={handleConnectGitHub}
                                        >
                                            <Github size={18} /> Connect GitHub
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Step 3: Configure Repository */}
                        {currentStep === 3 && (
                            <div className="step-panel">
                                <h3>Configure GitHub Repository</h3>
                                {validation.remoteConfigured ? (
                                    <>
                                        <p style={{ color: 'var(--color-success, #22c55e)' }}>
                                            <CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: '-3px' }} /> Remote configured: {validation.remote?.url}
                                        </p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => determineCurrentStep(validation)}
                                        >
                                            Continue <ArrowRight size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>Add your GitHub repository URL to push your code.</p>

                                        <div className="form-group">
                                            <label>Repository URL (HTTPS)</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="https://github.com/username/repo.git"
                                                value={repoUrl}
                                                onChange={(e) => setRepoUrl(e.target.value)}
                                            />
                                            <small>Use the HTTPS URL format from your GitHub repository</small>
                                        </div>

                                        <div className="form-group">
                                            <label>Branch</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder="main"
                                                value={branch}
                                                onChange={(e) => setBranch(e.target.value)}
                                            />
                                        </div>

                                        <div className="info-box">
                                            <span className="info-icon"><Lightbulb size={16} /></span>
                                            <p>
                                                Don't have a repository yet?{' '}
                                                <a
                                                    href="https://github.com/new"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    Create one on GitHub <ExternalLink size={14} />
                                                </a>
                                            </p>
                                        </div>

                                        <button
                                            className="btn btn-primary"
                                            onClick={handleAddRemote}
                                            disabled={loading || !repoUrl.trim()}
                                        >
                                            {loading ? <Loader className="spinner" size={16} /> : 'Add Remote'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Step 4: Create Commit */}
                        {currentStep === 4 && (
                            <div className="step-panel">
                                <h3>{validation.hasCommits ? 'Commit New Changes' : 'Create Initial Commit'}</h3>
                                {validation.hasCommits && !validation.hasUncommittedChanges ? (
                                    <>
                                        <p style={{ color: 'var(--color-success, #22c55e)' }}>
                                            <CheckCircle2 size={16} style={{ display: 'inline', verticalAlign: '-3px' }} /> All changes are committed.
                                        </p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => determineCurrentStep(validation)}
                                        >
                                            Continue <ArrowRight size={14} style={{ display: 'inline', verticalAlign: '-2px' }} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>
                                            {validation.hasUncommittedChanges
                                                ? 'You have uncommitted changes. Commit them before pushing to GitHub.'
                                                : 'Commit your files before pushing to GitHub.'}
                                        </p>

                                        <div className="form-group">
                                            <label>Commit Message</label>
                                            <input
                                                type="text"
                                                className="input"
                                                placeholder={validation.hasCommits ? 'Add new features' : 'Initial commit'}
                                                value={commitMessage}
                                                onChange={(e) => setCommitMessage(e.target.value)}
                                            />
                                        </div>

                                        <button
                                            className="btn btn-primary"
                                            onClick={handleCreateCommit}
                                            disabled={loading || !commitMessage.trim()}
                                        >
                                            {loading ? <Loader className="spinner" size={16} /> : 'Create Commit'}
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Step 5: Push */}
                        {currentStep === 5 && (
                            <div className="step-panel">
                                <h3>Ready to Push</h3>
                                <p>All prerequisites are met! Push your code to GitHub.</p>

                                {validation.remote && (
                                    <div className="info-box">
                                        <GitBranch size={16} />
                                        <div>
                                            <strong>Remote:</strong> {validation.remote.url}
                                        </div>
                                    </div>
                                )}

                                <button
                                    className="btn btn-primary"
                                    onClick={handlePush}
                                    disabled={loading}
                                >
                                    {loading ? <Loader className="spinner" size={16} /> : <><Github size={18} /> Push to GitHub</>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
        <ConfirmModal
            isOpen={modalState.isOpen}
            title={modalState.title}
            message={modalState.message}
            variant={modalState.variant}
            confirmLabel={modalState.confirmLabel}
            cancelLabel={modalState.cancelLabel}
            showCancel={modalState.showCancel}
            onConfirm={modalState.onConfirm}
            onCancel={closeModal}
        />
        </>
    );
}

function SetupStep({
    number,
    title,
    completed,
    active,
    onClick
}: {
    number: number;
    title: string;
    completed: boolean;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <div
            className={`setup-step ${active ? 'active' : ''} ${completed ? 'completed' : ''}`}
            onClick={onClick}
            style={{ cursor: 'pointer' }}
        >
            <div className="step-indicator">
                {completed ? (
                    <CheckCircle2 size={24} className="step-icon completed" />
                ) : (
                    <Circle size={24} className="step-icon" />
                )}
                <span className="step-number">{number}</span>
            </div>
            <div className="step-title">{title}</div>
        </div>
    );
}

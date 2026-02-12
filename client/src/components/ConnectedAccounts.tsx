import { useState } from 'react';
import { Mail as Google, Github, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useModal } from '../hooks/useModal';
import ConfirmModal from './ConfirmModal';

interface ConnectedAccount {
    id: string;
    provider: 'google' | 'github';
    email: string;
    created_at: string;
}

interface ConnectedAccountsProps {
    connectedAccounts: ConnectedAccount[];
    onConnect: (provider: 'google' | 'github') => void;
    onDisconnect: (provider: 'google' | 'github') => void;
    isLoading: boolean;
}

export default function ConnectedAccounts({
    connectedAccounts,
    onConnect,
    onDisconnect,
    isLoading
}: ConnectedAccountsProps) {
    const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
    const { modalState, showConfirm, closeModal } = useModal();

    const isConnected = (provider: 'google' | 'github') => {
        return connectedAccounts.some(acc => acc.provider === provider);
    };

    const getAccountEmail = (provider: 'google' | 'github') => {
        const account = connectedAccounts.find(acc => acc.provider === provider);
        return account?.email;
    };

    const handleDisconnect = async (provider: 'google' | 'github') => {
        const confirmed = await showConfirm({
            title: 'Disconnect Account',
            message: `Are you sure you want to disconnect your ${provider} account?`,
            confirmLabel: 'Disconnect',
        });
        if (confirmed) {
            setDisconnectingProvider(provider);
            try {
                await onDisconnect(provider);
            } finally {
                setDisconnectingProvider(null);
            }
        }
    };

    const providers = [
        {
            name: 'Google',
            key: 'google' as const,
            icon: Google,
            color: '#4285F4'
        },
        {
            name: 'GitHub',
            key: 'github' as const,
            icon: Github,
            color: '#24292e'
        }
    ];

    return (
        <div className="connected-accounts">
            <h3>Connected Accounts</h3>
            <p className="section-subtitle">Link your accounts to enable seamless integration</p>

            <div className="accounts-grid">
                {providers.map((provider) => {
                    const connected = isConnected(provider.key);
                    const email = getAccountEmail(provider.key);
                    const Icon = provider.icon;
                    const isDisconnecting = disconnectingProvider === provider.key;

                    return (
                        <div key={provider.key} className={`account-card ${connected ? 'connected' : ''}`}>
                            <div className="account-header">
                                <div className="account-info">
                                    <div className="account-icon" style={{ backgroundColor: provider.color }}>
                                        <Icon size={24} color="white" />
                                    </div>
                                    <div>
                                        <h4>{provider.name}</h4>
                                        {connected && email && (
                                            <p className="account-email">{email}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="account-status">
                                    {connected ? (
                                        <CheckCircle2 size={20} className="status-icon connected" />
                                    ) : (
                                        <XCircle size={20} className="status-icon disconnected" />
                                    )}
                                </div>
                            </div>

                            <div className="account-actions">
                                {connected ? (
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleDisconnect(provider.key)}
                                        disabled={isLoading || isDisconnecting}
                                    >
                                        {isDisconnecting ? (
                                            <span className="loading-spinner small"></span>
                                        ) : (
                                            <>Disconnect</>
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => onConnect(provider.key)}
                                        disabled={isLoading}
                                    >
                                        Connect
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="account-note">
                <AlertCircle size={16} />
                <p>You must have at least one authentication method connected to your account.</p>
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
        </div>
    );
}

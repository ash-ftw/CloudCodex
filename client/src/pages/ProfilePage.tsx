import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import ConnectedAccounts from '../components/ConnectedAccounts';
import { User, Mail, Shield, HardDrive, ArrowLeft, Save, CheckCircle, XCircle } from 'lucide-react';
import '../styles/profile.css';

export default function ProfilePage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuthStore();
    const {
        profile,
        connectedAccounts,
        isLoading,
        error,
        fetchProfile,
        updateProfile,
        connectAccount,
        disconnectAccount,
        clearError
    } = useProfileStore();

    const [username, setUsername] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    useEffect(() => {
        if (profile) {
            setUsername(profile.username);
        }
    }, [profile]);

    // Handle OAuth callback messages
    useEffect(() => {
        const googleLinked = searchParams.get('google_linked');
        const githubLinked = searchParams.get('github_linked');
        const errorParam = searchParams.get('error');

        if (googleLinked === 'true') {
            setSuccessMessage('Google account connected successfully!');
            fetchProfile();
            setTimeout(() => setSuccessMessage(''), 5000);
        } else if (githubLinked === 'true') {
            setSuccessMessage('GitHub account connected successfully!');
            fetchProfile();
            setTimeout(() => setSuccessMessage(''), 5000);
        } else if (errorParam === 'account_already_linked') {
            setErrorMessage('This account is already linked to another user.');
            setTimeout(() => setErrorMessage(''), 5000);
        }

        // Clear URL parameters
        if (googleLinked || githubLinked || errorParam) {
            navigate('/profile', { replace: true });
        }
    }, [searchParams, navigate, fetchProfile]);

    useEffect(() => {
        if (error) {
            setErrorMessage(error);
            clearError();
            setTimeout(() => setErrorMessage(''), 5000);
        }
    }, [error, clearError]);

    const handleUpdateProfile = async () => {
        try {
            await updateProfile({ username });
            setSuccessMessage('Profile updated successfully!');
            setIsEditing(false);
            setTimeout(() => setSuccessMessage(''), 5000);
        } catch (err) {
            // Error is already handled by the store
        }
    };

    const handleConnect = (provider: 'google' | 'github') => {
        if (user?.id) {
            connectAccount(provider, user.id);
        }
    };

    const handleDisconnect = async (provider: 'google' | 'github') => {
        try {
            await disconnectAccount(provider);
            setSuccessMessage(`${provider} account disconnected successfully!`);
            setTimeout(() => setSuccessMessage(''), 5000);
        } catch (err) {
            // Error is already handled by the store
        }
    };

    const storagePercentage = profile
        ? (profile.storage_used_mb / profile.storage_quota_mb) * 100
        : 0;

    return (
        <div className="profile-page">
            {/* Animated Background */}
            <div className="profile-bg">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
            </div>

            <div className="profile-container">
                {/* Header */}
                <div className="profile-header">
                    <button className="btn-back" onClick={() => navigate('/dashboard')}>
                        <ArrowLeft size={20} />
                        Back to Dashboard
                    </button>
                    <h1>Profile Settings</h1>
                    <p>Manage your account information and connected services</p>
                </div>

                {/* Success/Error Messages */}
                {successMessage && (
                    <div className="alert alert-success">
                        <CheckCircle size={20} />
                        {successMessage}
                    </div>
                )}

                {errorMessage && (
                    <div className="alert alert-error">
                        <XCircle size={20} />
                        {errorMessage}
                    </div>
                )}

                {/* Profile Information */}
                <div className="profile-section">
                    <h2>
                        <User size={24} />
                        Account Information
                    </h2>

                    {isLoading && !profile ? (
                        <div className="loading-state">
                            <div className="loading-spinner"></div>
                            <p>Loading profile...</p>
                        </div>
                    ) : profile ? (
                        <div className="profile-info">
                            <div className="info-row">
                                <div className="info-label">
                                    <Mail size={18} />
                                    Email
                                </div>
                                <div className="info-value">{user?.email}</div>
                            </div>

                            <div className="info-row">
                                <div className="info-label">
                                    <User size={18} />
                                    Username
                                </div>
                                <div className="info-value">
                                    {isEditing ? (
                                        <div className="edit-username">
                                            <input
                                                type="text"
                                                value={username}
                                                onChange={(e) => setUsername(e.target.value)}
                                                className="input"
                                                minLength={3}
                                                maxLength={30}
                                            />
                                            <button
                                                className="btn btn-primary btn-sm"
                                                onClick={handleUpdateProfile}
                                                disabled={isLoading}
                                            >
                                                <Save size={16} />
                                                Save
                                            </button>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => {
                                                    setIsEditing(false);
                                                    setUsername(profile.username);
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="username-display">
                                            {profile.username}
                                            <button
                                                className="btn btn-link"
                                                onClick={() => setIsEditing(true)}
                                            >
                                                Edit
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="info-row">
                                <div className="info-label">
                                    <Shield size={18} />
                                    Role
                                </div>
                                <div className="info-value">
                                    <span className={`role-badge ${profile.role}`}>
                                        {profile.role.toUpperCase()}
                                    </span>
                                </div>
                            </div>

                            <div className="info-row">
                                <div className="info-label">
                                    <HardDrive size={18} />
                                    Storage Usage
                                </div>
                                <div className="info-value">
                                    <div className="storage-info">
                                        <div className="storage-text">
                                            {profile.storage_used_mb} MB / {profile.storage_quota_mb} MB
                                            <span className="storage-percent">
                                                ({storagePercentage.toFixed(1)}%)
                                            </span>
                                        </div>
                                        <div className="storage-bar">
                                            <div
                                                className="storage-fill"
                                                style={{ width: `${Math.min(storagePercentage, 100)}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Connected Accounts */}
                <div className="profile-section">
                    <ConnectedAccounts
                        connectedAccounts={connectedAccounts}
                        onConnect={handleConnect}
                        onDisconnect={handleDisconnect}
                        isLoading={isLoading}
                    />
                </div>
            </div>
        </div>
    );
}

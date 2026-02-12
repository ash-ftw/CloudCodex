import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { Github, Mail, Lock, User, ArrowRight, Rocket, Shield, Zap } from 'lucide-react';
import '../styles/login.css';

export default function LoginPage() {
    const navigate = useNavigate();
    const { login, register, loginWithGitHub, loginWithGoogle, isLoading } = useAuthStore();

    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            if (isRegister) {
                await register(email, password, username);
            } else {
                await login(email, password);
            }
            navigate('/dashboard');
        } catch (err) {
            setError((err as Error).message);
        }
    };

    return (
        <div className="login-page">
            {/* Animated Background */}
            <div className="login-bg">
                <div className="gradient-orb orb-1"></div>
                <div className="gradient-orb orb-2"></div>
                <div className="gradient-orb orb-3"></div>
            </div>

            <div className="login-container">
                {/* Logo and Title */}
                <div className="login-header">
                    <div className="logo">
                        <img src="/favicon.svg" width={64} height={64} alt="CloudCodeX logo" />
                    </div>
                    <h1>CloudCodeX</h1>
                    <p>Cloud-based IDE for Modern Development</p>
                </div>

                {/* Login Form */}
                <form className="login-form" onSubmit={handleSubmit}>
                    <h2>{isRegister ? 'Create Account' : 'Welcome Back'}</h2>

                    {error && <div className="error-message">{error}</div>}

                    {isRegister && (
                        <div className="input-group">
                            <User className="input-icon" size={18} />
                            <input
                                type="text"
                                className="input"
                                placeholder="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                minLength={3}
                            />
                        </div>
                    )}

                    <div className="input-group">
                        <Mail className="input-icon" size={18} />
                        <input
                            type="email"
                            className="input"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>

                    <div className="input-group">
                        <Lock className="input-icon" size={18} />
                        <input
                            type="password"
                            className="input"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={6}
                        />
                    </div>

                    <button type="submit" className="btn btn-primary w-full" disabled={isLoading}>
                        {isLoading ? (
                            <span className="loading-spinner"></span>
                        ) : (
                            <>
                                {isRegister ? 'Create Account' : 'Sign In'}
                                <ArrowRight size={18} />
                            </>
                        )}
                    </button>

                    <div className="divider">
                        <span>or continue with</span>
                    </div>

                    <div className="oauth-buttons">
                        <button
                            type="button"
                            className="btn btn-secondary oauth-btn"
                            onClick={loginWithGoogle}
                        >
                            <Mail size={18} />
                            Google
                        </button>
                        <button
                            type="button"
                            className="btn btn-secondary oauth-btn"
                            onClick={loginWithGitHub}
                        >
                            <Github size={18} />
                            GitHub
                        </button>
                    </div>

                    <p className="switch-mode">
                        {isRegister ? 'Already have an account?' : "Don't have an account?"}
                        <button type="button" onClick={() => setIsRegister(!isRegister)}>
                            {isRegister ? 'Sign In' : 'Sign Up'}
                        </button>
                    </p>
                </form>

                {/* Features */}
                <div className="features">
                    <div className="feature">
                        <div className="feature-icon"><Rocket size={22} /></div>
                        <span>10+ Languages</span>
                    </div>
                    <div className="feature">
                        <div className="feature-icon"><Shield size={22} /></div>
                        <span>Secure Execution</span>
                    </div>
                    <div className="feature">
                        <div className="feature-icon"><Zap size={22} /></div>
                        <span>Real-time Output</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

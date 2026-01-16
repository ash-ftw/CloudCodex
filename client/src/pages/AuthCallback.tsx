import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function AuthCallback() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setAuth } = useAuthStore();

    useEffect(() => {
        const token = searchParams.get('token');

        if (token) {
            // Decode token to get user info (basic decode for display, actual validation on server)
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                setAuth(
                    {
                        id: payload.sub,
                        email: payload.email,
                        username: payload.email?.split('@')[0] || 'user',
                        role: 'user'
                    },
                    token
                );
                navigate('/dashboard');
            } catch {
                navigate('/login?error=invalid_token');
            }
        } else {
            navigate('/login?error=no_token');
        }
    }, [searchParams, setAuth, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="animate-pulse text-center">
                <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto' }}></div>
                <p className="text-muted" style={{ marginTop: '1rem' }}>Authenticating...</p>
            </div>
        </div>
    );
}

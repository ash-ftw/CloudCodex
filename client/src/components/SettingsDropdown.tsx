import { useState, useEffect, useRef } from 'react';
import { Sun, Moon, Check } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';

export default function SettingsDropdown() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const { theme, setTheme } = useThemeStore();

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [open]);

    return (
        <div className="settings-dropdown-wrapper" ref={ref}>
            <button
                className="btn-icon"
                onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                title="Settings"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>

            {open && (
                <div className="settings-dropdown" onClick={(e) => e.stopPropagation()}>
                    <div className="dropdown-label">Theme</div>
                    <button
                        className={theme === 'dark' ? 'active' : ''}
                        onClick={() => setTheme('dark')}
                    >
                        <Moon size={16} />
                        Dark
                        <Check size={14} className="check-icon" />
                    </button>
                    <button
                        className={theme === 'light' ? 'active' : ''}
                        onClick={() => setTheme('light')}
                    >
                        <Sun size={16} />
                        Light
                        <Check size={14} className="check-icon" />
                    </button>
                </div>
            )}
        </div>
    );
}

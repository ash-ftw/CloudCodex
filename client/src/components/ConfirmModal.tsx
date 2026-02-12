import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react';
import '../styles/confirm-modal.css';

export type ModalVariant = 'confirm' | 'error' | 'success' | 'info';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    variant?: ModalVariant;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const variantIcons: Record<ModalVariant, typeof Info> = {
    confirm: AlertTriangle,
    error: XCircle,
    success: CheckCircle,
    info: Info,
};

export default function ConfirmModal({
    isOpen,
    title,
    message,
    variant = 'confirm',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    showCancel = true,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    const confirmRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isOpen) {
            confirmRef.current?.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const Icon = variantIcons[variant];

    return (
        <div className="confirm-modal-overlay" onClick={onCancel}>
            <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
                <button className="confirm-modal-close" onClick={onCancel}>
                    <X size={16} />
                </button>
                <div className={`confirm-modal-icon ${variant}`}>
                    <Icon size={24} />
                </div>
                <h3 className="confirm-modal-title">{title}</h3>
                <p className="confirm-modal-message">{message}</p>
                <div className="confirm-modal-actions">
                    {showCancel && (
                        <button className="confirm-modal-btn cancel" onClick={onCancel}>
                            {cancelLabel}
                        </button>
                    )}
                    <button
                        ref={confirmRef}
                        className={`confirm-modal-btn ${variant}`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}

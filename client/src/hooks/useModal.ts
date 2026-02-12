import { useState, useCallback, useRef } from 'react';
import type { ModalVariant } from '../components/ConfirmModal';

interface ModalState {
    isOpen: boolean;
    title: string;
    message: string;
    variant: ModalVariant;
    confirmLabel: string;
    cancelLabel: string;
    showCancel: boolean;
    onConfirm: () => void;
}

const defaults: ModalState = {
    isOpen: false,
    title: '',
    message: '',
    variant: 'confirm',
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
    showCancel: true,
    onConfirm: () => {},
};

interface ShowOptions {
    title: string;
    message: string;
    variant?: ModalVariant;
    confirmLabel?: string;
    cancelLabel?: string;
    showCancel?: boolean;
}

export function useModal() {
    const [state, setState] = useState<ModalState>(defaults);
    const cancelCallbackRef = useRef<(() => void) | null>(null);

    const showAlert = useCallback((message: string, variant: ModalVariant = 'error', title?: string) => {
        cancelCallbackRef.current = null;
        setState({
            isOpen: true,
            title: title ?? (variant === 'success' ? 'Success' : variant === 'error' ? 'Error' : 'Notice'),
            message,
            variant,
            confirmLabel: 'OK',
            cancelLabel: 'Cancel',
            showCancel: false,
            onConfirm: () => setState(s => ({ ...s, isOpen: false })),
        });
    }, []);

    const showConfirm = useCallback((options: ShowOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            cancelCallbackRef.current = () => {
                setState(s => ({ ...s, isOpen: false }));
                resolve(false);
            };
            setState({
                isOpen: true,
                title: options.title,
                message: options.message,
                variant: options.variant ?? 'confirm',
                confirmLabel: options.confirmLabel ?? 'Confirm',
                cancelLabel: options.cancelLabel ?? 'Cancel',
                showCancel: options.showCancel ?? true,
                onConfirm: () => {
                    cancelCallbackRef.current = null;
                    setState(s => ({ ...s, isOpen: false }));
                    resolve(true);
                },
            });
        });
    }, []);

    const closeModal = useCallback(() => {
        if (cancelCallbackRef.current) {
            cancelCallbackRef.current();
            cancelCallbackRef.current = null;
        } else {
            setState(s => ({ ...s, isOpen: false }));
        }
    }, []);

    return {
        modalState: state,
        showAlert,
        showConfirm,
        closeModal,
    };
}

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import './Toast.css';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

let _id = 0;
const TOAST_DURATION_MS = 3000;
const TOAST_GAP_MS = 250;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info') => {
    if (!message) return;
    const id = ++_id;
    setToasts((prev) => {
      // Stagger toasts so they don't all start fading at the same instant.
      const offset = prev.length * TOAST_GAP_MS;
      const t = { id, message, type, offset };
      return [...prev, t];
    });
  }, []);

  // Esc dismisses the most recent toast.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && toasts.length > 0) {
        dismiss(toasts[toasts.length - 1].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} dismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, dismiss }) {
  // Note: we depend on `toast.id` and `dismiss` (both stable) rather than
  // a per-render arrow function. Otherwise, every time another toast appears
  // or disappears, this timer would reset, and toasts would live longer than
  // their 3-second budget.
  useEffect(() => {
    const timer = setTimeout(
      () => dismiss(toast.id),
      TOAST_DURATION_MS + toast.offset
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.offset, dismiss]);

  return (
    <div
      className={`toast toast--${toast.type}`}
      onClick={() => dismiss(toast.id)}
      role="button"
      tabIndex={0}
    >
      {toast.message}
    </div>
  );
}

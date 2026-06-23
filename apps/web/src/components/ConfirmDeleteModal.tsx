import { useState } from 'react';
import { getApiErrorMessage } from '../lib/api';

export function ConfirmDeleteModal({
  title,
  message,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(getApiErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md">
        <div className="card p-4">
          <h2 className="font-medium text-slate-800">{title}</h2>
          <p className="mt-2 text-sm text-slate-500">{message}</p>
          {error && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button
              className="btn-danger border border-red-200"
              onClick={() => void handleConfirm()}
              disabled={pending}
            >
              {pending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

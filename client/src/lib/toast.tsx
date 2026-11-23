import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

type Toast = { id: number; kind: 'success' | 'error'; text: string };
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let seq = 0;

function push(kind: Toast['kind'], text: string) {
  const t = { id: ++seq, kind, text };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => dismiss(t.id), kind === 'error' ? 6000 : 3500);
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  listeners.forEach((l) => l(toasts));
}

export const toast = { success: (t: string) => push('success', t), error: (t: string) => push('error', t) };

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return (
    <div className="no-print fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} role="status" className={`flex min-w-[280px] max-w-[520px] items-start gap-2 rounded-md px-3 py-2 text-[13px] shadow-lg ${t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {t.kind === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

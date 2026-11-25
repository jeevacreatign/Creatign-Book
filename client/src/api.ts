import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { toast } from './lib/toast';

export class ApiError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

/** The session ended (signed out elsewhere, expired, or the account was turned off): back to sign-in. */
function signInAgain() {
  const here = window.location.pathname + window.location.search;
  if (!/^\/(signin|signup|forgot-password|reset-password|invite)/.test(window.location.pathname)) window.location.assign(`/signin?next=${encodeURIComponent(here)}`);
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    // X-CL-Request marks our own requests; the server refuses changes without it (no cross-site forms)
    headers: { 'X-CL-Request': '1', ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (res.status === 401 && !path.startsWith('/auth/')) signInAgain();
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

export function useApi<T>(path: string | null, opts?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, ...opts });
}

/** Mutation that refreshes every query on success and toasts errors. */
export function useAction<TVars = void, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, success?: string | ((r: TRes) => string | undefined)) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TVars>({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries();
      const msg = typeof success === 'function' ? success(r) : success;
      if (msg) toast.success(msg);
    },
    onError: (e) => toast.error(e.message),
  });
}

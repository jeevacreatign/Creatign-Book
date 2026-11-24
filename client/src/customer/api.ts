// API helper for customer-facing pages (portal and shared links).
// The custom header marks requests as coming from our own pages; the server
// rejects state-changing portal requests without it.
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

export class CustomerApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function capi<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'X-Portal-Request': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: { error?: string } | undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new CustomerApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data as T;
}

export function useCustomer<T>(path: string | null, opts?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({ queryKey: ['customer', path], queryFn: () => capi<T>(path!), enabled: !!path, retry: false, ...opts });
}

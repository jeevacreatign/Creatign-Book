// Link a Gmail account with OAuth in a popup (server: /api/mail/google/*).
import { toast } from '../../lib/toast';

export function linkGmail(settings: { googleOAuthConfigured: boolean; googleCallbackOrigin: string } | undefined, onDone: () => void) {
  if (!settings?.googleOAuthConfigured) {
    toast.error('Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to .env to link Gmail (see README).');
    return;
  }
  const nonce = crypto.randomUUID();
  const popup = window.open(`/api/mail/google/start?nonce=${encodeURIComponent(nonce)}`, 'gmail-oauth', 'popup,width=600,height=720');
  if (!popup) {
    toast.error('Allow popups for this app to link Gmail.');
    return;
  }
  const onMessage = (event: MessageEvent) => {
    const data = event.data as Record<string, unknown> | null;
    const allowedOrigins = [window.location.origin, settings.googleCallbackOrigin];
    if (event.source !== popup || !allowedOrigins.includes(event.origin) || !data || data.type !== 'gmail-oauth-result' || data.nonce !== nonce) return;
    window.removeEventListener('message', onMessage);
    window.clearInterval(closeCheck);
    if (data.ok === true && typeof data.email === 'string') {
      toast.success(`Gmail connected as ${data.email}`);
      onDone();
    } else toast.error(typeof data.error === 'string' ? data.error : 'Could not connect the Gmail account');
  };
  window.addEventListener('message', onMessage);
  const closeCheck = window.setInterval(() => {
    if (popup.closed) {
      window.clearInterval(closeCheck);
      window.removeEventListener('message', onMessage);
    }
  }, 500);
}

import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const variableNames = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI', 'APP_ORIGIN', 'GOOGLE_OAUTH_TOKEN_FILE'] as const;
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));
const tokenFile = path.join(tmpdir(), `creatign-ledger-google-mail-${process.pid}.json`);
process.env.GOOGLE_OAUTH_TOKEN_FILE = tokenFile;

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tokenFile, { force: true });
  for (const name of variableNames) {
    const value = originalValues.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Gmail OAuth', () => {
  it('requests only Gmail send permission and consumes state once', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/mail/google/callback';
    process.env.APP_ORIGIN = 'http://localhost:5173';
    const { consumeGoogleAuthorizationState, createGoogleAuthorizationUrl } = await import('../server/google-mail');

    const authorization = new URL(createGoogleAuthorizationUrl('nonce_0123456789'));
    expect(authorization.origin).toBe('https://accounts.google.com');
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:4000/api/mail/google/callback');
    expect(authorization.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(authorization.searchParams.get('scope')).not.toContain('gmail.readonly');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');

    const state = authorization.searchParams.get('state')!;
    expect(consumeGoogleAuthorizationState(state)?.nonce).toBe('nonce_0123456789');
    expect(consumeGoogleAuthorizationState(state)).toBeUndefined();
  });

  it('requires OAuth credentials before starting the link flow', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const { createGoogleAuthorizationUrl } = await import('../server/google-mail');
    expect(() => createGoogleAuthorizationUrl('nonce_0123456789')).toThrow('GOOGLE_OAUTH_CLIENT_ID');
  });

  it('escapes callback content before embedding it in the popup page', async () => {
    const { googleOAuthResultPage } = await import('../server/google-mail');
    const page = googleOAuthResultPage({ nonce: 'nonce_0123456789', ok: false, error: '</script><img src=x>' });
    expect(page).not.toContain('</script><img');
    expect(page).toContain('&lt;/script&gt;&lt;img');
  });

  it('encrypts the linked token and sends through the Gmail API', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/mail/google/callback';
    process.env.APP_ORIGIN = 'http://localhost:5173';
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'oauth-access', refresh_token: 'oauth-refresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ email: 'sender@example.com', email_verified: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { consumeGoogleAuthorizationState, createGoogleAuthorizationUrl, deliverWithGoogle, finishGoogleAuthorization } = await import('../server/google-mail');
    const authorization = new URL(createGoogleAuthorizationUrl('nonce_0123456789'));
    const pending = consumeGoogleAuthorizationState(authorization.searchParams.get('state') || undefined);
    expect(pending).toBeDefined();
    await expect(finishGoogleAuthorization('authorization-code', pending!.codeVerifier)).resolves.toBe('sender@example.com');

    const stored = fs.readFileSync(tokenFile, 'utf8');
    expect(stored).not.toContain('oauth-refresh');

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'send-access' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gmail-message-id' }), { status: 200 }));
    await deliverWithGoogle({
      fromName: 'Creatign',
      replyTo: 'reply@example.com',
      to: ['customer@example.com'],
      cc: [],
      subject: 'Quote attached',
      text: 'Please see the attached quote.',
      html: '<p>Please see the attached quote.</p>',
      attachments: [{ filename: 'quote.pdf', content: Buffer.from('%PDF-test') }],
    });

    const sendBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { raw: string };
    const raw = Buffer.from(sendBody.raw, 'base64url').toString('utf8');
    expect(raw).toContain('To: customer@example.com');
    expect(raw).toContain('Subject: Quote attached');
    expect(raw).toContain('quote.pdf');
  });
});

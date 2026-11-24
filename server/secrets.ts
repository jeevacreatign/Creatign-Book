// Encrypts secrets saved from the Settings screens (for example the SMTP password)
// so db.json never holds them in plain text. The key comes from APP_SECRET, or a
// random key generated once into server/data/app-secret.json (git-ignored).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db';

let cached: Buffer | undefined;

function key(): Buffer {
  if (cached) return cached;
  const fromEnv = process.env.APP_SECRET?.trim();
  if (fromEnv) return (cached = createHash('sha256').update(fromEnv).digest());
  const file = process.env.APP_SECRET_FILE?.trim() ? path.resolve(process.env.APP_SECRET_FILE) : path.join(DATA_DIR, 'app-secret.json');
  if (fs.existsSync(file)) {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { key?: string };
    if (stored.key) return (cached = Buffer.from(stored.key, 'base64'));
  }
  const k = randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ key: k.toString('base64') }), { mode: 0o600 });
  return (cached = k);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), out.toString('base64')].join('.');
}

export function decryptSecret(sealed: string | undefined): string | undefined {
  if (!sealed) return undefined;
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) return undefined;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/** sha256 of a random token: what the database stores for invite, reset and session tokens. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

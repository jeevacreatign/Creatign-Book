// Tiny JSON-file persistence layer. The whole dataset lives in memory and is
// written atomically to server/data/db.json after every mutation.
// Set DB_FILE=:memory: to run without touching disk (used by the test suite).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
import type { Database } from '../shared/types';
import { seedDatabase } from './seed';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(here, 'uploads');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'db.json');
const inMemory = DB_FILE === ':memory:';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
export const newId = (prefix: string) => `${prefix}_${nano()}`;
export const now = () => new Date().toISOString();

let db: Database;

function emptyDefaults(d: Partial<Database>): Database {
  const seed = seedDatabase({ withSamples: false });
  const out = { ...seed, ...d } as Database;
  // add system accounts introduced after this file was created (e.g. GST input/output accounts)
  const have = new Set(out.accounts.map((a) => a.id));
  for (const a of seed.accounts) if (a.system && !have.has(a.id)) out.accounts.push({ ...a });
  return out;
}

export function loadDb(): Database {
  if (!inMemory && fs.existsSync(DB_FILE)) {
    db = emptyDefaults(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } else {
    db = seedDatabase({ withSamples: process.env.SEED_SAMPLES !== 'false' });
    persist();
  }
  return db;
}

export function getDb(): Database {
  if (!db) loadDb();
  return db;
}

export function resetDb(withSamples = true): Database {
  db = seedDatabase({ withSamples });
  persist();
  return db;
}

export function persist() {
  if (inMemory) return;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/** Next number in a series, e.g. nextNumber('invoice', 'INV-') -> INV-00001 */
export function peekNumber(series: string, prefix: string, width = 5): string {
  const n = (getDb().counters[series] || 0) + 1;
  return `${prefix}${String(n).padStart(width, '0')}`;
}

export function takeNumber(series: string, prefix: string, used: string, width = 5) {
  // Advance the counter if the used number matches the auto series.
  const d = getDb();
  const m = used.startsWith(prefix) ? Number(used.slice(prefix.length)) : NaN;
  if (Number.isFinite(m) && m > (d.counters[series] || 0)) d.counters[series] = m;
  else if (used === peekNumber(series, prefix, width)) d.counters[series] = (d.counters[series] || 0) + 1;
}

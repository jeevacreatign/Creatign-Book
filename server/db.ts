// Storage. The books are kept in MongoDB (MONGODB_URI); see server/mongo.ts for collections.
// The app works on an in-memory copy loaded once by initDb(); every change is written back to
// MongoDB by persist() and the API waits for flushDb() before it answers.
// DB_FILE=:memory: runs without any database (used by the test suite).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
import type { Database } from '../shared/types';
import * as mongo from './mongo';
import { seedDatabase } from './seed';
import { normalizeCurrencies } from '../shared/currency';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(here, 'uploads');

/** 'memory' for tests and scripts that should not touch a database, otherwise 'mongodb'. */
export const storage = (): 'memory' | 'mongodb' => (process.env.DB_FILE === ':memory:' || (!process.env.MONGODB_URI && process.env.VITEST) ? 'memory' : 'mongodb');

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
  // manual journals moved to their own collection (drafts never reach the ledger)
  if (!d.manualJournals) {
    out.manualJournals = (out.journals || []).filter((j) => j.sourceType === 'manual').map((j) => ({ ...j, status: j.status ?? 'published', reportingMethod: j.reportingMethod ?? 'accrual_and_cash' }));
  }
  if (!out.transactionLocks?.modules) out.transactionLocks = { modules: {}, history: [] };
  normalizeCurrencies(out);
  return out;
}

let ready = false;

/** Connect to MongoDB, create indexes and load the books. Call once before serving. */
export async function initDb(): Promise<Database> {
  if (storage() === 'memory') return loadDb();
  const target = mongo.connectionSettings();
  if (!target) throw new Error('MONGODB_URI is not set. Point it at your MongoDB database (see README).');
  mongo.connect(target);
  await mongo.migrate();
  const raw = await mongo.loadAll();
  if (raw) {
    mongo.remember(raw);
    db = emptyDefaults(raw);
    mongo.save(db);
    await mongo.flush();
  } else {
    db = seedDatabase({ withSamples: process.env.SEED_SAMPLES !== 'false' });
    mongo.save(db, { full: true });
    await mongo.flush();
  }
  ready = true;
  return db;
}

/** In-memory books (tests). */
export function loadDb(): Database {
  db = seedDatabase({ withSamples: process.env.SEED_SAMPLES !== 'false' });
  ready = true;
  return db;
}

export function getDb(): Database {
  if (!ready) {
    if (storage() === 'memory') return loadDb();
    throw new Error('The database is not loaded yet: call initDb() first');
  }
  return db;
}

/** Replace the books. With keep, those collections survive (for example the people who sign in). */
export function resetDb(withSamples = true, keep: (keyof Database)[] = []): Database {
  const old = ready ? db : undefined;
  db = seedDatabase({ withSamples });
  if (old) for (const k of keep) (db as unknown as Record<string, unknown>)[k] = old[k];
  ready = true;
  persist();
  return db;
}

/** Load books from another source (JSON or legacy MySQL import) and write all of them to MongoDB. */
export function replaceDb(d: Partial<Database>): Database {
  db = emptyDefaults(d);
  ready = true;
  if (storage() === 'mongodb') mongo.save(db, { full: true });
  return db;
}

/** Queue the changes for MongoDB. */
export function persist() {
  if (storage() === 'memory' || !ready) return;
  mongo.save(db);
}

/** Wait until all changes are in MongoDB (throws if the write failed). */
export async function flushDb() {
  if (storage() === 'memory') return;
  await mongo.flush();
}

export async function closeDb() {
  if (storage() === 'mongodb') {
    await mongo.flush().catch(() => undefined);
    await mongo.close();
  }
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


// MongoDB storage. Each array in the in-memory books is stored as documents in its own collection.
// The app keeps one in-memory copy and waits for queued MongoDB writes before answering API calls.
import { MongoClient, type Collection, type Db } from 'mongodb';
import type { Database } from '../shared/types';

type Row = Record<string, unknown>;

const COLLECTIONS: (keyof Database)[] = [
  'accounts', 'items', 'contacts', 'docs', 'paymentsReceived', 'paymentsMade', 'expenses',
  'recurringExpenses', 'journals', 'manualJournals', 'journalTemplates', 'recurringJournals',
  'comments', 'activities', 'mails', 'shareLinks', 'emailTemplates', 'pdfTemplates', 'portalUsers',
  'portalSessions', 'paymentNotices', 'users', 'staffSessions', 'projects', 'timeEntries', 'timers',
  'budgets', 'currencies', 'currencyAdjustments', 'bankTransactions', 'statementLines',
  'statementImports', 'bankRules', 'reconciliations', 'documents', 'docFolders', 'savedReports',
  'reportSchedules', 'priceLists', 'inventoryAdjustments',
];

const SETTINGS: (keyof Database)[] = ['organization', 'counters', 'preferences', 'transactionLocks'];
const collectionName = (key: keyof Database) => String(key);
const idOf = (key: keyof Database, row: Row) => String(row[key === 'currencies' ? 'code' : 'id'] ?? '');

interface StoredDocument {
  [key: string]: unknown;
  _id: string;
  seq?: number;
  data?: string;
  updatedAt?: Date;
}

let client: MongoClient | undefined;
let database: Db | undefined;

export function connectionSettings(env = process.env): { uri: string } | undefined {
  const uri = env.MONGODB_URI?.trim();
  return uri ? { uri } : undefined;
}

export function connect(target: string | { uri: string }) {
  const uri = typeof target === 'string' ? target : target.uri;
  client = new MongoClient(uri, {
    appName: 'CreatignLedger',
    ...(process.env.MONGODB_DATABASE?.trim() ? { dbName: process.env.MONGODB_DATABASE.trim() } : {}),
  });
  database = client.db();
  return database;
}

function db(): Db {
  if (!database) throw new Error('MongoDB is not connected');
  return database;
}

function collection(name: string): Collection<StoredDocument> {
  return db().collection<StoredDocument>(name);
}

export async function close() {
  await client?.close();
  client = undefined;
  database = undefined;
}

export async function migrate() {
  for (const key of COLLECTIONS) await collection(collectionName(key)).createIndex({ seq: 1 });
  await collection('journal_lines').createIndex({ journal_id: 1 });
  await collection('journal_lines').createIndex({ account_id: 1, date: 1 });
  await collection('journal_lines').createIndex({ contact_id: 1 });
  await collection('journal_lines').createIndex({ date: 1 });
  await collection('schema_info').updateOne(
    { _id: 'current' },
    { $setOnInsert: { version: 1, createdAt: new Date() } },
    { upsert: true },
  );
}

/** Read the saved books. Returns undefined only when all app collections are empty. */
export async function loadAll(): Promise<Partial<Database> | undefined> {
  const out: Record<string, unknown> = {};
  let hasData = false;

  const settings = await collection('settings').find({}).toArray();
  for (const row of settings) {
    out[String(row._id)] = JSON.parse(String(row.data));
    hasData = true;
  }

  for (const key of COLLECTIONS) {
    const rows = await collection(collectionName(key)).find({}, { projection: { data: 1, _id: 0 } }).sort({ seq: 1 }).toArray();
    out[key] = rows.map((row) => JSON.parse(String(row.data)));
    if (rows.length) hasData = true;
  }

  return hasData ? out as Partial<Database> : undefined;
}

/** What MongoDB holds: each record's JSON and position. */
type Snapshot = Map<string, Map<string, string>>;
let snapshot: Snapshot = new Map();
let queue: Promise<void> = Promise.resolve();
let failure: Error | undefined;

interface JournalLine {
  _id: string;
  journal_id: string;
  line_no: number;
  date: string | null;
  account_id: string;
  contact_id: string | null;
  project_id: string | null;
  source_type: string | null;
  source_id: string | null;
  debit: number;
  credit: number;
  description: string | null;
}

function journalLines(data: Database): JournalLine[] {
  const out: JournalLine[] = [];
  for (const journal of data.journals) {
    journal.lines.forEach((line, index) => out.push({
      _id: `${journal.id}:${index}`,
      journal_id: journal.id,
      line_no: index,
      date: journal.date || null,
      account_id: line.accountId,
      contact_id: line.contactId ?? journal.contactId ?? null,
      project_id: journal.projectId ?? null,
      source_type: journal.sourceType ?? null,
      source_id: journal.sourceId ?? null,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      description: line.description ?? null,
    }));
  }
  return out;
}

interface PlannedCollection {
  key: keyof Database;
  upserts: { id: string; seq: number; row: Row; signature: string }[];
  deletes: string[];
}

interface Plan {
  settings: { key: keyof Database; value: unknown; signature: string }[];
  collections: PlannedCollection[];
  lines?: { upserts: JournalLine[]; deletes: string[] };
}

function plan(data: Database, full: boolean): Plan {
  const result: Plan = { settings: [], collections: [] };
  const settingsSnapshot = snapshot.get('settings') ?? new Map<string, string>();
  for (const key of SETTINGS) {
    const value = data[key];
    const signature = JSON.stringify(value ?? null);
    if (full || settingsSnapshot.get(String(key)) !== signature) result.settings.push({ key, value, signature });
    settingsSnapshot.set(String(key), signature);
  }
  snapshot.set('settings', settingsSnapshot);

  for (const key of COLLECTIONS) {
    const name = collectionName(key);
    const previous = snapshot.get(name) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const upserts: PlannedCollection['upserts'] = [];
    const rows = (data[key] as unknown as Row[]) ?? [];
    rows.forEach((row, seq) => {
      const id = idOf(key, row);
      if (!id || next.has(id)) return;
      const signature = `${seq}|${JSON.stringify(row)}`;
      next.set(id, signature);
      if (full || previous.get(id) !== signature) upserts.push({ id, seq, row, signature });
    });
    const deletes = [...previous.keys()].filter((id) => !next.has(id));
    snapshot.set(name, next);
    if (upserts.length || deletes.length || full) result.collections.push({ key, upserts, deletes });
  }

  const journalSnapshot = snapshot.get('journal_lines') ?? new Map<string, string>();
  const nextLines = new Map<string, string>();
  const lineUpserts: JournalLine[] = [];
  for (const line of journalLines(data)) {
    const signature = JSON.stringify(line);
    nextLines.set(line._id, signature);
    if (full || journalSnapshot.get(line._id) !== signature) lineUpserts.push(line);
  }
  const lineDeletes = [...journalSnapshot.keys()].filter((id) => !nextLines.has(id));
  snapshot.set('journal_lines', nextLines);
  if (lineUpserts.length || lineDeletes.length || full) result.lines = { upserts: lineUpserts, deletes: lineDeletes };

  return result;
}

const CHUNK = 200;
function chunks<T>(values: T[], size = CHUNK) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function writeCollection(name: string, collectionPlan: { upserts: { id: string; seq: number; row: Row }[]; deletes: string[] }, full: boolean) {
  const target = collection(name);
  if (full) await target.deleteMany({});
  else for (const ids of chunks(collectionPlan.deletes)) await target.deleteMany({ _id: { $in: ids } });

  for (const batch of chunks(collectionPlan.upserts)) {
    const operations = batch.map((item) => ({
      replaceOne: {
        filter: { _id: item.id },
        replacement: {
          ...(name === 'journal_lines' ? item.row : {}),
          _id: item.id,
          seq: item.seq,
          data: JSON.stringify(item.row),
          updatedAt: new Date(),
        },
        upsert: true,
      },
    }));
    if (operations.length) await target.bulkWrite(operations, { ordered: true });
  }
}

async function apply(p: Plan, full: boolean) {
  const settings = collection('settings');
  if (full) await settings.deleteMany({});
  for (const item of p.settings) {
    await settings.replaceOne(
      { _id: String(item.key) },
      { _id: String(item.key), data: JSON.stringify(item.value), updatedAt: new Date() },
      { upsert: true },
    );
  }
  for (const item of p.collections)
    await writeCollection(collectionName(item.key), item, full);

  if (p.lines) await writeCollection('journal_lines', {
    upserts: p.lines.upserts.map((line) => ({ id: line._id, seq: line.line_no, row: line as unknown as Row })),
    deletes: p.lines.deletes,
  }, full);
}

async function run(p: Plan, full: boolean) {
  if (!p.settings.length && !p.collections.length && !p.lines?.upserts.length && !p.lines?.deletes.length && !full) return;
  await apply(p, full);
}

/** Queue writes in order. A failure makes the next save rewrite all collections to recover. */
export function save(data: Database, opts: { full?: boolean } = {}) {
  const full = !!opts.full || !!failure;
  failure = undefined;
  const p = plan(data, full);
  queue = queue.then(() => run(p, full)).catch((error: Error) => {
    failure = error;
    console.error('[mongodb] write failed:', error.message);
  });
  return queue;
}

/** Wait for all writes queued so far. */
export async function flush() {
  await queue;
  if (failure) throw new Error(`Could not save to MongoDB: ${failure.message}`);
}

/** After a load, the in-memory state is the MongoDB snapshot. */
export function remember(data: Partial<Database>) {
  snapshot = new Map();
  plan(data as Database, false);
}


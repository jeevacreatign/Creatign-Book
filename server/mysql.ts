// MySQL storage. Every collection of the books has its own table: an id primary key, a few typed
// columns for querying and reporting (dates, amounts, contact and account ids, statuses), the row's
// position, and the full record as JSON. Journal lines are also written out to their own table so
// the ledger can be queried with plain SQL.
//
// The app still works on an in-memory copy that is loaded once at start-up. After each change the
// rows that differ from what MySQL holds are written in one transaction, and the API waits for that
// write before it answers. Run one app process per database.
import awsCaBundle from 'aws-ssl-profiles';
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';
import type { Database } from '../shared/types';

type Row = Record<string, unknown>;
type ColType = 'id' | 'str' | 'text' | 'date' | 'datetime' | 'money' | 'num' | 'bool';
interface Col {
  name: string;
  type: ColType;
  get: (r: Row) => unknown;
  index?: boolean;
}
interface TableDef {
  /** key in the Database object */
  key: keyof Database;
  table: string;
  /** field that identifies a row (default "id") */
  idField?: string;
  cols: Col[];
}

const f = (field: string) => (r: Row) => r[field];
const c = (name: string, type: ColType, field: string, index = false): Col => ({ name, type, get: f(field), index });
const date = (name: string, field: string) => c(name, 'date', field, true);
const contact = c('contact_id', 'id', 'contactId', true);
const created = c('created_at', 'datetime', 'createdAt');
const status = c('status', 'str', 'status', true);
const number = c('number', 'str', 'number', true);

export const TABLES: TableDef[] = [
  { key: 'accounts', table: 'accounts', cols: [c('code', 'str', 'code', true), c('name', 'text', 'name'), c('type', 'str', 'type', true), c('sub_type', 'str', 'subType'), c('parent_id', 'id', 'parentId', true), c('active', 'bool', 'active')] },
  { key: 'items', table: 'items', cols: [c('name', 'text', 'name'), c('type', 'str', 'type'), c('sku', 'str', 'sku'), c('hsn_sac', 'str', 'hsnSac'), c('selling_price', 'money', 'sellingPrice'), c('cost_price', 'money', 'costPrice'), status, created] },
  { key: 'contacts', table: 'contacts', cols: [c('kind', 'str', 'kind', true), c('display_name', 'text', 'displayName'), c('company_name', 'text', 'companyName'), c('email', 'str', 'email', true), c('gstin', 'str', 'gstin'), c('place_of_supply', 'str', 'placeOfSupply'), status, created] },
  { key: 'docs', table: 'transactions', cols: [c('kind', 'str', 'kind', true), number, contact, date('date', 'date'), date('due_date', 'dueDate'), status, c('project_id', 'id', 'projectId', true), c('sub_total', 'money', 'subTotal'), c('tax_total', 'money', 'taxTotal'), c('total', 'money', 'total'), c('balance', 'money', 'balance'), created] },
  { key: 'paymentsReceived', table: 'payments_received', cols: [number, contact, date('date', 'date'), c('amount', 'money', 'amount'), c('mode', 'str', 'mode'), c('deposit_to_account_id', 'id', 'depositToAccountId', true), c('unused_amount', 'money', 'unusedAmount'), status, created] },
  { key: 'paymentsMade', table: 'payments_made', cols: [number, c('type', 'str', 'type'), contact, date('date', 'date'), c('amount', 'money', 'amount'), c('mode', 'str', 'mode'), c('paid_through_account_id', 'id', 'paidThroughAccountId', true), c('unused_amount', 'money', 'unusedAmount'), status, created] },
  { key: 'expenses', table: 'expenses', cols: [date('date', 'date'), c('account_id', 'id', 'accountId', true), c('paid_through_account_id', 'id', 'paidThroughAccountId', true), c('vendor_id', 'id', 'vendorId', true), c('customer_id', 'id', 'customerId', true), c('project_id', 'id', 'projectId', true), c('amount', 'money', 'amount'), c('total', 'money', 'total'), status, created] },
  { key: 'recurringExpenses', table: 'recurring_expenses', cols: [c('profile_name', 'text', 'profileName'), c('next_date', 'date', 'nextDate'), status, created] },
  { key: 'journals', table: 'journals', cols: [number, date('date', 'date'), c('source_type', 'str', 'sourceType', true), c('source_id', 'id', 'sourceId', true), contact, c('project_id', 'id', 'projectId', true), created] },
  { key: 'manualJournals', table: 'manual_journals', cols: [number, date('date', 'date'), status, c('reporting_method', 'str', 'reportingMethod'), created] },
  { key: 'journalTemplates', table: 'journal_templates', cols: [c('name', 'text', 'name')] },
  { key: 'recurringJournals', table: 'recurring_journals', cols: [c('profile_name', 'text', 'profileName'), c('next_date', 'date', 'nextDate'), status] },
  { key: 'comments', table: 'comments', cols: [c('entity_type', 'str', 'entityType', true), c('entity_id', 'id', 'entityId', true), created] },
  { key: 'activities', table: 'activities', cols: [c('entity_type', 'str', 'entityType', true), c('entity_id', 'id', 'entityId', true), contact, c('at', 'datetime', 'at')] },
  { key: 'mails', table: 'mails', cols: [contact, c('entity_type', 'str', 'entityType', true), c('entity_id', 'id', 'entityId', true), c('subject', 'text', 'subject'), status, created] },
  { key: 'shareLinks', table: 'share_links', cols: [c('token', 'str', 'token', true), c('entity_type', 'str', 'entityType'), c('entity_id', 'id', 'entityId', true), c('expires_at', 'datetime', 'expiresAt'), created] },
  { key: 'emailTemplates', table: 'email_templates', cols: [c('kind', 'str', 'kind', true), c('name', 'text', 'name')] },
  { key: 'pdfTemplates', table: 'pdf_templates', cols: [c('name', 'text', 'name'), c('layout', 'str', 'layout')] },
  { key: 'portalUsers', table: 'portal_users', cols: [contact, c('email', 'str', 'email', true), status, created] },
  { key: 'portalSessions', table: 'portal_sessions', cols: [c('token_hash', 'str', 'tokenHash', true), c('user_id', 'id', 'userId', true), c('expires_at', 'datetime', 'expiresAt')] },
  { key: 'paymentNotices', table: 'payment_notices', cols: [contact, c('doc_id', 'id', 'docId', true), c('amount', 'money', 'amount'), status, created] },
  { key: 'users', table: 'users', cols: [c('name', 'text', 'name'), c('email', 'str', 'email', true), c('role', 'str', 'role'), status, created] },
  { key: 'staffSessions', table: 'staff_sessions', cols: [c('token_hash', 'str', 'tokenHash', true), c('user_id', 'id', 'userId', true), c('expires_at', 'datetime', 'expiresAt')] },
  { key: 'projects', table: 'projects', cols: [c('name', 'text', 'name'), c('code', 'str', 'code'), c('customer_id', 'id', 'customerId', true), c('billing_method', 'str', 'billingMethod'), status, created] },
  { key: 'timeEntries', table: 'time_entries', cols: [c('project_id', 'id', 'projectId', true), c('task_id', 'id', 'taskId'), c('user_id', 'id', 'userId', true), date('date', 'date'), c('hours', 'num', 'hours'), c('billable', 'bool', 'billable'), c('invoiced', 'bool', 'invoiced'), c('invoice_id', 'id', 'invoiceId', true), created] },
  { key: 'timers', table: 'timers', cols: [c('user_id', 'id', 'userId', true), c('project_id', 'id', 'projectId')] },
  { key: 'budgets', table: 'budgets', cols: [c('name', 'text', 'name'), c('fiscal_year_start', 'date', 'fiscalYearStart'), c('project_id', 'id', 'projectId', true)] },
  { key: 'currencies', table: 'currencies', idField: 'code', cols: [c('name', 'text', 'name'), c('symbol', 'str', 'symbol')] },
  { key: 'currencyAdjustments', table: 'currency_adjustments', cols: [date('date', 'date'), c('currency_code', 'str', 'currencyCode')] },
  { key: 'bankTransactions', table: 'bank_transactions', cols: [c('type', 'str', 'type', true), date('date', 'date'), c('account_id', 'id', 'accountId', true), c('offset_account_id', 'id', 'offsetAccountId', true), c('amount', 'money', 'amount'), contact, c('statement_line_id', 'id', 'statementLineId', true), created] },
  { key: 'statementLines', table: 'statement_lines', cols: [c('account_id', 'id', 'accountId', true), date('date', 'date'), c('description', 'text', 'description'), c('deposit', 'money', 'deposit'), c('withdrawal', 'money', 'withdrawal'), status, c('import_id', 'id', 'importId', true), created] },
  { key: 'statementImports', table: 'statement_imports', cols: [c('account_id', 'id', 'accountId', true), c('file_name', 'text', 'fileName'), created] },
  { key: 'bankRules', table: 'bank_rules', cols: [c('name', 'text', 'name'), c('active', 'bool', 'active')] },
  { key: 'reconciliations', table: 'reconciliations', cols: [c('account_id', 'id', 'accountId', true), c('start_date', 'date', 'startDate'), c('end_date', 'date', 'endDate'), status] },
  { key: 'documents', table: 'files', cols: [c('name', 'text', 'name'), c('inbox', 'str', 'inbox'), c('folder_id', 'id', 'folderId', true), c('size', 'num', 'size'), c('uploaded_at', 'datetime', 'uploadedAt'), c('trashed_at', 'datetime', 'trashedAt')] },
  { key: 'docFolders', table: 'file_folders', cols: [c('name', 'text', 'name')] },
  { key: 'savedReports', table: 'saved_reports', cols: [c('name', 'text', 'name'), c('report', 'str', 'report')] },
  { key: 'reportSchedules', table: 'report_schedules', cols: [c('name', 'text', 'name'), c('report', 'str', 'report')] },
];

/** Single objects (not lists) live in one key/value table. */
export const SETTINGS: (keyof Database)[] = ['organization', 'counters', 'preferences', 'transactionLocks'];

const SQL_TYPE: Record<ColType, string> = {
  id: 'VARCHAR(96)',
  str: 'VARCHAR(191)',
  text: 'VARCHAR(512)',
  date: 'DATE',
  datetime: 'DATETIME(3)',
  money: 'DECIMAL(18,2)',
  num: 'DECIMAL(18,4)',
  bool: 'TINYINT(1)',
};

function sqlValue(type: ColType, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  switch (type) {
    case 'date': {
      const s = String(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    }
    case 'datetime': {
      const d = new Date(String(v));
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 23).replace('T', ' ');
    }
    case 'money':
    case 'num': {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return v ? 1 : 0;
    case 'id':
      return String(v).slice(0, 96);
    case 'str':
      return String(v).slice(0, 191);
    case 'text':
      return String(v).slice(0, 512);
  }
}

// ------------------------------------------------------------------ connection and schema

let pool: Pool | undefined;

/**
 * TLS for the MySQL connection, from DATABASE_SSL:
 *   rds      verify the server with the Amazon RDS certificate authorities (use this on AWS RDS)
 *   true     verify with the system certificate authorities
 *   (unset)  no TLS, for a local server
 */
export function sslOption(mode = process.env.DATABASE_SSL?.trim().toLowerCase()) {
  if (!mode || mode === 'false' || mode === '0' || mode === 'off') return undefined;
  if (mode === 'rds' || mode === 'amazon rds') return { ca: awsCaBundle.ca, rejectUnauthorized: true };
  return { rejectUnauthorized: true };
}

/** DATABASE_URL, or DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME (used on AWS, where the password comes from Secrets Manager). */
export function connectionSettings(env = process.env): { uri: string } | { host: string; port: number; user: string; password: string; database: string } | undefined {
  if (env.DATABASE_URL?.trim()) return { uri: env.DATABASE_URL.trim() };
  if (env.DB_HOST?.trim() && env.DB_USER && env.DB_NAME)
    return { host: env.DB_HOST.trim(), port: Number(env.DB_PORT) || 3306, user: env.DB_USER, password: env.DB_PASSWORD ?? '', database: env.DB_NAME };
  return undefined;
}

export function connect(target: string | NonNullable<ReturnType<typeof connectionSettings>>) {
  const where = typeof target === 'string' ? { uri: target } : target;
  const ssl = sslOption();
  pool = mysql.createPool({ ...where, ...(ssl ? { ssl } : {}), connectionLimit: 5, charset: 'utf8mb4', dateStrings: true, supportBigNumbers: true, decimalNumbers: true, multipleStatements: false });
  return pool;
}

export async function close() {
  await pool?.end();
  pool = undefined;
}

function q(name: string) {
  return '`' + name.replace(/`/g, '') + '`';
}

/** Create any missing table or column. Safe to run on every start. */
export async function migrate() {
  const conn = await pool!.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS settings (\`key\` VARCHAR(64) NOT NULL PRIMARY KEY, data LONGTEXT NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_info (id TINYINT NOT NULL PRIMARY KEY, version INT NOT NULL, migrated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
    for (const t of TABLES) {
      const cols = t.cols.map((c) => `${q(c.name)} ${SQL_TYPE[c.type]} NULL`).join(', ');
      const idx = t.cols.filter((c) => c.index).map((c) => `KEY ${q(`ix_${c.name}`)} (${q(c.name)})`).join(', ');
      await conn.query(`CREATE TABLE IF NOT EXISTS ${q(t.table)} (id VARCHAR(96) NOT NULL PRIMARY KEY, seq INT NOT NULL, ${cols}, data LONGTEXT NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)${idx ? `, ${idx}` : ''}, KEY ix_seq (seq)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // columns added in later versions
      const [have] = await conn.query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t.table]);
      const names = new Set((have as { name: string }[]).map((r) => r.name));
      for (const c of t.cols) if (!names.has(c.name)) await conn.query(`ALTER TABLE ${q(t.table)} ADD COLUMN ${q(c.name)} ${SQL_TYPE[c.type]} NULL${c.index ? `, ADD KEY ${q(`ix_${c.name}`)} (${q(c.name)})` : ''}`);
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS journal_lines (id VARCHAR(128) NOT NULL PRIMARY KEY, journal_id VARCHAR(96) NOT NULL, line_no INT NOT NULL, date DATE NULL, account_id VARCHAR(96) NOT NULL, contact_id VARCHAR(96) NULL, project_id VARCHAR(96) NULL, source_type VARCHAR(64) NULL, source_id VARCHAR(96) NULL, debit DECIMAL(18,2) NOT NULL DEFAULT 0, credit DECIMAL(18,2) NOT NULL DEFAULT 0, description VARCHAR(512) NULL, KEY ix_journal (journal_id), KEY ix_account_date (account_id, date), KEY ix_contact (contact_id), KEY ix_date (date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await conn.query(`INSERT INTO schema_info (id, version) VALUES (1, 1) ON DUPLICATE KEY UPDATE version = VALUES(version)`);
  } finally {
    conn.release();
  }
}

// ------------------------------------------------------------------ load

/** Read the whole dataset. Returns undefined when the database has never been written. */
export async function loadAll(): Promise<Partial<Database> | undefined> {
  const [settings] = await pool!.query('SELECT `key`, data FROM settings');
  const s = settings as { key: string; data: string }[];
  if (!s.length) return undefined;
  const out: Record<string, unknown> = {};
  for (const r of s) out[r.key] = JSON.parse(r.data);
  for (const t of TABLES) {
    const [rows] = await pool!.query(`SELECT data FROM ${q(t.table)} ORDER BY seq`);
    out[t.key] = (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  return out as Partial<Database>;
}

// ------------------------------------------------------------------ write only what changed

/** What MySQL holds, by table and id: the row's JSON and position. */
type Snapshot = Map<string, Map<string, string>>;
let snapshot: Snapshot = new Map();
let queue: Promise<void> = Promise.resolve();
let failure: Error | undefined;

const idOf = (t: TableDef, r: Row) => String(r[t.idField ?? 'id'] ?? '');

interface JournalLineRow {
  id: string;
  journal_id: string;
  line_no: number;
  date: unknown;
  account_id: string;
  contact_id: unknown;
  project_id: unknown;
  source_type: unknown;
  source_id: unknown;
  debit: number;
  credit: number;
  description: unknown;
}

function journalLines(db: Database): JournalLineRow[] {
  const out: JournalLineRow[] = [];
  for (const j of db.journals)
    j.lines.forEach((l, i) =>
      out.push({
        id: `${j.id}:${i}`,
        journal_id: j.id,
        line_no: i,
        date: sqlValue('date', j.date),
        account_id: l.accountId,
        contact_id: sqlValue('id', l.contactId ?? j.contactId),
        project_id: sqlValue('id', j.projectId),
        source_type: sqlValue('str', j.sourceType),
        source_id: sqlValue('id', j.sourceId),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        description: sqlValue('text', l.description),
      }),
    );
  return out;
}

interface Plan {
  settings: { key: string; data: string }[];
  tables: { def: TableDef; upserts: { id: string; seq: number; row: Row; data: string }[]; deletes: string[] }[];
  lines?: { upserts: JournalLineRow[]; deletes: string[] };
}

/** Compare the in-memory books with the snapshot and list the writes. Updates the snapshot. */
function plan(db: Database, full: boolean): Plan {
  const p: Plan = { settings: [], tables: [] };
  const settingsSnap = snapshot.get('settings') ?? new Map<string, string>();
  for (const k of SETTINGS) {
    const data = JSON.stringify(db[k] ?? null);
    if (full || settingsSnap.get(k) !== data) p.settings.push({ key: k, data });
    settingsSnap.set(k, data);
  }
  snapshot.set('settings', settingsSnap);
  for (const def of TABLES) {
    const prev = snapshot.get(def.table) ?? new Map<string, string>();
    const next = new Map<string, string>();
    const upserts: Plan['tables'][number]['upserts'] = [];
    const rows = (db[def.key] as unknown as Row[]) ?? [];
    rows.forEach((row, seq) => {
      const id = idOf(def, row);
      if (!id || next.has(id)) return; // rows without an id, or duplicates, can't be stored
      const data = JSON.stringify(row);
      const sig = `${seq}|${data}`;
      next.set(id, sig);
      if (full || prev.get(id) !== sig) upserts.push({ id, seq, row, data });
    });
    const deletes = [...prev.keys()].filter((id) => !next.has(id));
    snapshot.set(def.table, next);
    if (upserts.length || deletes.length || full) p.tables.push({ def, upserts, deletes });
  }
  // journal lines follow the journals table
  const jl = p.tables.find((t) => t.def.key === 'journals');
  if (jl || full) {
    const prev = snapshot.get('journal_lines') ?? new Map<string, string>();
    const next = new Map<string, string>();
    const upserts: JournalLineRow[] = [];
    for (const l of journalLines(db)) {
      const sig = JSON.stringify(l);
      next.set(l.id, sig);
      if (full || prev.get(l.id) !== sig) upserts.push(l);
    }
    snapshot.set('journal_lines', next);
    p.lines = { upserts, deletes: [...prev.keys()].filter((id) => !next.has(id)) };
  }
  return p;
}

const CHUNK = 200;
function chunks<T>(xs: T[], n = CHUNK) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function apply(conn: PoolConnection, p: Plan, full: boolean) {
  for (const s of p.settings) await conn.query('INSERT INTO settings (`key`, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)', [s.key, s.data]);
  for (const t of p.tables) {
    const { def } = t;
    if (full) await conn.query(`DELETE FROM ${q(def.table)}`);
    else for (const ids of chunks(t.deletes)) await conn.query(`DELETE FROM ${q(def.table)} WHERE id IN (?)`, [ids]);
    const names = ['id', 'seq', ...def.cols.map((c) => c.name), 'data'];
    const update = names.filter((n) => n !== 'id').map((n) => `${q(n)} = VALUES(${q(n)})`).join(', ');
    for (const batch of chunks(t.upserts)) {
      const values = batch.map((u) => [u.id, u.seq, ...def.cols.map((c) => sqlValue(c.type, c.get(u.row))), u.data]);
      await conn.query(`INSERT INTO ${q(def.table)} (${names.map(q).join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${update}`, [values]);
    }
  }
  if (p.lines) {
    if (full) await conn.query('DELETE FROM journal_lines');
    else for (const ids of chunks(p.lines.deletes)) await conn.query('DELETE FROM journal_lines WHERE id IN (?)', [ids]);
    const names = ['id', 'journal_id', 'line_no', 'date', 'account_id', 'contact_id', 'project_id', 'source_type', 'source_id', 'debit', 'credit', 'description'] as const;
    const update = names.filter((n) => n !== 'id').map((n) => `${q(n)} = VALUES(${q(n)})`).join(', ');
    for (const batch of chunks(p.lines.upserts)) await conn.query(`INSERT INTO journal_lines (${names.map(q).join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${update}`, [batch.map((l) => names.map((n) => l[n]))]);
  }
}

async function run(p: Plan, full: boolean) {
  if (!p.settings.length && !p.tables.length && !p.lines?.upserts.length && !p.lines?.deletes.length && !full) return;
  const conn = await pool!.getConnection();
  try {
    await conn.beginTransaction();
    await apply(conn, p, full);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Queue the writes for the current state. Writes run one after another in the order they were
 * queued. If one fails, the next save rewrites everything so MySQL catches up.
 */
export function save(db: Database, opts: { full?: boolean } = {}) {
  const full = !!opts.full || !!failure;
  failure = undefined;
  const p = plan(db, full);
  queue = queue.then(() => run(p, full)).catch((e: Error) => {
    failure = e;
    console.error('[mysql] write failed:', e.message);
  });
  return queue;
}

/** Wait until everything queued so far is in MySQL. Throws when the last write failed. */
export async function flush() {
  await queue;
  if (failure) throw new Error(`Could not save to MySQL: ${failure.message}`);
}

/** After a load: what was read is what MySQL holds. */
export function remember(db: Database) {
  snapshot = new Map();
  plan(db, false);
}

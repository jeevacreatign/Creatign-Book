// Setup for `npm run test:mysql`: runs every API test file against a real MySQL database instead of
// the in-memory store, then checks that what MySQL holds matches the books in memory exactly and
// that the journal_lines table balances. TEST_DATABASE_URL must point at an EMPTY throwaway
// database: every table in it is dropped before each test file.
import { afterAll, beforeAll, expect } from 'vitest';
import mysql from 'mysql2/promise';

const URL = process.env.DATABASE_URL!;

beforeAll(async () => {
  const sql = await mysql.createConnection({ uri: URL });
  const [tables] = await sql.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  for (const { t } of tables as { t: string }[]) await sql.query(`DROP TABLE \`${t}\``);
  await sql.end();
  const { initDb } = await import('../../server/db');
  await initDb();
});

afterAll(async () => {
  const { closeDb, flushDb, getDb, storage } = await import('../../server/db');
  const my = await import('../../server/mysql');
  expect(storage()).toBe('mysql');
  await flushDb();
  const stored = (await my.loadAll()) as Record<string, unknown>;
  const live = JSON.parse(JSON.stringify(getDb())) as Record<string, unknown> & { journals: { lines: unknown[] }[] };
  const differs = [...my.TABLES.map((t) => t.key), ...my.SETTINGS].filter((k) => JSON.stringify(live[k] ?? null) !== JSON.stringify(stored[k] ?? null));
  const sql = await mysql.createConnection({ uri: URL, decimalNumbers: true });
  const [[lines]] = (await sql.query('SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(debit), 0), 2) AS d, ROUND(COALESCE(SUM(credit), 0), 2) AS c FROM journal_lines')) as unknown as [{ n: number; d: number; c: number }[]];
  await sql.end();
  await closeDb();
  expect(differs).toEqual([]);
  expect(lines.n).toBe(live.journals.reduce((a, j) => a + j.lines.length, 0));
  expect(lines.d).toBe(lines.c);
});

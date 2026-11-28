// Copy the existing MySQL books into MongoDB without modifying the MySQL source.
// Set SOURCE_MYSQL_URL (or keep the old DATABASE_URL) and MONGODB_URI before running.
import 'dotenv/config';
import type { Database } from '../shared/types';
import { closeDb, flushDb, getDb, initDb, replaceDb } from './db';
import * as mongo from './mongo';
import * as mysql from './mysql';

const sourceUri = process.env.SOURCE_MYSQL_URL?.trim() || process.env.DATABASE_URL?.trim();
const target = mongo.connectionSettings();
const force = process.argv.includes('--force');

if (!sourceUri) throw new Error('Set SOURCE_MYSQL_URL to the existing MySQL connection string.');
if (!target) throw new Error('Set MONGODB_URI to the destination MongoDB connection string.');

let sourceData: Partial<Database> | undefined;
try {
  mysql.connect(sourceUri);
  sourceData = await mysql.loadAll();
} finally {
  await mysql.close();
}

if (!sourceData) throw new Error('The MySQL source has no saved books to migrate.');

let existing: Partial<Database> | undefined;
try {
  mongo.connect(target);
  await mongo.migrate();
  existing = await mongo.loadAll();
} finally {
  await mongo.close();
}

if (existing && !force) throw new Error('The MongoDB target already contains books. Use --force only if you intend to replace its data.');

await initDb();
try {
  const imported = replaceDb(sourceData);
  await flushDb();
  const saved = await mongo.loadAll();
  if (!saved) throw new Error('Migration finished but MongoDB has no saved books.');
  for (const key of Object.keys(imported) as (keyof Database)[]) {
    if (JSON.stringify(imported[key]) !== JSON.stringify(saved[key]))
      throw new Error(`MongoDB verification failed for ${String(key)}; keep the MySQL source unchanged and inspect the target.`);
  }
  const counts = ['accounts', 'contacts', 'items', 'docs', 'paymentsReceived', 'paymentsMade', 'expenses', 'journals', 'users'] as const;
  console.log('Copied existing MySQL books to MongoDB (the MySQL source was not changed):');
  for (const key of counts) console.log(`  ${key.padEnd(18)} ${getDb()[key].length}`);
} finally {
  await closeDb();
}

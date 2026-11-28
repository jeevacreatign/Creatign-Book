// npm run db:import -- [path/to/db.json | https://link/to/db.json] [--force]
// Copies books from a JSON backup into the MongoDB database in MONGODB_URI.
// An https link (for example an S3 pre-signed URL) lets a one-off task import a file it cannot see.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../shared/types';
import { DATA_DIR, closeDb, flushDb, getDb, initDb, replaceDb } from './db';
import { recompute } from './engine';
import * as mongo from './mongo';

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--')) ?? path.join(DATA_DIR, 'db.json');
const remote = /^https:\/\//i.test(source);
const file = remote ? new URL(source).origin + new URL(source).pathname : path.resolve(source);
const force = args.includes('--force');

let text: string;
if (remote) {
  const r = await fetch(source);
  if (!r.ok) {
    console.error(`Could not download ${file}: HTTP ${r.status}`);
    process.exit(1);
  }
  text = await r.text();
} else {
  if (!fs.existsSync(file)) {
    console.error(`No JSON file at ${file}`);
    process.exit(1);
  }
  text = fs.readFileSync(file, 'utf8');
}
const data = JSON.parse(text);
const target = mongo.connectionSettings();
if (!target) throw new Error('Set MONGODB_URI to your MongoDB database first (see README).');

let existing: Partial<Database> | undefined;
try {
  mongo.connect(target);
  await mongo.migrate();
  existing = await mongo.loadAll();
} finally {
  await mongo.close();
}
if (existing && !force) throw new Error('The MongoDB database already has books in it. Run again with --force only if you intend to replace them with the JSON file.');

await initDb();
try {
  const db = replaceDb(data);
  recompute(db);
  await flushDb();
  const counts = ['accounts', 'contacts', 'items', 'docs', 'paymentsReceived', 'paymentsMade', 'expenses', 'journals', 'users'] as const;
  console.log(`Imported ${file} into MongoDB:`);
  for (const k of counts) console.log(`  ${k.padEnd(18)} ${getDb()[k].length}`);
} finally {
  await closeDb();
}

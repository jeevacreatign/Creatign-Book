// npm run db:import -- [path/to/db.json | https://link/to/db.json] [--force]
// Moves books kept in the old JSON file (server/data/db.json) into the MySQL database in DATABASE_URL.
// An https link (for example an S3 pre-signed URL) lets a one-off task on AWS import a file it cannot see.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, closeDb, flushDb, getDb, initDb, replaceDb } from './db';
import { recompute } from './engine';
import * as my from './mysql';

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
const target = my.connectionSettings();
if (!target) {
  console.error('Set DATABASE_URL to your MySQL database first (see README).');
  process.exit(1);
}

my.connect(target);
await my.migrate();
const existing = await my.loadAll();
await my.close();
if (existing && !force) {
  console.error('The MySQL database already has books in it. Run again with --force to replace them with the JSON file.');
  process.exit(1);
}

await initDb();
const db = replaceDb(data);
recompute(db);
await flushDb();
const counts = ['accounts', 'contacts', 'items', 'docs', 'paymentsReceived', 'paymentsMade', 'expenses', 'journals', 'users'] as const;
console.log(`Imported ${file} into MySQL:`);
for (const k of counts) console.log(`  ${k.padEnd(18)} ${getDb()[k].length}`);
await closeDb();

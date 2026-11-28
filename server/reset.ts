// npm run reset-data [-- --empty]: replace everything in the MongoDB database with fresh sample books.
import 'dotenv/config';
import { closeDb, initDb, persist, resetDb } from './db';
import { recompute } from './engine';

const samples = !process.argv.includes('--empty');
await initDb();
recompute(resetDb(samples));
persist();
await closeDb();
console.log(`Data reset${samples ? ' with sample items, clients and suppliers' : ' (empty)'}.`);

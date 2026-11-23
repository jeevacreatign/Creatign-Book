import { resetDb } from './db';
import { recompute } from './engine';
import { persist } from './db';

const samples = !process.argv.includes('--empty');
const db = resetDb(samples);
recompute(db);
persist();
console.log(`Data reset${samples ? ' with sample items, customers and vendors' : ' (empty)'}.`);

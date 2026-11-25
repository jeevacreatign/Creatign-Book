import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, createApp } from './app';
import { closeDb, initDb } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

await initDb();
boot();
const app = createApp();

// In production, serve the built React app from /dist
const dist = path.join(here, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(PORT, () => {
  console.log(`Creatign Ledger API listening on http://localhost:${PORT}`);
});

// finish pending MySQL writes before exiting
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.once(sig, () => {
    server.close();
    closeDb().finally(() => process.exit(0));
  });

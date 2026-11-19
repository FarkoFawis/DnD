import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './store.ts';

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/dnd.sqlite', import.meta.url));
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));

const uploadsDir = process.env.UPLOADS_DIR ?? fileURLToPath(new URL('../data/uploads', import.meta.url));
const contentDir = process.env.CONTENT_DIR ?? fileURLToPath(new URL('../data/content', import.meta.url));
// On a fresh disk (a new host) the folders are not there yet; content packs get uploaded into theirs by hand.
for (const dir of [uploadsDir, contentDir]) mkdirSync(dir, { recursive: true });

const store = new Store(dbPath);
const { httpServer, io } = createApp({
  store,
  // Served when it has been built (npm run build); in dev, Vite serves the app on :5173.
  clientDist,
  corsOrigin: process.env.CORS_ORIGIN?.split(','),
  uploadsDir,
  contentDir,
  // Online: the code friends need once, when they choose their password (see docs/hosting.md).
  inviteCode: process.env.INVITE_CODE?.trim() || undefined,
});

httpServer.listen(port, () => {
  console.log(`DnD server listening on http://localhost:${port} (db: ${dbPath})`);
});

const shutdown = () => {
  void io.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

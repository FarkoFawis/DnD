import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './store.ts';

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/dnd.sqlite', import.meta.url));
const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));

const store = new Store(dbPath);
const { httpServer, io } = createApp({
  store,
  clientDist: process.env.NODE_ENV === 'production' ? clientDist : undefined,
  corsOrigin: process.env.CORS_ORIGIN?.split(','),
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

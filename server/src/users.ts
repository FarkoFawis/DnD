/**
 * Manage the pre-made accounts.
 *
 *   npm run users -- list
 *   npm run users -- add faris mira jonas
 *   npm run users -- reset-password mira   (they choose a new one at next login)
 *   npm run users -- remove jonas
 */
import { fileURLToPath } from 'node:url';
import { LIMITS } from '@dnd/shared';
import { Store } from './store.ts';

const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/dnd.sqlite', import.meta.url));
const store = new Store(dbPath);
const [command, ...names] = process.argv.slice(2);

try {
  switch (command) {
    case 'list': {
      const users = store.listUsers();
      if (users.length === 0) console.log('No accounts yet. Add some with: npm run users -- add <name> ...');
      for (const u of users) console.log(`${u.username}${u.hasPassword ? '' : '  (no password yet)'}`);
      break;
    }
    case 'add':
      for (const name of names) {
        if (!/^[\p{L}\p{N}_.-]+$/u.test(name) || name.length > LIMITS.usernameMaxLength) {
          console.error(`Skipping "${name}": use letters, numbers, _ . - (max ${LIMITS.usernameMaxLength}).`);
          continue;
        }
        try {
          store.addUser(name);
          console.log(`Added ${name}. They choose their password on first login.`);
        } catch {
          console.error(`Skipping "${name}": already exists.`);
        }
      }
      break;
    case 'reset-password':
      for (const name of names) {
        console.log(store.resetPassword(name) ? `Reset ${name}.` : `No account "${name}".`);
      }
      break;
    case 'remove':
      for (const name of names) {
        console.log(store.removeUser(name) ? `Removed ${name}.` : `No account "${name}".`);
      }
      break;
    default:
      console.log('Usage: npm run users -- list | add <names...> | reset-password <names...> | remove <names...>');
      process.exitCode = command ? 1 : 0;
  }
} finally {
  store.close();
}

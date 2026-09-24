// Vitest setup. Pure model tests run in node; store/io tests run in jsdom
// (see vite.config.ts environmentMatchGlobs) and get a fake IndexedDB.
import 'fake-indexeddb/auto';

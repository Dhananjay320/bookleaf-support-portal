import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db;

/** Opens (or returns) the shared SQLite connection and applies the schema. */
export function getDb() {
  if (db) return db;
  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

/** Runs fn inside a transaction; rolls back if it throws. */
export function transaction(fn) {
  const conn = getDb();
  conn.exec('BEGIN');
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

export function closeDb() {
  db?.close();
  db = undefined;
}

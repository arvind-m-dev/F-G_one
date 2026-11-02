/** Loads apps/api/.env (if present) before any module reads process.env. Real env vars always win. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(__dirname, '..', process.env.NODE_ENV === 'test' ? '.env.test' : '.env');
if (existsSync(file)) {
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}

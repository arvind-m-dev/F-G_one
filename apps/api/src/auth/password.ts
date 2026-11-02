import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended parameters (m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain: string) => hash(plain, OPTS);
export async function verifyPassword(hashed: string, plain: string) {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
/** Real hash of a random value; verifying against it equalises timing for unknown accounts. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hash(Math.random().toString(36), OPTS));

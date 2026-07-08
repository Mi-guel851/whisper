import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const ALGORITHM = "pbkdf2_sha256";
const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export async function hashRecoveryPhrase(phrase: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await pbkdf2Async(
    phrase,
    salt,
    ITERATIONS,
    KEY_LENGTH,
    DIGEST
  );

  return `${ALGORITHM}$${ITERATIONS}$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyRecoveryPhrase(phrase: string, storedHash: string) {
  const [algorithm, iterationsValue, salt, hash] = storedHash.split("$");

  if (algorithm !== ALGORITHM || !iterationsValue || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsValue);

  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = await pbkdf2Async(phrase, salt, iterations, expected.length, DIGEST);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

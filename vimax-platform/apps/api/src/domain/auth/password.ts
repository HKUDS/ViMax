import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const LEGACY_PASSWORD_PREFIX = "vimax:";
const PASSWORD_VERSION = "scrypt";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;

const scryptAsync = promisify(scrypt);

function hashLegacyPassword(password: string): string {
  return createHash("sha256")
    .update(`${LEGACY_PASSWORD_PREFIX}${password}`)
    .digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES).toString("hex");
  const derivedKey = (await scryptAsync(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
  )) as Buffer;

  return `${PASSWORD_VERSION}:${salt}:${derivedKey.toString("hex")}`;
}

export function needsPasswordRehash(storedHash: string): boolean {
  return !storedHash.startsWith(`${PASSWORD_VERSION}:`);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (needsPasswordRehash(storedHash)) {
    return hashLegacyPassword(password) === storedHash;
  }

  const [version, salt, expectedHash] = storedHash.split(":");
  if (
    version !== PASSWORD_VERSION ||
    !salt ||
    !expectedHash
  ) {
    return false;
  }

  const derivedKey = (await scryptAsync(
    password,
    salt,
    SCRYPT_KEY_LENGTH,
  )) as Buffer;
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedBuffer);
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from "./password.js";

test("hashPassword stores scrypt metadata and verifies the original password", async () => {
  const storedHash = await hashPassword("correct horse battery staple");

  assert.match(storedHash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
  assert.equal(
    await verifyPassword("correct horse battery staple", storedHash),
    true,
  );
  assert.equal(await verifyPassword("wrong password", storedHash), false);
  assert.equal(needsPasswordRehash(storedHash), false);
});

test("legacy sha256 hashes still verify and are marked for upgrade", async () => {
  const legacyHash = createHash("sha256")
    .update("vimax:legacy-password")
    .digest("hex");

  assert.equal(await verifyPassword("legacy-password", legacyHash), true);
  assert.equal(await verifyPassword("other-password", legacyHash), false);
  assert.equal(needsPasswordRehash(legacyHash), true);
});

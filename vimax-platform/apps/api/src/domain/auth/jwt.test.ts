import assert from "node:assert/strict";
import test from "node:test";
import {
  createAccessToken,
  getJwtSecret,
  verifyAccessToken,
} from "./jwt.js";

test("getJwtSecret throws when JWT_SECRET is unset", () => {
  const originalSecret = process.env.JWT_SECRET;

  delete process.env.JWT_SECRET;

  try {
    assert.throws(() => getJwtSecret(), /JWT_SECRET/);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("access tokens round-trip when JWT_SECRET is configured", () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret-for-jwt-roundtrip";

  try {
    const token = createAccessToken("user-123", "user@example.com");
    const payload = verifyAccessToken(token);

    assert.deepEqual(payload?.sub, "user-123");
    assert.deepEqual(payload?.email, "user@example.com");
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

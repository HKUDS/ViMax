import { eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { users, sessions, type User } from "../../infrastructure/db/schema.js";
import {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  hashToken,
  REFRESH_EXPIRY_MS,
} from "./jwt.js";
import {
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from "./password.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: Pick<User, "id" | "email" | "name" | "avatarUrl">;
  tokens: AuthTokens;
}

export async function registerUser(
  email: string,
  password: string,
  name: string,
): Promise<AuthResult> {
  const db = getDb();

  // Check existing
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new Error("Email already registered");
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, name, passwordHash }).returning();

  const tokens = await createSession(user.id);
  return { user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }, tokens };
}

export async function loginUser(email: string, password: string): Promise<AuthResult> {
  const db = getDb();

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (rows.length === 0) {
    throw new Error("Invalid email or password");
  }

  const user = rows[0];
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Invalid email or password");
  }

  if (needsPasswordRehash(user.passwordHash)) {
    const upgradedHash = await hashPassword(password);
    await db
      .update(users)
      .set({ passwordHash: upgradedHash })
      .where(eq(users.id, user.id));
  }

  const tokens = await createSession(user.id);
  return { user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl }, tokens };
}

async function createSession(userId: string): Promise<AuthTokens> {
  const db = getDb();
  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_MS);

  const user = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (user.length === 0) throw new Error("User not found");

  await db.insert(sessions).values({
    userId,
    refreshTokenHash,
    expiresAt,
  });

  const accessToken = createAccessToken(userId, user[0].email);
  return { accessToken, refreshToken };
}

export async function refreshSession(refreshToken: string): Promise<AuthTokens> {
  const db = getDb();
  const tokenHash = hashToken(refreshToken);

  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, tokenHash))
    .limit(1);

  if (rows.length === 0) throw new Error("Invalid refresh token");

  const session = rows[0];
  if (new Date() > session.expiresAt) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    throw new Error("Refresh token expired");
  }

  // Delete old session, create new (rotation)
  await db.delete(sessions).where(eq(sessions.id, session.id));
  return createSession(session.userId);
}

export async function logoutSession(refreshToken: string): Promise<void> {
  const db = getDb();
  const tokenHash = hashToken(refreshToken);
  await db.delete(sessions).where(eq(sessions.refreshTokenHash, tokenHash));
}

export async function getUserFromToken(accessToken: string): Promise<Pick<User, "id" | "email" | "name" | "avatarUrl"> | null> {
  const payload = verifyAccessToken(accessToken);
  if (!payload) return null;

  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
  if (rows.length === 0) return null;

  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, avatarUrl: rows[0].avatarUrl };
}

export { verifyAccessToken };

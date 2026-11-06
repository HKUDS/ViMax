import { createHmac, randomBytes } from "node:crypto";

const ACCESS_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface JwtPayload {
  sub: string; // user id
  email: string;
  exp: number;
  iat: number;
}

function base64UrlEncode(obj: object): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64url");
}

function base64UrlDecode(str: string): string {
  return Buffer.from(str, "base64url").toString("utf-8");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  return secret;
}

export function createAccessToken(userId: string, email: string): string {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: userId,
    email,
    exp: now + Math.floor(ACCESS_EXPIRY_MS / 1000),
    iat: now,
  };

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signature = sign(`${encodedHeader}.${encodedPayload}`, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSig = sign(`${encodedHeader}.${encodedPayload}`, secret);

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;

    if (Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHmac("sha256", getJwtSecret()).update(token).digest("hex");
}

export { ACCESS_EXPIRY_MS, REFRESH_EXPIRY_MS };

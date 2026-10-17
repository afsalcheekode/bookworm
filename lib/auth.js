import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { db } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password, storedHash, salt) {
  const computedHash = scryptSync(password, salt, 64).toString('hex');
  const bufA = Buffer.from(computedHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId) {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = Date.now() + SESSION_TTL_MS;

  const stmt = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  await stmt.run(tokenHash, userId, expiresAt);

  return { token: rawToken, expiresAt };
}

export async function getSessionUser(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;

  const tokenHash = hashToken(rawToken);
  const now = Date.now();

  const session = await db.prepare(`
    SELECT s.user_id, s.expires_at, u.id, u.username, u.email, u.name, u.handle, u.bio, u.avatar
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, now);

  if (!session) {
    // Clean up expired session if exists
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return {
    id: session.id,
    username: session.username,
    email: session.email,
    name: session.name,
    handle: session.handle,
    bio: session.bio,
    avatar: session.avatar
  };
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export async function purgeExpiredSessions() {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

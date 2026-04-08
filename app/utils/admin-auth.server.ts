import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../db.server";

const COOKIE_NAME = "admin_session";
// Use a random secret per deploy, or a stable one from env (non-sensitive, just for signing cookies)
const SESSION_SECRET = process.env.SESSION_SECRET || "upsellhive-admin-session-secret-2026";

const DEFAULT_PASSWORD = "Admin@e07a595";

// --- Password management (DB-backed) ---

export async function getAdminConfig() {
  return db.adminConfig.findUnique({ where: { id: "admin_config" } });
}

export async function ensureAdminPassword(): Promise<void> {
  const config = await getAdminConfig();
  if (!config) {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
    await db.adminConfig.create({
      data: { id: "admin_config", password: DEFAULT_PASSWORD, passwordHash: hash },
    });
  }
}

export async function verifyPassword(password: string): Promise<boolean> {
  const config = await getAdminConfig();
  if (!config) {
    // Fallback if DB not seeded yet
    return password === DEFAULT_PASSWORD;
  }
  return bcrypt.compare(password, config.passwordHash);
}

export async function updatePassword(newPassword: string): Promise<void> {
  const hash = await bcrypt.hash(newPassword, 12);
  await db.adminConfig.upsert({
    where: { id: "admin_config" },
    update: { password: newPassword, passwordHash: hash },
    create: { id: "admin_config", password: newPassword, passwordHash: hash },
  });
}

export async function getPlainPassword(): Promise<string> {
  const config = await getAdminConfig();
  return config?.password || DEFAULT_PASSWORD;
}

// --- Session cookie ---

function signToken(data: string): string {
  const hmac = crypto.createHmac("sha256", SESSION_SECRET);
  hmac.update(data);
  return hmac.digest("hex");
}

function makeSessionToken(): string {
  const payload = `admin:${Date.now()}`;
  const sig = signToken(payload);
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): boolean {
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return false;
  const payload = token.substring(0, lastDot);
  const sig = token.substring(lastDot + 1);

  if (signToken(payload) !== sig) return false;

  // Check expiry (7 days)
  const parts = payload.split(":");
  const ts = parseInt(parts[1] || "0", 10);
  return Date.now() - ts < 7 * 24 * 60 * 60 * 1000;
}

export function isAdminAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  return verifySessionToken(decodeURIComponent(match[1]));
}

export function createAdminSessionCookie(): string {
  const token = makeSessionToken();
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`;
}

export function clearAdminSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

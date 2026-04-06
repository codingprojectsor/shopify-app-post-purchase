// Simple in-memory rate limiter per IP/shop
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const CLEANUP_INTERVAL = 60_000; // clean stale entries every 60s
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of requestCounts) {
    if (entry.resetAt <= now) requestCounts.delete(key);
  }
}

/**
 * Check if a request should be rate-limited.
 * @param key - Unique identifier (IP, shop domain, etc.)
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns true if the request is allowed, false if rate-limited
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 60,
  windowMs: number = 60_000,
): boolean {
  cleanup();

  const now = Date.now();
  const entry = requestCounts.get(key);

  if (!entry || entry.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= maxRequests;
}

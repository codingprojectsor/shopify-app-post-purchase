import crypto from "crypto";

interface TokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

/**
 * Verifies a Shopify session token (JWT) from a checkout UI extension.
 * Returns the shop domain (e.g., "my-store.myshopify.com") on success.
 * Throws an error on failure.
 */
export async function verifyExtensionToken(
  request: Request,
): Promise<{ shop: string; payload: TokenPayload }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Response("Missing or invalid Authorization header", {
      status: 401,
    });
  }

  const token = authHeader.slice(7);
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Response("Server configuration error", { status: 500 });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Response("Invalid token format", { status: 401 });
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify HMAC-SHA256 signature
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signatureInput)
    .digest("base64url");

  if (signatureB64 !== expectedSignature) {
    throw new Response("Invalid token signature", { status: 401 });
  }

  // Decode payload
  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
  } catch {
    throw new Response("Invalid token payload", { status: 401 });
  }

  // Verify expiration with 30s clock skew tolerance
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp + 30) {
    throw new Response("Token expired", { status: 401 });
  }
  if (payload.nbf && now < payload.nbf - 30) {
    throw new Response("Token not yet valid", { status: 401 });
  }

  // Verify audience matches our app's API key
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (apiKey && payload.aud !== apiKey) {
    throw new Response("Invalid token audience", { status: 401 });
  }

  // Extract shop domain from dest claim
  let shop: string;
  try {
    const destUrl = new URL(
      payload.dest.includes("://") ? payload.dest : `https://${payload.dest}`,
    );
    shop = destUrl.host;
  } catch {
    // Fallback: use dest directly if it looks like a domain
    shop = payload.dest.replace(/^https?:\/\//, "");
  }
  return { shop, payload };
}

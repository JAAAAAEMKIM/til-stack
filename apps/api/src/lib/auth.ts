import * as jose from "jose";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// Environment variables
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production"
);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/auth/callback";

const COOKIE_NAME = "til_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface JWTPayload extends Record<string, unknown> {
  userId: string;
  googleId: string;
}

export interface User {
  id: string;
  googleId: string;
}

// Generate Google OAuth URL
export function getGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange authorization code for tokens
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  id_token: string;
}> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to exchange code: ${error}`);
  }

  return response.json();
}

// Verify Google ID token and extract user info
export async function verifyGoogleToken(
  idToken: string
): Promise<{ googleId: string; email?: string }> {
  // Decode the JWT (Google tokens are self-contained)
  const decoded = jose.decodeJwt(idToken);

  // Verify issuer
  if (decoded.iss !== "https://accounts.google.com" && decoded.iss !== "accounts.google.com") {
    throw new Error("Invalid token issuer");
  }

  // Verify audience
  if (decoded.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("Invalid token audience");
  }

  // Verify expiration
  if (decoded.exp && decoded.exp < Date.now() / 1000) {
    throw new Error("Token expired");
  }

  return {
    googleId: decoded.sub as string,
    email: decoded.email as string | undefined,
  };
}

// Create or get user by Google ID
export async function getOrCreateUser(googleId: string): Promise<{ user: User; isNewUser: boolean }> {
  // Check if user exists
  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.googleId, googleId))
    .get();

  if (existing) {
    return {
      user: { id: existing.id, googleId: existing.googleId },
      isNewUser: false,
    };
  }

  // Create new user
  const newUser = await db
    .insert(schema.users)
    .values({
      id: nanoid(),
      googleId,
    })
    .returning()
    .get();

  return {
    user: { id: newUser.id, googleId: newUser.googleId },
    isNewUser: true,
  };
}

// Create JWT session token
export async function createSessionToken(user: User): Promise<string> {
  const payload: JWTPayload = {
    userId: user.id,
    googleId: user.googleId,
  };

  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(JWT_SECRET);
}

// Verify JWT session token
export async function verifySessionToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// Set session cookie
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

// Get session cookie
export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
}

// Clear session cookie
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

// Get user from request context
export async function getUserFromContext(c: Context): Promise<User | null> {
  const token = getSessionCookie(c);
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  // Verify user still exists in database
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payload.userId))
    .get();

  if (!user) return null;

  return { id: user.id, googleId: user.googleId };
}

// Delete user and all their data
export async function deleteUserAndData(userId: string): Promise<void> {
  // Delete all user data
  await db.delete(schema.entries).where(eq(schema.entries.userId, userId));
  await db.delete(schema.skipDays).where(eq(schema.skipDays.userId, userId));
  await db.delete(schema.templates).where(eq(schema.templates.userId, userId));
  await db.delete(schema.webhooks).where(eq(schema.webhooks.userId, userId));

  // Delete user
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}

import { randomBytes } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { config } from "./env.ts";
import { HttpError } from "./http.ts";
import { findUser, type User } from "./users.ts";

export interface AuthEnv {
  Variables: { user: User };
}

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_DAYS = 90;
/** A session older than this is re-signed on use, so active users never expire. */
const REFRESH_AFTER_S = 24 * 60 * 60;
const GITHUB_SCOPE = "read:user";

const now = () => Math.floor(Date.now() / 1000);

const cookieOptions = () => ({
  path: "/",
  httpOnly: true,
  secure: config.secureCookies,
  sameSite: "Lax" as const
});

async function setSession(c: Parameters<MiddlewareHandler>[0], login: string): Promise<void> {
  const iat = now();
  const token = await sign(
    { sub: login, iat, exp: iat + SESSION_DAYS * 86_400 },
    config.sessionSecret
  );
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 86_400 });
}

async function sessionUser(c: Parameters<MiddlewareHandler>[0]): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  let payload: { sub?: unknown; iat?: unknown };
  try {
    payload = await verify(token, config.sessionSecret, "HS256");
  } catch {
    return null;
  }
  if (typeof payload.sub !== "string") return null;
  const user = await findUser(payload.sub);
  if (user && typeof payload.iat === "number" && now() - payload.iat > REFRESH_AFTER_S) {
    await setSession(c, user.login);
  }
  return user;
}

export const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = await sessionUser(c);
  if (!user) throw new HttpError(401, "sign in first");
  c.set("user", user);
  await next();
};

export const requireOwner: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.get("user").role !== "owner") throw new HttpError(403, "owners only");
  await next();
};

const denied = (reason: string, login?: string) =>
  `/?auth=${reason}${login ? `&login=${encodeURIComponent(login)}` : ""}`;

interface GitHubUser {
  login?: unknown;
}

async function githubLogin(code: string): Promise<string> {
  const { clientId, clientSecret } = config.github!;
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${config.publicUrl}/auth/callback`
    })
  });
  const token = (await tokenResponse.json()) as { access_token?: unknown; error?: unknown };
  if (typeof token.access_token !== "string") {
    throw new Error(`GitHub token exchange failed: ${String(token.error ?? tokenResponse.status)}`);
  }
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "hsctikzbench"
    }
  });
  const user = (await userResponse.json()) as GitHubUser;
  if (typeof user.login !== "string")
    throw new Error(`GitHub user lookup failed: ${userResponse.status}`);
  return user.login;
}

export function authRoutes(): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/auth/login", async (c) => {
    if (config.devUser !== null) {
      const user = await findUser(config.devUser);
      if (!user) return c.redirect(denied("unknown", config.devUser));
      await setSession(c, user.login);
      return c.redirect("/");
    }
    if (!config.github) throw new HttpError(503, "GitHub sign-in is not configured");
    const state = randomBytes(16).toString("hex");
    setCookie(c, STATE_COOKIE, state, { ...cookieOptions(), maxAge: 600 });
    const params = new URLSearchParams({
      client_id: config.github.clientId,
      redirect_uri: `${config.publicUrl}/auth/callback`,
      scope: GITHUB_SCOPE,
      state
    });
    return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
  });

  app.get("/auth/callback", async (c) => {
    if (!config.github) throw new HttpError(503, "GitHub sign-in is not configured");
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, cookieOptions());
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state || !expected || state !== expected) return c.redirect(denied("error"));
    let login: string;
    try {
      login = await githubLogin(code);
    } catch (e) {
      console.error(e);
      return c.redirect(denied("error"));
    }
    const user = await findUser(login);
    if (!user) return c.redirect(denied("denied", login));
    await setSession(c, user.login);
    return c.redirect("/");
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, cookieOptions());
    return c.body(null, 204);
  });

  app.get("/api/me", requireUser, (c) => c.json(c.get("user")));

  return app;
}

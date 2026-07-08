import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { completeOAuth } from "./oauth-callback.js";
import type { Config, Tokens } from "./types.js";

const SCOPE = "song_requests_queue";
const REFRESH_SKEW_MS = 60_000;

export class AuthError extends Error {}

export function buildAuthorizeUrl(config: Config, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${config.authBaseUrl}/oauth2/authorize?${params.toString()}`;
}

export function needsRefresh(tokens: Tokens, now: number, skewMs: number = REFRESH_SKEW_MS): boolean {
  return now >= tokens.expiresAt - skewMs;
}

export function readTokens(path: string): Tokens | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Tokens;
}

export function writeTokens(path: string, tokens: Tokens): void {
  writeFileSync(path, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function postToken(config: Config, body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${config.authBaseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  const expiresIn =
    typeof data.expires_in === "number" && Number.isFinite(data.expires_in) ? data.expires_in : 0;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function exchangeCode(config: Config, code: string): Promise<Tokens> {
  return postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
}

export async function refreshTokens(config: Config, refreshToken: string): Promise<Tokens> {
  return postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function getValidAccessToken(config: Config): Promise<string> {
  const tokens = readTokens(config.tokensPath);
  if (!tokens) {
    throw new AuthError('No tokens found. Run "npm run login" first.');
  }
  if (needsRefresh(tokens, Date.now())) {
    let refreshed: Tokens;
    try {
      refreshed = await refreshTokens(config, tokens.refreshToken);
    } catch (err) {
      throw new AuthError(
        `Token refresh failed — run "npm run login" again. (${(err as Error).message})`
      );
    }
    writeTokens(config.tokensPath, refreshed);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export async function login(config: Config): Promise<void> {
  const state = randomUUID();
  const authUrl = buildAuthorizeUrl(config, state);
  await completeOAuth({
    authUrl,
    redirectUri: config.redirectUri,
    state,
    label: "Nightbot",
    onCode: async (code) => {
      const tokens = await exchangeCode(config, code);
      writeTokens(config.tokensPath, tokens);
    },
  });
  console.log(`Tokens saved to ${config.tokensPath}.`);
}

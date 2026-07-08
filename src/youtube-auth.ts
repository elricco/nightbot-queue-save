import { randomUUID } from "node:crypto";
import type { Tokens, YouTubeConfig } from "./types.js";
import { readTokens, writeTokens, needsRefresh } from "./auth.js";
import { completeOAuth } from "./oauth-callback.js";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube";

// Marker error: signals the sync should pause for the rest of the run.
export class YouTubeAuthError extends Error {
  readonly pauseSync = true as const;
}

export function buildYouTubeAuthorizeUrl(config: YouTubeConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

// Google omits refresh_token on refresh responses — preserve the previous one.
export function mergeRefreshedTokens(
  previous: Tokens,
  resp: TokenResponse,
  now: number = Date.now(),
): Tokens {
  const expiresIn =
    typeof resp.expires_in === "number" && Number.isFinite(resp.expires_in) ? resp.expires_in : 0;
  return {
    accessToken: resp.access_token,
    refreshToken: resp.refresh_token ?? previous.refreshToken,
    expiresAt: now + expiresIn * 1000,
  };
}

async function postToken(config: YouTubeConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new Error(`YouTube token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeYouTubeCode(config: YouTubeConfig, code: string): Promise<Tokens> {
  const resp = await postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });
  // On the first consent Google returns a refresh_token; seed from an empty previous.
  return mergeRefreshedTokens({ accessToken: "", refreshToken: "", expiresAt: 0 }, resp);
}

export async function refreshYouTubeTokens(config: YouTubeConfig, previous: Tokens): Promise<Tokens> {
  const resp = await postToken(config, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: previous.refreshToken,
  });
  return mergeRefreshedTokens(previous, resp);
}

export async function getValidYouTubeAccessToken(config: YouTubeConfig): Promise<string> {
  const tokens = readTokens(config.tokensPath);
  if (!tokens) {
    throw new YouTubeAuthError('No YouTube tokens found. Run "npm run login:youtube" first.');
  }
  if (needsRefresh(tokens, Date.now())) {
    let refreshed: Tokens;
    try {
      refreshed = await refreshYouTubeTokens(config, tokens);
    } catch (err) {
      throw new YouTubeAuthError(
        `YouTube token refresh failed — run "npm run login:youtube" again. (${(err as Error).message})`,
      );
    }
    writeTokens(config.tokensPath, refreshed);
    return refreshed.accessToken;
  }
  return tokens.accessToken;
}

export async function loginYouTube(config: YouTubeConfig): Promise<void> {
  const state = randomUUID();
  const authUrl = buildYouTubeAuthorizeUrl(config, state);
  await completeOAuth({
    authUrl,
    redirectUri: config.redirectUri,
    state,
    label: "YouTube",
    onCode: async (code) => {
      const tokens = await exchangeYouTubeCode(config, code);
      writeTokens(config.tokensPath, tokens);
    },
  });
  console.log(`YouTube tokens saved to ${config.tokensPath}.`);
}

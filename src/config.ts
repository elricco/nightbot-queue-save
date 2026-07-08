import { config as loadDotenv } from "dotenv";
import type { Config, WatchConfig, YouTubeConfig } from "./types.js";

export function buildConfig(env: Record<string, string | undefined>): Config {
  const clientId = env.NIGHTBOT_CLIENT_ID;
  const clientSecret = env.NIGHTBOT_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing required env var NIGHTBOT_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing required env var NIGHTBOT_CLIENT_SECRET");

  const pollIntervalSeconds = Number(env.POLL_INTERVAL_SECONDS ?? "5");
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error(
      `Invalid POLL_INTERVAL_SECONDS: must be a positive number, got "${env.POLL_INTERVAL_SECONDS}"`
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: env.NIGHTBOT_REDIRECT_URI ?? "http://localhost:8080/callback",
    pollIntervalSeconds,
    csvPath: env.CSV_PATH?.trim() || "./song-requests.csv",
    tokensPath: env.TOKENS_PATH ?? "./tokens.json",
    apiBaseUrl: "https://api.nightbot.tv",
    authBaseUrl: "https://api.nightbot.tv",
  };
}

export function buildPublicConfig(
  env: Record<string, string | undefined>,
  username: string,
): WatchConfig {
  const pollIntervalSeconds = Number(env.PUBLIC_POLL_INTERVAL_SECONDS ?? "10");
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error(
      `Invalid PUBLIC_POLL_INTERVAL_SECONDS: must be a positive number, got "${env.PUBLIC_POLL_INTERVAL_SECONDS}"`,
    );
  }

  return {
    pollIntervalSeconds,
    csvPath: env.CSV_PATH?.trim() || `./song-requests-${username}.csv`,
    apiBaseUrl: "https://api.nightbot.tv",
  };
}

export function loadConfig(): Config {
  loadDotenv();
  return buildConfig(process.env);
}

export function loadPublicConfig(username: string): WatchConfig {
  loadDotenv();
  return buildPublicConfig(process.env, username);
}

// Returns null when YouTube is entirely unconfigured. Throws when partially
// configured in a way that cannot work (playlist without credentials).
export function buildYouTubeConfig(
  env: Record<string, string | undefined>,
): YouTubeConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim();
  const playlistId = env.YOUTUBE_PLAYLIST_ID?.trim() ?? "";
  if (!clientId && !playlistId) return null;
  if (!clientId) throw new Error("YOUTUBE_PLAYLIST_ID is set but YOUTUBE_CLIENT_ID is missing");
  const clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("Missing required env var YOUTUBE_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    redirectUri: env.YOUTUBE_REDIRECT_URI?.trim() || "http://localhost:8080/callback",
    playlistId,
    tokensPath: env.YOUTUBE_TOKENS_PATH?.trim() || "./youtube-tokens.json",
  };
}

export function loadYouTubeConfig(): YouTubeConfig | null {
  loadDotenv();
  return buildYouTubeConfig(process.env);
}

import { config as loadDotenv } from "dotenv";
import type { Config, WatchConfig } from "./types.js";

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

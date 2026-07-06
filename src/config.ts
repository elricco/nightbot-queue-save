import { config as loadDotenv } from "dotenv";
import type { Config } from "./types.js";

export function buildConfig(env: Record<string, string | undefined>): Config {
  const clientId = env.NIGHTBOT_CLIENT_ID;
  const clientSecret = env.NIGHTBOT_CLIENT_SECRET;
  if (!clientId) throw new Error("Missing required env var NIGHTBOT_CLIENT_ID");
  if (!clientSecret) throw new Error("Missing required env var NIGHTBOT_CLIENT_SECRET");

  return {
    clientId,
    clientSecret,
    redirectUri: env.NIGHTBOT_REDIRECT_URI ?? "http://localhost:8080/callback",
    pollIntervalSeconds: Number(env.POLL_INTERVAL_SECONDS ?? "5"),
    csvPath: env.CSV_PATH ?? "./song-requests.csv",
    tokensPath: env.TOKENS_PATH ?? "./tokens.json",
    apiBaseUrl: "https://api.nightbot.tv",
    authBaseUrl: "https://api.nightbot.tv",
  };
}

export function loadConfig(): Config {
  loadDotenv();
  return buildConfig(process.env);
}

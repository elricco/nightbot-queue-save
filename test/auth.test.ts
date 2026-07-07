import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { buildAuthorizeUrl, needsRefresh, writeTokens, readTokens, getValidAccessToken, AuthError } from "../src/auth.js";
import type { Config, Tokens } from "../src/types.js";

const cfg: Config = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "http://localhost:8080/callback",
  pollIntervalSeconds: 5,
  csvPath: "./song-requests.csv",
  tokensPath: "./test/tmp-tokens.json",
  apiBaseUrl: "https://api.nightbot.tv",
  authBaseUrl: "https://api.nightbot.tv",
};

afterEach(() => { if (existsSync(cfg.tokensPath)) rmSync(cfg.tokensPath); });

describe("buildAuthorizeUrl", () => {
  it("includes client_id, redirect_uri, response_type, scope and state", () => {
    const url = new URL(buildAuthorizeUrl(cfg, "STATE123"));
    expect(url.origin + url.pathname).toBe("https://api.nightbot.tv/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("song_requests_queue");
    expect(url.searchParams.get("state")).toBe("STATE123");
  });
});

describe("needsRefresh", () => {
  it("is true when the token is expired or within the skew window", () => {
    const now = 1_000_000;
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now - 1 }, now)).toBe(true);
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 30_000 }, now)).toBe(true);
  });
  it("is false when the token is comfortably valid", () => {
    const now = 1_000_000;
    expect(needsRefresh({ accessToken: "a", refreshToken: "r", expiresAt: now + 3_600_000 }, now)).toBe(false);
  });
});

describe("token storage round-trip", () => {
  it("writes and reads tokens", () => {
    const tokens: Tokens = { accessToken: "a", refreshToken: "r", expiresAt: 42 };
    writeTokens(cfg.tokensPath, tokens);
    expect(readTokens(cfg.tokensPath)).toEqual(tokens);
  });
  it("readTokens returns null when the file is missing", () => {
    expect(readTokens("./test/no-such-tokens.json")).toBeNull();
  });
});

describe("getValidAccessToken", () => {
  it("throws AuthError when no tokens file exists", async () => {
    await expect(
      getValidAccessToken({ ...cfg, tokensPath: "./test/no-such-tokens-xyz.json" })
    ).rejects.toBeInstanceOf(AuthError);
  });
});

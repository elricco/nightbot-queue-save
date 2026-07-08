import { describe, it, expect } from "vitest";
import { buildYouTubeAuthorizeUrl, mergeRefreshedTokens, getValidYouTubeAccessToken, YouTubeAuthError } from "../src/youtube-auth.js";
import type { YouTubeConfig, Tokens } from "../src/types.js";

const cfg: YouTubeConfig = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "http://localhost:8080/callback",
  playlistId: "PL123",
  tokensPath: "./test/no-such-youtube-tokens.json",
};

describe("buildYouTubeAuthorizeUrl", () => {
  it("targets Google and requests offline access with a refresh token", () => {
    const url = new URL(buildYouTubeAuthorizeUrl(cfg, "STATE123"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:8080/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/youtube");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("STATE123");
  });
});

describe("mergeRefreshedTokens", () => {
  const previous: Tokens = { accessToken: "old", refreshToken: "R_OLD", expiresAt: 0 };

  it("keeps the previous refresh token when the response omits one", () => {
    const merged = mergeRefreshedTokens(previous, { access_token: "new", expires_in: 3600 }, 1_000);
    expect(merged.accessToken).toBe("new");
    expect(merged.refreshToken).toBe("R_OLD");
    expect(merged.expiresAt).toBe(1_000 + 3600 * 1000);
  });

  it("uses a new refresh token when the response provides one", () => {
    const merged = mergeRefreshedTokens(previous, { access_token: "new", refresh_token: "R_NEW", expires_in: 3600 }, 0);
    expect(merged.refreshToken).toBe("R_NEW");
  });
});

describe("getValidYouTubeAccessToken", () => {
  it("throws YouTubeAuthError when no tokens file exists", async () => {
    await expect(getValidYouTubeAccessToken(cfg)).rejects.toBeInstanceOf(YouTubeAuthError);
  });
});

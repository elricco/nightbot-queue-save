import { describe, it, expect } from "vitest";
import { buildConfig, buildPublicConfig } from "../src/config.js";

describe("buildConfig", () => {
  it("applies defaults when optional vars are missing", () => {
    const cfg = buildConfig({
      NIGHTBOT_CLIENT_ID: "id",
      NIGHTBOT_CLIENT_SECRET: "secret",
    });
    expect(cfg.clientId).toBe("id");
    expect(cfg.clientSecret).toBe("secret");
    expect(cfg.redirectUri).toBe("http://localhost:8080/callback");
    expect(cfg.pollIntervalSeconds).toBe(5);
    expect(cfg.csvPath).toBe("./song-requests.csv");
    expect(cfg.apiBaseUrl).toBe("https://api.nightbot.tv");
  });

  it("reads overrides from env", () => {
    const cfg = buildConfig({
      NIGHTBOT_CLIENT_ID: "id",
      NIGHTBOT_CLIENT_SECRET: "secret",
      POLL_INTERVAL_SECONDS: "10",
      CSV_PATH: "/tmp/out.csv",
    });
    expect(cfg.pollIntervalSeconds).toBe(10);
    expect(cfg.csvPath).toBe("/tmp/out.csv");
  });

  it("throws when required vars are missing", () => {
    expect(() => buildConfig({ NIGHTBOT_CLIENT_ID: "id" })).toThrow(
      /NIGHTBOT_CLIENT_SECRET/
    );
  });

  it("throws when POLL_INTERVAL_SECONDS is not a positive number", () => {
    const base = { NIGHTBOT_CLIENT_ID: "id", NIGHTBOT_CLIENT_SECRET: "secret" };
    expect(() => buildConfig({ ...base, POLL_INTERVAL_SECONDS: "5s" })).toThrow(/POLL_INTERVAL_SECONDS/);
    expect(() => buildConfig({ ...base, POLL_INTERVAL_SECONDS: "0" })).toThrow(/POLL_INTERVAL_SECONDS/);
    expect(() => buildConfig({ ...base, POLL_INTERVAL_SECONDS: "-3" })).toThrow(/POLL_INTERVAL_SECONDS/);
  });
});

describe("buildPublicConfig", () => {
  it("derives a per-channel CSV path and 10s default poll interval", () => {
    const cfg = buildPublicConfig({}, "elricco1978");
    expect(cfg.csvPath).toBe("./song-requests-elricco1978.csv");
    expect(cfg.pollIntervalSeconds).toBe(10);
    expect(cfg.apiBaseUrl).toBe("https://api.nightbot.tv");
  });

  it("lets CSV_PATH override the per-channel default", () => {
    const cfg = buildPublicConfig({ CSV_PATH: "/tmp/out.csv" }, "elricco1978");
    expect(cfg.csvPath).toBe("/tmp/out.csv");
  });

  it("reads PUBLIC_POLL_INTERVAL_SECONDS", () => {
    const cfg = buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "20" }, "x");
    expect(cfg.pollIntervalSeconds).toBe(20);
  });

  it("throws when PUBLIC_POLL_INTERVAL_SECONDS is not a positive number", () => {
    expect(() => buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "0" }, "x")).toThrow(
      /PUBLIC_POLL_INTERVAL_SECONDS/,
    );
    expect(() => buildPublicConfig({ PUBLIC_POLL_INTERVAL_SECONDS: "abc" }, "x")).toThrow(
      /PUBLIC_POLL_INTERVAL_SECONDS/,
    );
  });
});

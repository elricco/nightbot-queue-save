import { describe, it, expect } from "vitest";
import { parsePublicUrl } from "../src/public.js";

describe("parsePublicUrl", () => {
  it("parses a full public queue URL", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978/song_requests")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("parses a URL without the /song_requests suffix", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("accepts the bare provider/username short form", () => {
    expect(parsePublicUrl("t/elricco1978")).toEqual({ provider: "t", username: "elricco1978" });
  });

  it("ignores extra path segments and a trailing slash", () => {
    expect(parsePublicUrl("https://nightbot.tv/t/elricco1978/song_requests/")).toEqual({
      provider: "t",
      username: "elricco1978",
    });
  });

  it("throws on empty input", () => {
    expect(() => parsePublicUrl("   ")).toThrow(/URL/i);
  });

  it("throws when a segment is missing", () => {
    expect(() => parsePublicUrl("https://nightbot.tv/t")).toThrow(/Invalid/i);
  });
});

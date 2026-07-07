import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { escapeField, formatRow, parseCsv, readKnownTrackIds, appendSong } from "../src/csv.js";
import type { Song } from "../src/types.js";

const TMP = "./test/tmp-songs.csv";
afterEach(() => { if (existsSync(TMP)) rmSync(TMP); });

const sampleSong: Song = {
  trackId: "abc123",
  title: 'Song, with "quotes"',
  url: "https://youtu.be/abc123",
  requester: "Möller",
  durationSeconds: 200,
  provider: "youtube",
  firstSeenAt: "2026-07-06T12:00:00.000Z",
};

describe("escapeField", () => {
  it("leaves plain fields untouched", () => {
    expect(escapeField("hello")).toBe("hello");
  });
  it("quotes and doubles quotes when field has comma or quote", () => {
    expect(escapeField('a,b')).toBe('"a,b"');
    expect(escapeField('say "hi"')).toBe('"say ""hi"""');
  });
  it("quotes fields containing newlines", () => {
    expect(escapeField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("parseCsv", () => {
  it("parses quoted fields with embedded commas, quotes and newlines", () => {
    const rows = parseCsv('a,"b,c","d""e"\n"multi\nline",x,y\n');
    expect(rows[0]).toEqual(["a", "b,c", 'd"e']);
    expect(rows[1]).toEqual(["multi\nline", "x", "y"]);
  });
});

describe("appendSong + readKnownTrackIds", () => {
  it("writes BOM + header on first write, appends rows after", () => {
    appendSong(TMP, sampleSong);
    const raw = readFileSync(TMP);
    expect(raw[0]).toBe(0xef); // BOM byte 1
    const text = raw.toString("utf8");
    expect(text).toContain("track_id,title,url,requester,duration_seconds,provider,first_seen_at");
    expect(text).toContain('"Song, with ""quotes"""');
    expect(text).toContain("Möller");

    appendSong(TMP, { ...sampleSong, trackId: "xyz789", title: "Second" });
    const ids = readKnownTrackIds(TMP);
    expect(ids.has("abc123")).toBe(true);
    expect(ids.has("xyz789")).toBe(true);
    expect(ids.size).toBe(2); // header row excluded
  });

  it("returns empty set when file does not exist", () => {
    expect(readKnownTrackIds("./test/does-not-exist.csv").size).toBe(0);
  });
});

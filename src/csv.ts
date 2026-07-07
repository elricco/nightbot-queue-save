import { existsSync, readFileSync, appendFileSync, writeFileSync, statSync } from "node:fs";
import type { Song } from "./types.js";

const BOM = "﻿";
const HEADER = ["track_id", "title", "url", "requester", "duration_seconds", "provider", "first_seen_at"];

export function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function formatRow(fields: string[]): string {
  return fields.map(escapeField).join(",");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  // strip a leading BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function songToFields(song: Song): string[] {
  return [
    song.trackId,
    song.title,
    song.url,
    song.requester,
    String(song.durationSeconds),
    song.provider,
    song.firstSeenAt,
  ];
}

export function appendSong(path: string, song: Song): void {
  const needsHeader = !existsSync(path) || statSync(path).size === 0;
  if (needsHeader) {
    writeFileSync(path, BOM + formatRow(HEADER) + "\n", "utf8");
  }
  appendFileSync(path, formatRow(songToFields(song)) + "\n", "utf8");
}

export function readKnownTrackIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  const rows = parseCsv(readFileSync(path, "utf8"));
  for (let r = 1; r < rows.length; r++) { // skip header row
    const id = rows[r][0];
    if (id) ids.add(id);
  }
  return ids;
}

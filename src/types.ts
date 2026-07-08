export interface WatchConfig {
  pollIntervalSeconds: number;
  csvPath: string;
  apiBaseUrl: string;
}

export interface Config extends WatchConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokensPath: string;
  authBaseUrl: string;
}

export interface Song {
  trackId: string;
  title: string;
  url: string;
  requester: string;
  durationSeconds: number;
  provider: string;
  firstSeenAt: string; // ISO-8601
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms when the access token expires
}

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  playlistId: string; // may be "" — feature is active only when non-empty
  tokensPath: string;
}

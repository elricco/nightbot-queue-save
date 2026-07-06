export interface Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pollIntervalSeconds: number;
  csvPath: string;
  tokensPath: string;
  apiBaseUrl: string;
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

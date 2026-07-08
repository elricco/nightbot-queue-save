import { loadConfig, loadPublicConfig, loadYouTubeConfig } from "./config.js";
import { login } from "./auth.js";
import { loginYouTube } from "./youtube-auth.js";
import { watch, scrape } from "./watch.js";
import { parsePublicUrl } from "./public.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "watch";

  switch (command) {
    case "login":
      await login(loadConfig());
      break;
    case "login:youtube": {
      const yt = loadYouTubeConfig();
      if (!yt) {
        console.error(
          "YouTube is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first.",
        );
        process.exit(1);
      }
      await loginYouTube(yt);
      break;
    }
    case "watch":
      await watch(loadConfig(), loadYouTubeConfig());
      break;
    case "scrape": {
      const url = process.argv[3];
      if (!url) {
        console.error(
          "Usage: npm run scrape <public-queue-url>\n" +
            "Example: npm run scrape https://nightbot.tv/t/<username>/song_requests",
        );
        process.exit(1);
      }
      const { provider, username } = parsePublicUrl(url);
      await scrape(loadPublicConfig(username), provider, username, loadYouTubeConfig());
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Use "login", "login:youtube", "watch", or "scrape <url>".`,
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

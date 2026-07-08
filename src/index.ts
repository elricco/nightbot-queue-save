import { loadConfig, loadPublicConfig } from "./config.js";
import { login } from "./auth.js";
import { watch, scrape } from "./watch.js";
import { parsePublicUrl } from "./public.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "watch";

  switch (command) {
    case "login":
      await login(loadConfig());
      break;
    case "watch":
      await watch(loadConfig());
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
      await scrape(loadPublicConfig(username), provider, username);
      break;
    }
    default:
      console.error(`Unknown command "${command}". Use "login", "watch", or "scrape <url>".`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

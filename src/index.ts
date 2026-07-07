import { loadConfig } from "./config.js";
import { login } from "./auth.js";
import { watch } from "./watch.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "watch";
  const config = loadConfig();

  switch (command) {
    case "login":
      await login(config);
      break;
    case "watch":
      await watch(config);
      break;
    default:
      console.error(`Unknown command "${command}". Use "login" or "watch".`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

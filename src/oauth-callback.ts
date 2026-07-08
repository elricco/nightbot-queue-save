import { createServer } from "node:http";
import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
    : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best effort — the URL is also printed to the console */
  }
}

// Runs a one-shot local callback server, returns the OAuth `code`.
export function waitForOAuthCode(opts: {
  authUrl: string;
  redirectUri: string;
  state: string;
  label: string;
}): Promise<string> {
  const redirect = new URL(opts.redirectUri);
  const port = Number(redirect.port || "80");
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const returnedState = reqUrl.searchParams.get("state");
      if (returnedState !== opts.state || !code) {
        res.writeHead(400).end("Invalid state or missing code. Close this tab and retry.");
        server.close();
        reject(new Error("OAuth callback failed: state mismatch or missing code."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<h1>${opts.label} login complete.</h1><p>You can close this tab and return to the terminal.</p>`);
      server.close();
      resolve(code);
    });
    server.listen(port, () => {
      console.log(`Waiting for ${opts.label} authorization on ${opts.redirectUri} ...`);
      console.log(`If your browser did not open, visit:\n${opts.authUrl}\n`);
      openBrowser(opts.authUrl);
    });
    server.on("error", reject);
  });
}

import http from "node:http";
import { exec } from "node:child_process";
import crypto from "node:crypto";
import { loadConfig, saveConfig, defaultBaseUrl } from "./config.js";

// `nexus login` — two paths:
//
// 1. Browser flow (default): starts a tiny local server on a random port,
//    opens the web app's /login with a one-time state key. After the user
//    signs in, the web app hands the CLI the Supabase access/refresh tokens
//    by POSTing them to the local server. Same auth backend as the web app,
//    zero new credentials.
//
// 2. Token paste (`nexus login --token`): for headless boxes. The user pastes
//    a Supabase access token (Settings → Account → "CLI token" in the web
//    app, or from any Supabase auth response).

export async function loginBrowser(baseUrl: string): Promise<void> {
  const state = crypto.randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/callback") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const data = JSON.parse(body) as {
            state?: string;
            access_token?: string;
            refresh_token?: string;
            email?: string;
          };
          if (data.state !== state || !data.access_token) {
            res.writeHead(400).end("bad state");
            return;
          }
          saveConfig({
            baseUrl,
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            email: data.email,
          });
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body style='font-family:sans-serif;background:#0b0d12;color:#e5e7eb;display:grid;place-items:center;height:100vh'><p>✓ Logged in — you can close this tab and return to the terminal.</p></body></html>"
          );
          res.on("finish", () => {
            server.close();
            resolve();
          });
        } catch {
          res.writeHead(400).end("bad request");
        }
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not start local callback server"));
        return;
      }
      const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
      const loginUrl = `${baseUrl}/login?cli=1&state=${state}&callback=${encodeURIComponent(callbackUrl)}`;

      console.log(`Opening ${loginUrl}`);
      console.log("If the browser didn't open, paste the URL above manually.\n");
      try {
        const mod = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${mod} "${loginUrl}"`);
      } catch {
        // best-effort only
      }
      console.log("Waiting for sign-in…");
    });

    server.on("error", reject);
  });
}

export async function loginWithToken(baseUrl: string, token: string): Promise<void> {
  saveConfig({ baseUrl, accessToken: token.trim() });
}

export async function refreshAccessToken(): Promise<string | null> {
  const cfg = loadConfig();
  if (!cfg.refreshToken) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ refresh_token: cfg.refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!data.access_token) return null;
    saveConfig({
      accessToken: data.access_token,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    });
    return data.access_token;
  } catch {
    return null;
  }
}

export async function getValidToken(): Promise<string | null> {
  const cfg = loadConfig();
  if (cfg.accessToken) return cfg.accessToken;
  return refreshAccessToken();
}

export { defaultBaseUrl };

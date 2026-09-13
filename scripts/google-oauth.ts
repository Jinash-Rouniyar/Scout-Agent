/**
 * One-time helper to mint GOOGLE_REFRESH_TOKEN for Scout.
 *
 * In Google Cloud Console → Credentials → your Web client → Authorized redirect URIs,
 * add BOTH (Google treats these as different):
 *   http://localhost:53682/oauth2callback
 *   http://127.0.0.1:53682/oauth2callback
 *
 * Run:  npx tsx --env-file=.env scripts/google-oauth.ts
 */
import { createServer } from "node:http";
import { execSync } from "node:child_process";
import { google } from "googleapis";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
/** Must match one of the URIs registered on the SAME OAuth client as CLIENT_ID. */
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT ?? "http://localhost:53682/oauth2callback";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.send",
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

console.log("Using OAuth client:", CLIENT_ID.slice(0, 20) + "…");
console.log("Redirect URI:", REDIRECT_URI);
console.log("\nEnsure THIS client (not a different Web client) has the redirect URI above in Google Cloud Console.\n");

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

try {
  execSync(`open "${authUrl}"`, { stdio: "ignore" });
  console.log("Opened browser. If nothing opened, visit:\n");
} catch {
  console.log("Visit this URL in your browser:\n");
}
console.log(authUrl);
console.log("");

let handled = false;

const server = createServer(async (req, res) => {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = new URL(req.url ?? "/", `http://${host}`);

  // Log every hit for debugging (no secrets).
  console.log("[callback]", url.pathname + url.search.slice(0, 80) + (url.search.length > 80 ? "…" : ""));

  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");

  if (err) {
    res.writeHead(400, { "content-type": "text/html" });
    res.end(`<h1>Google error: ${err}</h1><p>${errDesc ?? ""}</p><p>Check redirect URI on the OAuth client matching your .env CLIENT_ID.</p>`);
    console.error("Google returned error:", err, errDesc ?? "");
    return; // keep server open so user can retry after fixing console
  }

  if (!code) {
    // Ignore stray hits (prefetch, manual navigation) — keep waiting.
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>Waiting…</h1><p>Complete sign-in on the Google page, then you will be redirected here with a code.</p>");
    console.log("(no code yet — complete Google sign-in, or fix redirect URI in Cloud Console)");
    return;
  }

  if (handled) return;
  handled = true;

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(400, { "content-type": "text/html" });
      res.end(
        "<h1>No refresh token</h1><p>Revoke Scout at <a href='https://myaccount.google.com/permissions'>Google Account permissions</a> and run this script again.</p>",
      );
      console.error("\nNo refresh_token. Revoke app access and re-run.\n");
      server.close();
      process.exit(1);
      return;
    }

    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>Success</h1><p>Close this tab and check the terminal for GOOGLE_REFRESH_TOKEN.</p>");

    console.log("\n✅ Add this to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log("\nAlso set RECAP_TO_EMAIL to the inbox that should receive weekly recaps.");
    console.log("(Emails are sent FROM the Google account you just signed in with.)\n");
  } catch (e) {
    console.error("Token exchange failed:", e instanceof Error ? e.message : e);
    res.writeHead(500, { "content-type": "text/html" });
    res.end("<h1>Token exchange failed</h1><p>See terminal for details.</p>");
    handled = false;
    return;
  } finally {
    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
  console.log("Waiting for Google to redirect to /oauth2callback …\n");
});

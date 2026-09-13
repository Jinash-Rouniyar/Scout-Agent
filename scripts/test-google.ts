/**
 * Smoke-test Google Docs + Gmail using .env credentials.
 * Run: npx tsx --env-file=.env scripts/test-google.ts
 */
import { LiveGoogleConnector } from "@/lib/connectors/google";

async function main() {
  const google = new LiveGoogleConnector();
  const recapTo = process.env.RECAP_TO_EMAIL;
  if (!recapTo) {
    console.error("Set RECAP_TO_EMAIL in .env (where weekly recaps are sent).");
    process.exit(1);
  }

  console.log("Creating test Google Doc…");
  const doc = await google.createDoc("Scout connectivity test", "Scout Google connector is working.\n\nThis doc was created by scripts/test-google.ts");
  console.log("Doc OK:", doc.url);

  console.log("Sending test Gmail to", recapTo, "…");
  const mail = await google.sendGmail({
    to: recapTo,
    subject: "Scout Gmail connectivity test",
    body: "If you received this, Scout can send the weekly recap from the connected Google account.",
  });
  console.log("Gmail OK — message id:", mail.messageId);
}

main().catch((e) => {
  console.error("FAIL:", e.message ?? e);
  process.exit(1);
});

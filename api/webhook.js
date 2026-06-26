// Resend webhook. Verifies the Svix signature, then auto-suppresses any address
// that bounces or files a spam complaint, plus Resend's own unsubscribe events.
import { createHmac, timingSafeEqual } from "node:crypto";
import { addSuppressed } from "../lib/store.js";

// Read the raw bytes ourselves so the signature check is over the exact payload.
export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Svix signature scheme: HMAC-SHA256 over `${id}.${timestamp}.${body}`.
function verify(secret, headers, body) {
  if (!secret) return true; // not configured -> don't hard-fail, but you SHOULD set it
  const id = headers["svix-id"];
  const ts = headers["svix-timestamp"];
  const sigHeader = headers["svix-signature"] || "";
  if (!id || !ts || !sigHeader) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  // Header may contain several space-separated "v1,<sig>" values.
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1] || "";
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const body = await rawBody(req);

  if (!verify(process.env.RESEND_WEBHOOK_SECRET, req.headers, body)) {
    return res.status(401).json({ error: "bad signature" });
  }

  let event;
  try { event = JSON.parse(body); } catch { return res.status(400).json({ error: "bad json" }); }

  const SUPPRESS_ON = new Set(["email.bounced", "email.complained", "contact.unsubscribed"]);
  if (SUPPRESS_ON.has(event.type)) {
    const to = [].concat(event.data?.to || event.data?.email || []);
    for (const addr of to) { try { await addSuppressed(addr); } catch {} }
    console.log(`Suppressed ${to.join(", ")} via ${event.type}`);
  }
  return res.status(200).json({ received: true });
}

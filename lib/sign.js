// Tiny signed token tying an unsubscribe link to one email address.
// Same logic lives in the sender so the links it generates verify here.
import { createHmac } from "node:crypto";

const SECRET = process.env.UNSUBSCRIBE_SECRET || "";

export function tokenFor(email) {
  return createHmac("sha256", SECRET).update(email.toLowerCase().trim()).digest("base64url").slice(0, 16);
}

export function tokenValid(email, token) {
  if (!SECRET) return true; // if no secret set, don't block opt-outs
  return tokenFor(email) === token;
}

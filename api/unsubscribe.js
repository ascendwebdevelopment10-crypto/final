// One-click unsubscribe. GET renders a confirmation page; POST handles the
// email-client "one-click" (List-Unsubscribe-Post) request. Both record the opt-out.
import { addSuppressed } from "../lib/store.js";
import { tokenValid } from "../lib/sign.js";

function page(title, msg) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1322;color:#e9eefb;
display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:440px;padding:40px;text-align:center}
h1{font-size:22px;margin:0 0 10px}p{color:#8593ad;line-height:1.5}</style></head>
<body><div class="card"><h1>${title}</h1><p>${msg}</p></div></body></html>`;
}

export default async function handler(req, res) {
  const email = (req.query.e || "").toString();
  const token = (req.query.t || "").toString();

  if (!email) {
    res.setHeader("Content-Type", "text/html");
    return res.status(400).send(page("Missing address", "This unsubscribe link is incomplete."));
  }
  if (!tokenValid(email, token)) {
    res.setHeader("Content-Type", "text/html");
    return res.status(403).send(page("Invalid link", "This unsubscribe link could not be verified."));
  }

  try {
    await addSuppressed(email);
  } catch (e) {
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(page("Something went wrong", "We couldn't record that just now. Please email us directly and we'll remove you."));
  }

  // One-click POST from the mail client just needs a 200.
  if (req.method === "POST") return res.status(200).json({ unsubscribed: true });

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(page("You're unsubscribed", `${email} has been removed. You won't receive any more emails from us.`));
}

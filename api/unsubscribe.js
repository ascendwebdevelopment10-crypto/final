// GET renders a confirmation page; POST records both human confirmations and
// email-client one-click (List-Unsubscribe-Post) opt-outs.
import { addToSuppression } from "../lib/store.js";
import { tokenValid } from "../lib/sign.js";

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function page(title, msg, action = '') {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/icons/icon-192.png?v=nitro-20260728b">
<link rel="shortcut icon" type="image/png" href="/icons/icon-192.png?v=nitro-20260728b">
<title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0d1322;color:#e9eefb;
display:grid;place-items:center;min-height:100vh;margin:0}.card{max-width:440px;padding:40px;text-align:center}
h1{font-size:22px;margin:0 0 10px}p{color:#8593ad;line-height:1.5}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p>${action}</div></body></html>`;
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

  if (req.method === "GET") {
    const action = `<form method="post" action="/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}"><button type="submit" style="border:0;border-radius:9px;padding:12px 18px;background:#ff6b00;color:white;font-weight:700;cursor:pointer">Confirm unsubscribe</button></form>`;
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(page("Unsubscribe from Nitro Outreach?", `Confirm that you want to remove ${email} from future outreach emails.`, action));
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await addToSuppression(email);
  } catch (e) {
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(page("Something went wrong", "We couldn't record that just now. Please email us directly and we'll remove you."));
  }

  const oneClick = String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded') && String(req.body || '').includes('List-Unsubscribe=One-Click');
  if (oneClick) return res.status(200).json({ unsubscribed: true });
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(page("You're unsubscribed", `${email} has been removed. You won't receive any more emails from us.`));
}

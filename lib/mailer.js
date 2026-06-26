// Send via Resend with CAN-SPAM compliance baked in (honest from, physical
// address, working one-click unsubscribe). Uses this app's own signed links.
import { tokenFor } from "./sign.js";

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function unsubLink(cfg, lead) {
  if (!cfg.unsubscribeUrl) {
    return { url: `mailto:${cfg.unsubscribeEmail}?subject=${encodeURIComponent("UNSUBSCRIBE " + lead.email)}`, oneClick: false };
  }
  const t = tokenFor(lead.email);
  return { url: `${cfg.unsubscribeUrl}?e=${encodeURIComponent(lead.email)}&t=${t}`, oneClick: true };
}

function footer(cfg, lead) {
  const { url, oneClick } = unsubLink(cfg, lead);
  const optOut = oneClick ? `Not interested? Unsubscribe: ${url}` : `Not interested? Email ${cfg.unsubscribeEmail} and you'll never hear from us again.`;
  return `\n\n--\n${[
    `You received this because your role at ${lead.company || "your company"} matched our outreach.`,
    optOut,
    `${cfg.companyName}, ${cfg.physicalAddress}`,
  ].join("\n")}`;
}

function html(body, cfg, lead) {
  const { url } = unsubLink(cfg, lead);
  const paras = body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#222">${paras}` +
    `<hr style="border:none;border-top:1px solid #eee;margin:20px 0">` +
    `<p style="font-size:12px;color:#888">You received this because your role at ${esc(lead.company || "your company")} matched our outreach. ` +
    `<a href="${esc(url)}" style="color:#888">Unsubscribe</a>.<br>${esc(cfg.companyName)}, ${esc(cfg.physicalAddress)}</p></div>`
  );
}

export async function sendEmail(cfg, lead, subject, body) {
  const { url, oneClick } = unsubLink(cfg, lead);
  const headers = { "List-Unsubscribe": oneClick ? `<${url}>` : url.replace(/^mailto:/, "<mailto:") + ">" };
  if (oneClick) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from, to: [lead.email], reply_to: cfg.replyTo,
      subject, text: body + footer(cfg, lead), html: html(body, cfg, lead), headers,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(data)}`);
  return data.id;
}

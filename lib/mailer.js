// Mailer: prefers the Resend HTTP API (where the sending domain is verified),
// and falls back to Amazon SES SMTP or Gmail SMTP via nodemailer if Resend
// isn't configured. Every caller uses the same sendEmail(options) interface,
// so nothing else in the app changes.
//
// Resend (preferred): set RESEND_API_KEY. Sender defaults to FROM_EMAIL, which
// must be an address on a domain verified in Resend (e.g. hello@nitrooutreach.com).
// SES fallback: SES_SMTP_USER / SES_SMTP_PASS / SES_REGION.
// Gmail fallback: GMAIL_USER / GMAIL_APP_PASSWORD.
import nodemailer from 'nodemailer';

export const FROM_EMAIL =
  process.env.FROM_EMAIL || process.env.CUSTOMER_FROM_EMAIL || 'hello@nitrooutreach.com';

// Which provider is active — Resend first, then SES, then Gmail.
export const MAIL_PROVIDER =
  process.env.RESEND_API_KEY ? 'resend'
    : (process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS) ? 'ses'
      : 'gmail';

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS) {
    const host =
      process.env.SES_SMTP_HOST ||
      `email-smtp.${process.env.SES_REGION || 'us-east-1'}.amazonaws.com`;
    _transporter = nodemailer.createTransport({
      host, port: 465, secure: true,
      auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASS },
    });
  } else {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _transporter;
}

async function sendViaResend(options = {}) {
  const { from, to, subject, html, text, reply_to, replyTo, bcc, cc, headers, idempotencyKey } = options;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: from || `Nitro Outreach <${FROM_EMAIL}>`,
      to: Array.isArray(to) ? to : [to],
      subject: subject || '(no subject)',
      html: html || undefined,
      text: text || undefined,
      reply_to: reply_to || replyTo || undefined,
      bcc: bcc || undefined,
      cc: cc || undefined,
      headers: headers || undefined,
    }),
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data && data.message ? data.message : `Resend error ${res.status}`);
  return { id: data.id, messageId: data.id };
}

export async function sendEmail(options = {}) {
  const { to } = options;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error('sendEmail: missing "to" recipient');
  }
  if (MAIL_PROVIDER === 'resend') return sendViaResend(options);

  const { from, subject, html, text, reply_to, replyTo, bcc, cc, headers } = options;
  const info = await getTransporter().sendMail({
    from: from || FROM_EMAIL,
    to,
    subject: subject || '(no subject)',
    html: html || undefined,
    text: text || undefined,
    replyTo: reply_to || replyTo || undefined,
    bcc: bcc || undefined,
    cc: cc || undefined,
    headers: headers || undefined,
  });
  return info;
}

export default sendEmail;

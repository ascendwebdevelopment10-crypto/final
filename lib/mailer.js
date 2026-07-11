// Mailer: sends via Amazon SES (SMTP) when SES credentials are configured,
// otherwise falls back to the legacy Gmail SMTP. Every caller uses the same
// sendEmail(options) interface, so nothing else in the app changes.
//
// To switch to SES, set these environment variables in Vercel:
//   SES_SMTP_USER   - SES SMTP username (from the AWS SES console)
//   SES_SMTP_PASS   - SES SMTP password (shown once when you create the creds)
//   SES_REGION      - e.g. "us-east-1" (or set SES_SMTP_HOST directly)
//   FROM_EMAIL      - a verified sender on your domain, e.g. info@ascendwebdevelopment.com
// If SES_SMTP_USER/PASS are absent, the mailer keeps using GMAIL_USER/GMAIL_APP_PASSWORD.
import nodemailer from 'nodemailer';

export const FROM_EMAIL = process.env.FROM_EMAIL || process.env.GMAIL_USER;

// Which provider is active — handy for logging/debugging.
export const MAIL_PROVIDER =
  process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS ? 'ses' : 'gmail';

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (MAIL_PROVIDER === 'ses') {
    const host =
      process.env.SES_SMTP_HOST ||
      `email-smtp.${process.env.SES_REGION || 'us-east-1'}.amazonaws.com`;
    _transporter = nodemailer.createTransport({
      host,
      port: 465,
      secure: true,
      auth: {
        user: process.env.SES_SMTP_USER,
        pass: process.env.SES_SMTP_PASS,
      },
    });
  } else {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

export async function sendEmail(options = {}) {
  const { from, to, subject, html, text, reply_to, replyTo, bcc, cc } = options;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error('sendEmail: missing "to" recipient');
  }
  const info = await getTransporter().sendMail({
    from: from || FROM_EMAIL,
    to,
    subject: subject || '(no subject)',
    html: html || undefined,
    text: text || undefined,
    replyTo: reply_to || replyTo || undefined,
    bcc: bcc || undefined,
    cc: cc || undefined,
  });
  return info;
}

export default sendEmail;

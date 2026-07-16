// Mailer with automatic provider selection:
//   1. Amazon SES (SMTP)  - when SES_SMTP_USER + SES_SMTP_PASS are set
//   2. Resend             - when RESEND_API_KEY is set
//   3. Gmail SMTP         - legacy fallback (GMAIL_USER + GMAIL_APP_PASSWORD)
// Every caller uses the same sendEmail(options) interface, so switching
// providers is just an environment-variable change — no code edits.
//
// To switch to SES, set these in Vercel:
//   SES_SMTP_USER   - SES SMTP username (from the AWS SES console)
//   SES_SMTP_PASS   - SES SMTP password (shown once when you create the creds)
//   SES_REGION      - e.g. "us-east-1" (or set SES_SMTP_HOST directly)
//   FROM_EMAIL      - a verified sender on your domain
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

export const FROM_EMAIL = process.env.FROM_EMAIL || process.env.GMAIL_USER;

export const MAIL_PROVIDER =
  process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS ? 'ses'
  : process.env.RESEND_API_KEY ? 'resend'
  : 'gmail';

let _transporter = null;
let _resend = null;

function getTransporter() {
  if (_transporter) return _transporter;
  if (MAIL_PROVIDER === 'ses') {
    const host =
      process.env.SES_SMTP_HOST ||
      'email-smtp.' + (process.env.SES_REGION || 'us-east-1') + '.amazonaws.com';
    _transporter = nodemailer.createTransport({
      host,
      port: 465,
      secure: true,
      auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASS },
    });
  } else {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
  }
  return _transporter;
}

export async function sendEmail(options = {}) {
  const { from, to, subject, html, text, reply_to, replyTo, bcc, cc } = options;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error('sendEmail: missing "to" recipient');
  }

  if (MAIL_PROVIDER === 'resend') {
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await _resend.emails.send({
      from: from || FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject: subject || '(no subject)',
      html: html || undefined,
      text: text || undefined,
      reply_to: reply_to || replyTo || undefined,
      bcc: bcc || undefined,
      cc: cc || undefined,
    });
    if (error) throw new Error('Resend: ' + (error.message || JSON.stringify(error)));
    return data;
  }

  return await getTransporter().sendMail({
    from: from || FROM_EMAIL,
    to,
    subject: subject || '(no subject)',
    html: html || undefined,
    text: text || undefined,
    replyTo: reply_to || replyTo || undefined,
    bcc: bcc || undefined,
    cc: cc || undefined,
  });
}

export default sendEmail;

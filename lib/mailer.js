// Gmail SMTP mailer (nodemailer). Replaces the old Resend implementation.
// Every caller passes ONE options object; supports the fields they use:
//   { from, to, subject, html, text, reply_to, bcc, cc }
// Returns the nodemailer info object (has .messageId), which reply.js reads.
import nodemailer from 'nodemailer';

export const FROM_EMAIL = process.env.FROM_EMAIL || process.env.GMAIL_USER;

let _transporter = null;
function getTransporter() {
  if (!_transporter) {
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

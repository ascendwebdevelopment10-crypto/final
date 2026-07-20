import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { sendEmail, FROM_EMAIL, MAIL_PROVIDER } from '../lib/mailer.js';
import {
  clearCustomerSessionCookie, clientIp, consumeActionToken, createActionToken,
  customerSessionCookie, getCustomer, getCustomerByEmail, hashPassword,
  normalizeEmail, passwordIssue, publicCustomer, rateLimit, requestOrigin,
  sameOrigin, saveCustomer, validEmail, verifyCustomerPassword,
} from '../lib/customer-auth.js';
import { verifyPassword as verifyAdminPassword, makeSessionCookie as makeAdminSessionCookie } from '../lib/auth.js';

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function esc(value) { return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function sendAccountEmail(req, user, kind) {
  const token = await createActionToken(kind, user.id, kind === 'verify' ? 86400 : 3600);
  const path = kind === 'verify' ? '/verify-email' : '/reset-password';
  const link = requestOrigin(req) + path + '?token=' + encodeURIComponent(token);
  const title = kind === 'verify' ? 'Verify your Ascend account' : 'Reset your Ascend password';
  const action = kind === 'verify' ? 'Verify email' : 'Reset password';
  const sender = process.env.CUSTOMER_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || (MAIL_PROVIDER === 'resend' ? 'info@ascendwebdevelopment.com' : FROM_EMAIL);
  await sendEmail({
    from: sender ? `Ascend <${sender}>` : undefined,
    reply_to: process.env.REPLY_TO || FROM_EMAIL || undefined,
    to: user.email,
    subject: title,
    text: `${title}\n\n${link}\n\nThis link expires ${kind === 'verify' ? 'in 24 hours' : 'in 1 hour'}.`,
    html: `<div style="background:#07100b;padding:36px;font-family:Arial,sans-serif;color:#eef7f1"><div style="max-width:560px;margin:auto;background:#101914;border:1px solid #294235;border-radius:20px;padding:32px"><div style="color:#66f2a3;font-weight:800;letter-spacing:.12em">ASCEND</div><h1 style="font-size:25px;margin:24px 0 10px">${esc(title)}</h1><p style="color:#a8b8ae;line-height:1.7">Hi ${esc(user.firstName || 'there')}, use the secure button below to continue.</p><a href="${esc(link)}" style="display:inline-block;margin:18px 0;padding:13px 20px;border-radius:10px;background:#66f2a3;color:#07100b;font-weight:800;text-decoration:none">${action}</a><p style="color:#6f8175;font-size:12px;line-height:1.6">If you did not request this, you can safely ignore this email.</p></div></div>`,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const body = req.body || {};
  const action = clean(body.action, 40).toLowerCase();
  const ip = clientIp(req);

  try {
    if (action === 'signup') {
      if (!(await rateLimit('signup:' + ip, 8, 3600))) { res.status(429).json({ error: 'Too many signup attempts. Try again later.' }); return; }
      const email = normalizeEmail(body.email);
      const issue = passwordIssue(body.password);
      if (!validEmail(email)) { res.status(400).json({ error: 'Enter a valid email address' }); return; }
      if (issue) { res.status(400).json({ error: issue }); return; }
      if (await getCustomerByEmail(email)) { res.status(409).json({ error: 'An account already exists for this email. Sign in or reset your password.' }); return; }
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomUUID(), role: 'customer', email,
        firstName: clean(body.firstName, 80), lastName: clean(body.lastName, 80),
        passwordHash: hashPassword(body.password), emailVerified: false,
        createdAt: now, updatedAt: now,
        onboarding: { step: 1, completed: false, data: {} },
        subscription: { plan: 'free', interval: 'monthly', status: 'active', billingMode: 'free', cancelAtPeriodEnd: false, startedAt: now },
        usage: { aiUsed: 0, websites: 0, storageBytes: 0 },
        preferences: { productUpdates: true, activityAlerts: true, billingEmails: true, weeklyReport: true },
      };
      await saveCustomer(user);
      let emailSent = true;
      try { await sendAccountEmail(req, user, 'verify'); }
      catch (error) { emailSent = false; console.error('Customer verification email failed:', error.message); }
      res.status(201).json({ ok: true, emailSent, email: user.email });
      return;
    }

    if (action === 'login') {
      const email = normalizeEmail(body.email);
      // Owner shortcut: the site owner signs in with ADMIN_EMAIL + the admin dashboard
      // password and is taken straight into the admin command center at /dashboard.
      const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || 'tysmith327@icloud.com');
      if (email === ADMIN_EMAIL) {
        if (!(await rateLimit('ownerlogin:' + ip, 12, 900))) { res.status(429).json({ error: 'Too many login attempts. Wait 15 minutes and try again.' }); return; }
        if (!verifyAdminPassword(body.password)) {
          await new Promise(resolve => setTimeout(resolve, 700));
          res.status(401).json({ error: 'Email or password is incorrect' }); return;
        }
        res.setHeader('Set-Cookie', makeAdminSessionCookie());
        res.status(200).json({ ok: true, redirect: '/dashboard' });
        return;
      }
      if (!(await rateLimit('login:' + ip + ':' + email, 12, 900))) { res.status(429).json({ error: 'Too many login attempts. Wait 15 minutes and try again.' }); return; }
      const user = await getCustomerByEmail(email);
      if (!user || !verifyCustomerPassword(body.password, user.passwordHash)) {
        await new Promise(resolve => setTimeout(resolve, 700));
        res.status(401).json({ error: 'Email or password is incorrect' }); return;
      }
      if (!user.emailVerified) { res.status(403).json({ error: 'Verify your email before signing in', code: 'EMAIL_UNVERIFIED', email: user.email }); return; }
      res.setHeader('Set-Cookie', customerSessionCookie(user.id));
      res.status(200).json({ ok: true, user: publicCustomer(user), redirect: user.onboarding?.completed ? '/app' : '/welcome' });
      return;
    }

    if (action === 'verify') {
      const userId = await consumeActionToken('verify', body.token);
      if (!userId) { res.status(400).json({ error: 'This verification link is invalid or expired' }); return; }
      const user = await getCustomer(userId);
      if (!user) { res.status(404).json({ error: 'Account not found' }); return; }
      user.emailVerified = true;
      user.emailVerifiedAt = new Date().toISOString();
      await saveCustomer(user);
      res.setHeader('Set-Cookie', customerSessionCookie(user.id));
      res.status(200).json({ ok: true, redirect: '/pricing?welcome=1' });
      return;
    }

    if (action === 'resend-verification') {
      const email = normalizeEmail(body.email);
      if (!(await rateLimit('verify:' + ip + ':' + email, 4, 3600))) { res.status(429).json({ error: 'Please wait before requesting another email.' }); return; }
      const user = await getCustomerByEmail(email);
      if (user && !user.emailVerified) await sendAccountEmail(req, user, 'verify');
      res.status(200).json({ ok: true, message: 'If the account still needs verification, a new email is on its way.' });
      return;
    }

    if (action === 'forgot-password') {
      const email = normalizeEmail(body.email);
      if (!(await rateLimit('forgot:' + ip + ':' + email, 4, 3600))) { res.status(429).json({ error: 'Please wait before requesting another reset.' }); return; }
      const user = await getCustomerByEmail(email);
      if (user) await sendAccountEmail(req, user, 'reset');
      res.status(200).json({ ok: true, message: 'If an account exists, a reset link is on its way.' });
      return;
    }

    if (action === 'reset-password') {
      const issue = passwordIssue(body.password);
      if (issue) { res.status(400).json({ error: issue }); return; }
      const userId = await consumeActionToken('reset', body.token);
      if (!userId) { res.status(400).json({ error: 'This reset link is invalid or expired' }); return; }
      const user = await getCustomer(userId);
      if (!user) { res.status(404).json({ error: 'Account not found' }); return; }
      user.passwordHash = hashPassword(body.password);
      await saveCustomer(user);
      res.setHeader('Set-Cookie', customerSessionCookie(user.id));
      res.status(200).json({ ok: true, redirect: user.onboarding?.completed ? '/app' : '/welcome' });
      return;
    }

    if (action === 'logout') {
      res.setHeader('Set-Cookie', clearCustomerSessionCookie());
      res.status(200).json({ ok: true }); return;
    }

    res.status(400).json({ error: 'Unknown authentication action' });
  } catch (error) {
    console.error('Customer auth error:', error.message);
    res.status(500).json({ error: action.includes('email') || action.includes('forgot') || action.includes('resend') ? 'Email could not be sent. Please try again shortly.' : 'Account request failed. Please try again.' });
  }
}

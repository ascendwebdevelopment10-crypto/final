import { kv } from '@vercel/kv';
import {
  clearCustomerSessionCookie, currentCustomer, hashPassword, normalizeEmail,
  passwordIssue, publicCustomer, sameOrigin, saveCustomer, verifyCustomerPassword,
} from '../lib/customer-auth.js';
import { planFor, publicPlans } from '../lib/customer-plans.js';

function clean(value, max = 500) { return String(value || '').trim().slice(0, max); }
function bool(value) { return value === true; }
function safeUrl(value) {
  const raw = clean(value, 1000);
  if (!raw) return '';
  try { const url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''; }
  catch { return ''; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method === 'GET') {
    const plan = planFor(user.subscription?.plan);
    res.status(200).json({ user: publicCustomer(user), plan, plans: publicPlans(), stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY) });
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  const body = req.body || {};
  const action = clean(body.action, 50).toLowerCase();

  try {
    if (action === 'save-onboarding') {
      const step = Math.max(1, Math.min(8, Number(body.step) || 1));
      const current = user.onboarding || { step: 1, completed: false, data: {} };
      const data = { ...(current.data || {}) };
      if (body.companyName !== undefined) data.companyName = clean(body.companyName, 140);
      if (body.industry !== undefined) data.industry = clean(body.industry, 100);
      if (body.websiteUrl !== undefined) data.websiteUrl = safeUrl(body.websiteUrl);
      if (body.primaryColor !== undefined) data.primaryColor = /^#[0-9a-f]{6}$/i.test(body.primaryColor) ? body.primaryColor : '#66f2a3';
      if (body.secondaryColor !== undefined) data.secondaryColor = /^#[0-9a-f]{6}$/i.test(body.secondaryColor) ? body.secondaryColor : '#5de6e6';
      if (body.logoData !== undefined) {
        const logo = String(body.logoData || '');
        if (logo && (!/^data:image\/(png|jpeg|webp);base64,/i.test(logo) || logo.length > 500000)) { res.status(400).json({ error: 'Use a PNG, JPG, or WebP logo under 350 KB' }); return; }
        data.logoData = logo;
      }
      if (body.goals !== undefined) data.goals = Array.isArray(body.goals) ? body.goals.map(x => clean(x, 80)).filter(Boolean).slice(0, 8) : [];
      if (body.socials !== undefined) data.socials = Array.isArray(body.socials) ? body.socials.map(x => clean(x, 50)).filter(Boolean).slice(0, 8) : [];
      user.onboarding = { step: Math.max(current.step || 1, step), completed: bool(body.completed) || current.completed, data };
      if (data.companyName) user.companyName = data.companyName;
      await saveCustomer(user);
      res.status(200).json({ ok: true, onboarding: user.onboarding }); return;
    }

    if (action === 'finish-onboarding') {
      user.onboarding = user.onboarding || { data: {} };
      user.onboarding.step = 8; user.onboarding.completed = true; user.onboarding.completedAt = new Date().toISOString();
      await saveCustomer(user);
      res.status(200).json({ ok: true, redirect: '/app' }); return;
    }

    if (action === 'update-profile') {
      user.firstName = clean(body.firstName, 80); user.lastName = clean(body.lastName, 80);
      if (body.companyName !== undefined) user.companyName = clean(body.companyName, 140);
      if (body.jobTitle !== undefined) user.jobTitle = clean(body.jobTitle, 120);
      await saveCustomer(user); res.status(200).json({ ok: true, user: publicCustomer(user) }); return;
    }

    if (action === 'update-company') {
      user.company = {
        ...(user.company || {}), name: clean(body.name, 140), industry: clean(body.industry, 100),
        website: safeUrl(body.website), size: clean(body.size, 40), timezone: clean(body.timezone, 80),
      };
      if (user.company.name) user.companyName = user.company.name;
      await saveCustomer(user); res.status(200).json({ ok: true, company: user.company }); return;
    }

    if (action === 'update-notifications') {
      user.preferences = {
        productUpdates: bool(body.productUpdates), activityAlerts: bool(body.activityAlerts),
        billingEmails: bool(body.billingEmails), weeklyReport: bool(body.weeklyReport),
      };
      await saveCustomer(user); res.status(200).json({ ok: true, preferences: user.preferences }); return;
    }

    if (action === 'change-password') {
      if (!verifyCustomerPassword(body.currentPassword, user.passwordHash)) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
      const issue = passwordIssue(body.newPassword);
      if (issue) { res.status(400).json({ error: issue }); return; }
      user.passwordHash = hashPassword(body.newPassword);
      await saveCustomer(user); res.status(200).json({ ok: true }); return;
    }

    if (action === 'delete-account') {
      if (clean(body.confirm, 30) !== 'DELETE' || !verifyCustomerPassword(body.password, user.passwordHash)) { res.status(400).json({ error: 'Enter your password and type DELETE to confirm' }); return; }
      await Promise.all([kv.del('customer:user:' + user.id), kv.del('customer:email:' + normalizeEmail(user.email))]);
      res.setHeader('Set-Cookie', clearCustomerSessionCookie());
      res.status(200).json({ ok: true, redirect: '/signup?deleted=1' }); return;
    }

    res.status(400).json({ error: 'Unknown customer action' });
  } catch (error) {
    console.error('Customer data error:', error.message);
    res.status(500).json({ error: 'Your changes could not be saved' });
  }
}

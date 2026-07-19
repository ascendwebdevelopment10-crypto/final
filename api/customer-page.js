import fs from 'node:fs';
import path from 'node:path';
import { customerIdFromRequest } from '../lib/customer-auth.js';

const PROTECTED = ['/app', '/welcome', '/checkout', '/checkout/payment', '/checkout/success'];
const AUTH_PAGES = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'];

export default function handler(req, res) {
  const route = String(req.query?.route || req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const signedIn = Boolean(customerIdFromRequest(req));
  const protectedRoute = PROTECTED.some(item => route === item || route.startsWith(item + '/'));
  if (protectedRoute && !signedIn) {
    res.redirect(302, '/login?next=' + encodeURIComponent(route)); return;
  }
  if (signedIn && AUTH_PAGES.includes(route) && !['/reset-password', '/verify-email'].includes(route)) {
    res.redirect(302, '/app'); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const html = fs.readFileSync(path.join(process.cwd(), 'views', 'customer.html'), 'utf8');
  res.status(200).send(html);
}

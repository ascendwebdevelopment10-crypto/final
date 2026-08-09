import { kv } from '@vercel/kv';
import { currentCustomer, rateLimit, sameOrigin, saveCustomer } from '../lib/customer-auth.js';
import { deleteOutlookTokens, getRecentInboxMessages, sendOutlookEmail } from '../lib/outlook.js';

function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function emailAddress(value) { return clean(value, 320).toLowerCase(); }
function messageId(prefix = 'msg') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

function ensureWorkspace(user) {
  user.workspace = user.workspace || {};
  if (!Array.isArray(user.workspace.messages)) user.workspace.messages = [];
  user.workspace.connections = user.workspace.connections || {};
  return user.workspace;
}

function outlookConnection(workspace) {
  const connection = workspace.connections?.email;
  if (!connection?.connected || connection.provider !== 'outlook') throw new Error('Connect Outlook first.');
  return connection;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = await currentCustomer(req);
  if (!user) { res.status(401).json({ error: 'Customer sign-in required' }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Invalid request origin' }); return; }
  if (!await rateLimit(`outlook:${user.id}`, 20, 60)) { res.status(429).json({ error: 'Please wait a moment before trying again.' }); return; }

  const action = clean(req.body?.action, 40).toLowerCase();
  const workspace = ensureWorkspace(user);

  try {
    if (action === 'send') {
      const connection = outlookConnection(workspace);
      const to = emailAddress(req.body?.to);
      const subject = clean(req.body?.subject, 240) || '(no subject)';
      const body = clean(req.body?.body, 12000);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { res.status(400).json({ error: 'Enter a valid recipient email.' }); return; }
      if (!body) { res.status(400).json({ error: 'Write a message first.' }); return; }

      await sendOutlookEmail(user.id, { to, subject, body });
      const entry = {
        id: messageId(), channel: 'email', provider: 'outlook', from: connection.from,
        to, subject, body, status: 'sent', createdAt: new Date().toISOString(),
      };
      workspace.messages.unshift(entry);
      workspace.messages = workspace.messages.slice(0, 200);
      await saveCustomer(user);
      res.status(200).json({ ok: true, entry });
      return;
    }

    if (action === 'sync') {
      const connection = outlookConnection(workspace);
      const inbox = await getRecentInboxMessages(user.id);
      const existing = new Set(workspace.messages.map(item => String(item.providerId || '')));
      const sentRecipients = new Set(workspace.messages
        .filter(item => item.channel === 'email' && item.status === 'sent')
        .map(item => emailAddress(item.to))
        .filter(Boolean));
      const since = Date.parse(connection.connectedAt || connection.lastSyncedAt || 0) || 0;
      let added = 0;

      for (const item of inbox.reverse()) {
        const providerId = String(item.id || '');
        const from = emailAddress(item.from?.emailAddress?.address);
        const receivedAt = Date.parse(item.receivedDateTime || 0) || 0;
        if (!providerId || existing.has(providerId) || !from || !sentRecipients.has(from) || receivedAt < since) continue;
        workspace.messages.unshift({
          id: messageId('reply'), providerId, conversationId: String(item.conversationId || ''),
          channel: 'email', provider: 'outlook', from, to: connection.from,
          subject: clean(item.subject, 240) || '(no subject)',
          body: clean(item.bodyPreview, 3000), status: 'reply',
          createdAt: item.receivedDateTime || new Date().toISOString(),
        });
        for (const sent of workspace.messages) {
          if (sent.status === 'sent' && emailAddress(sent.to) === from) sent.replied = true;
        }
        existing.add(providerId);
        added += 1;
      }

      connection.lastSyncedAt = new Date().toISOString();
      workspace.messages = workspace.messages.slice(0, 200);
      await saveCustomer(user);
      res.status(200).json({ ok: true, added });
      return;
    }

    if (action === 'disconnect') {
      await deleteOutlookTokens(user.id);
      workspace.connections.email = { connected: false };
      await saveCustomer(user);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: 'Unknown Outlook action' });
  } catch (error) {
    console.error('Outlook messaging error:', error.message);
    const reconnect = /token|consent|invalid_grant|connected/i.test(error.message || '');
    res.status(500).json({ error: reconnect ? 'Your Outlook connection needs to be renewed. Reconnect Outlook and try again.' : (error.message || 'Outlook could not complete that action.') });
  }
}

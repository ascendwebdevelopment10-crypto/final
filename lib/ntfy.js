import { kv } from '@vercel/kv';

const CONFIG_KEY = 'config:ntfy';

export async function ntfyConfig() {
  let saved = null;
  try { saved = await kv.get(CONFIG_KEY); } catch {}
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch { saved = null; } }
  const topic = String(process.env.NTFY_TOPIC || saved?.topic || '').trim();
  const server = String(process.env.NTFY_SERVER || saved?.server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  return topic ? { topic, server } : null;
}

export async function saveNtfyConfig(config) {
  const topic = String(config?.topic || '').trim();
  const server = String(config?.server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(topic)) throw new Error('Invalid ntfy topic');
  if (server !== 'https://ntfy.sh') throw new Error('Only ntfy.sh is allowed');
  await kv.set(CONFIG_KEY, { topic, server, updatedAt: new Date().toISOString() });
}

export async function notifyNtfy({ title, message, priority = 'default', tags = 'zap', click = '' }) {
  const config = await ntfyConfig();
  if (!config) throw new Error('ntfy is not configured');
  const headers = { Title: String(title || 'Nitro Outreach').slice(0, 200), Priority: priority, Tags: tags, 'Content-Type': 'text/plain; charset=utf-8' };
  if (click) headers.Click = click;
  const response = await fetch(`${config.server}/${encodeURIComponent(config.topic)}`, {
    method: 'POST', headers, body: String(message || '').slice(0, 4000),
  });
  if (!response.ok) throw new Error(`ntfy returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json().catch(() => ({ ok: true }));
}

export async function notifyBestEffort(payload) {
  try { return await notifyNtfy(payload); }
  catch (error) { console.error('ntfy notification failed:', error.message); return null; }
}

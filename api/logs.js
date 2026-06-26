import { getEmailLog, getSmsLog, getTotalStats } from '../lib/store.js';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || 'stats';

  try {
    if (type === 'stats') {
      const stats = await getTotalStats();
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } else if (type === 'emails') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const log = await getEmailLog(limit);
      return new Response(JSON.stringify(log), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } else if (type === 'sms') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const log = await getSmsLog(limit);
      return new Response(JSON.stringify(log), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    } else {
      return new Response(JSON.stringify({ error: 'Unknown type' }), { status: 400 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

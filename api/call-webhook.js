import { createClient } from '@vercel/kv';
import twilio from 'twilio';

const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }

  try {
    const data = req.body;
    const callId = data.call_id || data.id;
    const status = data.status || '';
    const duration = data.call_length || data.duration || 0;
    const transcript = data.transcripts ? JSON.stringify(data.transcripts) : '';
    const meta = data.metadata || {};
    const contactPhone = meta.contact_phone || data.to || '';
    const contactName = meta.contact_name || '';
    const industry = meta.industry || '';
    const painPoint = meta.pain_point || '';

    await kv.lpush('calls:outcomes', JSON.stringify({
      callId, status, duration, contactName, contactPhone, industry, painPoint,
      transcript: transcript.substring(0, 500),
      timestamp: Date.now()
    }));

    const voicemailStatuses = ['voicemail', 'no-answer', 'busy', 'failed'];
    const isVoicemail = voicemailStatuses.some(s => status.toLowerCase().includes(s));

    if (isVoicemail && contactPhone) {
      const firstName = contactName.split(' ')[0] || 'there';
      const followupMsg = 'Hey ' + firstName + ', this is Alex from Ascend Web Development. I just tried reaching you — I noticed something on your digital profile that could be costing you leads. Worth a quick look. Reply here or call us back anytime. - Ascend Web Dev';
      try {
        await twilioClient.messages.create({
          body: followupMsg,
          from: TWILIO_FROM,
          to: contactPhone
        });
        await kv.incr('stats:followup_sms');
      } catch(e) {
        console.error('followup SMS error:', e.message);
      }
    }

    if (status.toLowerCase().includes('completed') && duration > 60) {
      await kv.incr('stats:calls_answered');
    }

    res.status(200).json({ ok: true });
  } catch(e) {
    console.error('call-webhook error:', e.message);
    res.status(200).json({ ok: false, error: e.message });
  }
}

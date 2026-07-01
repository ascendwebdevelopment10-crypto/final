import { createClient } from '@vercel/kv';
import twilio from 'twilio';

const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

// Final statuses we care about — ignore intermediate ones (initiated, ringing, in-progress)
const FINAL_STATUSES = new Set(['completed', 'no-answer', 'busy', 'failed', 'canceled']);

export default async function handler(req, res) {
      if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }

  try {
          // Twilio sends status callbacks as form-encoded
        const {
                  CallSid:    callSid    = '',
                  CallStatus: callStatus = '',
                  Duration:   duration   = '0',
                  To:         toPhone    = '',
        } = req.body || {};

        // Only process final status — ignore initiated/ringing/in-progress
        if (!FINAL_STATUSES.has(callStatus)) {
                  return res.status(200).json({ ignored: true, callStatus });
        }

        // Contact context passed as query params from call-cron statusCallback URL
        const contactName = req.query.contactName || '';
          const industry    = req.query.industry    || '';
          const painPoint   = req.query.painPoint   || '';
          const phone       = req.query.phone       || toPhone;

        // Map to outcome label
        const outcomeMap = {
                  completed:   'completed',
                  'no-answer': 'no-answer',
                  busy:        'busy',
                  failed:      'failed',
                  canceled:    'canceled',
        };
          const outcome = outcomeMap[callStatus] || callStatus;

        // Write to calls:outcomes (what the dashboard reads via getCallLog)
        const logEntry = {
                  callSid,
                  status:       outcome,
                  duration:     parseInt(duration, 10),
                  contactPhone: phone,
                  contactName,
                  industry,
                  painPoint,
                  timestamp:    Date.now(),
        };
          await kv.lpush('calls:outcomes', JSON.stringify(logEntry));
          await kv.ltrim('calls:outcomes', 0, 499);

        // Update stats
        await kv.incr('stats:calls_made');
          if (outcome === 'completed') await kv.incr('stats:calls_answered');

        // Clean up conversation history
        if (callSid) await kv.del(`call:history:${callSid}`);

        // Send follow-up SMS on no-answer or busy
        if ((outcome === 'no-answer' || outcome === 'busy') && phone) {
                  const smsBody = `Hi${contactName ? ' ' + contactName : ''}, this is Alex from Ascend Web Development. I tried calling but missed you. We help ${industry || 'businesses'} get more clients through websites, ads & apps. Worth a quick chat? Reply anytime.`;
                  try {
                              await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: phone });
                              await kv.incr('stats:followup_sms');
                  } catch (smsErr) {
                              console.error('Follow-up SMS failed:', smsErr.message);
                  }
        }

        res.status(200).json({ received: true, callSid, outcome });
  } catch (err) {
          console.error('call-webhook error:', err);
          res.status(500).json({ error: err.message });
  }
}

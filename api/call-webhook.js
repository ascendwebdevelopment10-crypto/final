import { createClient } from '@vercel/kv';
import twilio from 'twilio';

const kv = createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }

  try {
        // Twilio sends status callbacks as form-encoded
      const {
              CallSid: callSid = '',
              CallStatus: callStatus = '',
              Duration: duration = '0',
              To: contactPhone = '',
      } = req.body || {};

      // Contact context passed as query params from call-cron.js statusCallbackUrl
      const contactName  = req.query.contactName  || '';
        const industry     = req.query.industry     || '';
        const painPoint    = req.query.painPoint    || '';
        const businessName = req.query.businessName || '';

      // Map Twilio statuses to our outcome labels
      const outcomeMap = {
              completed:  'completed',
              'no-answer': 'no-answer',
              busy:        'busy',
              failed:      'failed',
              canceled:    'canceled',
      };
        const outcome = outcomeMap[callStatus] || callStatus;

      // Log to KV calls:log list
      const logEntry = {
              callSid,
              status:    outcome,
              duration:  parseInt(duration, 10),
              phone:     contactPhone,
              name:      contactName,
              industry,
              painPoint,
              timestamp: new Date().toISOString(),
      };
        await kv.lpush('calls:log', JSON.stringify(logEntry));
        await kv.ltrim('calls:log', 0, 499); // keep last 500

      // Increment stats
      await kv.incr('stats:calls_made');
        if (outcome === 'completed') {
                await kv.incr('stats:calls_answered');
        }

      // Clean up conversation history from KV
      if (callSid) {
              await kv.del(`call:history:${callSid}`);
      }

      // Send follow-up SMS on no-answer or busy
      if ((outcome === 'no-answer' || outcome === 'busy') && contactPhone) {
              const smsBody = `Hi ${contactName || 'there'}, this is Alex from Ascend Web Development. I tried calling but couldn't reach you. We specialize in helping ${industry || 'businesses'} get more clients through modern websites and digital marketing. Would love to connect — reply here or visit our site!`;
              try {
                        await twilioClient.messages.create({
                                    body: smsBody,
                                    from: TWILIO_FROM,
                                    to:   contactPhone,
                        });
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

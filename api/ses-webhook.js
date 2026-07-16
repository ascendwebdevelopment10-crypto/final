import { kv } from '@vercel/kv';

// Receives AWS SNS notifications for SES bounces and complaints and adds the
// affected addresses to the suppression list so we never email them again.
// (Required to keep SES bounce/complaint rates below Amazon's thresholds.)
// In AWS: SES -> Configuration sets / Notifications -> SNS topic -> HTTPS
// subscription pointing at: https://final-phi-swart.vercel.app/api/ses-webhook
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // SNS asks the endpoint to confirm the subscription once.
    if (raw.Type === 'SubscriptionConfirmation' && raw.SubscribeURL) {
      await fetch(raw.SubscribeURL);
      res.status(200).json({ ok: true, confirmed: true });
      return;
    }

    if (raw.Type === 'Notification') {
      const msg = typeof raw.Message === 'string' ? JSON.parse(raw.Message) : (raw.Message || {});
      const t = msg.notificationType || msg.eventType;
      let recipients = [];
      if (t === 'Bounce' && msg.bounce && msg.bounce.bounceType === 'Permanent') {
        recipients = (msg.bounce.bouncedRecipients || []).map((r) => r.emailAddress);
      } else if (t === 'Complaint' && msg.complaint) {
        recipients = (msg.complaint.complainedRecipients || []).map((r) => r.emailAddress);
      }
      for (const e of recipients) {
        if (e) await kv.sadd('suppression:emails', e.toLowerCase());
      }
      res.status(200).json({ ok: true, suppressed: recipients.length });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('ses-webhook error:', e.message);
    res.status(200).json({ ok: true });
  }
}

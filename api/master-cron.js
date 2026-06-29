// api/master-cron.js
// Single master cron for Vercel Hobby (max 2 crons, daily minimum).
// Fires once per day and internally fans out to all three outreach tasks:
//   1. /api/cron       - SMS outreach (SMS_CAP=35) + email (EMAIL_CAP=0)
//   2. /api/email-cron - Email outreach (EMAIL_CAP=25)
//   3. /api/call-cron  - AI phone calls (CALL_CAP=17)
//
// vercel.json should have exactly ONE cron entry pointing here:
//   { "path": "/api/master-cron", "schedule": "0 15 * * *" }
//
// Each sub-task runs via an internal self-fetch so each handler executes
// in its own Vercel Function invocation with its own 60-second maxDuration.

export const config = { maxDuration: 60 };

const CRON_SECRET = process.env.CRON_SECRET;

// VERCEL_URL is set automatically by Vercel to the canonical deployment URL.
// Fall back to the known production URL if running in a context without it.
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
    : 'https://final-phi-swart.vercel.app';

    async function callEndpoint(path) {
      const url = BASE_URL + path;
        const headers = { Authorization: `Bearer ${CRON_SECRET}` };
          try {
              const res = await fetch(url, {
                    headers,
                          // Give each sub-task 55 s so we have 5 s of head-room before our
                                // own 60-second limit cuts us off.
                                      signal: AbortSignal.timeout(55000),
                                          });
                                              const json = await res.json().catch(() => ({ status: res.status }));
                                                  return { path, ok: res.ok, result: json };
                                                    } catch (e) {
                                                        return { path, ok: false, error: e.message };
                                                          }
                                                          }

                                                          export default async function handler(req, res) {
                                                            if (req.method !== 'GET') {
                                                                res.status(405).end('Method not allowed');
                                                                    return;
                                                                      }

                                                                        const auth = req.headers['authorization'];
                                                                          if (CRON_SECRET && auth !== 'Bearer ' + CRON_SECRET) {
                                                                              res.status(401).end('Unauthorized');
                                                                                  return;
                                                                                    }

                                                                                      const started = Date.now();

                                                                                        // Run SMS cron first (it also does email scraping), then email + calls in parallel.
                                                                                          const smsResult = await callEndpoint('/api/cron');
                                                                                            const [emailResult, callResult] = await Promise.all([
                                                                                                callEndpoint('/api/email-cron'),
                                                                                                    callEndpoint('/api/call-cron'),
                                                                                                      ]);
                                                                                                      
                                                                                                        res.status(200).json({
                                                                                                            masterCron: true,
                                                                                                                durationMs: Date.now() - started,
                                                                                                                    timestamp: new Date().toISOString(),
                                                                                                                        tasks: {
                                                                                                                              sms: smsResult,
                                                                                                                                    email: emailResult,
                                                                                                                                          calls: callResult,
                                                                                                                                              },
                                                                                                                                                });
                                                                                                                                                }

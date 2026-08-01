# Nitro Outreach change safety

Always begin work from the latest production `main` branch and preserve unrelated customer, billing, analytics, and outreach behavior.

The outreach engine is production-critical. Do not edit these files as part of an unrelated feature, refactor, merge cleanup, or formatting pass:

- `api/cron.js`
- `api/email-cron.js`
- `lib/leads.js`
- `lib/store.js`

Changes to a protected file require a dedicated outreach-engine task, a focused diff, and verification of scheduled email/SMS behavior before deployment.

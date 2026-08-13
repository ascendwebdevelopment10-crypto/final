# Nitro production verification report

Date: August 12, 2026  
Production: https://nitrooutreach.com  
Scope: public funnel, authenticated owner workspace, analytics, website generation, Prompt-to-Reel, Instagram scheduling, outreach, Stripe contracts, and deployment safety.

## Executive result

Nitro’s production application is live and the audited public routes, authenticated sections, pricing controls, publishing queue, template selector, and Reel configuration render without a generic application error. The repository passes 22 automated tests plus syntax checks across every server-side JavaScript file and the customer client.

Safe fixes were deployed through a tested Vercel preview before production. The final deployment ID and post-deploy error scan are recorded below.

## Production data verified

The owner Outreach dashboard was read directly from production after deployment:

| Metric | Total | Today | Meaning |
|---|---:|---:|---|
| Tracked sends | 300 | 66 | Sends recorded since the clean tracking cutoff on August 4 |
| Delivered | 140 | 34 | Provider delivery event or later recipient activity; no longer mislabeled as provider-only |
| Opened | 140 | 34 | Tracking-pixel image requests; still labeled as estimated |
| Link loaded | 33 | 9 | Link loads; may include security scanners |
| Confirmed visits | 32 | 8 | Active on-site engagement, not a raw link request |
| Replies | 0 | 0 | Inbound replies recorded by Nitro |
| Failed | 0 | 0 | Bounce, complaint, suppression, or provider failure |

The analytics pipeline was inspected for bot user agents, data-center cities, coordinated scanner bursts, rapid duplicates, 30-minute visit grouping, anonymous-browser identity, signed-in identity, source attribution, and Mountain Time day boundaries. Automated/scanner exclusions have dedicated regression tests.

## Changes completed

### Production app and mobile contracts

- Verified `/`, `/pricing`, `/login`, `/signup`, `/audit`, `/privacy`, and `/terms` return HTTP 200 in preview and production.
- Verified every authenticated section renders: Dashboard, Outreach, Websites, Content, Socials, Ads, Messaging, AI Assistant, Analytics, Billing, Settings, and Owner.
- Verified pricing monthly/yearly switching produces $25, $50, and $150 monthly prices and the expected annual totals.
- Verified required signup fields stop a blank submission without creating an account.
- Verified responsive contracts at 1220, 1080, 900, 760, and 430px, including single-column Social and DM layouts. The available cloud browser had a fixed desktop viewport, so phone-specific visual screenshots remain a manual-device check rather than a claimed visual pass.
- Replaced the protected-route landing-page flash with a branded loading state while the session is resolved.
- Prevented decorative homepage elements from creating horizontal document overflow.

### Website generator

- Added ten named template families: Editorial, Split Impact, Cinematic, Bento, Sidecar, Storefront, Showcase, Command Center, Organic, and Luxury Minimal.
- Added the template selector to the real production creation modal.
- Completed a real owner-account generation for the Editorial family. The resulting page loaded in production with four working images, no blank or `#`-only links, tablet/phone CSS, reduced-motion handling, and no desktop horizontal overflow.
- Preserved recipe/history variation inside each family to reduce repeated output.
- Enforced mobile/tablet/desktop output, accessible focus, reduced motion, contrast, compact markup, and approved image rules in the generation brief.
- Repaired placeholder `href="#"` CTAs to `#contact` and instructed the generator to use supplied phone, email, booking, or real section links.
- Kept fast generation behavior: stronger model with extended thinking disabled, provider fallback, parallel site/storage persistence, and recorded `generationMs` telemetry.

### Prompt-to-Reel

- Verified six creative starting concepts, four visual tones, six voice modes, and 15/30/45-second durations.
- Verified the UI and server both charge 1/2/3 credits for 15/30/45 seconds.
- Verified narration word budgets, natural pause guidance, continuous cinematic movement, varied visual worlds/camera moves/story shapes, recent-style avoidance, preview player, progress feedback, download, and Instagram publishing controls.
- Verified server-side credit reservation and refund-on-failure paths by code and contract tests.
- Completed a real owner-account production render: a 15.0-second, 1080×1920 vertical MP4 reached playback ready state 4, was saved in Content Studio, and exposed working Watch, Download, and Instagram publishing controls. The owner/free path did not consume a paid allowance.

### Instagram scheduling and content

- Six polished 1080px campaign images and captions are present and scheduled daily for August 13–18 at 11:30 AM Mountain Time.
- The live owner Social workspace now shows those six system-managed posts in the publishing queue instead of incorrectly showing zero scheduled.
- The five-minute publishing worker is configured and returns successfully in production logs.
- Added an in-product DM playbook with copy buttons for Interested, Unsure, and Not interested responses.

### Lead research

- Qualified six new Utah businesses with publicly verified Instagram counts below 500: Canyon Detail Lab (43), Classy Detailing (10), Big Bro Detail (29), Cake Club SLC (80), Primula Horticulture & Design (254), and BrightMint Cleaning (4).
- Each has a public site or usable contact path and was not part of the previously contacted group.
- No message was sent to this new batch during research. See `research/qualified-businesses-2026-08-12.md` for evidence and priority.

### Signup, pricing, Stripe, and gating

- Confirmed client and server agree on all four plan prices, website limits, AI allowances, and Reel allowances.
- Confirmed Checkout uses server-owned prices, same-origin checks, signed-in checks, owner-account blocking, and duplicate-subscription blocking.
- Confirmed Stripe webhooks verify raw-body signatures and prepaid credit fulfillment is idempotent.
- Fixed subscription activation/renewal so AI usage resets and the plan’s included Reel allowance is restored without deleting a larger prepaid balance.
- Confirmed checkout wording: 14-day trial, automatic renewal until canceled, Stripe-hosted card entry, and no card for Free.

### Outreach provider tracking

- Corrected the Delivered subtitle from “Confirmed by provider” to “Provider or recipient evidence.”
- Added safe diagnostic states for missing, restricted, rate-limited, or unavailable webhook management.
- Added the required explicit User-Agent for direct Resend management requests.
- Hardened `/webhook` with raw-body Svix/Resend HMAC verification, five-minute replay tolerance, and constant-time comparison. Spoofed or modified payloads now receive HTTP 401.
- Production now reports `restricted_api_key`: the current Resend key can send mail but cannot list/create/update webhooks. The remaining external action is to replace `RESEND_API_KEY` with a Resend `full_access` key.
- Rejected unrelated vendor, site-builder, and telemetry addresses when an email domain does not match the business website, while continuing to allow business-owned and common public inboxes.

## Verification matrix

| Area | Result | Evidence |
|---|---|---|
| Public routes | Pass | 7/7 returned HTTP 200 |
| Pricing toggle | Pass | Correct monthly and annual display |
| Signup validation | Pass | Blank submission blocked |
| Authenticated navigation | Pass | 12/12 sections rendered |
| Website templates | Pass | 10 unique IDs, names, and layout specifications; production selector visible |
| Generated website | Pass | Real owner-account generation; four images, responsive CSS, reduced motion, no dead links or horizontal overflow |
| Generated CTA safety | Pass | Live generated page plus dead-link repair contract |
| Reel price/gating | Pass | Client/server 1/2/3-credit parity |
| Reel production render | Pass | Live 15.0-second 1080×1920 MP4; playback ready state 4 |
| Social scheduling | Pass | Six-post live queue and five-minute worker |
| DM scripts | Pass | Three live scripts with copy controls |
| Analytics filtering | Pass | Bot/scanner/duplicate attribution tests pass |
| Today/Delivered statistics | Pass with disclosure | Production values read directly; delivery evidence wording corrected |
| Stripe lifecycle | Pass | Signed checkout, webhook verification, idempotency, allowance restoration |
| Resend webhook authenticity | Pass in code | Valid signature accepted; tampered payload rejected |
| Mobile structure | Pass | Responsive CSS contracts and single-column collapse tested |
| Mobile visual device sweep | Manual check | Fixed cloud viewport prevented genuine phone screenshots |
| GitHub synchronization | Blocked | Required `gh` CLI is not available in this workspace; production deployment is complete independently |

## Automated test result

`node --test tests/*.test.js`: 22 passed, 0 failed.  
All `api/**/*.js`, `lib/**/*.js`, and `public/customer/app.js` passed `node --check`.  
`git diff --check` passed.

## Deployment result

- Preview deployment: READY
- Production target: READY
- Production alias: https://nitrooutreach.com
- Framework: Vercel Functions/static app
- Production deployment ID: `dpl_FQHKN7o5uRdD4JqaMwLWxHUVnf23`
- Production form check: the shared `Business name` and `Design template` labels resolve programmatically, and the template selector can be controlled by its accessible label.
- Post-deploy route check: all seven audited public routes and both changed static assets returned HTTP 200 from `nitrooutreach.com`.
- Post-deploy runtime error scan: no error was attributed to the final deployment. Vercel still groups one historical Node `DEP0169` `url.parse()` deprecation warning from the prior deployment; no application source uses `url.parse()`, so this is dependency/platform noise rather than a Nitro request failure.

## Remaining external/manual items

1. Create a Resend full-access key, replace `RESEND_API_KEY` in Vercel Production, and redeploy. Do not paste the key into chat. The live dashboard confirms that the current sending-only key is the reason provider webhook management is unavailable.
2. Run a final visual sweep on one actual iPhone and one Android device. Structural breakpoints are tested, but the available browser viewport could not emulate a phone honestly.
3. Install/authenticate GitHub CLI if the local changes must be committed and pushed from this environment. The production app itself is already deployed.

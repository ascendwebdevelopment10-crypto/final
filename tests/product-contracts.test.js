import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WEBSITE_TEMPLATES } from '../api/customer-workspace.js';
import { CUSTOMER_PLANS } from '../lib/customer-plans.js';
import { validWebhookSignature } from '../api/webhook.js';
import crypto from 'node:crypto';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('website builder exposes ten genuinely named template families', () => {
  assert.equal(WEBSITE_TEMPLATES.length, 10);
  assert.equal(new Set(WEBSITE_TEMPLATES.map(item => item.id)).size, 10);
  assert.equal(new Set(WEBSITE_TEMPLATES.map(item => item.layout)).size, 10);
});

test('website builder UI sends a selected template and backend repairs dead CTAs', async () => {
  const [client, backend] = await Promise.all([read('../public/customer/app.js'), read('../api/customer-workspace.js')]);
  for (const template of WEBSITE_TEMPLATES) assert.match(client, new RegExp(`['"]${template.id}['"]`));
  assert.match(client, /v\.template=WEBSITE_TEMPLATE_IDS/);
  assert.match(backend, /href\\s\*=\\s\*\(\["'\]\)#\\1/);
  assert.match(backend, /Never emit href="#"/);
});

test('website generation shows staged progress until the finished site is saved', async () => {
  const [client, css] = await Promise.all([read('../public/customer/app.js'), read('../public/customer/app.css')]);
  assert.match(client, /function websiteProgressModal/);
  assert.match(client, /Choosing the design system/);
  assert.match(client, /Wiring buttons and mobile layout/);
  assert.match(client, /Your website is ready/);
  assert.match(client, /await progress\.complete\(\)/);
  assert.match(css, /\.website-progress/);
  assert.match(css, /\.build-stage-list/);
});

test('public plan prices and allowances match the server source of truth', async () => {
  const client = await read('../public/customer/app.js');
  for (const plan of Object.values(CUSTOMER_PLANS)) {
    assert.match(client, new RegExp(`${plan.id}:\\{id:'${plan.id}',name:'${plan.name}',monthly:${plan.monthly},yearly:${plan.yearly},credits:${plan.aiCredits === null ? 'null' : plan.aiCredits},contentCredits:${plan.contentCredits}`));
  }
});

test('Stripe lifecycle restores monthly Content allowances without deleting prepaid credits', async () => {
  const source = await read('../api/stripe-webhook.js');
  assert.match(source, /user\.usage\.aiUsed = 0/);
  assert.match(source, /Math\.max\(contentCreditBalance\(user\), Number\(plan\.contentCredits \|\| 0\)\)/);
  assert.match(source, /applyPlanAllowance\(user, plan\)/);
  assert.match(source, /applyPlanAllowance\(user, user\.subscription\.plan\)/);
});

test('customer Content credits are affordable and Reel Lab is owner-only', async () => {
  const [render, client, workspace, credits] = await Promise.all([read('../api/video-render.js'), read('../public/customer/app.js'), read('../api/customer-workspace.js'), read('../api/video-credits.js')]);
  assert.match(render, /Reel Lab is an owner-only experimental tool/);
  assert.match(client, /OWNER-ONLY EXPERIMENT/);
  assert.match(client, /Image · 1/);
  assert.match(client, /Carousel · 2/);
  assert.match(workspace, /spendContentCredits\(user, 1\)/);
  assert.match(workspace, /spendContentCredits\(user, 2\)/);
  assert.match(credits, /credits: 25, amountCents: 499/);
  assert.match(credits, /credits: 2500, amountCents: 24999/);
});

test('public marketing removes customer Reel generation and matches the implemented multi-platform scheduler', async () => {
  const landing = await read('../public/current-stacked-preview/index.html');
  assert.doesNotMatch(landing, /Prompt-to-Reel|Generate Reels|CONTENT & REELS/i);
  assert.match(landing, /schedule Instagram automatically/);
  const client = await read('../public/customer/app.js');
  assert.match(client, /Connect every channel\. Schedule once\./);
  assert.match(client, /All public-ready connected platforms/);
});

test('owner publishing queue and all three DM response scripts are visible in the workspace', async () => {
  const client = await read('../public/customer/app.js');
  assert.match(client, /NITRO_CAMPAIGN_QUEUE=\[/);
  assert.equal((client.match(/'2026-08-[a-z-]+'/g) || []).length, 6);
  assert.match(client, /social-queue-grid/);
  assert.match(client, /Scheduled post preview/);
  for (const intent of ['Interested', 'Unsure', 'Not interested']) assert.match(client, new RegExp(`\\['${intent}'`));
  assert.match(client, /data-copy-dm/);
});

test('outreach conversion path includes a focused landing page, full funnel tracking, and beta pipeline', async () => {
  const [app, css, followup, cron] = await Promise.all([
    read('../public/customer/app.js'), read('../public/customer/app.css'),
    read('../api/outreach-followup-cron.js'), read('../vercel.json'),
  ]);
  assert.match(app, /function renderStart\(/);
  assert.match(app, /trackFunnelStage\('signup_viewed'\)/);
  assert.match(app, /trackFunnelStage\('signup_started'\)/);
  assert.match(app, /trackFunnelStage\('signup_submitted'\)/);
  assert.match(app, /Three-business beta pipeline/);
  assert.match(css, /\.beta-candidate-grid/);
  assert.match(followup, /email:confirmed-visits:first/);
  assert.match(followup, /engaged_followup/);
  assert.match(cron, /outreach-followup-cron/);
});

test('responsive contracts cover desktop, tablet, phone, and compact phone layouts', async () => {
  const css = await read('../public/customer/app.css');
  for (const breakpoint of ['1220px', '1080px', '900px', '760px', '430px']) assert.match(css, new RegExp(`max-width:${breakpoint}`));
  assert.match(css, /\.social-account-grid,\.dm-script-grid\{grid-template-columns:1fr\}/);
});

test('owner navigation stays viewport-bound and keeps owner shortcuts first', async () => {
  const [client, css] = await Promise.all([read('../public/customer/app.js'), read('../public/customer/app.css')]);
  assert.match(client, /sidebar-primary-nav/);
  assert.ok(client.indexOf('<div class="side-label">Owner<\/div>') < client.indexOf('<div class="side-label">Workspace<\/div>'));
  assert.match(client, /root\.classList\.remove\('render-enter'\)/);
  assert.match(client, /root\.addEventListener\('animationend',clearEntryTransform/);
  assert.match(css, /\.sidebar\{height:100dvh;overflow:hidden\}/);
  assert.match(css, /\.sidebar-primary-nav\{[^}]*overflow-y:auto/);
  assert.match(client, /function resetWorkspaceRoutePosition\(\)/);
  assert.match(client, /\.sidebar-primary-nav'\)\?\.scrollTo/);
  assert.match(client, /\.desktop-quick-wrap'\)\?\.classList\.remove\('open'\)/);
  assert.match(client, /scrollTo\(\{top:0,left:0,behavior:'instant'\}\)/);
  assert.match(client, /state\.mobileMenu=false;resetWorkspaceRoutePosition\(\);render\(\)/);
});

test('protected routes show a branded loader without exposing the landing page', async () => {
  const [client, index, finalCss] = await Promise.all([
    read('../public/customer/app.js'),
    read('../public/index.html'),
    read('../public/customer/final-fixes.css'),
  ]);
  assert.match(client, /protectedInitialRoute/);
  assert.match(client, /Loading your workspace/);
  assert.match(index, /customer\/final-fixes\.css/);
  assert.match(finalCss, /body\{overflow-x:hidden\}/);
  assert.match(finalCss, /\.route-loading-shell/);
});

test('shared modal fields expose programmatic label associations', async () => {
  const client = await read('../public/customer/app.js');
  assert.ok(client.includes('label for="${fieldId}"'));
  assert.ok(client.includes('id="${fieldId}" class="input"'));
  assert.ok(client.includes('id="${fieldId}" class="select"'));
});

test('outreach dashboard removes the redundant Delivered summary and explains conservative opens', async () => {
  const client = await read('../public/customer/app.js');
  assert.match(client, /Likely human opens/);
  assert.match(client, /Filtered opens/);
  assert.doesNotMatch(client, /outreachStat\('Delivered'/);
  assert.match(client, /workspaceTheme/);
  assert.match(client, /\.main-area\{background:radial-gradient/);
});

test('Instagram publishing buttons inherit the selected workspace appearance', async () => {
  const [css, client] = await Promise.all([read('../public/customer/app.css'), read('../public/customer/app.js')]);
  const rule = css.match(/\.ig-post-btn\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /var\(--green\)/);
  assert.match(rule, /var\(--aqua\)/);
  assert.doesNotMatch(rule, /#f09433|#dc2743|#bc1888/i);
  assert.match(client, /\.modal-overlay\{--green:/);
  assert.match(css, /#customer-shell \.btn,.modal-overlay \.btn/);
  assert.match(css, /#customer-shell \.btn-primary,.modal-overlay \.btn-primary/);
  assert.match(css, /#customer-shell \.btn-reel,.modal-overlay \.btn-reel/);
});

test('Reel studio uses continuity references and customer production controls', async () => {
  const [render, client] = await Promise.all([read('../api/video-render.js'), read('../public/customer/app.js')]);
  assert.match(render, /ANTHROPIC_REEL_MODEL/);
  assert.match(render, /quality', 'medium'/);
  assert.match(render, /strict continuity reference/);
  assert.match(render, /productionStyle/);
  assert.match(render, /mustShow/);
  assert.match(render, /referenceImage/);
  assert.match(client, /Real business footage/);
  assert.match(client, /Reference image \(recommended\)/);
  assert.match(client, /Never show/);
});

test('Reel templates are distinct production systems wired through the renderer', async () => {
  const [render, client, css] = await Promise.all([read('../api/video-render.js'), read('../public/customer/app.js'), read('../public/customer/app.css')]);
  for (const id of ['founder_pov', 'product_proof', 'mini_doc', 'kinetic_editorial', 'cinematic_reveal', 'local_day']) {
    assert.match(client, new RegExp(`id:'${id}'`));
    assert.match(render, new RegExp(`${id}:`));
  }
  assert.match(client, /templateId,prompt:value/);
  assert.match(render, /Production system:/);
  assert.match(render, /Template camera language:/);
  assert.match(css, /--template-accent/);
});

test('the two pre-release owner audit tests are removed without touching new leads', async () => {
  const source = await read('../api/owner-data.js');
  assert.match(source, /AUDIT_LEAD_CLEAN_START/);
  assert.match(source, /slice\(0, 2\)/);
  assert.match(source, /kv\.lrem\('growth:audits', 0, lead\.id\)/);
});

test('owner visitors stay separate and show business location apart from detected IP location', async () => {
  const [ownerData, client, store, emailCron] = await Promise.all([
    read('../api/owner-data.js'), read('../public/customer/app.js'), read('../lib/store.js'), read('../api/email-cron.js'),
  ]);
  assert.match(ownerData, /enrichVisitorsWithOutreach/);
  assert.match(client, /Business location/);
  assert.match(client, /Detected visit/);
  assert.match(client, /individual visitors/);
  assert.doesNotMatch(client, /groupVisitorsByLocation/);
  assert.match(store, /businessLocation/);
  assert.match(emailCron, /businessLocation: contact\.businessLocation/);
});

test('outreach emails hide the long attribution URL behind a short CTA', async () => {
  const source = await read('../api/email-cron.js');
  assert.match(source, />Start free<\/a>/);
  assert.match(source, /text: textBody \+ footerText/);
  assert.match(source, /body: textBody/);
  assert.doesNotMatch(source, /const trackedBody = body\.replaceAll/);
});

test('Resend webhook accepts a fresh valid signature and rejects tampering', () => {
  const secretBytes = crypto.randomBytes(32);
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const payload = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email_123' } });
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${payload}`).digest('base64');
  const req = { headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` } };
  assert.equal(validWebhookSignature(payload, req, secret), true);
  assert.equal(validWebhookSignature(`${payload} `, req, secret), false);
});

test('webhook registration reports restricted Resend keys without exposing credentials', async () => {
  const source = await read('../lib/outreach-webhook.js');
  assert.match(source, /restricted_api_key/);
  assert.match(source, /full-access key/);
  assert.match(source, /User-Agent/);
  assert.doesNotMatch(source, /console\.log\([^\n]*RESEND_API_KEY/);
});

test('important failures and business events have owner alerts', async () => {
  const [auth, lead, stripe, social, workspace, renderCallback, webhook, sms] = await Promise.all([
    read('../api/customer-auth.js'), read('../api/lead.js'), read('../api/stripe-webhook.js'),
    read('../api/social-cron.js'), read('../api/customer-workspace.js'), read('../api/video-render-callback.js'),
    read('../api/webhook.js'), read('../api/sms-webhook.js'),
  ]);
  assert.match(auth, /New Nitro signup/);
  assert.match(lead, /New qualified website lead/);
  assert.match(stripe, /Nitro payment failed/);
  assert.match(social, /Scheduled social post failed/);
  assert.match(workspace, /Nitro generation failed/);
  assert.match(renderCallback, /Nitro Reel generation failed/);
  assert.match(webhook, /New outreach reply/);
  assert.match(sms, /New SMS reply/);
});

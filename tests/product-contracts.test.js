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

test('public plan prices and allowances match the server source of truth', async () => {
  const client = await read('../public/customer/app.js');
  for (const plan of Object.values(CUSTOMER_PLANS)) {
    assert.match(client, new RegExp(`${plan.id}:\\{id:'${plan.id}',name:'${plan.name}',monthly:${plan.monthly},yearly:${plan.yearly},credits:${plan.aiCredits === null ? 'null' : plan.aiCredits},reelCredits:${plan.reelCredits}`));
  }
});

test('Stripe lifecycle restores monthly included allowances without deleting prepaid credits', async () => {
  const source = await read('../api/stripe-webhook.js');
  assert.match(source, /user\.usage\.aiUsed = 0/);
  assert.match(source, /Math\.max\(Number\(user\.usage\.videoCredits \|\| 0\), Number\(plan\.reelCredits \|\| 0\)\)/);
  assert.match(source, /applyPlanAllowance\(user, plan\)/);
  assert.match(source, /applyPlanAllowance\(user, user\.subscription\.plan\)/);
});

test('Reel duration pricing and UI credit display agree', async () => {
  const [render, client] = await Promise.all([read('../api/video-render.js'), read('../public/customer/app.js')]);
  assert.match(render, /CREDIT_COST = \{ 15: 1, 30: 2, 45: 3 \}/);
  assert.match(client, /15 sec · 1 credit/);
  assert.match(client, /30 sec · 2 credits/);
  assert.match(client, /45 sec · 3 credits/);
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

test('responsive contracts cover desktop, tablet, phone, and compact phone layouts', async () => {
  const css = await read('../public/customer/app.css');
  for (const breakpoint of ['1220px', '1080px', '900px', '760px', '430px']) assert.match(css, new RegExp(`max-width:${breakpoint}`));
  assert.match(css, /\.social-account-grid,\.dm-script-grid\{grid-template-columns:1fr\}/);
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

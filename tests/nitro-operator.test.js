import test from 'node:test';
import assert from 'node:assert/strict';
import { inferOperatorAction, operatorAgent, operatorFallbackResponse, operatorPriorities, operatorSnapshot } from '../lib/nitro-operator.js';

test('builds an honest operator snapshot from customer workspace data', () => {
  const snapshot = operatorSnapshot({
    workspace: {
      websites: [{ id: 'site-1' }],
      content: [{ type: 'video' }, { type: 'image' }],
      socialDrafts: [{ status: 'scheduled' }, { status: 'published' }],
      campaigns: [{ status: 'active' }, { status: 'paused' }],
      messages: [{ status: 'sent' }, { status: 'reply' }],
      connections: { email: { connected: true }, sms: { connected: false } },
    },
    meta: { connected: true, igUserId: 'ig-1' },
    socialConnections: { facebook: { connected: true }, linkedin: { connected: false } },
  });
  assert.deepEqual(snapshot, {
    websites: 1, content: 2, reels: 1, socialScheduled: 1, socialPublished: 1,
    connectedSocials: 2, campaigns: 2, activeCampaigns: 1, pausedCampaigns: 1,
    sentMessages: 1, replies: 1, scheduledMessages: 0, connectedMessaging: 1,
  });
});

test('priorities point users to real Nitro workspaces without claiming execution', () => {
  const priorities = operatorPriorities(operatorSnapshot({ workspace: {} }));
  assert.equal(priorities[0].route, '#websites');
  assert.ok(priorities.some(item => item.route === '#social'));
  assert.ok(priorities.every(item => !/has been|was completed|was published|was sent/i.test(item.detail)));
});

test('routes operator commands to a specialized agent and workspace', () => {
  assert.deepEqual(inferOperatorAction('Make me three Instagram posts'), { type: 'content', label: 'Open Content Studio', route: '#content' });
  assert.equal(inferOperatorAction('Show me traffic and conversion performance').route, '#analytics');
  assert.equal(operatorAgent('Pause the weak ad campaign'), 'Growth agent');
  assert.equal(inferOperatorAction('Tell me what to focus on'), null);
});

test('returns a useful verified briefing when an AI provider is unavailable', () => {
  const snapshot = { websites: 1, content: 3, socialScheduled: 2, connectedSocials: 3, activeCampaigns: 1, replies: 0 };
  const priorities = [{ title: 'Review performance', detail: 'Use verified results to choose the next move.' }];
  const answer = operatorFallbackResponse('Give me my business briefing', snapshot, priorities, 'Nitro Outreach');
  assert.match(answer, /Nitro Outreach briefing/);
  assert.match(answer, /3 content assets/);
  assert.match(answer, /3\/5 social channels connected/);
  assert.match(answer, /Best next move:.*Review performance/);
  assert.doesNotMatch(answer, /undefined/i);
});

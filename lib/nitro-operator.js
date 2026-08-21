const ROUTES = Object.freeze({
  website: '#websites',
  content: '#content',
  social: '#social',
  outreach: '#outreach',
  messaging: '#messages',
  ads: '#ads',
  analytics: '#analytics',
  billing: '#billing',
  settings: '#settings',
});

function count(items, predicate = () => true) {
  return Array.isArray(items) ? items.filter(predicate).length : 0;
}

export function operatorSnapshot(user = {}) {
  const workspace = user.workspace || {};
  const socialConnections = user.socialConnections || {};
  const instagramConnected = user.meta?.connected === true && Boolean(user.meta?.igUserId);
  const connectedSocials = ['facebook', 'tiktok', 'linkedin', 'youtube']
    .filter(platform => socialConnections[platform]?.connected).length + (instagramConnected ? 1 : 0);
  const messages = Array.isArray(workspace.messages) ? workspace.messages : [];
  const socialDrafts = Array.isArray(workspace.socialDrafts) ? workspace.socialDrafts : [];
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
  const connections = workspace.connections || {};

  return {
    websites: count(workspace.websites),
    content: count(workspace.content),
    reels: count(workspace.content, item => item?.type === 'video'),
    socialScheduled: count(socialDrafts, item => item?.status === 'scheduled'),
    socialPublished: count(socialDrafts, item => item?.status === 'published'),
    connectedSocials,
    campaigns: campaigns.length,
    activeCampaigns: count(campaigns, item => item?.status === 'active'),
    pausedCampaigns: count(campaigns, item => item?.status === 'paused'),
    sentMessages: count(messages, item => item?.status === 'sent'),
    replies: count(messages, item => item?.status === 'reply'),
    scheduledMessages: count(messages, item => item?.status === 'scheduled'),
    connectedMessaging: ['email', 'sms'].filter(channel => connections[channel]?.connected).length,
  };
}

export function operatorPriorities(snapshot = {}) {
  const priorities = [];
  if (!snapshot.websites) priorities.push({ level: 'high', title: 'Launch a conversion destination', detail: 'There is no website project in this workspace yet.', route: ROUTES.website, agent: 'Site agent' });
  if (!snapshot.connectedSocials) priorities.push({ level: 'high', title: 'Connect a publishing channel', detail: 'Content cannot publish automatically until at least one social account is connected.', route: ROUTES.social, agent: 'Publisher agent' });
  if (!snapshot.content) priorities.push({ level: 'medium', title: 'Create the first campaign asset', detail: 'The content library is empty.', route: ROUTES.content, agent: 'Content agent' });
  if (!snapshot.sentMessages && !snapshot.scheduledMessages) priorities.push({ level: 'medium', title: 'Start a tracked conversation', detail: 'No customer messages are sent or scheduled in this workspace.', route: ROUTES.messaging, agent: 'Outreach agent' });
  if (snapshot.pausedCampaigns) priorities.push({ level: 'medium', title: 'Review paused campaigns', detail: `${snapshot.pausedCampaigns} campaign${snapshot.pausedCampaigns === 1 ? ' is' : 's are'} paused.`, route: ROUTES.ads, agent: 'Growth agent' });
  if (snapshot.replies) priorities.push({ level: 'high', title: 'Respond while interest is fresh', detail: `${snapshot.replies} inbound repl${snapshot.replies === 1 ? 'y is' : 'ies are'} available.`, route: ROUTES.messaging, agent: 'Outreach agent' });
  if (!priorities.length) priorities.push({ level: 'low', title: 'Review performance and optimize', detail: 'The core workspace is active. Use verified results to choose the next experiment.', route: ROUTES.analytics, agent: 'Growth agent' });
  return priorities.slice(0, 4);
}

export function inferOperatorAction(prompt = '') {
  const value = String(prompt).toLowerCase();
  const rules = [
    [/(website|landing page|site\b|conversion page)/, 'website', 'Open Website Builder'],
    [/(publish|schedule|connect).*(instagram|facebook|tiktok|linkedin|youtube|social|post)|(instagram|facebook|tiktok|linkedin|youtube|social|post).*(publish|schedule|connect)/, 'social', 'Open Socials'],
    [/(reel|carousel|caption|content|posts?\b|creative)/, 'content', 'Open Content Studio'],
    [/(instagram|facebook|tiktok|linkedin|youtube|social)/, 'social', 'Open Socials'],
    [/(cold email|outreach engine|prospect|lead list)/, 'outreach', 'Open Outreach'],
    [/(email|sms|text message|reply|follow up|follow-up|inbox)/, 'messaging', 'Open Messaging'],
    [/(ad\b|ads\b|campaign|roas|return on ad|budget)/, 'ads', 'Open Ads'],
    [/(analytics|metric|performance|traffic|visitor|conversion|report)/, 'analytics', 'Open Analytics'],
    [/(plan|upgrade|credit|billing|price)/, 'billing', 'Open Billing'],
    [/(brand|color|company info|setting)/, 'settings', 'Open Settings'],
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  if (!matched) return null;
  return { type: matched[1], label: matched[2], route: ROUTES[matched[1]] };
}

export function operatorAgent(prompt = '') {
  const action = inferOperatorAction(prompt);
  return ({ website: 'Site agent', content: 'Content agent', social: 'Publisher agent', outreach: 'Outreach agent', messaging: 'Outreach agent', ads: 'Growth agent', analytics: 'Growth agent' })[action?.type] || 'Operator';
}

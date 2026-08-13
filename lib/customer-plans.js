export const CUSTOMER_PLANS = {
  free: {
    id: 'free', name: 'Free', monthly: 0, yearly: 0, aiCredits: 5, contentCredits: 5, websites: 1, recommended: false,
    description: 'Build your first website and explore Nitro’s core tools—free, with no credit card.',
    featureLabel: 'Included free',
    features: ['1 website project', '5 AI generations / month', '5 Content credits / month', 'Save up to 5 content pieces', 'Basic analytics', 'Community support'],
  },
  starter: {
    id: 'starter', name: 'Starter', monthly: 25, yearly: 250, aiCredits: 50, contentCredits: 25, websites: 3, recommended: false,
    description: 'Create and publish consistent marketing for one growing business or solo brand.',
    featureLabel: 'Upgrade from Free — you add',
    features: ['50 AI generations / month', '3 website projects', '25 Content credits / month', 'Publish directly to Instagram', 'Schedule Instagram posts', 'One queue for every connected channel', 'Email support'],
  },
  growth: {
    id: 'growth', name: 'Growth', monthly: 50, yearly: 500, aiCredits: 150, contentCredits: 75, websites: 10, recommended: true,
    description: 'Automate outreach, publish more content, and track the channels driving real results.',
    featureLabel: 'Upgrade from Starter — you add',
    features: ['150 AI generations / month', '10 website projects', '75 Content credits / month', 'Publish directly to Instagram', 'Schedule Instagram posts', 'One queue for every connected channel', 'Automated email and text outreach', 'Ad campaign management', 'Full analytics dashboard', 'Priority email support'],
  },
  pro: {
    id: 'pro', name: 'Pro', monthly: 150, yearly: 1500, aiCredits: null, contentCredits: 250, websites: null, recommended: false,
    description: 'Run high-volume marketing with unlimited creation, automation, and team tools.',
    featureLabel: 'Upgrade from Growth — you add',
    features: ['Unlimited AI generations', 'Unlimited website projects', '250 Content credits / month', 'Publish directly to Instagram', 'Schedule Instagram posts', 'One queue for every connected channel', 'Built-in CRM and automations', 'Team access and white-label tools', 'API access', 'Priority support'],
  },
};

export function planFor(id) {
  return CUSTOMER_PLANS[String(id || '').toLowerCase()] || CUSTOMER_PLANS.free;
}

export function publicPlans() {
  return Object.values(CUSTOMER_PLANS);
}

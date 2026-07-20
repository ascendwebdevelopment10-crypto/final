export const CUSTOMER_PLANS = {
  free: {
    id: 'free', name: 'Free', monthly: 0, yearly: 0, aiCredits: 5, websites: 1, recommended: false,
    description: 'Try Nitro Outreach and launch one project.',
    features: ['1 website project', '5 AI generations / month', 'Save up to 5 content pieces', 'Basic analytics', 'Community support'],
  },
  starter: {
    id: 'starter', name: 'Starter', monthly: 25, yearly: 250, aiCredits: 50, websites: 3, recommended: false,
    description: 'For solo operators getting consistent.',
    features: ['Everything in Free', '50 AI generations / month', '3 websites', 'Social drafts & scheduling', 'Email support'],
  },
  growth: {
    id: 'growth', name: 'Growth', monthly: 50, yearly: 500, aiCredits: 150, websites: 10, recommended: true,
    description: 'For growing businesses that need more firepower.',
    features: ['Everything in Starter', '150 AI generations / month', '10 websites', 'Ad campaign management', 'Analytics dashboard', 'Priority email support'],
  },
  pro: {
    id: 'pro', name: 'Pro', monthly: 150, yearly: 1500, aiCredits: null, websites: null, recommended: false,
    description: 'The complete growth system with unlimited scale.',
    features: ['Everything in Growth', 'Unlimited AI generations', 'Unlimited websites', 'Built-in CRM & automations', 'Team members & white-label', 'API access', 'Priority support'],
  },
};

export function planFor(id) {
  return CUSTOMER_PLANS[String(id || '').toLowerCase()] || CUSTOMER_PLANS.free;
}

export function publicPlans() {
  return Object.values(CUSTOMER_PLANS);
}

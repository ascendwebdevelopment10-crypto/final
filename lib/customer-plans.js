export const CUSTOMER_PLANS = {
  free: {
    id: 'free', name: 'Free', monthly: 0, yearly: 0, aiCredits: 5, websites: 1, recommended: false,
    description: 'Try Ascend and launch one project.',
    features: ['1 website project', '5 AI generations / month', 'Save up to 5 content pieces', 'Basic analytics', 'Community support'],
  },
  starter: {
    id: 'starter', name: 'Starter', monthly: 30, yearly: 300, aiCredits: 50, websites: 3, recommended: false,
    description: 'For solo operators getting consistent.',
    features: ['Everything in Free', '50 AI generations / month', '3 websites', 'Social drafts & scheduling', 'Email support'],
  },
  growth: {
    id: 'growth', name: 'Growth', monthly: 50, yearly: 500, aiCredits: 150, websites: 10, recommended: false,
    description: 'For businesses scaling their marketing.',
    features: ['Everything in Starter', '150 AI generations / month', '10 websites', 'Ad campaign management', 'Analytics dashboard', 'Priority email support'],
  },
  pro: {
    id: 'pro', name: 'Pro', monthly: 90, yearly: 900, aiCredits: 500, websites: 25, recommended: true,
    description: 'The full growth system for established teams.',
    features: ['Everything in Growth', '500 AI generations / month', '25 websites', 'Built-in CRM', 'Advanced automations', 'Priority support'],
  },
  scale: {
    id: 'scale', name: 'Scale', monthly: 160, yearly: 1600, aiCredits: null, websites: null, recommended: false,
    description: 'Unlimited scale for agencies and teams.',
    features: ['Everything in Pro', 'Unlimited AI generations', 'Unlimited websites', 'Team members', 'White-label options', 'API access', 'Dedicated support'],
  },
};

export function planFor(id) {
  return CUSTOMER_PLANS[String(id || '').toLowerCase()] || CUSTOMER_PLANS.free;
}

export function publicPlans() {
  return Object.values(CUSTOMER_PLANS);
}

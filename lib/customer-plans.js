export const CUSTOMER_PLANS = {
  free: {
    id: 'free', name: 'Free', monthly: 0, yearly: 0, aiCredits: 10, recommended: false,
    description: 'Explore the core workspace and launch your first project.',
    features: ['1 website', 'Limited AI generations', 'Limited content storage', 'Basic analytics', 'Community support'],
  },
  starter: {
    id: 'starter', name: 'Starter', monthly: 49, yearly: 490, aiCredits: 150, recommended: false,
    description: 'For solo operators building a repeatable growth system.',
    features: ['Everything in Free', 'More AI generations', 'Social media scheduling', 'Basic automations', 'Email support'],
  },
  growth: {
    id: 'growth', name: 'Growth', monthly: 99, yearly: 990, aiCredits: null, recommended: true,
    description: 'The complete operating system for growing service businesses.',
    features: ['Unlimited AI generations', 'Multiple websites', 'Full social scheduler', 'Ad campaign management', 'Analytics dashboard', 'CRM', 'Priority support'],
  },
  pro: {
    id: 'pro', name: 'Pro', monthly: 199, yearly: 1990, aiCredits: null, recommended: false,
    description: 'Advanced controls, collaboration, and scale for established teams.',
    features: ['Everything in Growth', 'Unlimited websites', 'Team members', 'Advanced automations', 'White-label options', 'API access', 'Highest limits', 'Premium support'],
  },
};

export function planFor(id) {
  return CUSTOMER_PLANS[String(id || '').toLowerCase()] || CUSTOMER_PLANS.free;
}

export function publicPlans() {
  return Object.values(CUSTOMER_PLANS);
}

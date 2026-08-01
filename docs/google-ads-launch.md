# Nitro Outreach — Google Search acquisition campaign

## Campaign controls

- Campaign: `Nitro Customer Acquisition — Search`
- Status at creation: **Paused**
- Network: Google Search only; disable Display Network and Search Partners initially.
- Location: United States; presence only, not interest.
- Daily budget draft: **$20/day** (requires owner approval before activation).
- Bidding: Maximize Clicks with a conservative CPC ceiling until conversion data is verified; move to Maximize Conversions only after reliable primary-conversion volume.

## Conversion setup

- Primary: completed free account creation / arrival at `/welcome` after verified signup.
- Secondary: completed Growth Audit / arrival at `/report?id=...`.
- Secondary: pricing-page visit.
- Count account creation once per user; do not optimize toward ordinary page views.
- Preserve `gclid` and UTM values through signup and audit flows.

## Ad group: all-in-one small-business marketing

Keywords begin as phrase/exact match:

- "small business marketing software"
- "all in one marketing platform"
- "small business website builder"
- "ai marketing tools for small business"
- "social media and website builder"
- "automated customer follow up software"

Negative starter list: jobs, salary, course, certification, definition, free download, cracked, template, agency jobs.

## Responsive Search Ad

Headlines: All Your Marketing in One Place; Build Your Website With AI; Turn Prompts Into Reels; Automate Customer Follow-Up; Replace Your Marketing Stack; Marketing Built for Small Teams; Start Nitro Outreach Free; Websites Content Ads & More; Stop Paying for Five Tools; Launch Better Marketing Faster; One Login for Your Growth; Try the Free Growth Audit.

Descriptions: Build websites, create content and Reels, manage outreach, and track growth from one workspace. Start free. | Nitro gives small businesses one place for websites, social content, ads, messaging, and analytics. | Replace disconnected marketing subscriptions with a focused workspace built for owners doing their own growth. | Run a free website Growth Audit, see the highest-impact opportunities, and build the next step in Nitro.

Landing URL: `https://nitrooutreach.com/?utm_source=google&utm_medium=cpc&utm_campaign=nitro_customer_acquisition`

## Activation gate

Do not enable the campaign until the Google tag reports healthy, the signup conversion fires once in a test, billing is confirmed, and the owner approves the daily budget.

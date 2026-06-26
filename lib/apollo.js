// Apollo: find net-new people, then enrich the promising ones for verified emails.
// Search is free (no credits). Enrichment costs ~1 credit per person.
// Docs: https://docs.apollo.io/reference/people-api-search

const BASE = "https://api.apollo.io/api/v1";

function headers(key) {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    accept: "application/json",
    "x-api-key": key,
  };
}

// Step 1 — search. Returns people WITHOUT emails, but with ids + a has_email flag.
export async function searchPeople(key, { titles, keywords, locations, perPage = 100, page = 1 }) {
  const body = {
    person_titles: titles,
    q_organization_keyword_tags: keywords,
    person_locations: locations,
    per_page: perPage,
    page,
  };
  // Note: use /mixed_people/api_search (NOT /search) — the latter 403s on lower plans.
  const res = await fetch(`${BASE}/mixed_people/api_search`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apollo search failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.people || data.contacts || [];
}

// Step 2 — enrich up to 10 at a time to reveal work emails.
export async function enrichBatch(key, people) {
  const details = people.map((p) => ({ id: p.id }));
  const res = await fetch(`${BASE}/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ details }),
  });
  if (!res.ok) throw new Error(`Apollo enrich failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.matches || [];
}

// Pull, filter to people likely to have a real email, enrich, and normalize.
export async function getLeads(key, target, max) {
  const found = await searchPeople(key, target);
  // Only spend credits on people Apollo thinks it has an email for.
  const enrichable = found.filter((p) => p.email_status === "verified" || p.has_email).slice(0, max);

  const leads = [];
  for (let i = 0; i < enrichable.length; i += 10) {
    const chunk = enrichable.slice(i, i + 10);
    const matches = await enrichBatch(key, chunk);
    for (const m of matches) {
      if (!m || !m.email || /email_not_unlocked|^null$/i.test(m.email)) continue;
      leads.push({
        name: [m.first_name, m.last_name].filter(Boolean).join(" ") || m.name || "there",
        firstName: m.first_name || (m.name || "there").split(" ")[0],
        email: m.email,
        emailStatus: m.email_status || "unknown",
        title: m.title || "",
        company: m.organization?.name || m.account?.name || "",
        domain: m.organization?.website_url || "",
        // A "signal" to make the opener specific. Best-effort from available fields.
        signal: m.headline || m.organization?.short_description || `works as ${m.title || "a decision-maker"}`,
      });
    }
  }
  return leads;
}

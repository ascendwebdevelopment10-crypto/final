// Free lead source: OpenStreetMap via the public Overpass API.
// No API key, no billing, no per-record cost. Returns place objects in the
// same shape the crons expect from Outscraper: { name, phone, website, type, full_address }.
// Outscraper stays available as an OPTIONAL paid backup (set USE_OUTSCRAPER=true) but is never
// called by default, so it can't rack up charges.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Local-service categories well-mapped in OSM AND good web/marketing clients.
// Owner-operated, service-based businesses that respond to outreach (no chains/restaurants).
export const OSM_TAGS = [
  // Health & medical
  'amenity=dentist', 'amenity=veterinary', 'amenity=clinic', 'amenity=doctors',
  'healthcare=physiotherapist', 'healthcare=chiropractor', 'healthcare=optometrist',
  'healthcare=podiatrist', 'healthcare=psychotherapist', 'healthcare=dietitian', 'healthcare=alternative',
  // Professional services / offices
  'office=lawyer', 'office=accountant', 'office=insurance', 'office=estate_agent', 'office=financial_advisor',
  'office=architect', 'office=engineer', 'office=surveyor', 'office=tax_advisor',
  'office=advertising_agency', 'office=it', 'office=employment_agency', 'office=consulting',
  // Personal care & beauty
  'shop=hairdresser', 'shop=beauty', 'shop=massage', 'shop=optician', 'shop=tattoo', 'shop=nail_salon',
  // Auto
  'shop=car_repair', 'shop=tyres', 'amenity=car_wash', 'shop=car_parts',
  // Retail / boutiques (want websites)
  'shop=florist', 'shop=jewelry', 'shop=bakery', 'shop=butcher', 'shop=bicycle',
  'shop=furniture', 'shop=kitchen', 'shop=interior_decoration', 'shop=pet', 'shop=garden_centre',
  'shop=clothes', 'shop=shoes', 'shop=hardware', 'shop=doityourself',
  // Local services
  'shop=travel_agency', 'shop=dry_cleaning', 'shop=laundry', 'shop=funeral_directors',
  'shop=mobile_phone', 'amenity=driving_school',
  // Trades & construction
  'craft=plumber', 'craft=electrician', 'craft=hvac', 'craft=roofer', 'craft=painter',
  'craft=gardener', 'craft=caterer', 'craft=carpenter', 'craft=locksmith', 'craft=tiler',
  'craft=plasterer', 'craft=glaziery', 'craft=metal_construction', 'craft=window_construction',
  'craft=photographer', 'craft=sign_maker', 'craft=upholsterer',
  // Fitness & recreation
  'leisure=fitness_centre', 'leisure=sports_centre', 'leisure=dance',
];

// Email outreach intentionally uses the narrower high-response categories from
// outreach-targeting.js. Keeping this list separate prevents the cron from
// spending half of each run on medical/professional categories that the
// qualification layer will always reject.
export const OUTREACH_OSM_TAGS = [
  'office=advertising_agency', 'craft=photographer',
  'shop=hairdresser', 'shop=beauty', 'shop=massage', 'shop=tattoo', 'shop=nail_salon',
  'amenity=car_wash', 'shop=car_repair', 'shop=tyres',
  'shop=florist', 'shop=bakery', 'shop=jewelry', 'shop=pet', 'shop=bicycle',
  'leisure=fitness_centre', 'leisure=sports_centre', 'leisure=dance',
  'amenity=driving_school', 'shop=travel_agency',
];

// Metro bounding boxes [south, west, north, east] across the US.
const METROS = [
  [40.55,-74.10,40.90,-73.75],[33.90,-118.45,34.25,-118.10],[41.70,-87.85,42.05,-87.55],
  [29.55,-95.65,30.05,-95.15],[33.30,-112.30,33.75,-111.90],[39.87,-75.28,40.14,-74.96],
  [29.30,-98.70,29.65,-98.35],[32.65,-117.25,32.95,-117.00],[32.65,-96.95,32.95,-96.65],
  [30.15,-97.90,30.45,-97.60],[37.20,-122.00,37.45,-121.75],[30.20,-81.80,30.45,-81.55],
  [39.90,-83.10,40.10,-82.85],[35.10,-80.95,35.35,-80.70],[39.68,-86.30,39.90,-86.00],
  [47.50,-122.42,47.73,-122.24],[39.62,-105.05,39.83,-104.85],[36.05,-86.90,36.30,-86.65],
  [45.45,-122.75,45.60,-122.55],[36.05,-115.30,36.30,-115.05],[33.65,-84.50,33.90,-84.28],
  [25.70,-80.35,25.90,-80.15],[27.90,-82.55,28.10,-82.35],[44.88,-93.35,45.05,-93.15],
  [38.48,-121.55,38.68,-121.40],[39.00,-94.70,39.20,-94.50],[28.40,-81.50,28.62,-81.28],
  [38.55,-90.35,38.72,-90.15],[40.35,-80.10,40.55,-79.85],[39.05,-84.65,39.25,-84.40],
];

function pickMetro(offset = 0) {
  const hourlySeed = Math.floor(Date.now() / 3600000);
  return METROS[(hourlySeed + (offset * 7)) % METROS.length];
}

function shuffled(values) {
  return [...values].sort(() => Math.random() - 0.5);
}

const UA = 'NitroOutreach/1.0';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function overpassQuery(body) {
  // Shuffle mirrors so we don't always hammer the same one first.
  const mirrors = [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5);
  // Two polite passes with backoff; public servers throttle bursty cloud traffic.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of mirrors) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
          body: 'data=' + encodeURIComponent(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status === 504) { await sleep(1200); continue; }
        if (!res.ok) continue;
        const txt = await res.text();
        if (txt.trim().startsWith('<')) { await sleep(1200); continue; }
        return JSON.parse(txt);
      } catch (e) { /* try next mirror */ }
    }
    if (attempt === 0) await sleep(1500 + Math.random() * 1500);
  }
  return null;
}

function toPlace(el, category) {
  const t = el.tags || {};
  const phone = String(t.phone || t['contact:phone'] || t['contact:mobile'] || '').split(';')[0].trim();
  const website = String(t.website || t['contact:website'] || t.url || '').split(';')[0].trim();
  const email = String(t.email || t['contact:email'] || '').split(';')[0].trim();
  const addr = [t['addr:housenumber'], t['addr:street'], t['addr:city'], t['addr:state']].filter(Boolean).join(' ');
  const normalizedName = String(t.name || '').trim().toLowerCase();
  const normalizedBrand = String(t.brand || '').trim().toLowerCase();
  const chainSignals = [t['brand:wikidata'], t['operator:wikidata'], t.network, t.franchise].filter(Boolean);
  const isChain = chainSignals.length > 0 || Boolean(normalizedBrand && normalizedBrand !== normalizedName);
  return {
    name: t.name || '', phone, website, email, type: category, subtypes: category, full_address: addr,
    brand: t.brand || '', operator: t.operator || '', isChain,
  };
}

export async function fetchOsmLeads(tag, limit = 20) {
  const [k, v] = String(tag).split('=');
  if (!k || !v) return [];
  // Desynchronize the parallel calls the crons make in the same instant.
  await sleep(Math.random() * 2500);
  const [S, W, N, E] = pickMetro();
  const bbox = '(' + S + ',' + W + ',' + N + ',' + E + ')';
  const q = '[out:json][timeout:25];(node["' + k + '"="' + v + '"]["name"]' + bbox + ';way["' + k + '"="' + v + '"]["name"]' + bbox + ';);out center tags ' + Math.max(60, limit * 4) + ';';
  const data = await overpassQuery(q);
  if (!data || !Array.isArray(data.elements)) return [];
  const seen = new Set();
  const out = [];
  for (const el of data.elements) {
    const p = toPlace(el, v);
    if (!p.name) continue;
    if (!p.phone && !p.website && !p.email) continue;
    const key = (p.phone || p.website || p.email).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

// Fetch several business categories from one metro in a single Overpass request.
// This gives the email job a much deeper candidate pool without multiplying the
// number of public-API requests (or depending on one sparse category/metro pair).
export async function fetchOsmLeadPool(tags = OSM_TAGS, limit = 50, poolIndex = 0) {
  const rotatedTags = tags.map((_, index) => tags[(index + (poolIndex * 12)) % tags.length]);
  const selected = rotatedTags
    .map(tag => String(tag).split('='))
    .filter(([k, v]) => k && v)
    .slice(0, 12);
  if (!selected.length) return [];

  await sleep(Math.random() * 2500);
  const [S, W, N, E] = pickMetro(poolIndex);
  const bbox = '(' + S + ',' + W + ',' + N + ',' + E + ')';
  const selectors = selected.flatMap(([k, v]) => [
    'node["' + k + '"="' + v + '"]["name"]' + bbox + ';',
    'way["' + k + '"="' + v + '"]["name"]' + bbox + ';',
  ]).join('');
  const q = '[out:json][timeout:25];(' + selectors + ');out center tags ' + Math.max(100, limit * 3) + ';';
  const data = await overpassQuery(q);
  if (!data || !Array.isArray(data.elements)) return [];

  const seen = new Set();
  const out = [];
  for (const el of shuffled(data.elements)) {
    const tagsForElement = el.tags || {};
    const category = selected.find(([k, v]) => tagsForElement[k] === v)?.[1] || 'local_business';
    const p = toPlace(el, category);
    if (!p.name || p.isChain || (!p.website && !p.email)) continue;
    const key = (p.email || p.website || (p.name + '|' + p.full_address)).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export default fetchOsmLeads;

import { mkdir, writeFile } from 'node:fs/promises';

const out = process.argv[2] || '/tmp/nitro-instagram';
await mkdir(out, { recursive: true });

const cards = [
  {
    file: '01-one-workspace.svg', eyebrow: 'NITRO OUTREACH',
    title: ['Your whole marketing', 'operation. One login.'],
    body: 'Websites, content, social, ads, and outreach—without juggling five tools.',
    panel: ['WEBSITE', 'CONTENT', 'OUTREACH'], metric: 'ONE WORKSPACE',
  },
  {
    file: '02-website.svg', eyebrow: 'WEBSITES',
    title: ['Launch the site.', 'Keep the momentum.'],
    body: 'Build a polished business website, then turn traffic into follow-up from the same workspace.',
    panel: ['LIVE SITE', 'VISITORS', 'FOLLOW-UP'], metric: 'BUILT TO CONVERT',
  },
  {
    file: '03-content.svg', eyebrow: 'CONTENT STUDIO',
    title: ['One idea.', 'A week of content.'],
    body: 'Draft posts, Reel scripts, and campaign copy while keeping your brand voice consistent.',
    panel: ['IDEA', 'DRAFT', 'SCHEDULE'], metric: 'CREATE FASTER',
  },
  {
    file: '04-social.svg', eyebrow: 'SOCIAL SCHEDULING',
    title: ['Plan it now.', 'Publish it on time.'],
    body: 'Queue visual posts, edit the schedule, and catch anything that needs attention before it goes live.',
    panel: ['DRAFT', 'QUEUED', 'PUBLISHED'], metric: 'STAY CONSISTENT',
  },
  {
    file: '05-outreach.svg', eyebrow: 'OUTREACH',
    title: ['Know what happened', 'after you hit send.'],
    body: 'Track opens, clicks, visits, and replies so you can follow up with real intent.',
    panel: ['OPENED', 'CLICKED', 'REPLIED'], metric: 'REAL SIGNALS',
  },
  {
    file: '06-start-free.svg', eyebrow: 'START FREE',
    title: ['Do the work.', 'Skip the tool pile.'],
    body: 'Start with the free plan. No credit card. Upgrade when Nitro is earning its place.',
    panel: ['FREE PLAN', 'NO CARD', 'ONE LOGIN'], metric: 'NITROOUTREACH.COM',
  },
];

function esc(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function wrap(value, max = 54) {
  const words = value.split(/\s+/);
  const lines = [''];
  for (const word of words) {
    const current = lines.at(-1);
    if (current && `${current} ${word}`.length > max && lines.length < 2) lines.push(word);
    else lines[lines.length - 1] = current ? `${current} ${word}` : word;
  }
  return lines;
}

function cardSvg(card, index) {
  const bodyLines = wrap(card.body);
  const title = card.title.map((line, i) =>
    `<text x="72" y="${326 + i * 96}" class="title${i === 1 ? ' accent' : ''}">${esc(line)}</text>`
  ).join('\n');
  const chips = card.panel.map((label, i) => {
    const x = 112 + i * 288;
    return `<rect x="${x}" y="778" width="248" height="92" rx="18" class="chip"/>
      <circle cx="${x + 34}" cy="824" r="8" class="dot${i === 2 ? ' hot' : ''}"/>
      <text x="${x + 56}" y="833" class="chipText">${esc(label)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#07120d"/><stop offset="1" stop-color="#0c2418"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000" flood-opacity=".38"/></filter>
  </defs>
  <style>
    text { font-family: Arial, Helvetica, sans-serif; }
    .eyebrow { fill:#ff7a1a; font-size:25px; font-weight:800; letter-spacing:5px; }
    .title { fill:#f6f7f3; font-size:72px; font-weight:800; letter-spacing:-3px; }
    .accent { fill:#ff8528; }
    .body { fill:#c4ccc6; font-size:30px; font-weight:400; }
    .panel { fill:#0a100d; stroke:#294033; stroke-width:2; }
    .panelTitle { fill:#f6f7f3; font-size:24px; font-weight:700; }
    .small { fill:#829087; font-size:18px; }
    .chip { fill:#111d16; stroke:#31493a; stroke-width:2; }
    .chipText { fill:#e9eee9; font-size:18px; font-weight:700; }
    .dot { fill:#47d17e; } .hot { fill:#ff7a1a; }
    .metric { fill:#f6f7f3; font-size:31px; font-weight:800; letter-spacing:2px; }
    .footer { fill:#9ba69f; font-size:20px; }
  </style>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <circle cx="970" cy="150" r="310" fill="#163b27" opacity=".55"/>
  <circle cx="40" cy="1280" r="330" fill="#0b1b12"/>
  <rect x="72" y="64" width="62" height="62" rx="17" fill="#ff6d00"/>
  <path d="M105 77 87 106h14l-8 23 28-36h-15z" fill="#fff"/>
  <text x="156" y="105" class="panelTitle">Nitro Outreach</text>
  <text x="72" y="222" class="eyebrow">${esc(card.eyebrow)}</text>
  ${title}
  <text x="72" y="565" class="body">${esc(bodyLines[0] || '')}</text>
  <text x="72" y="608" class="body">${esc(bodyLines[1] || '')}</text>
  <g filter="url(#shadow)">
    <rect x="72" y="696" width="936" height="380" rx="32" class="panel"/>
    <text x="112" y="746" class="small">WORKFLOW</text>
    ${chips}
    <line x1="112" y1="932" x2="968" y2="932" stroke="#26382d" stroke-width="2"/>
    <text x="112" y="1000" class="small">RESULT</text>
    <text x="968" y="1000" text-anchor="end" class="metric">${esc(card.metric)}</text>
  </g>
  <text x="72" y="1240" class="footer">Free forever plan · No credit card</text>
  <text x="1008" y="1240" text-anchor="end" class="footer">${String(index + 1).padStart(2, '0')} / 06</text>
  <text x="72" y="1282" class="footer">nitrooutreach.com</text>
</svg>`;
}

for (const [index, card] of cards.entries()) {
  await writeFile(`${out}/${card.file}`, cardSvg(card, index));
}

const captions = [
  `Your website, content, social, ads, and outreach should work together—not live in five different tabs. Nitro puts the operation in one place. Start free at nitrooutreach.com.\n\n#smallbusinessmarketing #marketingtools #nitrooutreach`,
  `A website is only useful if it helps the next conversation happen. Build the site, understand the traffic, and follow up from the same workspace.\n\n#businesswebsite #leadgeneration #smallbusiness`,
  `One solid idea can become a week of useful content. Nitro helps turn the idea into posts, Reel scripts, and campaign copy without losing your voice.\n\n#contentmarketing #reelsstrategy #smallbusinessowner`,
  `Consistency gets easier when the queue is visible. Draft, schedule, edit, and catch posts that need attention before they miss the moment.\n\n#socialmediamarketing #contentscheduler #marketingworkflow`,
  `Opens are interesting. Replies are useful. Nitro keeps opens, clicks, site visits, and replies in one view so follow-up is based on real signals.\n\n#outreach #salesfollowup #leadtracking`,
  `Do the marketing work without adding another pile of disconnected tools. Nitro has a free forever plan and doesn’t require a credit card. Start at nitrooutreach.com.\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach`,
];
await writeFile(`${out}/captions.txt`, captions.map((caption, i) => `POST ${i + 1}\n${caption}`).join('\n\n---\n\n'));
console.log(out);

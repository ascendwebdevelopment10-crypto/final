export default function handler(req, res) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ascend Outreach Dashboard</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#0f172a; color:#e2e8f0; min-height:100vh; }
.header { background:#1e293b; border-bottom:1px solid #334155; padding:16px 32px; display:flex; align-items:center; justify-content:space-between; }
.header h1 { font-size:20px; font-weight:700; color:#f8fafc; }
.badge-live { background:#22c55e; color:#fff; font-size:11px; padding:2px 8px; border-radius:99px; font-weight:600; }
.nav { background:#1e293b; border-bottom:1px solid #334155; padding:0 32px; display:flex; gap:4px; }
.nav-btn { padding:14px 20px; background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:14px; font-weight:500; border-bottom:2px solid transparent; transition:all 0.15s; }
.nav-btn:hover { color:#e2e8f0; }
.nav-btn.active { color:#6366f1; border-bottom-color:#6366f1; }
.nav-btn .count { display:inline-block; background:#6366f1; color:#fff; font-size:10px; padding:1px 6px; border-radius:99px; margin-left:6px; font-weight:600; }
.nav-btn.replies-btn.active { color:#f59e0b; border-bottom-color:#f59e0b; }
.nav-btn .count.reply-count { background:#f59e0b; }
.container { max-width:1200px; margin:0 auto; padding:32px; }
.page { display:none; }
.page.active { display:block; }

/* Overview */
.stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:16px; margin-bottom:32px; }
.stat-card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:20px; }
.stat-card .label { font-size:12px; color:#94a3b8; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em; }
.stat-card .value { font-size:32px; font-weight:700; color:#f8fafc; }
.stat-card .sub { font-size:12px; color:#64748b; margin-top:4px; }
.stat-card.email { border-top:3px solid #6366f1; }
.stat-card.sms { border-top:3px solid #f59e0b; }
.stat-card.reply { border-top:3px solid #22c55e; }
.stat-card.unsub { border-top:3px solid #ef4444; }
.section { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:24px; margin-bottom:24px; }
.section h2 { font-size:16px; font-weight:600; margin-bottom:20px; color:#f8fafc; }
.tabs { display:flex; gap:8px; margin-bottom:20px; }
.tab { padding:8px 16px; border-radius:8px; border:1px solid #334155; background:transparent; color:#94a3b8; cursor:pointer; font-size:14px; }
.tab.active { background:#6366f1; border-color:#6366f1; color:#fff; }
.chart { display:flex; align-items:flex-end; gap:4px; height:120px; }
.bar-group { flex:1; display:flex; gap:2px; align-items:flex-end; height:100%; }
.bar { flex:1; border-radius:2px 2px 0 0; min-height:2px; }
.bar.email-bar { background:#6366f1; }
.bar.sms-bar { background:#f59e0b; }
.chart-labels { display:flex; gap:4px; margin-top:4px; }
.chart-label { flex:1; text-align:center; font-size:9px; color:#475569; overflow:hidden; }
.legend { display:flex; gap:16px; margin-top:12px; }
.legend-item { display:flex; align-items:center; gap:6px; font-size:12px; color:#94a3b8; }
.legend-dot { width:10px; height:10px; border-radius:2px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; padding:10px 12px; color:#64748b; font-weight:500; border-bottom:1px solid #334155; font-size:11px; text-transform:uppercase; }
td { padding:12px; border-bottom:1px solid #1e293b; color:#cbd5e1; vertical-align:top; }
tr:last-child td { border-bottom:none; }
.badge-sent { background:#1d4ed8; color:#bfdbfe; padding:2px 8px; border-radius:99px; font-size:11px; }
.badge-replied { background:#166534; color:#bbf7d0; padding:2px 8px; border-radius:99px; font-size:11px; }
.badge-sms { background:#92400e; color:#fde68a; padding:2px 8px; border-radius:99px; font-size:11px; }
.empty { text-align:center; color:#475569; padding:40px; }

/* Replies page */
.reply-list { display:flex; flex-direction:column; gap:12px; }
.reply-card { background:#1e293b; border:1px solid #334155; border-radius:12px; overflow:hidden; cursor:pointer; transition:border-color 0.15s; }
.reply-card:hover { border-color:#6366f1; }
.reply-card.open { border-color:#f59e0b; }
.reply-header { padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.reply-header-left { display:flex; align-items:center; gap:12px; flex:1; min-width:0; }
.reply-avatar { width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#f59e0b); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; color:#fff; flex-shrink:0; }
.reply-meta { flex:1; min-width:0; }
.reply-from { font-weight:600; color:#f8fafc; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.reply-subject { color:#94a3b8; font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.reply-time { font-size:11px; color:#64748b; flex-shrink:0; }
.reply-chevron { color:#64748b; font-size:18px; flex-shrink:0; transition:transform 0.2s; }
.reply-card.open .reply-chevron { transform:rotate(90deg); }
.reply-body { display:none; padding:0 20px 20px 20px; border-top:1px solid #334155; margin-top:0; }
.reply-card.open .reply-body { display:block; }
.reply-body-inner { background:#0f172a; border-radius:8px; padding:16px; margin-top:16px; font-size:13px; line-height:1.7; color:#cbd5e1; white-space:pre-wrap; word-break:break-word; max-height:400px; overflow-y:auto; }
.reply-actions { display:flex; gap:8px; margin-top:12px; }
.reply-actions a { padding:7px 14px; border-radius:8px; font-size:12px; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px; }
.btn-reply { background:#6366f1; color:#fff; }
.btn-reply:hover { background:#4f46e5; }
.no-replies { text-align:center; padding:60px 20px; }
.no-replies .icon { font-size:48px; margin-bottom:16px; }
.no-replies p { color:#64748b; font-size:15px; }
.replies-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.replies-header h2 { font-size:20px; font-weight:700; color:#f8fafc; }
.refresh-btn { padding:8px 14px; background:#1e293b; border:1px solid #334155; border-radius:8px; color:#94a3b8; cursor:pointer; font-size:12px; }
.refresh-btn:hover { color:#e2e8f0; border-color:#6366f1; }
</style>
</head>
<body>
<div class="header">
  <h1>&#128640; Ascend Outreach</h1>
  <span class="badge-live">LIVE</span>
</div>
<nav class="nav">
  <button class="nav-btn active" onclick="showPage('overview')">Overview</button>
  <button class="nav-btn" onclick="showPage('emails')">Emails</button>
  <button class="nav-btn" onclick="showPage('sms')">SMS</button>
  <button class="nav-btn replies-btn" id="nav-replies" onclick="showPage('replies')">Replies <span class="count reply-count" id="reply-count-badge" style="display:none">0</span></button>
</nav>

<div class="container">

  <!-- OVERVIEW PAGE -->
  <div class="page active" id="page-overview">
    <div class="stats-grid">
      <div class="stat-card email"><div class="label">Emails Sent</div><div class="value" id="total-email">—</div><div class="sub" id="today-email">Today: —</div></div>
      <div class="stat-card sms"><div class="label">SMS Sent</div><div class="value" id="total-sms">—</div><div class="sub" id="today-sms">Today: —</div></div>
      <div class="stat-card reply"><div class="label">Email Replies</div><div class="value" id="email-replies">—</div><div class="sub">responses received</div></div>
      <div class="stat-card reply"><div class="label">SMS Replies</div><div class="value" id="sms-replies">—</div><div class="sub">responses received</div></div>
      <div class="stat-card unsub"><div class="label">Unsubscribed</div><div class="value" id="unsubscribed">—</div><div class="sub">removed</div></div>
    </div>
    <div class="section">
      <h2>30-Day Activity</h2>
      <div class="chart" id="chart"></div>
      <div class="chart-labels" id="chart-labels"></div>
      <div class="legend">
        <div class="legend-item"><div class="legend-dot" style="background:#6366f1"></div>Emails</div>
        <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div>SMS</div>
      </div>
    </div>
  </div>

  <!-- EMAILS PAGE -->
  <div class="page" id="page-emails">
    <div class="section">
      <h2>Email Log</h2>
      <table><thead><tr><th>To</th><th>Subject</th><th>Segment</th><th>Time</th><th>Status</th></tr></thead>
      <tbody id="email-log-body"></tbody></table>
    </div>
  </div>

  <!-- SMS PAGE -->
  <div class="page" id="page-sms">
    <div class="section">
      <h2>SMS Log</h2>
      <table><thead><tr><th>To</th><th>Message</th><th>Segment</th><th>Time</th><th>Status</th></tr></thead>
      <tbody id="sms-log-body"></tbody></table>
    </div>
  </div>

  <!-- REPLIES PAGE -->
  <div class="page" id="page-replies">
    <div class="replies-header">
      <h2>Replies <span id="reply-total-count" style="color:#64748b;font-size:16px;font-weight:400"></span></h2>
      <button class="refresh-btn" onclick="loadReplies()">&#8635; Refresh</button>
    </div>
    <div class="reply-list" id="reply-list"></div>
  </div>

</div>

<script>
let currentPage = 'overview';
let repliesData = [];

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  event.currentTarget.classList.add('active');
  currentPage = page;
  if (page === 'replies') loadReplies();
}

function fmt(ts) { return ts ? new Date(ts).toLocaleString() : '—'; }
function initials(email) { return email ? email[0].toUpperCase() : '?'; }

function toggleReply(id) {
  const card = document.getElementById('reply-' + id);
  card.classList.toggle('open');
}

function renderReplies(replies) {
  const list = document.getElementById('reply-list');
  const totalEl = document.getElementById('reply-total-count');
  const badge = document.getElementById('reply-count-badge');

  if (!replies.length) {
    list.innerHTML = '<div class="no-replies"><div class="icon">&#128235;</div><p>No replies yet. When someone responds to an outreach email, it will appear here.</p></div>';
    totalEl.textContent = '';
    badge.style.display = 'none';
    return;
  }

  totalEl.textContent = '(' + replies.length + ')';
  badge.textContent = replies.length;
  badge.style.display = 'inline-block';

  list.innerHTML = replies.map((r, i) => {
    const from = r.from || '—';
    const subject = r.subject || '(no subject)';
    const body = (r.body || '').replace(/<[^>]*>/g, '').trim() || '(no content)';
    const time = fmt(r.timestamp);
    const initial = initials(from);
    const mailtoLink = 'mailto:' + encodeURIComponent(from) + '?subject=' + encodeURIComponent('Re: ' + subject);
    return `<div class="reply-card" id="reply-${i}">
      <div class="reply-header" onclick="toggleReply(${i})">
        <div class="reply-header-left">
          <div class="reply-avatar">${initial}</div>
          <div class="reply-meta">
            <div class="reply-from">${from}</div>
            <div class="reply-subject">${subject}</div>
          </div>
        </div>
        <span class="reply-time">${time}</span>
        <span class="reply-chevron">&#8250;</span>
      </div>
      <div class="reply-body">
        <div class="reply-body-inner">${body}</div>
        <div class="reply-actions">
          <a href="${mailtoLink}" class="btn-reply" target="_blank">&#9993; Reply in Email</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function loadReplies() {
  try {
    const res = await fetch('/api/logs?type=replies&limit=100');
    repliesData = await res.json();
    renderReplies(repliesData);
  } catch(e) { console.error(e); }
}

async function loadStats() {
  try {
    const stats = await fetch('/api/logs?type=stats').then(r => r.json());
    document.getElementById('total-email').textContent = (stats.totalEmailSent||0).toLocaleString();
    document.getElementById('total-sms').textContent = (stats.totalSmsSent||0).toLocaleString();
    document.getElementById('today-email').textContent = 'Today: '+(stats.todayEmailSent||0);
    document.getElementById('today-sms').textContent = 'Today: '+(stats.todaySmsSent||0);
    document.getElementById('email-replies').textContent = (stats.emailReplies||0).toLocaleString();
    document.getElementById('sms-replies').textContent = (stats.smsReplies||0).toLocaleString();
    document.getElementById('unsubscribed').textContent = (stats.unsubscribed||0).toLocaleString();
    const days = stats.dailyChart || [];
    const maxV = Math.max(...days.map(d => Math.max(d.emails||0,d.sms||0)),1);
    const chart = document.getElementById('chart');
    const labels = document.getElementById('chart-labels');
    chart.innerHTML = ''; labels.innerHTML = '';
    days.forEach(d => {
      const eH = Math.round(((d.emails||0)/maxV)*100);
      const sH = Math.round(((d.sms||0)/maxV)*100);
      const g = document.createElement('div'); g.className='bar-group'; g.title=d.date+': '+d.emails+' emails, '+d.sms+' SMS';
      g.innerHTML='<div class="bar email-bar" style="height:'+eH+'%"></div><div class="bar sms-bar" style="height:'+sH+'%"></div>';
      chart.appendChild(g);
      const l = document.createElement('div'); l.className='chart-label'; l.textContent=d.date.slice(5); labels.appendChild(l);
    });
  } catch(e) { console.error(e); }
}

async function loadEmailLog() {
  try {
    const emails = await fetch('/api/logs?type=emails&limit=100').then(r => r.json());
    const segLabel = { no_website: '&#127760; No Website', needs_app: '&#128241; App', general: 'General' };
    document.getElementById('email-log-body').innerHTML = emails.length
      ? emails.map(e => `<tr>
          <td>${e.to||'—'}</td>
          <td>${e.subject||'—'}</td>
          <td style="font-size:11px">${segLabel[e.segment]||e.segment||'—'}</td>
          <td style="white-space:nowrap">${fmt(e.timestamp)}</td>
          <td><span class="${e.replied?'badge-replied':'badge-sent'}">${e.replied?'Replied':'Sent'}</span></td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No emails sent yet. First run at 10am MST.</td></tr>';
  } catch(e) { console.error(e); }
}

async function loadSmsLog() {
  try {
    const sms = await fetch('/api/logs?type=sms&limit=100').then(r => r.json());
    const segLabel = { no_website: '&#127760; No Website', needs_app: '&#128241; App', general: 'General' };
    document.getElementById('sms-log-body').innerHTML = sms.length
      ? sms.map(e => `<tr>
          <td>${e.to||'—'}</td>
          <td style="max-width:300px">${(e.body||'—').substring(0,100)}</td>
          <td style="font-size:11px">${segLabel[e.segment]||e.segment||'—'}</td>
          <td style="white-space:nowrap">${fmt(e.timestamp)}</td>
          <td><span class="${e.replied?'badge-replied':'badge-sms'}">${e.replied?'Replied':'Sent'}</span></td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">No SMS sent yet. First run at 10am MST.</td></tr>';
  } catch(e) { console.error(e); }
}

// Init
loadStats();
loadEmailLog();
loadSmsLog();
loadReplies();
setInterval(() => { loadStats(); if(currentPage==='replies') loadReplies(); }, 30000);
</script>
</body></html>`;
  res.setHeader('Content-Type','text/html');
  res.status(200).send(html);
}

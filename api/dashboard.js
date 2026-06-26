export const config = { runtime: 'edge' };

export default function handler(req) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ascend Outreach Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 20px; font-weight: 700; color: #f8fafc; }
  .header .badge { background: #22c55e; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 99px; font-weight: 600; }
  .container { max-width: 1200px; margin: 0 auto; padding: 32px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; }
  .stat-card .label { font-size: 12px; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-card .value { font-size: 32px; font-weight: 700; color: #f8fafc; }
  .stat-card .sub { font-size: 12px; color: #64748b; margin-top: 4px; }
  .stat-card.email { border-top: 3px solid #6366f1; }
  .stat-card.sms { border-top: 3px solid #f59e0b; }
  .stat-card.reply { border-top: 3px solid #22c55e; }
  .stat-card.unsub { border-top: 3px solid #ef4444; }
  .section { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 20px; color: #f8fafc; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .tab { padding: 8px 16px; border-radius: 8px; border: 1px solid #334155; background: transparent; color: #94a3b8; cursor: pointer; font-size: 14px; }
  .tab.active { background: #6366f1; border-color: #6366f1; color: #fff; }
  .chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; margin-top: 8px; }
  .bar-group { flex: 1; display: flex; gap: 2px; align-items: flex-end; height: 100%; }
  .bar { flex: 1; border-radius: 2px 2px 0 0; min-height: 2px; transition: opacity 0.2s; }
  .bar.email-bar { background: #6366f1; }
  .bar.sms-bar { background: #f59e0b; }
  .bar:hover { opacity: 0.8; }
  .chart-labels { display: flex; gap: 4px; margin-top: 4px; }
  .chart-label { flex: 1; text-align: center; font-size: 9px; color: #475569; overflow: hidden; }
  .legend { display: flex; gap: 16px; margin-top: 12px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #94a3b8; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 10px 12px; color: #64748b; font-weight: 500; border-bottom: 1px solid #334155; font-size: 11px; text-transform: uppercase; }
  td { padding: 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; }
  tr:last-child td { border-bottom: none; }
  .badge-sent { background: #1d4ed8; color: #bfdbfe; padding: 2px 8px; border-radius: 99px; font-size: 11px; }
  .badge-replied { background: #166534; color: #bbf7d0; padding: 2px 8px; border-radius: 99px; font-size: 11px; }
  .badge-sms { background: #92400e; color: #fde68a; padding: 2px 8px; border-radius: 99px; font-size: 11px; }
  .empty { text-align: center; color: #475569; padding: 40px; }
  #log-panel { display: none; }
  #sms-panel { display: none; }
</style>
</head>
<body>
<div class="header">
  <h1>&#128640; Ascend Outreach</h1>
  <span class="badge">LIVE</span>
</div>
<div class="container">
  <!-- Stats Grid -->
  <div class="stats-grid" id="stats-grid">
    <div class="stat-card email"><div class="label">Emails Sent</div><div class="value" id="total-email">—</div><div class="sub" id="today-email">Today: —</div></div>
    <div class="stat-card sms"><div class="label">SMS Sent</div><div class="value" id="total-sms">—</div><div class="sub" id="today-sms">Today: —</div></div>
    <div class="stat-card reply"><div class="label">Email Replies</div><div class="value" id="email-replies">—</div><div class="sub">responses received</div></div>
    <div class="stat-card reply"><div class="label">SMS Replies</div><div class="value" id="sms-replies">—</div><div class="sub">responses received</div></div>
    <div class="stat-card unsub"><div class="label">Unsubscribed</div><div class="value" id="unsubscribed">—</div><div class="sub">removed from list</div></div>
  </div>

  <!-- Chart -->
  <div class="section">
    <h2>30-Day Activity</h2>
    <div class="chart" id="chart"></div>
    <div class="chart-labels" id="chart-labels"></div>
    <div class="legend">
      <div class="legend-item"><div class="legend-dot" style="background:#6366f1"></div>Emails</div>
      <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div>SMS</div>
    </div>
  </div>

  <!-- Activity Log -->
  <div class="section">
    <h2>Recent Activity</h2>
    <div class="tabs">
      <button class="tab active" onclick="showTab('email')">Emails</button>
      <button class="tab" onclick="showTab('sms')">SMS</button>
    </div>
    <div id="log-panel">
      <table>
        <thead><tr><th>To</th><th>Subject</th><th>Time</th><th>Status</th></tr></thead>
        <tbody id="email-log-body"></tbody>
      </table>
    </div>
    <div id="sms-panel">
      <table>
        <thead><tr><th>To</th><th>Message</th><th>Time</th><th>Status</th></tr></thead>
        <tbody id="sms-log-body"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('log-panel').style.display = tab === 'email' ? 'block' : 'none';
  document.getElementById('sms-panel').style.display = tab === 'sms' ? 'block' : 'none';
}

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

async function loadStats() {
  try {
    const res = await fetch('/api/logs?type=stats');
    const data = await res.json();
    document.getElementById('total-email').textContent = (data.totalEmailSent || 0).toLocaleString();
    document.getElementById('total-sms').textContent = (data.totalSmsSent || 0).toLocaleString();
    document.getElementById('today-email').textContent = 'Today: ' + (data.todayEmailSent || 0);
    document.getElementById('today-sms').textContent = 'Today: ' + (data.todaySmsSent || 0);
    document.getElementById('email-replies').textContent = (data.emailReplies || 0).toLocaleString();
    document.getElementById('sms-replies').textContent = (data.smsReplies || 0).toLocaleString();
    document.getElementById('unsubscribed').textContent = (data.unsubscribed || 0).toLocaleString();

    // Chart
    const days = data.dailyChart || [];
    const maxVal = Math.max(...days.map(d => Math.max(d.emails || 0, d.sms || 0)), 1);
    const chart = document.getElementById('chart');
    const labels = document.getElementById('chart-labels');
    chart.innerHTML = '';
    labels.innerHTML = '';
    days.forEach(d => {
      const emailH = Math.round(((d.emails || 0) / maxVal) * 100);
      const smsH = Math.round(((d.sms || 0) / maxVal) * 100);
      const group = document.createElement('div');
      group.className = 'bar-group';
      group.title = d.date + ': ' + d.emails + ' emails, ' + d.sms + ' SMS';
      group.innerHTML = '<div class="bar email-bar" style="height:' + emailH + '%"></div><div class="bar sms-bar" style="height:' + smsH + '%"></div>';
      chart.appendChild(group);
      const lbl = document.createElement('div');
      lbl.className = 'chart-label';
      lbl.textContent = d.date.slice(5);
      labels.appendChild(lbl);
    });
  } catch(e) { console.error(e); }
}

async function loadEmailLog() {
  try {
    const res = await fetch('/api/logs?type=emails&limit=50');
    const log = await res.json();
    const tbody = document.getElementById('email-log-body');
    if (!log.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No emails sent yet. First run at 3pm UTC.</td></tr>'; return; }
    tbody.innerHTML = log.map(e => \`<tr>
      <td>\${e.to || '—'}</td>
      <td>\${e.subject || '—'}</td>
      <td>\${formatTime(e.timestamp)}</td>
      <td><span class="\${e.replied ? 'badge-replied' : 'badge-sent'}">\${e.replied ? 'Replied' : 'Sent'}</span></td>
    </tr>\`).join('');
    document.getElementById('log-panel').style.display = 'block';
  } catch(e) { console.error(e); }
}

async function loadSmsLog() {
  try {
    const res = await fetch('/api/logs?type=sms&limit=50');
    const log = await res.json();
    const tbody = document.getElementById('sms-log-body');
    if (!log.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No SMS sent yet. First run at 3pm UTC.</td></tr>'; return; }
    tbody.innerHTML = log.map(e => \`<tr>
      <td>\${e.to || '—'}</td>
      <td>\${(e.body || '—').substring(0, 80)}</td>
      <td>\${formatTime(e.timestamp)}</td>
      <td><span class="\${e.replied ? 'badge-replied' : 'badge-sms'}">\${e.replied ? 'Replied' : 'Sent'}</span></td>
    </tr>\`).join('');
  } catch(e) { console.error(e); }
}

// Init
showTab('email');
loadStats();
loadEmailLog();
loadSmsLog();
setInterval(() => { loadStats(); loadEmailLog(); loadSmsLog(); }, 30000);
<\/script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ascend Outreach Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0f1117;--surface:#1a1d27;--surface2:#22263a;--border:#2e3250;
    --accent:#6c63ff;--accent2:#00d4aa;--red:#ff4d6d;--yellow:#ffd166;
    --text:#e8eaf6;--muted:#8892b0;--font:'Inter',system-ui,sans-serif;
  }
  body{background:var(--bg);color:var(--text);font-family:var(--font);min-height:100vh}
  a{color:var(--accent);text-decoration:none}

  /* Layout */
  .sidebar{position:fixed;left:0;top:0;bottom:0;width:220px;background:var(--surface);border-right:1px solid var(--border);padding:24px 16px;display:flex;flex-direction:column;gap:8px;z-index:10}
  .logo{font-size:18px;font-weight:700;color:var(--accent);margin-bottom:16px;padding-left:8px}
  .logo span{color:var(--text)}
  .nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:14px;transition:all .15s}
  .nav-item:hover,.nav-item.active{background:var(--surface2);color:var(--text)}
  .nav-item.active{border-left:3px solid var(--accent);padding-left:9px}
  .nav-icon{font-size:16px;width:20px;text-align:center}
  .main{margin-left:220px;padding:32px;min-height:100vh}
  .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
  .header h1{font-size:24px;font-weight:700}
  .header-right{display:flex;align-items:center;gap:12px}
  .badge{background:var(--surface2);border:1px solid var(--border);padding:4px 12px;border-radius:20px;font-size:12px;color:var(--muted)}
  .badge.live{border-color:var(--accent2);color:var(--accent2)}
  .badge.live::before{content:'● ';color:var(--accent2)}
  .btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-primary:hover{opacity:.9}
  .btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}
  .btn-outline:hover{border-color:var(--accent);color:var(--accent)}

  /* Auth gate */
  .auth-gate{display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px}
  .auth-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px;width:380px;text-align:center}
  .auth-card h2{margin-bottom:8px;font-size:20px}
  .auth-card p{color:var(--muted);font-size:14px;margin-bottom:24px}
  .input{width:100%;padding:12px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;outline:none;transition:border .15s}
  .input:focus{border-color:var(--accent)}
  .auth-card .btn{width:100%;margin-top:12px;padding:12px}

  /* Stats grid */
  .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
  .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
  .stat-label{font-size:12px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
  .stat-value{font-size:32px;font-weight:700;line-height:1}
  .stat-sub{font-size:12px;color:var(--muted);margin-top:6px}
  .stat-card.accent .stat-value{color:var(--accent)}
  .stat-card.green .stat-value{color:var(--accent2)}
  .stat-card.red .stat-value{color:var(--red)}
  .stat-card.yellow .stat-value{color:var(--yellow)}

  /* Chart */
  .chart-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:28px}
  .chart-card h3{font-size:15px;font-weight:600;margin-bottom:20px;color:var(--muted)}
  .chart-wrap{position:relative;height:200px}

  /* Tabs */
  .tabs{display:flex;gap:4px;margin-bottom:20px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:4px;width:fit-content}
  .tab{padding:8px 20px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);transition:all .15s}
  .tab.active{background:var(--accent);color:#fff}

  /* Table */
  .table-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
  .table-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
  .table-header h3{font-size:15px;font-weight:600}
  .search-wrap{position:relative}
  .search-wrap input{padding:8px 12px 8px 32px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px;outline:none;width:220px}
  .search-wrap::before{content:'🔍';position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px}
  table{width:100%;border-collapse:collapse}
  th{padding:12px 16px;text-align:left;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);font-weight:600}
  td{padding:13px 16px;font-size:13px;border-bottom:1px solid var(--border);color:var(--text)}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:var(--surface2)}
  .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .pill.sent{background:rgba(0,212,170,.12);color:var(--accent2)}
  .pill.failed{background:rgba(255,77,109,.12);color:var(--red)}
  .pill.replied{background:rgba(108,99,255,.15);color:var(--accent)}
  .pill.unsubscribed{background:rgba(255,209,102,.12);color:var(--yellow)}
  .pill.opened{background:rgba(0,212,170,.08);color:var(--accent2);opacity:.7}

  /* Pagination */
  .pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--border);font-size:13px;color:var(--muted)}
  .page-btns{display:flex;gap:6px}
  .page-btn{padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;font-size:12px}
  .page-btn:hover{border-color:var(--accent);color:var(--accent)}
  .page-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .page-btn:disabled{opacity:.4;cursor:default}

  /* Sections */
  .section{display:none}
  .section.active{display:block}

  /* Loader */
  .loader{text-align:center;padding:60px;color:var(--muted)}
  .spinner{width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}

  /* Empty */
  .empty{text-align:center;padding:60px;color:var(--muted)}
  .empty-icon{font-size:40px;margin-bottom:12px}

  /* Responsive */
  @media(max-width:900px){
    .sidebar{display:none}
    .main{margin-left:0;padding:20px}
    .stats-grid{grid-template-columns:repeat(2,1fr)}
  }
  @media(max-width:500px){
    .stats-grid{grid-template-columns:1fr 1fr}
    .stat-value{font-size:24px}
  }
</style>
</head>
<body>

<!-- AUTH GATE -->
<div id="authGate" class="auth-gate">
  <div class="auth-card">
    <div style="font-size:36px;margin-bottom:16px">📬</div>
    <h2>Outreach Dashboard</h2>
    <p>Enter your API key to access the dashboard</p>
    <input id="apiKeyInput" class="input" type="password" placeholder="API Key (SUPPRESS_API_SECRET)" />
    <button class="btn btn-primary" onclick="login()">Sign In</button>
    <div id="authError" style="color:var(--red);font-size:13px;margin-top:12px;display:none">Invalid API key</div>
  </div>
</div>

<!-- MAIN APP -->
<div id="app" style="display:none">
  <div class="sidebar">
    <div class="logo">Ascend <span>Outreach</span></div>
    <div class="nav-item active" onclick="showSection('overview')"><span class="nav-icon">📊</span> Overview</div>
    <div class="nav-item" onclick="showSection('emails')"><span class="nav-icon">📧</span> Emails Sent</div>
    <div class="nav-item" onclick="showSection('replies')"><span class="nav-icon">💬</span> Replies</div>
    <div class="nav-item" onclick="showSection('suppressed')"><span class="nav-icon">🚫</span> Unsubscribed</div>
  </div>

  <div class="main">
    <div class="header">
      <h1 id="pageTitle">Overview</h1>
      <div class="header-right">
        <span class="badge live">Live</span>
        <button class="btn btn-outline" onclick="refresh()">↺ Refresh</button>
      </div>
    </div>

    <!-- OVERVIEW -->
    <div id="section-overview" class="section active">
      <div id="statsGrid" class="stats-grid">
        <div class="stat-card accent"><div class="stat-label">Total Sent</div><div class="stat-value" id="st-sent">—</div><div class="stat-sub">All time</div></div>
        <div class="stat-card green"><div class="stat-label">Replies</div><div class="stat-value" id="st-replied">—</div><div class="stat-sub">Response rate: <span id="st-rate">—</span></div></div>
        <div class="stat-card yellow"><div class="stat-label">Today's Sends</div><div class="stat-value" id="st-today">—</div><div class="stat-sub" id="st-cap">of 500 cap</div></div>
        <div class="stat-card red"><div class="stat-label">Unsubscribed</div><div class="stat-value" id="st-unsub">—</div><div class="stat-sub">Opt-outs</div></div>
      </div>
      <div class="chart-card">
        <h3>Emails Sent — Last 30 Days</h3>
        <div class="chart-wrap"><canvas id="myChart"></canvas></div>
      </div>
      <div class="table-card">
        <div class="table-header"><h3>Recent Activity</h3></div>
        <table>
          <thead><tr><th>Time</th><th>To</th><th>Company</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody id="recentBody"></tbody>
        </table>
      </div>
    </div>

    <!-- EMAILS -->
    <div id="section-emails" class="section">
      <div class="table-card">
        <div class="table-header">
          <h3>All Sent Emails</h3>
          <div class="search-wrap"><input id="emailSearch" placeholder="Search..." oninput="filterEmails()"/></div>
        </div>
        <div id="emailsLoader" class="loader"><div class="spinner"></div>Loading...</div>
        <div id="emailsTableWrap" style="display:none">
          <table>
            <thead><tr><th>Date</th><th>Name</th><th>Email</th><th>Title</th><th>Company</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody id="emailsBody"></tbody>
          </table>
          <div class="pagination">
            <span id="emailsCount"></span>
            <div class="page-btns" id="emailsPages"></div>
          </div>
        </div>
        <div id="emailsEmpty" class="empty" style="display:none"><div class="empty-icon">📭</div>No emails sent yet</div>
      </div>
    </div>

    <!-- REPLIES -->
    <div id="section-replies" class="section">
      <div class="table-card">
        <div class="table-header"><h3>Replies Received</h3></div>
        <div id="repliesLoader" class="loader"><div class="spinner"></div>Loading...</div>
        <div id="repliesTableWrap" style="display:none">
          <table>
            <thead><tr><th>Date</th><th>From</th><th>Message ID</th></tr></thead>
            <tbody id="repliesBody"></tbody>
          </table>
        </div>
        <div id="repliesEmpty" class="empty" style="display:none"><div class="empty-icon">💬</div>No replies tracked yet</div>
      </div>
    </div>

    <!-- SUPPRESSED -->
    <div id="section-suppressed" class="section">
      <div class="table-card">
        <div class="table-header">
          <h3>Unsubscribed / Suppressed</h3>
          <div class="search-wrap"><input id="suppressSearch" placeholder="Search..." oninput="filterSuppressed()"/></div>
        </div>
        <div id="suppressLoader" class="loader"><div class="spinner"></div>Loading...</div>
        <div id="suppressTableWrap" style="display:none">
          <table>
            <thead><tr><th>#</th><th>Email Address</th></tr></thead>
            <tbody id="suppressBody"></tbody>
          </table>
          <div class="pagination"><span id="suppressCount"></span></div>
        </div>
        <div id="suppressEmpty" class="empty" style="display:none"><div class="empty-icon">🚫</div>No unsubscribes yet</div>
      </div>
    </div>
  </div>
</div>

<script>
let API_KEY = '';
let data = null;
let chart = null;
let allEmails = [];
let allSuppressed = [];
let emailPage = 0;
const PAGE_SIZE = 50;

const BASE = window.location.origin;

async function login() {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key) return;
  try {
    const r = await fetch(BASE + '/api/logs?key=' + encodeURIComponent(key));
    if (r.status === 401) { document.getElementById('authError').style.display='block'; return; }
    const d = await r.json();
    if (d.error) { document.getElementById('authError').style.display='block'; return; }
    API_KEY = key;
    data = d;
    document.getElementById('authGate').style.display='none';
    document.getElementById('app').style.display='block';
    renderAll();
  } catch(e) {
    document.getElementById('authError').style.display='block';
  }
}

async function refresh() {
  try {
    const r = await fetch(BASE + '/api/logs?key=' + encodeURIComponent(API_KEY));
    data = await r.json();
    renderAll();
  } catch {}
}

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if(n.textContent.toLowerCase().includes(name === 'overview' ? 'overview' : name === 'emails' ? 'emails' : name === 'replies' ? 'replies' : 'unsub')) n.classList.add('active');
  });
  const titles = {overview:'Overview',emails:'Emails Sent',replies:'Replies',suppressed:'Unsubscribed'};
  document.getElementById('pageTitle').textContent = titles[name];
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
}

function statusPill(e) {
  if (e.replied) return '<span class="pill replied">💬 Replied</span>';
  if (e.status === 'failed') return '<span class="pill failed">✗ Failed</span>';
  return '<span class="pill sent">✓ Sent</span>';
}

function renderAll() {
  if (!data) return;
  const s = data.stats || {};
  const emails = data.emails || [];
  const replies = data.replies || [];
  const suppressed = data.suppressed || [];
  const daily = data.dailyCounts || {};
  allEmails = emails;
  allSuppressed = suppressed;

  // Stats
  document.getElementById('st-sent').textContent = (s.totalSent || 0).toLocaleString();
  document.getElementById('st-replied').textContent = (s.totalReplied || 0).toLocaleString();
  const rate = s.totalSent > 0 ? ((s.totalReplied / s.totalSent) * 100).toFixed(1) : '0.0';
  document.getElementById('st-rate').textContent = rate + '%';
  document.getElementById('st-unsub').textContent = (s.totalUnsubscribed || 0).toLocaleString();

  // Today count from dailyCounts
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCount = daily[todayKey] || 0;
  document.getElementById('st-today').textContent = todayCount.toLocaleString();

  // Chart
  const labels = Object.keys(daily).sort();
  const values = labels.map(k => daily[k]);
  if (chart) chart.destroy();
  const ctx = document.getElementById('myChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => { const d=new Date(l); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }),
      datasets: [{
        data: values,
        backgroundColor: 'rgba(108,99,255,0.5)',
        borderColor: '#6c63ff',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#2e3250' }, ticks: { color: '#8892b0', maxTicksLimit: 10 } },
        y: { grid: { color: '#2e3250' }, ticks: { color: '#8892b0', precision: 0 }, beginAtZero: true }
      }
    }
  });

  // Recent table (last 10)
  const recent = emails.slice(0, 10);
  document.getElementById('recentBody').innerHTML = recent.length === 0
    ? '<tr><td colspan="5" class="empty">No emails sent yet</td></tr>'
    : recent.map(e => \`<tr>
        <td style="color:var(--muted);white-space:nowrap">\${fmt(e.ts)}</td>
        <td>\${e.to || '—'}</td>
        <td style="color:var(--muted)">\${e.company || '—'}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${e.subject || '—'}</td>
        <td>\${statusPill(e)}</td>
      </tr>\`).join('');

  // Emails table
  renderEmailsPage(0);

  // Replies table
  document.getElementById('repliesLoader').style.display = 'none';
  if (replies.length === 0) {
    document.getElementById('repliesEmpty').style.display = 'block';
  } else {
    document.getElementById('repliesTableWrap').style.display = 'block';
    document.getElementById('repliesBody').innerHTML = replies.map(r => \`<tr>
      <td style="color:var(--muted)">\${fmt(r.ts)}</td>
      <td>\${r.email || '—'}</td>
      <td style="color:var(--muted);font-size:12px">\${r.messageId || '—'}</td>
    </tr>\`).join('');
  }

  // Suppressed table
  document.getElementById('suppressLoader').style.display = 'none';
  filterSuppressed();
}

function renderEmailsPage(page) {
  emailPage = page;
  const search = (document.getElementById('emailSearch')?.value || '').toLowerCase();
  const filtered = allEmails.filter(e =>
    !search || (e.to||'').toLowerCase().includes(search) ||
    (e.company||'').toLowerCase().includes(search) ||
    (e.firstName||'').toLowerCase().includes(search) ||
    (e.subject||'').toLowerCase().includes(search)
  );
  const total = filtered.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  document.getElementById('emailsLoader').style.display = 'none';
  if (allEmails.length === 0) {
    document.getElementById('emailsEmpty').style.display = 'block';
    return;
  }
  document.getElementById('emailsTableWrap').style.display = 'block';
  document.getElementById('emailsCount').textContent = \`\${total.toLocaleString()} emails\`;

  document.getElementById('emailsBody').innerHTML = slice.map(e => \`<tr>
    <td style="color:var(--muted);white-space:nowrap;font-size:12px">\${fmt(e.ts)}</td>
    <td>\${e.firstName||''} \${e.lastName||''}</td>
    <td style="color:var(--muted)">\${e.to||'—'}</td>
    <td style="color:var(--muted);font-size:12px">\${e.title||'—'}</td>
    <td>\${e.company||'—'}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">\${e.subject||'—'}</td>
    <td>\${statusPill(e)}</td>
  </tr>\`).join('');

  // Pagination
  const pb = document.getElementById('emailsPages');
  pb.innerHTML = '';
  const addBtn = (label, p, disabled=false) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (p === page ? ' active' : '');
    b.textContent = label; b.disabled = disabled;
    b.onclick = () => renderEmailsPage(p);
    pb.appendChild(b);
  };
  addBtn('‹', page - 1, page === 0);
  const start = Math.max(0, page - 2), end = Math.min(pages - 1, start + 4);
  for (let i = start; i <= end; i++) addBtn(i + 1, i);
  addBtn('›', page + 1, page >= pages - 1);
}

function filterEmails() { renderEmailsPage(0); }

function filterSuppressed() {
  const search = (document.getElementById('suppressSearch')?.value || '').toLowerCase();
  const filtered = allSuppressed.filter(e => !search || e.toLowerCase().includes(search));
  document.getElementById('suppressLoader').style.display = 'none';
  if (filtered.length === 0) {
    document.getElementById('suppressEmpty').style.display = 'block';
    document.getElementById('suppressTableWrap').style.display = 'none';
    return;
  }
  document.getElementById('suppressEmpty').style.display = 'none';
  document.getElementById('suppressTableWrap').style.display = 'block';
  document.getElementById('suppressCount').textContent = filtered.length.toLocaleString() + ' addresses';
  document.getElementById('suppressBody').innerHTML = filtered.map((e,i) =>
    \`<tr><td style="color:var(--muted);width:50px">\${i+1}</td><td>\${e}</td></tr>\`
  ).join('');
}

document.getElementById('apiKeyInput').addEventListener('keydown', e => { if(e.key==='Enter') login(); });
</script>
</body>
</html>`);
}

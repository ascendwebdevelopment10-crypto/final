import { getTotalStats, getEmailLog, getSmsLog } from '../lib/store.js';

export default function handler(req, res) {
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
  .chart { display: flex; align-items: flex-end; gap: 4px; height: 120px; }
  .bar-group { flex: 1; display: flex; gap: 2px; align-items: flex-end; height: 100%; }
  .bar { flex: 1; border-radius: 2px 2px 0 0; min-height: 2px; }
  .bar.email-bar { background: #6366f1; }
  .bar.sms-bar { background: #f59e0b; }
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
  #sms-panel { display: none; }
</style>
</head>
<body>
<div class="header"><h1>&#128640; Ascend Outreach</h1><span class="badge">LIVE</span></div>
<div class="container">
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
  <div class="section">
    <h2>Recent Activity</h2>
    <div class="tabs">
      <button class="tab active" id="tab-email" onclick="showTab('email')">Emails</button>
      <button class="tab" id="tab-sms" onclick="showTab('sms')">SMS</button>
    </div>
    <div id="email-panel"><table><thead><tr><th>To</th><th>Subject</th><th>Time</th><th>Status</th></tr></thead><tbody id="email-log-body"></tbody></table></div>
    <div id="sms-panel"><table><thead><tr><th>To</th><th>Message</th><th>Time</th><th>Status</th></tr></thead><tbody id="sms-log-body"></tbody></table></div>
  </div>
</div>
<script>
function showTab(t){document.getElementById('email-panel').style.display=t==='email'?'block':'none';document.getElementById('sms-panel').style.display=t==='sms'?'block':'none';document.getElementById('tab-email').className='tab'+(t==='email'?' active':'');document.getElementById('tab-sms').className='tab'+(t==='sms'?' active':'');}
function fmt(ts){return ts?new Date(ts).toLocaleString():'—';}
async function load(){
  try{
    const[stats,emails,sms]=await Promise.all([fetch('/api/logs?type=stats').then(r=>r.json()),fetch('/api/logs?type=emails&limit=50').then(r=>r.json()),fetch('/api/logs?type=sms&limit=50').then(r=>r.json())]);
    document.getElementById('total-email').textContent=(stats.totalEmailSent||0).toLocaleString();
    document.getElementById('total-sms').textContent=(stats.totalSmsSent||0).toLocaleString();
    document.getElementById('today-email').textContent='Today: '+(stats.todayEmailSent||0);
    document.getElementById('today-sms').textContent='Today: '+(stats.todaySmsSent||0);
    document.getElementById('email-replies').textContent=(stats.emailReplies||0).toLocaleString();
    document.getElementById('sms-replies').textContent=(stats.smsReplies||0).toLocaleString();
    document.getElementById('unsubscribed').textContent=(stats.unsubscribed||0).toLocaleString();
    const days=stats.dailyChart||[];
    const maxV=Math.max(...days.map(d=>Math.max(d.emails||0,d.sms||0)),1);
    const chart=document.getElementById('chart');const labels=document.getElementById('chart-labels');
    chart.innerHTML='';labels.innerHTML='';
    days.forEach(d=>{const eH=Math.round(((d.emails||0)/maxV)*100);const sH=Math.round(((d.sms||0)/maxV)*100);const g=document.createElement('div');g.className='bar-group';g.title=d.date+': '+d.emails+' emails, '+d.sms+' SMS';g.innerHTML='<div class="bar email-bar" style="height:'+eH+'%"></div><div class="bar sms-bar" style="height:'+sH+'%"></div>';chart.appendChild(g);const l=document.createElement('div');l.className='chart-label';l.textContent=d.date.slice(5);labels.appendChild(l);});
    const eb=document.getElementById('email-log-body');
    eb.innerHTML=emails.length?emails.map(e=>'<tr><td>'+(e.to||'—')+'</td><td>'+(e.subject||'—')+'</td><td>'+fmt(e.timestamp)+'</td><td><span class="'+(e.replied?'badge-replied':'badge-sent')+'">'+(e.replied?'Replied':'Sent')+'</span></td></tr>').join(''):'<tr><td colspan="4" class="empty">No emails sent yet. First run at 3pm UTC.</td></tr>';
    const sb=document.getElementById('sms-log-body');
    sb.innerHTML=sms.length?sms.map(e=>'<tr><td>'+(e.to||'—')+'</td><td>'+((e.body||'—').substring(0,80))+'</td><td>'+fmt(e.timestamp)+'</td><td><span class="'+(e.replied?'badge-replied':'badge-sms')+'">'+(e.replied?'Replied':'Sent')+'</span></td></tr>').join(''):'<tr><td colspan="4" class="empty">No SMS sent yet. First run at 3pm UTC.</td></tr>';
  }catch(e){console.error(e);}
}
load();setInterval(load,30000);
<\/script>
</body></html>`;
  res.setHeader('Content-Type','text/html');
  res.status(200).send(html);
}

export default function handler(req, res) {
const css = '*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f0f6ff;color:#1e293b;min-height:100vh}.header{background:#fff;border-bottom:1px solid #e2e8f0;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,.06)}.header h1{font-size:20px;font-weight:700;color:#0284c7}.badge-live{background:#0ea5e9;color:#fff;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600}.nav{background:#fff;border-bottom:1px solid #e2e8f0;padding:0 32px;display:flex;gap:4px}.nav-btn{padding:14px 20px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s}.nav-btn:hover{color:#0284c7}.nav-btn.active{color:#0284c7;border-bottom-color:#0284c7}.nav-btn.replies-btn.active{color:#0284c7;border-bottom-color:#0284c7}.rbadge{display:none;background:#0ea5e9;color:#fff;font-size:10px;padding:1px 6px;border-radius:99px;margin-left:6px;font-weight:600}.container{max-width:1200px;margin:0 auto;padding:32px}.page{display:none}.page.active{display:block}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:32px}.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.05)}.stat-card .label{font-size:12px;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}.stat-card .value{font-size:32px;font-weight:700;color:#0284c7}.stat-card .sub{font-size:12px;color:#64748b;margin-top:4px}.stat-card.ec{border-top:3px solid #0ea5e9}.stat-card.sc{border-top:3px solid #38bdf8}.stat-card.rc{border-top:3px solid #22c55e}.stat-card.uc{border-top:3px solid #f87171}.section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.05)}.section h2{font-size:16px;font-weight:600;margin-bottom:20px;color:#0f172a}.chart{display:flex;align-items:flex-end;gap:4px;height:120px}.bg{flex:1;display:flex;gap:2px;align-items:flex-end;height:100%}.bar{flex:1;border-radius:2px 2px 0 0;min-height:2px}.eb{background:#0ea5e9}.sb{background:#38bdf8}.chart-labels{display:flex;gap:4px;margin-top:4px}.cl{flex:1;text-align:center;font-size:9px;color:#64748b;overflow:hidden}.legend{display:flex;gap:16px;margin-top:12px}.li{display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b}.ld{width:10px;height:10px;border-radius:2px}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:10px 12px;color:#64748b;font-weight:500;border-bottom:1px solid #e2e8f0;font-size:11px;text-transform:uppercase}td{padding:12px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:top}tr.data-row:last-child td{border-bottom:none}tr.data-row:hover td{background:#f8fafc;cursor:pointer}.bs{background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.br{background:#dcfce7;color:#166534;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.bsm{background:#fef3c7;color:#0369a1;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.bads{background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.bapp{background:#dcfce7;color:#166534;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.bweb{background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:500}.empty{text-align:center;color:#64748b;padding:40px}.subtabs{display:flex;gap:8px;margin-bottom:24px;border-bottom:1px solid #e2e8f0;padding-bottom:0}.stab{padding:10px 20px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:14px;font-weight:500;margin-bottom:-1px}.stab.email-stab.active{color:#0284c7;border-bottom-color:#0284c7}.stab.sms-stab.active{color:#0284c7;border-bottom-color:#0284c7}.sbadge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:99px;margin-left:6px;font-weight:600}.email-stab .sbadge{background:#dbeafe;color:#1d4ed8}.sms-stab .sbadge{background:#e0f2fe;color:#0369a1}.subpage{display:none}.subpage.active{display:block}.reply-list{display:flex;flex-direction:column;gap:12px}.rc2{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;transition:border-color .15s;box-shadow:0 1px 3px rgba(0,0,0,.04)}.rc2:hover{border-color:#7dd3fc}.rc2.open{border-color:#0ea5e9}.rc2.email-reply.open{border-color:#0284c7}.rh{padding:16px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none}.ra{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0}.ra.email-av{background:linear-gradient(135deg,#0ea5e9,#38bdf8)}.ra.sms-av{background:linear-gradient(135deg,#0284c7,#0ea5e9)}.rm{flex:1;min-width:0}.rf{font-weight:600;color:#0f172a;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rs{color:#64748b;font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rt{font-size:11px;color:#64748b;flex-shrink:0}.rv{color:#64748b;font-size:18px;flex-shrink:0;transition:transform .2s}.rc2.open .rv{transform:rotate(90deg)}.rb2{display:none;padding:0 20px 20px;border-top:1px solid #f1f5f9}.rc2.open .rb2{display:block}.rbi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-top:16px;font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;word-break:break-word;max-height:400px;overflow-y:auto}.ract{display:flex;gap:8px;margin-top:12px}.btn-r{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;background:#0ea5e9;color:#fff;display:inline-block}.btn-sms-r{background:#38bdf8;color:#0c4a6e}.no-rep{text-align:center;padding:60px 20px}.no-rep .icon{font-size:48px;margin-bottom:16px}.no-rep p{color:#64748b;font-size:15px}.rph{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.rph h2{font-size:20px;font-weight:700;color:#0f172a}.rfbtn{padding:8px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;color:#64748b;cursor:pointer;font-size:12px}.rfbtn:hover{color:#0284c7;border-color:#0ea5e9}.msg-expand-row{display:none;background:#f8fafc}.msg-expand-row.open{display:table-row}.msg-expand-row td{padding:0 12px 16px 12px;border-bottom:1px solid #e2e8f0}.msg-box{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;font-size:13px;line-height:1.7;color:#334155;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto}.expand-arrow{display:inline-block;font-size:11px;color:#94a3b8;margin-left:6px;transition:transform .2s}.row-open .expand-arrow{transform:rotate(90deg)}';

const navHtml = '<div class="header"><h1>&#128640; Ascend Outreach</h1><span class="badge-live">LIVE</span></div><nav class="nav"><button class="nav-btn active" data-page="overview">Overview</button><button class="nav-btn" data-page="emails">Emails</button><button class="nav-btn" data-page="sms">SMS</button><button class="nav-btn replies-btn" data-page="replies">Replies<span class="rbadge" id="rbadge">0</span></button></nav>';

const overviewHtml = '<div class="page active" id="page-overview"><div class="stats-grid"><div class="stat-card ec"><div class="label">Emails Sent</div><div class="value" id="te">-</div><div class="sub" id="tde">Today: -</div></div><div class="stat-card sc"><div class="label">SMS Sent</div><div class="value" id="ts">-</div><div class="sub" id="tds">Today: -</div></div><div class="stat-card rc"><div class="label">Email Replies</div><div class="value" id="er">-</div><div class="sub">responses received</div></div><div class="stat-card rc"><div class="label">SMS Replies</div><div class="value" id="sr">-</div><div class="sub">responses received</div></div><div class="stat-card uc"><div class="label">Unsubscribed</div><div class="value" id="un">-</div><div class="sub">removed</div></div></div><div class="section"><h2>30-Day Activity</h2><div class="chart" id="chart"></div><div class="chart-labels" id="clabels"></div><div class="legend"><div class="li"><div class="ld" style="background:#0ea5e9"></div>Emails</div><div class="li"><div class="ld" style="background:#38bdf8"></div>SMS</div></div></div></div>';

const emailsHtml = '<div class="page" id="page-emails"><div class="section"><h2>Email Log</h2><table><thead><tr><th>To</th><th>Subject</th><th>Service</th><th>Segment</th><th>Time</th><th>Status</th></tr></thead><tbody id="email-tbody"></tbody></table></div></div>';

const smsHtml = '<div class="page" id="page-sms"><div class="section"><h2>SMS Log</h2><table><thead><tr><th>To</th><th>Message <span style="font-size:10px;color:#94a3b8">(click to expand)</span></th><th>Service</th><th>Segment</th><th>Time</th><th>Status</th></tr></thead><tbody id="sms-tbody"></tbody></table></div></div>';

const repliesHtml = '<div class="page" id="page-replies"><div class="rph"><h2>Replies <span id="rtc" style="color:#64748b;font-size:16px;font-weight:400"></span></h2><button class="rfbtn" id="refresh-btn">&#8635; Refresh</button></div><div class="subtabs"><button class="stab email-stab active" data-subtab="email">&#9993; Email Replies<span class="sbadge" id="er-badge">0</span></button><button class="stab sms-stab" data-subtab="sms">&#128241; SMS Replies<span class="sbadge" id="sr-badge">0</span></button></div><div class="subpage active" id="subpage-email"><div class="reply-list" id="email-list"></div></div><div class="subpage" id="subpage-sms"><div class="reply-list" id="sms-list"></div></div></div>';

const js = `(function(){
var cp='overview';
document.querySelectorAll('.nav-btn').forEach(function(b){
b.addEventListener('click',function(){
var p=b.dataset.page;
document.querySelectorAll('.page').forEach(function(x){x.classList.remove('active');});
document.querySelectorAll('.nav-btn').forEach(function(x){x.classList.remove('active');});
document.getElementById('page-'+p).classList.add('active');
b.classList.add('active');cp=p;
if(p==='replies')lr();
if(p==='emails')le();
if(p==='sms')ls();
});
});
document.querySelectorAll('.stab').forEach(function(b){
b.addEventListener('click',function(){
var t=b.dataset.subtab;
document.querySelectorAll('.subpage').forEach(function(x){x.classList.remove('active');});
document.querySelectorAll('.stab').forEach(function(x){x.classList.remove('active');});
document.getElementById('subpage-'+t).classList.add('active');
b.classList.add('active');
});
});
document.getElementById('refresh-btn').addEventListener('click',lr);
document.addEventListener('click',function(e){
var h=e.target.closest('.rh');
if(h)h.parentElement.classList.toggle('open');
// Handle expandable SMS/Email rows
var dr=e.target.closest('tr.data-row');
if(dr&&dr.dataset.expandId){
var xr=document.getElementById(dr.dataset.expandId);
if(xr){xr.classList.toggle('open');dr.classList.toggle('row-open');}
}
});
function fmt(ts){return ts?new Date(ts).toLocaleString():'-';}
function ini(s){return s?s[0].toUpperCase():'?';}
function esc(s){return s?(s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}
function svcBadge(svc){
if(svc==='ads')return '<span class="bads">Ads</span>';
if(svc==='app')return '<span class="bapp">App</span>';
if(svc==='website')return '<span class="bweb">Website</span>';
return '<span class="bs">'+(svc||'Web')+'</span>';
}
function makeCard(r,ie){
var from=r.from||'-';
var subj=ie?(r.subject||'(no subject)'):(r.body||'').substring(0,60);
var body=esc((r.body||'').replace(/<[^>]+>/g,'').trim()||'(no content)');
var cc=ie?'email-reply':'sms-reply';
var ac=ie?'email-av':'sms-av';
var href=ie?'mailto:'+encodeURIComponent(from)+'?subject='+encodeURIComponent('Re: '+(r.subject||'')):'sms:'+from;
var lbl=ie?'Reply in Email':'Reply via SMS';
var bc=ie?'btn-r':'btn-r btn-sms-r';
return '<div class="rc2 '+cc+'"><div class="rh"><div class="ra '+ac+'">'+ini(from)+'</div><div class="rm"><div class="rf">'+esc(from)+'</div><div class="rs">'+esc(subj)+'</div></div><span class="rt">'+fmt(r.timestamp)+'</span><span class="rv">&#8250;</span></div><div class="rb2"><div class="rbi">'+body+'</div><div class="ract"><a href="'+href+'" class="'+bc+'" target="_blank">'+lbl+'</a></div></div></div>';
}
function rrc(replies,lid,ie){
var el=document.getElementById(lid);
if(!replies||!replies.length){
el.innerHTML='<div class="no-rep"><div class="icon">'+(ie?'&#128235;':'&#128241;')+'</div><p>No '+(ie?'email':'SMS')+' replies yet.</p></div>';
return;
}
el.innerHTML=replies.map(function(r){return makeCard(r,ie);}).join('');
}
function lr(){
Promise.all([
fetch('/api/logs?type=replies&subtype=email&limit=100').then(function(r){return r.json();}),
fetch('/api/logs?type=replies&subtype=sms&limit=100').then(function(r){return r.json();})
]).then(function(res){
var er=res[0]||[],sr=res[1]||[];
var tot=er.length+sr.length;
var b=document.getElementById('rbadge');
b.textContent=tot;b.style.display=tot?'inline-block':'none';
document.getElementById('rtc').textContent=tot?'('+tot+')':'';
document.getElementById('er-badge').textContent=er.length;
document.getElementById('sr-badge').textContent=sr.length;
rrc(er,'email-list',true);rrc(sr,'sms-list',false);
}).catch(function(e){console.error(e);});
}
function lstats(){
fetch('/api/logs?type=stats').then(function(r){return r.json();}).then(function(s){
document.getElementById('te').textContent=(s.totalEmailSent||0).toLocaleString();
document.getElementById('ts').textContent=(s.totalSmsSent||0).toLocaleString();
document.getElementById('tde').textContent='Today: '+(s.todayEmailSent||0);
document.getElementById('tds').textContent='Today: '+(s.todaySmsSent||0);
document.getElementById('er').textContent=(s.emailReplies||0).toLocaleString();
document.getElementById('sr').textContent=(s.smsReplies||0).toLocaleString();
document.getElementById('un').textContent=(s.unsubscribed||0).toLocaleString();
var days=s.dailyChart||[];
var mx=Math.max.apply(null,days.map(function(d){return Math.max(d.emails||0,d.sms||0);}));
mx=mx||1;
var ch=document.getElementById('chart'),cl=document.getElementById('clabels');
ch.innerHTML='';cl.innerHTML='';
days.forEach(function(d){
var eH=Math.round(((d.emails||0)/mx)*100),sH=Math.round(((d.sms||0)/mx)*100);
var g=document.createElement('div');g.className='bg';
g.innerHTML='<div class="bar eb" style="height:'+eH+'%"></div><div class="bar sb" style="height:'+sH+'%"></div>';
ch.appendChild(g);
var l=document.createElement('div');l.className='cl';l.textContent=d.date.slice(5);cl.appendChild(l);
});
}).catch(function(e){console.error(e);});
}
function le(){
fetch('/api/logs?type=emails&limit=100').then(function(r){return r.json();}).then(function(emails){
var sl={no_website:'No Website',needs_app:'App',general:'General'};
var rows='';
emails.forEach(function(e,i){
var xid='ex-em-'+i;
var preview=esc((e.subject||'-'));
var fullBody=esc((e.body||'(no body stored)').replace(/<[^>]+>/g,'').trim());
rows+='<tr class="data-row" data-expand-id="'+xid+'"><td>'+esc(e.to||'-')+'</td><td>'+preview+'<span class="expand-arrow">&#8250;</span></td><td>'+svcBadge(e.service)+'</td><td>'+(sl[e.segment]||e.segment||'-')+'</td><td>'+fmt(e.timestamp)+'</td><td><span class="'+(e.replied?'br':'bs')+'">'+(e.replied?'Replied':'Sent')+'</span></td></tr>';
rows+='<tr class="msg-expand-row" id="'+xid+'"><td colspan="6"><div class="msg-box">'+fullBody+'</div></td></tr>';
});
document.getElementById('email-tbody').innerHTML=rows||'<tr><td colspan="6" class="empty">No emails sent yet.</td></tr>';
}).catch(function(e){console.error(e);});
}
function ls(){
fetch('/api/logs?type=sms&limit=100').then(function(r){return r.json();}).then(function(sms){
var sl={no_website:'No Website',needs_app:'App',general:'General'};
var rows='';
sms.forEach(function(e,i){
var xid='ex-sms-'+i;
var preview=esc((e.body||'-').substring(0,80))+(e.body&&e.body.length>80?'...':'');
var fullMsg=esc(e.body||'(no message)');
rows+='<tr class="data-row" data-expand-id="'+xid+'"><td>'+esc(e.to||'-')+'</td><td>'+preview+'<span class="expand-arrow">&#8250;</span></td><td>'+svcBadge(e.service)+'</td><td>'+(sl[e.segment]||e.segment||'-')+'</td><td>'+fmt(e.timestamp)+'</td><td><span class="'+(e.replied?'br':'bsm')+'">'+(e.replied?'Replied':'Sent')+'</span></td></tr>';
rows+='<tr class="msg-expand-row" id="'+xid+'"><td colspan="6"><div class="msg-box">'+fullMsg+'</div></td></tr>';
});
document.getElementById('sms-tbody').innerHTML=rows||'<tr><td colspan="6" class="empty">No SMS sent yet.</td></tr>';
}).catch(function(e){console.error(e);});
}
lstats();le();ls();lr();
setInterval(function(){lstats();if(cp==='replies')lr();},30000);
})()`;

const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Ascend Outreach Dashboard</title><style>' + css + '</style></head><body>' + navHtml + '<div class="container">' + overviewHtml + emailsHtml + smsHtml + repliesHtml + '</div><script>' + js + '<\/script></body></html>';

res.setHeader('Content-Type', 'text/html');
res.status(200).send(html);
}

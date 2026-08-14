(()=>{
  if(window.__nitroOutreachIntelligence)return;window.__nitroOutreachIntelligence=true;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const fmt=value=>{if(!value)return '—';try{return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(Number(value)||value));}catch{return '—';}};
  const mountainDay=value=>{try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${o.year}-${o.month}-${o.day}`;}catch{return '';}};
  const todayKey=()=>mountainDay(Date.now());
  const secondsLabel=s=>{s=Math.max(0,Number(s||0));if(!s)return '';const m=Math.floor(s/60),r=Math.floor(s%60);return m?`${m}m ${String(r).padStart(2,'0')}s`:`${r}s`;};
  const prettyPath=p=>{p=String(p||'/').split('?')[0].split('#')[0];if(p==='/'||!p)return 'Homepage';return p.split('/').filter(Boolean).map(x=>x.replace(/[-_]/g,' ')).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' › ');};
  async function post(action){const r=await fetch('/api/owner-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});if(!r.ok)throw new Error('owner data');return r.json();}
  async function durations(){try{const r=await fetch('/api/outreach-duration');return r.ok?r.json():{seconds:{}};}catch{return {seconds:{}};}}
  function accountMap(accounts){return new Map((accounts||[]).map(a=>[String(a.email||'').toLowerCase(),a]));}
  function pagesFor(entry,groups){const sessions=[];(groups||[]).forEach(g=>(g.sessions||[]).forEach(s=>{if(String(s.outreachId||'')===String(entry.id||''))sessions.push(s);}));return sessions;}
  function confidence(entry){if(entry.opened)return ['human','Likely human'];if(entry.automatedOpen||Number(entry.knownAutomatedOpenCount||0)>0)return ['filtered','Security scan'];if(Number(entry.rawOpenCount||entry.openCount||0)>0)return ['uncertain','Uncertain'];return ['','No open yet'];}
  function buildTimeline(entry,account,visitSessions,duration){const out=[];const push=(time,title,detail='',kind='')=>{if(time)out.push({time:Number(time)||Date.parse(time),title,detail,kind});};
    push(entry.timestamp,'Email sent',entry.subject||'Outreach email');
    if(['delivered','replied'].includes(String(entry.status||'')))push(entry.deliveredAt||entry.statusAt,'Delivered','Provider-confirmed delivery');
    if(entry.automatedOpen||Number(entry.knownAutomatedOpenCount||0)>0)push(entry.firstOpenedAt,'Security scan filtered',`${Number(entry.rawOpenCount||entry.knownAutomatedOpenCount||1)} automated image request${Number(entry.rawOpenCount||1)===1?'':'s'}`,'filtered');
    if(entry.opened)push(entry.firstOpenedAt,'Likely human open',`${Number(entry.openCount||1)} likely-human image request${Number(entry.openCount||1)===1?'':'s'}`,'human');
    else if(Number(entry.rawOpenCount||0)>0&&!entry.automatedOpen)push(entry.firstOpenedAt,'Open detected — uncertain','Not enough evidence to call this human','');
    if(entry.linkLoaded)push(entry.firstVisitedAt,'Email link loaded',entry.visitedPath?prettyPath(entry.visitedPath):'Signed outreach link loaded','site');
    (visitSessions||[]).forEach(s=>{const pages=[...(s.pages||[])];if(pages.length)push(s.firstViewedAt,'Site session',`${pages.map(prettyPath).join(' → ')}${Number(s.viewCount||0)>1?` · ${s.viewCount} page views`:''}`,'site');});
    if(entry.confirmedVisit){const reason={active_8s:'8+ focused seconds',scroll:'meaningful scroll',click:'on-site click',navigation:'multiple pages'}[entry.confirmedReason]||'meaningful on-site engagement';push(entry.firstConfirmedAt,'Confirmed site visit',`${reason}${duration?` · ${secondsLabel(duration)} focused time`:''}${entry.confirmedPath?` · ${prettyPath(entry.confirmedPath)}`:''}`,'human');}
    if(account&&Date.parse(account.createdAt||0)>=Number(entry.timestamp||0))push(account.createdAt,'Created Nitro account',`${account.plan||'free'} plan`,'human');
    if(account&&account.billingMode==='stripe'&&account.status!=='canceled')push(account.updatedAt||account.createdAt,'Became a paid customer',`${account.plan||'paid'} · ${account.interval||'monthly'}`,'paid');
    if(entry.reply)push(entry.reply.timestamp,'Replied',entry.reply.subject||'Reply received','human');
    return out.filter(x=>Number.isFinite(x.time)&&x.time>0).sort((a,b)=>a.time-b.time);
  }
  function renderEvent(e){return `<div class="nitro-event ${e.kind?'is-'+e.kind:''}"><span class="nitro-event-time">${esc(fmt(e.time))}</span><i class="nitro-event-dot"></i><div class="nitro-event-copy"><b>${esc(e.title)}</b>${e.detail?`<small>${esc(e.detail)}</small>`:''}</div></div>`;}
  async function enhance(){const statsEl=document.getElementById('outreach-stats');const table=document.querySelector('.outreach-activity');if(!statsEl||!table)return;statsEl.style.display='none';try{const [outreach,stats,dur]=await Promise.all([post('outreach'),post('stats'),durations()]);const s=outreach.stats||{},log=outreach.log||[],accounts=accountMap(stats.accounts),groups=stats.visitorGroups||[],durationMap=dur.seconds||{};
    const uncertain=Math.max(0,Number(s.rawOpened||0)-Number(s.opened||0)-Number(s.filteredOpens||0));
    let panel=document.getElementById('nitro-confidence-panel');if(!panel){panel=document.createElement('div');panel.id='nitro-confidence-panel';panel.className='nitro-intelligence';statsEl.parentNode.insertBefore(panel,statsEl);}
    const matched=log.map(e=>({e,a:accounts.get(String(e.to||'').toLowerCase())}));
    const signed=matched.filter(x=>x.a&&Date.parse(x.a.createdAt||0)>=Number(x.e.timestamp||0)).length;
    const paid=matched.filter(x=>x.a&&x.a.billingMode==='stripe'&&x.a.status!=='canceled').length;
    const today=todayKey();
    const signedToday=matched.filter(x=>x.a&&Date.parse(x.a.createdAt||0)>=Number(x.e.timestamp||0)&&mountainDay(x.a.createdAt)===today).length;
    const paidToday=matched.filter(x=>x.a&&x.a.billingMode==='stripe'&&x.a.status!=='canceled'&&mountainDay(x.a.updatedAt||x.a.createdAt)===today).length;
    const stages=[
      ['Sent',s.totalEmailSent,s.todayEmailSent],
      ['Human opened',s.opened,s.todayOpened],
      ['Link loaded',s.linkLoads,s.todayLinkLoads],
      ['Site visited',s.confirmedVisits,s.todayConfirmedVisits],
      ['Engaged',s.confirmedVisits,s.todayConfirmedVisits],
      ['Signed up',signed,signedToday],
      ['Paid',paid,paidToday]
    ];
    panel.innerHTML=`<section class="nitro-intelligence-card"><div class="nitro-intelligence-head"><div><h3>Open confidence</h3><p>Raw email image requests are classified instead of being treated as human opens.</p></div></div><div class="nitro-confidence-grid"><div class="nitro-confidence"><b>${Number(s.opened||0).toLocaleString()}</b><span>Likely human opens</span><small>Human evidence or no automation flags</small></div><div class="nitro-confidence"><b>${Number(s.filteredOpens||0).toLocaleString()}</b><span>Security scans filtered</span><small>Mail scanners, proxies, or automated bursts</small></div><div class="nitro-confidence"><b>${uncertain.toLocaleString()}</b><span>Uncertain</span><small>Recorded, but not strong enough to call human</small></div></div></section><section class="nitro-intelligence-card"><div class="nitro-intelligence-head"><div><h3>Outreach funnel</h3><p>From send to revenue. “Link loaded” stays separate because a load alone can still be automated.</p></div></div><div class="nitro-funnel">${stages.map(([label,value,todayValue])=>`<div class="nitro-funnel-step"><b>${Number(value||0).toLocaleString()}</b><span>${esc(label)}</span><small>Today ${Number(todayValue||0).toLocaleString()}</small></div>`).join('')}</div></section>`;
    let timelineSection=document.getElementById('nitro-lead-timelines');if(!timelineSection){timelineSection=document.createElement('section');timelineSection.id='nitro-lead-timelines';timelineSection.className='nitro-intelligence-card';table.insertAdjacentElement('afterend',timelineSection);}
    const cards=log.slice(0,100).map(entry=>{const acct=accounts.get(String(entry.to||'').toLowerCase()),sessions=pagesFor(entry,groups),events=buildTimeline(entry,acct,sessions,Number(durationMap[entry.id]||0)),[cls,label]=confidence(entry);return `<details class="nitro-lead-timeline"><summary><div class="nitro-lead-main"><b>${esc(entry.contactName||'Unknown business')}</b><small>${esc(entry.to||'')} · sent ${esc(fmt(entry.timestamp))}</small></div><span class="nitro-confidence-pill ${cls}">${esc(label)}</span></summary><div class="nitro-timeline-body">${events.length?events.map(renderEvent).join(''):'<div class="nitro-timeline-empty">No timeline events yet.</div>'}</div></details>`;}).join('');
    timelineSection.innerHTML=`<div class="nitro-intelligence-head"><div><h3>Lead timelines</h3><p>Each recipient gets one chronological history across email, website behavior, signup, and billing when Nitro can match the identity.</p></div><span>${Math.min(log.length,100)} shown</span></div><div class="nitro-timeline-list">${cards||'<div class="nitro-timeline-empty">No outreach leads yet.</div>'}</div>`;
  }catch{}
  }
  let timer;const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,650);};
  new MutationObserver(()=>{if(document.getElementById('outreach-stats'))schedule();}).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('click',e=>{if(e.target.closest('#outreach-refresh'))setTimeout(enhance,900);},true);
  schedule();
})();

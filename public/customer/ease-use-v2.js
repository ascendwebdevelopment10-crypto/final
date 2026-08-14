(() => {
  const GOAL_KEY='nitro-ease-goal-v1';
  const LABELS={
    'Delivered':'Accepted by the sending provider. It does not prove a person saw the message.',
    'Link loaded':'The tracked link was requested. Security scanners can do this automatically, so Nitro treats it as a weak signal until real on-site engagement is confirmed.',
    'Engaged':'A person showed meaningful activity such as focused time, scrolling, clicking, replying, or navigating beyond the first page.',
    'Reach':'Estimated unique people who saw the content, when the platform provides this metric.',
    'Connected':'The account authorization is currently valid and Nitro can use the features that provider allows.',
    'Setup required':'This connection still needs provider or developer configuration before Nitro can use it.',
    'Direct / unknown':'Nitro could not reliably identify a referring source for this visit.'
  };
  const PAGE_ACTIONS={
    dashboard:['Do this next','Create content'],websites:['Create Website','New website','Create website'],content:['Write post','Create content','Generate image'],social:['Schedule','Create post','New post','Connect Instagram'],ads:['Build campaign','Create campaign'],messages:['Compose','Send','Connect email'],assistant:['New chat','Ask'],analytics:['Refresh'],billing:['Choose Growth','Upgrade','Buy credits'],settings:['Save'],outreach:['Refresh'],owner:['Refresh data']
  };
  const EMPTY={
    websites:{title:'Launch your first website',copy:'Give visitors one clear place to understand your offer and take the next step.',href:'#websites',label:'Create website →'},
    content:{title:'Create your first campaign asset',copy:'Start with one useful post, image, or carousel instead of staring at an empty library.',href:'#content',label:'Create content →'},
    social:{title:'Put your first post on the calendar',copy:'Connect the channel you use, then schedule one post so Nitro can start working for you.',href:'#social',label:'Connect or schedule →'},
    ads:{title:'Build your first campaign',copy:'Turn your offer into a launch-ready campaign with one clear objective.',href:'#ads',label:'Build campaign →'},
    messages:{title:'Start your first conversation',copy:'Connect email or SMS, then send one tracked message.',href:'#messages',label:'Connect messaging →'},
    analytics:{title:'Create activity first',copy:'Analytics becomes useful after your first site, post, campaign, or outreach send.',href:'#dashboard',label:'See what to do next →'}
  };
  let queued=false, lastBusy=0;
  const section=()=>location.hash.replace(/^#/,'')||'dashboard';
  const txt=el=>String(el?.textContent||'').trim();
  const num=el=>{const n=Number(txt(el).replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0;};
  function stats(){
    const cards=[...document.querySelectorAll('.result-kpi-grid .stat-card')];
    const val=label=>num(cards.find(c=>txt(c.querySelector('.stat-top span'))===label)?.querySelector('.stat-value'));
    const lead=document.querySelector('.lead-result');
    const social=document.querySelector('.social-result');
    const rows=[...social?.querySelectorAll('.metric-rows>div')||[]];
    const row=l=>num(rows.find(r=>txt(r.querySelector('span'))===l)?.querySelector('b'));
    const msg=document.querySelector('.outreach-result');
    const msgRows=[...msg?.querySelectorAll('.metric-rows>div')||[]];
    const mrow=l=>num(msgRows.find(r=>txt(r.querySelector('span'))===l)?.querySelector('b'));
    return {
      sites:num(lead?.querySelector('.result-split div:first-child b')),
      campaigns:num(lead?.querySelector('.result-split div:nth-child(2) b')),
      content:val('Content created'), published:val('Posts published'), sent:val('Outreach sent'), replies:val('Leads & replies'),
      socials:row('Connected socials'), scheduled:row('Scheduled'), messaging:mrow('Connected channels')
    };
  }
  function pageLink(href,label,copy){return `<a class="ux-next-card" href="${href}"><span><b>${label}</b><small>${copy}</small></span><em>→</em></a>`;}
  function primaryActions(){
    const s=section(), toolbar=document.querySelector('.section-toolbar'); if(!toolbar)return;
    const actions=[...toolbar.querySelectorAll('a.btn,button.btn')].filter(x=>!x.disabled);
    if(actions.length<2)return;
    const wanted=PAGE_ACTIONS[s]||[];
    let primary=actions.find(a=>wanted.some(w=>txt(a).toLowerCase().includes(w.toLowerCase())))||actions.find(a=>a.classList.contains('btn-primary'))||actions[actions.length-1];
    actions.forEach(a=>{a.classList.toggle('ux-page-primary',a===primary);a.classList.toggle('ux-page-secondary',a!==primary);});
    toolbar.classList.add('ux-toolbar-ranked');
  }
  function emptyStates(){
    const s=section(), cfg=EMPTY[s]; if(!cfg)return;
    document.querySelectorAll('.empty-state,.dashboard-empty,.social-performance-loading,.instagram-performance-loading').forEach(box=>{
      if(box.dataset.uxGuided==='1')return;
      const text=txt(box).toLowerCase();
      if(!/(no |first|empty|ready when|will show|not .* yet)/i.test(text))return;
      box.dataset.uxGuided='1';
      if(!box.querySelector('h3'))box.insertAdjacentHTML('afterbegin',`<h3>${cfg.title}</h3>`);
      if(!box.querySelector('p'))box.insertAdjacentHTML('beforeend',`<p>${cfg.copy}</p>`);
      if(!box.querySelector('a.btn,button.btn'))box.insertAdjacentHTML('beforeend',`<a class="btn btn-primary ux-empty-cta" href="${cfg.href}">${cfg.label}</a>`);
    });
  }
  function terminology(){
    const nodes=document.querySelectorAll('th,small,.stat-top span,.outreach-stat-card .stat-top span,.social-account-state,.result-action span,.src-tag');
    nodes.forEach(el=>{
      if(el.dataset.uxTerm==='1')return;
      const key=Object.keys(LABELS).find(k=>txt(el).toLowerCase()===k.toLowerCase()||txt(el).toLowerCase().startsWith(k.toLowerCase()));
      if(!key)return;
      el.dataset.uxTerm='1'; el.classList.add('ux-term'); el.title=LABELS[key]; el.setAttribute('aria-label',`${txt(el)}. ${LABELS[key]}`);
      if(!el.querySelector('.ux-info'))el.insertAdjacentHTML('beforeend',' <i class="ux-info" aria-hidden="true">?</i>');
    });
  }
  function navGroups(){
    const nav=document.querySelector('.sidebar-primary-nav,.side-nav'); if(!nav||nav.dataset.uxGrouped==='1')return;
    nav.dataset.uxGrouped='1';
    const groups={dashboard:'Today',websites:'Create',content:'Create',social:'Publish',ads:'Grow',messages:'Communicate',assistant:'Work faster',analytics:'Measure',billing:'Account',settings:'Account'};
    let prior='';
    [...nav.querySelectorAll('.side-link')].forEach(link=>{
      const id=(link.getAttribute('href')||'').replace(/^#/,''); const group=groups[id]; if(!group||group===prior)return;
      const label=document.createElement('div'); label.className='ux-nav-group'; label.textContent=group; link.before(label); prior=group;
    });
  }
  function setupButton(){
    const top=document.querySelector('.app-topbar'); if(!top||document.getElementById('ux-setup-button'))return;
    const button=document.createElement('button');button.id='ux-setup-button';button.className='btn ux-setup-button';button.type='button';button.innerHTML='<span>✓</span> Setup';
    const host=top.lastElementChild||top;host.prepend(button);button.addEventListener('click',openSetup);
  }
  function openSetup(){
    document.querySelector('.ux-setup-overlay')?.remove();
    const s=stats(), goal=localStorage.getItem(GOAL_KEY)||'';
    const items=[
      ['Business profile',true,'#settings','Review your business name, brand, website, and contact details.'],
      ['Social account',s.socials>0,'#social',s.socials?'At least one channel is connected.':'Connect the channel you actually use.'],
      ['Primary goal',!!goal,'#dashboard',goal?'Nitro is prioritizing your selected objective.':'Choose what you want Nitro to help with first.'],
      ['Messaging',s.messaging>0||s.sent>0,'#messages',s.messaging||s.sent?'Messaging is ready or has already been used.':'Connect email or SMS when outreach is part of your plan.'],
      ['Plan & credits',true,'#billing','See your plan, limits, and credits in one place.']
    ];
    const done=items.filter(i=>i[1]).length;
    const wrap=document.createElement('div');wrap.className='ux-setup-overlay';wrap.innerHTML=`<aside class="ux-setup-drawer"><header><div><small>ONE SETUP CENTER</small><h2>Your Nitro setup</h2><p>${done}/5 areas ready. Everything that powers your workspace is here.</p></div><button class="ux-close" aria-label="Close setup">×</button></header><div class="ux-setup-meter"><i style="width:${done/5*100}%"></i></div><div class="ux-setup-list">${items.map((i,n)=>`<a href="${i[2]}"><span class="${i[1]?'done':''}">${i[1]?'✓':n+1}</span><div><b>${i[0]}</b><small>${i[3]}</small></div><em>→</em></a>`).join('')}</div><footer><a href="#settings">Business profile</a><a href="#social">Connections</a><a href="#billing">Plan & credits</a><a href="#messages">Outreach setup</a></footer></aside>`;document.body.appendChild(wrap);
    const close=()=>wrap.remove();wrap.querySelector('.ux-close').onclick=close;wrap.addEventListener('mousedown',e=>{if(e.target===wrap)close();});wrap.querySelectorAll('a').forEach(a=>a.addEventListener('click',close));
  }
  function proactive(){
    const home=document.querySelector('.result-dashboard');if(!home)return;
    document.querySelector('.ux-proactive')?.remove();
    const s=stats(); let item;
    if(!s.sites)item=['Your business needs a place to send traffic.','Build the website first so every post, ad, and outreach message has somewhere useful to land.','#websites','Build website'];
    else if(!s.socials)item=['No social account is connected yet.','Connect the channel you already use so Nitro can turn content into scheduled work.','#social','Connect social'];
    else if(!s.content)item=['You have nothing ready to publish yet.','Create one useful campaign asset. Nitro will help you turn it into the next step.','#content','Create first post'];
    else if(!s.scheduled&&!s.published)item=['You have content, but nothing is scheduled.','Put one post on the calendar so your workspace starts doing work without you remembering it.','#social','Schedule a post'];
    else if(!s.sent)item=['Your content side is moving. Outreach has not started yet.','Connect messaging and send one tracked campaign when direct outreach fits your goal.','#messages','Start outreach'];
    else if(s.replies)item=[`${s.replies} lead${s.replies===1?'':'s'} need attention.`,`Open the conversations while intent is fresh instead of starting another task.`,'#messages','Follow up now'];
    else item=['Your system is running.','Review what published, what got attention, and the one next action most likely to create a customer.','#analytics','Review performance'];
    const box=document.createElement('section');box.className='glass-card ux-proactive';box.innerHTML=`<div><span class="eyebrow">NITRO RECOMMENDS TODAY</span><h3>${item[0]}</h3><p>${item[1]}</p></div><a class="btn btn-primary" href="${item[2]}">${item[3]} →</a>`;
    const guide=home.querySelector('.nitro-setup-guide');(guide||home.querySelector('.dashboard-welcome'))?.after(box);
  }
  function quickStart(){
    const home=document.querySelector('.result-dashboard');if(!home||localStorage.getItem('nitro-first-five-dismissed')==='1')return;
    const s=stats(), fresh=s.sites===0&&s.content===0&&s.published===0&&s.sent===0&&s.socials===0;
    if(!fresh)return;
    if(document.querySelector('.ux-first-five'))return;
    const goal=!!localStorage.getItem(GOAL_KEY);
    const steps=[
      [s.socials>0,'Connect social','#social','Connect the account you actually use.'],
      [true,'Business info','#settings','Review your business details and brand.'],
      [goal,'Choose goal','#dashboard','Tell Nitro the result you care about most.'],
      [s.content>0||s.campaigns>0||s.sent>0,'Create first campaign','#content','Make the first post, campaign, or outreach asset.'],
      [s.published>0||s.sent>0||s.campaigns>0,'Launch','#dashboard','Publish, send, or activate the first real piece of work.']
    ];
    const first=steps.find(x=>!x[0])||steps[4];
    const card=document.createElement('section');card.className='glass-card ux-first-five';card.innerHTML=`<div class="ux-first-five-head"><div><span class="eyebrow">YOUR FIRST 5 MINUTES</span><h3>Get one real result before learning the whole app.</h3><p>Nitro will walk you through only the setup needed for your first piece of work.</p></div><button type="button" class="ux-dismiss">Hide</button></div><div class="ux-first-five-grid">${steps.map((x,i)=>`<a href="${x[2]}" class="${x[0]?'done':''}"><span>${x[0]?'✓':i+1}</span><div><b>${x[1]}</b><small>${x[3]}</small></div></a>`).join('')}</div><a class="btn btn-primary ux-first-five-next" href="${first[2]}">${first[1]} →</a>`;
    home.querySelector('.dashboard-welcome')?.after(card);card.querySelector('.ux-dismiss').onclick=()=>{localStorage.setItem('nitro-first-five-dismissed','1');card.remove();};
  }
  function feedback(){
    if(document.getElementById('ux-global-status'))return;
    const bar=document.createElement('div');bar.id='ux-global-status';bar.setAttribute('role','status');bar.setAttribute('aria-live','polite');document.body.appendChild(bar);
    document.addEventListener('click',e=>{
      const b=e.target.closest('button,a');if(!b)return;
      if(!b.matches('[data-workspace-action],[data-connect],[data-social-disconnect],[data-campaign-status],[data-ig-post],[data-ig-reel],[data-buy-video-credits],#instagram-performance-refresh,#social-performance-refresh,#outreach-refresh,#owner-refresh,button[type="submit"]'))return;
      if(b.disabled)return;
      lastBusy=Date.now();bar.textContent=`Starting ${txt(b).replace(/→|\+|↑/g,'').trim().toLowerCase()||'action'}…`;bar.className='show';
      setTimeout(()=>{if(Date.now()-lastBusy>=2200)bar.className='';},2400);
    },true);
    new MutationObserver(()=>{
      const toast=[...document.querySelectorAll('.toast')].at(-1);if(!toast)return;
      bar.textContent=txt(toast);bar.className='show '+(toast.classList.contains('error')?'error':'success');lastBusy=Date.now();setTimeout(()=>{if(Date.now()-lastBusy>=2600)bar.className='';},2800);
    }).observe(document.body,{childList:true,subtree:true});
  }
  function pageHelp(){
    const s=section(), toolbar=document.querySelector('.section-toolbar');if(!toolbar||toolbar.querySelector('.ux-page-purpose'))return;
    const map={websites:'Build and manage the pages customers land on.',content:'Create the assets you will actually publish.',social:'Connect channels, schedule posts, and compare results.',ads:'Turn one offer into a launch-ready campaign.',messages:'Send, track, and follow up on conversations.',analytics:'See what is getting attention and creating action.',billing:'Manage plan limits and credits.',settings:'Manage the business details Nitro uses everywhere.'};
    if(!map[s])return;const p=document.createElement('div');p.className='ux-page-purpose';p.textContent=map[s];toolbar.appendChild(p);
  }
  function mobileA11y(){
    document.querySelectorAll('button,a.btn,.side-link').forEach(el=>{if(!el.getAttribute('aria-label')&&txt(el))el.setAttribute('aria-label',txt(el).replace(/\s+/g,' '));});
    document.querySelectorAll('.tbl-wrap,.owner-table-wrap').forEach(el=>{el.setAttribute('tabindex','0');el.setAttribute('aria-label','Scrollable data table');});
  }
  function run(){queued=false;if(!location.pathname.startsWith('/app'))return;primaryActions();emptyStates();terminology();navGroups();setupButton();quickStart();proactive();pageHelp();mobileA11y();feedback();}
  function queue(){if(queued)return;queued=true;requestAnimationFrame(run);}
  new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('hashchange',queue);window.addEventListener('popstate',queue);document.addEventListener('DOMContentLoaded',queue);queue();
})();
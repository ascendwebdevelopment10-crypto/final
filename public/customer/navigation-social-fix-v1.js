(()=>{
  let queued=false,lastSocialFetch=0,lastSocialCount=null;
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  const lower=el=>text(el).toLowerCase();

  function navRoot(){return document.querySelector('.sidebar-primary-nav,.side-nav');}
  function navIcon(){
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4L3 11l6 2.4L11 20l3.2-4.6L21 4Z"/><path d="M9 13.4L21 4"/></svg>`;
  }
  function makeOutreachLink(messages){
    const a=messages.cloneNode(true);
    a.href='#messages';
    a.dataset.communicateOutreach='1';
    a.classList.remove('active');
    const label=[...a.querySelectorAll('span,b')].find(el=>/messaging/i.test(text(el)))||a.querySelector('span:last-child');
    if(label)label.textContent='Outreach';
    const iconHost=a.querySelector('.side-icon,.nav-icon,i');
    if(iconHost)iconHost.innerHTML=navIcon();
    a.setAttribute('aria-label','Outreach');
    a.title='Outreach';
    return a;
  }
  function rebuildSidebarGroups(){
    const root=navRoot();if(!root)return;
    root.querySelectorAll('.ux-nav-group').forEach(el=>el.remove());
    root.querySelectorAll('a.side-link[href="#ads"]').forEach(el=>el.remove());
    const messages=root.querySelector('a.side-link[href="#messages"]');
    let outreach=root.querySelector('a.side-link[href="#outreach"],a.side-link[data-communicate-outreach="1"]');
    if(messages&&!outreach){outreach=makeOutreachLink(messages);messages.before(outreach);}
    else if(messages&&outreach&&outreach.nextElementSibling!==messages)messages.before(outreach);
    const groups={dashboard:'Today',websites:'Create',content:'Create',social:'Publish',outreach:'Communicate',messages:'Communicate',assistant:'Work faster',analytics:'Measure',billing:'Account',settings:'Account'};
    let previous='';
    [...root.querySelectorAll('a.side-link')].forEach(link=>{
      let id=(link.getAttribute('href')||'').replace(/^#/,'');
      if(link.dataset.communicateOutreach==='1')id='outreach';
      const group=groups[id];if(!group||group===previous)return;
      const label=document.createElement('div');label.className='ux-nav-group';label.textContent=group;link.before(label);previous=group;
    });
    root.dataset.uxGrouped='1';
  }

  function fixQuickMenu(){
    const panel=document.querySelector('.desktop-quick-panel');if(!panel)return;
    panel.querySelectorAll('a[href="#ads"]').forEach(el=>el.remove());
    const messages=panel.querySelector('a[href="#messages"]');
    let outreach=panel.querySelector('a[href="#outreach"],[data-communicate-outreach="1"]');
    if(messages&&!outreach){outreach=makeOutreachLink(messages);messages.before(outreach);}
    else if(messages&&outreach&&outreach.nextElementSibling!==messages)messages.before(outreach);
  }

  function applyScheduledCount(count){
    const stats=document.querySelector('.social-v4-stats,.social-exact-stats');if(!stats)return;
    const scheduled=[...stats.querySelectorAll('.social-exact-stat')].find(card=>lower(card.querySelector('small'))==='scheduled');if(!scheduled)return;
    const value=scheduled.querySelector('strong'),note=scheduled.querySelector('em');
    if(value)value.textContent=String(count);
    if(note)note.textContent=count===1?'Your scheduled post':'Your scheduled posts';
  }
  async function fixScheduledCount(){
    if(location.hash!=='#social')return;
    const now=Date.now();
    if(lastSocialCount!==null&&now-lastSocialFetch<5000){applyScheduledCount(lastSocialCount);return;}
    try{
      const res=await fetch('/api/customer-data',{credentials:'same-origin',cache:'no-store'});const data=await res.json();if(!res.ok)throw new Error('customer data');
      const drafts=data.user?.workspace?.socialDrafts||[];
      const count=drafts.filter(item=>{
        const status=String(item.status||'').toLowerCase();
        if(['published','canceled','cancelled','failed'].includes(status))return false;
        if(status==='scheduled')return true;
        return !!item.scheduledFor&&status!=='draft';
      }).length;
      lastSocialFetch=now;lastSocialCount=count;applyScheduledCount(count);
    }catch{
      const cards=[...document.querySelectorAll('.social-calendar .calendar-post')].filter(card=>!card.closest('[data-system-campaign="true"]'));
      applyScheduledCount(cards.length);
    }
  }

  function bindOutreachAlias(){
    document.querySelectorAll('[data-communicate-outreach="1"]').forEach(link=>{
      if(link.dataset.boundAlias==='1')return;link.dataset.boundAlias='1';
      link.addEventListener('click',()=>{sessionStorage.setItem('nitro-communicate-mode','outreach');});
    });
    document.querySelectorAll('a.side-link[href="#messages"]:not([data-communicate-outreach])').forEach(link=>{
      if(link.dataset.boundMessageAlias==='1')return;link.dataset.boundMessageAlias='1';
      link.addEventListener('click',()=>{sessionStorage.setItem('nitro-communicate-mode','messages');});
    });
  }

  function run(){queued=false;if(!location.pathname.startsWith('/app'))return;rebuildSidebarGroups();fixQuickMenu();bindOutreachAlias();fixScheduledCount();}
  function queue(){if(queued)return;queued=true;requestAnimationFrame(run);}
  new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',queue);addEventListener('load',queue);queue();
})();
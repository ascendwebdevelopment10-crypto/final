(()=>{
  const SYSTEM_POST_SNIPPETS=[
    'five tabs do not make a marketing system',
    'quick question: does your website create the next conversation',
    'the content chain:',
    'your future self does not want to remember',
    'opened is curiosity. clicked is intent.',
    '$0 to start. no card. no forced demo.'
  ];
  let queued=false;
  const text=el=>String(el?.textContent||'').toLowerCase().replace(/\s+/g,' ').trim();
  const isSystemPost=el=>SYSTEM_POST_SNIPPETS.some(snippet=>text(el).includes(snippet));

  function fixScheduledCount(){
    if(location.hash!=='#social')return;
    const stats=document.querySelector('.social-v4-stats');
    if(!stats)return;
    const scheduled=[...stats.querySelectorAll('.social-exact-stat')].find(card=>text(card.querySelector('small'))==='scheduled');
    if(!scheduled)return;
    const calendarCards=[...document.querySelectorAll('.social-calendar .calendar-post')];
    const accountPosts=calendarCards.filter(card=>!isSystemPost(card));
    const value=scheduled.querySelector('strong');
    const note=scheduled.querySelector('em');
    if(value)value.textContent=String(accountPosts.length);
    if(note)note.textContent=accountPosts.length===1?'Your scheduled post':'Your scheduled posts';
  }

  function rebuildSidebarGroups(){
    const root=document.querySelector('.sidebar-primary-nav');
    if(!root)return;
    root.querySelectorAll('.ux-nav-group').forEach(el=>el.remove());
    root.querySelectorAll('a.side-link[href="#ads"]').forEach(el=>el.remove());

    const messages=root.querySelector('a.side-link[href="#messages"]');
    const outreach=root.querySelector('a.side-link[href="#outreach"]');
    if(messages&&outreach&&messages.parentElement){messages.parentElement.insertBefore(outreach,messages);}

    const ordered=[...root.querySelectorAll('a.side-link')];
    const groups={dashboard:'Today',websites:'Create',content:'Create',social:'Publish',outreach:'Communicate',messages:'Communicate',assistant:'Work faster',analytics:'Measure',billing:'Account',settings:'Account'};
    let previous='';
    ordered.forEach(link=>{
      const id=(link.getAttribute('href')||'').replace(/^#/,'');
      const group=groups[id];
      if(!group||group===previous)return;
      const label=document.createElement('div');label.className='ux-nav-group';label.textContent=group;link.before(label);previous=group;
    });
    root.dataset.uxGrouped='1';
  }

  function fixQuickMenu(){
    const panel=document.querySelector('.desktop-quick-panel');
    if(!panel)return;
    panel.querySelectorAll('a.side-link[href="#ads"]').forEach(el=>el.remove());
    const messages=panel.querySelector('a.side-link[href="#messages"]');
    const outreach=panel.querySelector('a.side-link[href="#outreach"]');
    if(messages&&outreach)panel.insertBefore(outreach,messages);
    const labels=[...panel.querySelectorAll('.quick-menu-label')];
    labels.forEach(label=>{if(/owner/i.test(label.textContent||''))label.textContent='Communicate';});
  }

  function run(){
    queued=false;
    if(!location.pathname.startsWith('/app'))return;
    rebuildSidebarGroups();
    fixQuickMenu();
    fixScheduledCount();
  }
  function queue(){if(queued)return;queued=true;requestAnimationFrame(run);}
  new MutationObserver(queue).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',queue);
  addEventListener('load',queue);
  queue();
})();
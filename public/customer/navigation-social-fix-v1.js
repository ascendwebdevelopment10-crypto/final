(()=>{
  let lastSocialFetch=0,lastSocialCount=null;
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();
  const lower=el=>text(el).toLowerCase();

  function navRoot(){return document.querySelector('.sidebar-primary-nav,.side-nav');}
  function addGroupLabelsOnce(root){
    root.querySelectorAll('.ux-nav-group[data-nitro-added="1"]').forEach(el=>el.remove());
    const groups={dashboard:'Today',websites:'Create',content:'Create',social:'Publish',outreach:'Communicate',messages:'Communicate',assistant:'Work faster',analytics:'Measure',billing:'Account',settings:'Account'};
    let previous='';
    [...root.querySelectorAll('a.side-link')].forEach(link=>{
      const id=(link.getAttribute('href')||'').replace(/^#/,'');
      const group=groups[id];
      if(!group||group===previous)return;
      const label=document.createElement('div');
      label.className='ux-nav-group';label.dataset.nitroAdded='1';label.textContent=group;
      link.before(label);previous=group;
    });
  }

  function fixNavigation(){
    if(!location.pathname.startsWith('/app'))return;
    const root=navRoot();
    if(root){
      root.querySelectorAll('a.side-link[href="#ads"]').forEach(el=>el.remove());
      const messages=[...root.querySelectorAll('a.side-link[href="#messages"]')];
      if(messages.length>1)messages.slice(1).forEach(el=>el.remove());
      const outreach=root.querySelector('a.side-link[href="#outreach"]');
      const message=root.querySelector('a.side-link[href="#messages"]');
      if(outreach&&message&&outreach.nextElementSibling!==message)message.before(outreach);
      addGroupLabelsOnce(root);
    }
    const panel=document.querySelector('.desktop-quick-panel');
    if(panel){
      panel.querySelectorAll('a[href="#ads"]').forEach(el=>el.remove());
      const msgs=[...panel.querySelectorAll('a[href="#messages"]')];if(msgs.length>1)msgs.slice(1).forEach(el=>el.remove());
    }
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
    }catch{}
  }

  function run(){fixNavigation();fixScheduledCount();}
  addEventListener('load',()=>setTimeout(run,50));
  addEventListener('hashchange',()=>setTimeout(run,50));
  setTimeout(run,100);
})();
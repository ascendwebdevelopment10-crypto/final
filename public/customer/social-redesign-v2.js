const socialRedesign = (()=>{
  let scheduledOnce=false;
  function textNum(el){const m=String(el?.textContent||'').match(/\d+/);return m?Number(m[0]):0;}
  function enhance(){
    if(location.hash!=='#social' && !location.pathname.includes('/app')) return;
    const page=document.querySelector('.socials-workspace');
    if(!page)return;
    const toolbar=page.querySelector('.socials-toolbar');
    const calendar=page.querySelector('.social-calendar');
    if(!toolbar||!calendar)return;
    let stats=page.querySelector('.social-v2-stats');
    if(!stats){
      const jobs=textNum(calendar.querySelector('.panel-head>span'));
      const queue=page.querySelectorAll('.social-queue-card');
      const published=[...queue].filter(x=>/published/i.test(x.textContent)).length;
      const connected=page.querySelectorAll('.social-account-card.is-connected').length;
      const failed=[...queue].filter(x=>/failed/i.test(x.textContent)).length;
      stats=document.createElement('section');
      stats.className='social-v2-stats';
      stats.innerHTML=`
        <article class="social-v2-stat"><span class="social-v2-stat-icon">▣</span><div><small>Scheduled</small><strong>${jobs}</strong><span>platform jobs in queue</span></div></article>
        <article class="social-v2-stat"><span class="social-v2-stat-icon">↗</span><div><small>Published</small><strong>${published}</strong><span>visible published posts</span></div></article>
        <article class="social-v2-stat"><span class="social-v2-stat-icon">◎</span><div><small>Connected</small><strong>${connected}/5</strong><span>authorized social channels</span></div></article>
        <article class="social-v2-stat"><span class="social-v2-stat-icon">✓</span><div><small>Queue health</small><strong>${failed?`${failed} failed`:'Good'}</strong><span>${failed?'needs attention':'no visible failures'}</span></div></article>
        <article class="social-v2-stat"><span class="social-v2-stat-icon">⌁</span><div><small>Analytics</small><strong>Live</strong><span>platform results below</span></div></article>`;
      toolbar.insertAdjacentElement('afterend',stats);
    }
    const primary=toolbar.querySelector('[data-workspace-action="social"]');
    if(primary&&!primary.dataset.socialV2){primary.dataset.socialV2='1';primary.textContent='+ Create Post';}
  }
  function schedule(){if(scheduledOnce)return;scheduledOnce=true;requestAnimationFrame(()=>{scheduledOnce=false;enhance();});}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('hashchange',schedule);
  window.addEventListener('load',schedule);
  schedule();
  return {enhance};
})();

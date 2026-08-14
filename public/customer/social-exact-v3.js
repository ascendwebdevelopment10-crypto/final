(()=>{
  const brands=['instagram','facebook','tiktok','linkedin','youtube'];
  let queued=false;
  function n(txt){const m=String(txt||'').match(/\d+/);return m?Number(m[0]):0}
  function enhance(){
    if(location.hash!=='#social')return;
    const page=document.querySelector('.socials-workspace');
    if(!page)return;
    const toolbar=page.querySelector('.socials-toolbar');
    const cal=page.querySelector('.social-calendar');
    const queue=page.querySelector('.social-queue-primary');
    if(!toolbar||!cal||!queue)return;
    let stats=page.querySelector('.social-exact-stats');
    if(!stats){
      const jobs=n(cal.querySelector('.panel-head>span')?.textContent);
      const cards=[...page.querySelectorAll('.social-queue-card')];
      const published=cards.filter(x=>/published/i.test(x.textContent)).length;
      const connected=page.querySelectorAll('.social-account-card.is-connected').length;
      stats=document.createElement('section');
      stats.className='social-exact-stats';
      stats.innerHTML=`
        <article class="social-exact-stat"><span class="social-exact-stat-icon">▣</span><div><small>Scheduled</small><strong>${jobs||cards.length}</strong><em>Posts this week</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon">➤</span><div><small>Published</small><strong>${published}</strong><em>Posts this month</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon">◉</span><div><small>Total Reach</small><strong>—</strong><em>Platform analytics</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon">♡</span><div><small>Engagement</small><strong>—</strong><em>Platform analytics</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon">⌁</span><div><small>Connected</small><strong>${connected}/5</strong><em class="good">Social channels</em></div></article>`;
      toolbar.insertAdjacentElement('afterend',stats);
    }
    const create=toolbar.querySelector('[data-workspace-action="social"],.btn-primary,.btn');
    if(create&&!create.dataset.v3){create.dataset.v3='1';create.textContent='+  Create Post'}
    page.querySelectorAll('.social-account-card').forEach((card,i)=>{
      const mark=card.querySelector('.social-platform-mark');
      if(mark)mark.dataset.brand=brands[i]||'';
    });
    page.querySelectorAll('.calendar-post').forEach(post=>{
      const title=post.querySelector('.calendar-platform')?.getAttribute('title')||'';
      post.dataset.platform=title.split(' ')[0].toLowerCase();
      const map={instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',linkedin:'LinkedIn',youtube:'YouTube'};
      const label=map[post.dataset.platform];
      if(label)post.setAttribute('aria-label',`${label} scheduled post`);
    });
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);addEventListener('load',schedule);schedule();
})();

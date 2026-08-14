(()=>{
  const brands=['instagram','facebook','tiktok','linkedin','youtube'];
  const brandNames={instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',linkedin:'LinkedIn',youtube:'YouTube'};
  let queued=false;
  function n(txt){const m=String(txt||'').match(/\d+/);return m?Number(m[0]):0}
  function brandFromText(txt){const s=String(txt||'').toLowerCase();return brands.find(b=>s.includes(b))||''}
  function addBrand(el,brand){if(el&&brand)el.dataset.brand=brand}
  function ensureSevenDays(cal){
    const wrap=cal.querySelector('.social-calendar-days');
    if(!wrap)return;
    const days=[...wrap.children].filter(x=>x.tagName==='ARTICLE');
    if(!days.length)return;
    const last=days[days.length-1];
    const header=last.querySelector('header');
    const b=header?.querySelector('b')?.textContent?.trim()||'';
    const parsed=new Date(`${b}, 2026 12:00:00`);
    let cursor=Number.isNaN(parsed.getTime())?new Date():parsed;
    while(wrap.querySelectorAll(':scope > article').length<7){
      cursor=new Date(cursor.getTime()+86400000);
      const article=document.createElement('article');
      article.className='is-empty-day';
      article.innerHTML=`<header><small>${cursor.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</small><b>${cursor.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</b></header><div><div class="empty-day-cta"><b>+</b><strong>Add Post</strong><span>Plan something amazing.</span></div></div>`;
      wrap.appendChild(article);
    }
  }
  function brandEverything(page){
    page.querySelectorAll('.social-account-card').forEach((card,i)=>{
      const brand=brandFromText(card.textContent)||brands[i]||'';
      addBrand(card,brand);addBrand(card.querySelector('.social-platform-mark'),brand);
    });
    page.querySelectorAll('.calendar-platform').forEach(el=>{
      const brand=brandFromText(el.getAttribute('title')||el.textContent);addBrand(el,brand);
    });
    page.querySelectorAll('.calendar-post').forEach(post=>{
      const brand=brandFromText(post.querySelector('.calendar-platform')?.getAttribute('title')||post.textContent);
      addBrand(post,brand);
      if(brand)post.setAttribute('aria-label',`${brandNames[brand]} scheduled post`);
    });
    page.querySelectorAll('.social-queue-card').forEach(card=>{
      const brand=brandFromText(card.textContent);
      addBrand(card,brand);addBrand(card.querySelector('.social-queue-meta'),brand);
    });
    page.querySelectorAll('.social-result-platform').forEach(el=>addBrand(el,brandFromText(el.parentElement?.textContent||el.textContent)));
    page.querySelectorAll('.social-performance article,.social-performance .card,.social-performance [class*="result"]').forEach(el=>{
      const brand=brandFromText(el.textContent); if(brand){addBrand(el,brand);const mark=el.querySelector('.social-result-platform,[class*="platform"]');if(mark)addBrand(mark,brand)}
    });
    page.querySelectorAll('[class*="platform"]').forEach(el=>{if(!el.dataset.brand){const brand=brandFromText(el.getAttribute('title')||el.textContent||el.parentElement?.textContent);if(brand)addBrand(el,brand)}});
  }
  function enhance(){
    if(location.hash!=='#social')return;
    const page=document.querySelector('.socials-workspace');
    if(!page)return;
    const toolbar=page.querySelector('.socials-toolbar');
    const cal=page.querySelector('.social-calendar');
    const queue=page.querySelector('.social-queue-primary');
    if(!toolbar||!cal||!queue)return;
    page.querySelectorAll('.social-v2-stats').forEach(x=>x.remove());
    let stats=page.querySelector('.social-exact-stats');
    if(!stats){
      const jobs=n(cal.querySelector('.panel-head>span')?.textContent);
      const cards=[...page.querySelectorAll('.social-queue-card')];
      const published=cards.filter(x=>/published/i.test(x.textContent)).length;
      const connected=page.querySelectorAll('.social-account-card.is-connected').length;
      stats=document.createElement('section');
      stats.className='social-exact-stats';
      stats.innerHTML=`
        <article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Scheduled</small><strong>${jobs||cards.length}</strong><em>Posts this week</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Published</small><strong>${published}</strong><em>Posts this month</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Total Reach</small><strong>—</strong><em>Platform analytics</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Engagement</small><strong>—</strong><em>Platform analytics</em></div></article>
        <article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Connected</small><strong>${connected}/5</strong><em class="good">Social channels</em></div></article>`;
      toolbar.insertAdjacentElement('afterend',stats);
    }
    const create=toolbar.querySelector('[data-workspace-action="social"],.btn-primary,.btn');
    if(create&&!create.dataset.v3){create.dataset.v3='1';create.textContent='+  Create Post'}
    ensureSevenDays(cal);
    brandEverything(page);
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);addEventListener('load',schedule);schedule();
})();

(()=>{
  const brands=['instagram','facebook','tiktok','linkedin','youtube'];
  const names={instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',linkedin:'LinkedIn',youtube:'YouTube'};
  let queued=false,activePlatform='instagram';
  const brandFromText=value=>{const s=String(value||'').toLowerCase();return brands.find(b=>s.includes(b))||''};
  const num=value=>{const m=String(value||'').match(/\d+/);return m?Number(m[0]):0};
  function setBrand(el,brand){if(el&&brand)el.dataset.brand=brand}
  function clearBrands(page){page.querySelectorAll('[data-brand]').forEach(el=>el.removeAttribute('data-brand'));}
  function brandDedicatedHosts(page){
    page.querySelectorAll('.social-account-card').forEach((card,i)=>setBrand(card.querySelector('.social-platform-mark'),brandFromText(card.textContent)||brands[i]));
    page.querySelectorAll('.calendar-platform').forEach(el=>setBrand(el,brandFromText(el.getAttribute('title')||el.textContent)));
    page.querySelectorAll('.social-queue-card').forEach(card=>setBrand(card.querySelector('.social-queue-meta'),brandFromText(card.textContent)));
  }
  function addDays(calendar){
    const wrap=calendar.querySelector('.social-calendar-days');if(!wrap)return;
    let articles=[...wrap.children].filter(el=>el.tagName==='ARTICLE');if(!articles.length)return;
    while(articles.length>7){articles.pop()?.remove();}
    const last=articles[articles.length-1],label=last.querySelector('header b')?.textContent?.trim()||'';
    const year=new Date().getFullYear();let cursor=new Date(`${label}, ${year} 12:00:00`);
    if(Number.isNaN(cursor.getTime()))cursor=new Date();
    while(articles.length<7){
      cursor=new Date(cursor.getFullYear(),cursor.getMonth(),cursor.getDate()+1,12);
      const article=document.createElement('article');article.className='is-empty-day';
      article.innerHTML=`<header><small>${cursor.toLocaleDateString('en-US',{weekday:'short'}).toUpperCase()}</small><b>${cursor.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</b></header><div class="empty-day-body"><button type="button" class="empty-day-cta" data-open-social-compose><b>+</b><strong>Add Post</strong><span>Nothing scheduled</span></button></div>`;
      wrap.appendChild(article);articles.push(article);
    }
    articles.forEach((article,index)=>article.dataset.dayIndex=String(index));
    wrap.style.gridTemplateColumns='repeat(7,minmax(0,1fr))';
  }
  function createStats(page,toolbar,calendar,queue){
    page.querySelectorAll('.social-v2-stats,.social-exact-stats').forEach(x=>x.remove());
    const jobs=num(calendar.querySelector('.panel-head>span')?.textContent),cards=[...queue.querySelectorAll('.social-queue-card')];
    const published=cards.filter(x=>/published/i.test(x.textContent)).length,connected=page.querySelectorAll('.social-account-card.is-connected').length;
    const section=document.createElement('section');section.className='social-exact-stats social-v4-stats';
    section.innerHTML=`<article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Scheduled</small><strong>${jobs||cards.length}</strong><em>Posts this week</em></div></article><article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Published</small><strong>${published}</strong><em>Posts this month</em></div></article><article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Total Reach</small><strong>—</strong><em>Platform analytics</em></div></article><article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Engagement</small><strong>—</strong><em>Platform analytics</em></div></article><article class="social-exact-stat"><span class="social-exact-stat-icon"></span><div><small>Connected</small><strong>${connected}/5</strong><em class="good">Social channels</em></div></article>`;
    toolbar.insertAdjacentElement('afterend',section);
  }
  function browserMarkup(){
    return `<section class="social-platform-browser glass-card" id="social-platform-browser"><div class="platform-browser-head"><div><span class="eyebrow">PLATFORM POSTS</span><h3>Browse posts by platform</h3><p>Choose a channel to see only that platform's published content and results.</p></div><button class="btn btn-sm" type="button" data-platform-refresh>Refresh</button></div><div class="platform-browser-tabs">${brands.map(b=>`<button type="button" data-platform-tab="${b}" class="${b===activePlatform?'active':''}"><span data-brand="${b}"></span>${names[b]}</button>`).join('')}</div><div class="platform-browser-summary" id="platform-browser-summary"></div><div class="platform-browser-posts" id="platform-browser-posts"><div class="platform-browser-loading">Loading ${names[activePlatform]} posts…</div></div></section>`;
  }
  function metric(label,value){const clean=value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString():'—';return `<span><small>${label}</small><b>${clean}</b></span>`}
  function postRow(group,platform){
    const variants=group.platforms||[],variant=variants.find(v=>String(v.platform).toLowerCase()===platform)||variants[0]||{};
    const title=group.title||String(group.text||'Untitled post').split('\n')[0].slice(0,100),date=variant.publishedAt||group.publishedAt||group.scheduledFor;
    return `<article class="platform-post-row"><span class="platform-post-logo" data-brand="${platform}"></span><div class="platform-post-copy"><b>${String(title).replace(/[&<>]/g,'')}</b><p>${String(group.text||'').replace(/[&<>]/g,'').slice(0,150)}</p><small>${date?new Date(date).toLocaleString():'Published content'}</small></div><div class="platform-post-metrics">${metric('Views',variant.views)}${metric('Reach',variant.reach)}${metric('Likes',variant.likes)}${metric('Comments',variant.comments)}${metric('Shares',variant.shares)}</div>${variant.permalink?`<a class="platform-post-open" href="${variant.permalink}" target="_blank" rel="noopener">Open ↗</a>`:''}</article>`;
  }
  async function loadPlatform(platform,force=false){
    activePlatform=platform;
    document.querySelectorAll('[data-platform-tab]').forEach(b=>b.classList.toggle('active',b.dataset.platformTab===platform));
    const posts=document.getElementById('platform-browser-posts'),summary=document.getElementById('platform-browser-summary');if(!posts)return;
    posts.innerHTML=`<div class="platform-browser-loading">Loading ${names[platform]} posts…</div>`;
    try{
      const res=await fetch(`/api/social-analytics?platform=${encodeURIComponent(platform)}${force?'&refresh=1':''}`);const data=await res.json();if(!res.ok)throw new Error(data.error||'Could not load platform posts');
      const t=data.totals||{};
      if(summary)summary.innerHTML=`${metric('Published',t.published)}${metric('Views',t.views)}${metric('Reach',t.reach)}${metric('Engagement',t.engagement)}${metric('Clicks',t.clicks)}${metric('Conversions',Number(t.leads||0)+Number(t.signups||0))}`;
      posts.innerHTML=(data.posts||[]).length?data.posts.map(g=>postRow(g,platform)).join(''):`<div class="platform-browser-empty"><span data-brand="${platform}"></span><b>No ${names[platform]} posts yet</b><p>Published posts will appear here.</p></div>`;
    }catch(err){posts.innerHTML=`<div class="platform-browser-empty"><b>${err.message}</b><p>Try refreshing this platform.</p></div>`;}
  }
  function buildBrowser(page){
    page.querySelector('.social-performance')?.classList.add('social-performance-hidden-v4');
    page.querySelector('.instagram-performance')?.classList.add('social-performance-hidden-v4');
    let browser=page.querySelector('#social-platform-browser');
    if(!browser){
      const accounts=page.querySelector('.social-account-grid');if(!accounts)return;
      accounts.insertAdjacentHTML('afterend',browserMarkup());browser=page.querySelector('#social-platform-browser');
      browser.querySelectorAll('[data-platform-tab]').forEach(btn=>btn.addEventListener('click',()=>loadPlatform(btn.dataset.platformTab,false)));
      browser.querySelector('[data-platform-refresh]')?.addEventListener('click',()=>loadPlatform(activePlatform,true));
      loadPlatform(activePlatform,false);
    }
  }
  function bindEmptyCompose(page){page.querySelectorAll('[data-open-social-compose]').forEach(btn=>{if(btn.dataset.bound)return;btn.dataset.bound='1';btn.addEventListener('click',()=>page.querySelector('[data-workspace-action="social"]')?.click());});}
  function enhance(){
    if(location.hash!=='#social')return;
    const page=document.querySelector('.socials-workspace');if(!page)return;
    const toolbar=page.querySelector('.socials-toolbar'),calendar=page.querySelector('.social-calendar'),queue=page.querySelector('.social-queue-primary');if(!toolbar||!calendar||!queue)return;
    clearBrands(page);brandDedicatedHosts(page);addDays(calendar);createStats(page,toolbar,calendar,queue);buildBrowser(page);bindEmptyCompose(page);
    const create=toolbar.querySelector('[data-workspace-action="social"]');if(create)create.textContent='+ Create Post';
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);addEventListener('load',schedule);schedule();
})();
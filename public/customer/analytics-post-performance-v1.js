(()=>{
  const PLATFORMS=['all','instagram','facebook','tiktok','linkedin','youtube'];
  const NAMES={all:'All posts',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok',linkedin:'LinkedIn',youtube:'YouTube'};
  let active='all', loading=false, queued=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const known=v=>Number.isFinite(Number(v));
  const fmt=v=>known(v)?Number(v).toLocaleString():'—';
  const date=v=>{const d=new Date(v||0);return Number.isNaN(d.getTime())?'':d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
  const engagement=p=>['likes','comments','shares','saves'].reduce((n,k)=>n+(known(p[k])?Number(p[k]):0),0);
  function host(){
    const toolbar=document.querySelector('.section-toolbar');
    if(toolbar && /analytics/i.test(location.hash)) return toolbar.parentElement;
    return document.querySelector('.analytics-workspace,.result-analytics,[data-page="analytics"],main,.app-main,#app-root');
  }
  function shell(){
    let root=document.getElementById('analytics-post-performance');
    if(root)return root;
    const h=host(); if(!h)return null;
    root=document.createElement('section');root.id='analytics-post-performance';root.className='analytics-post-performance glass-card';
    root.innerHTML=`<header class="app-post-head"><div><span class="eyebrow">SOCIAL PERFORMANCE</span><h2>Post performance</h2><p>Every published post and the stats each connected platform currently provides.</p></div><button type="button" class="btn app-post-refresh">Refresh stats</button></header><div class="app-post-filters">${PLATFORMS.map(p=>`<button type="button" data-app-platform="${p}" class="${p==='all'?'active':''}">${NAMES[p]}</button>`).join('')}</div><div class="app-post-summary"></div><div class="app-post-list"><div class="app-post-loading">Loading post analytics…</div></div>`;
    h.appendChild(root);
    root.addEventListener('click',e=>{
      const f=e.target.closest('[data-app-platform]');
      if(f){active=f.dataset.appPlatform;root.querySelectorAll('[data-app-platform]').forEach(x=>x.classList.toggle('active',x===f));load(true);return;}
      if(e.target.closest('.app-post-refresh'))load(true);
    });
    return root;
  }
  function metrics(v){
    const items=[['Views',v.views],['Reach',v.reach],['Likes',v.likes],['Comments',v.comments],['Shares',v.shares],['Saves',v.saves],['Clicks',v.clicks],['Leads',v.leads],['Signups',v.signups],['Engagement',engagement(v)]];
    return `<div class="app-post-metrics">${items.map(([k,val])=>`<div><small>${k}</small><strong>${fmt(val)}</strong></div>`).join('')}</div>`;
  }
  function platformRow(v){
    const note=String(v.analyticsNote||'').trim();
    return `<section class="app-post-platform" data-platform="${esc(v.platform)}"><div class="app-post-platform-head"><div><span class="app-platform-badge ${esc(v.platform)}">${esc(NAMES[v.platform]||v.platform)}</span><span class="app-status ${esc(v.status)}">${esc(v.status||'published')}</span></div>${v.permalink?`<a href="${esc(v.permalink)}" target="_blank" rel="noopener">View post ↗</a>`:''}</div>${metrics(v)}${note?`<p class="app-post-note">${esc(note)}</p>`:''}</section>`;
  }
  function card(post){
    const img=post.thumbnailUrl||post.mediaUrl||'';
    const variants=(post.platforms||[]).filter(v=>active==='all'||v.platform===active);
    if(!variants.length)return '';
    return `<article class="app-post-card"><div class="app-post-identity">${img?`<img src="${esc(img)}" alt="" loading="lazy">`:`<div class="app-post-placeholder">POST</div>`}<div><h3>${esc(post.title||'Social post')}</h3><p>${esc((post.text||'').slice(0,220))}${(post.text||'').length>220?'…':''}</p><small>${esc(date(post.publishedAt||post.scheduledFor))}</small></div></div><div class="app-post-platforms">${variants.map(platformRow).join('')}</div></article>`;
  }
  function render(data){
    const root=shell();if(!root)return;
    const variants=(data.posts||[]).flatMap(p=>p.platforms||[]).filter(v=>active==='all'||v.platform===active);
    const total=(key)=>{const vals=variants.map(v=>v[key]).filter(known).map(Number);return vals.length?vals.reduce((a,b)=>a+b,0):null;};
    const eng=variants.reduce((n,v)=>n+engagement(v),0);
    root.querySelector('.app-post-summary').innerHTML=`<div><small>Published</small><strong>${variants.filter(v=>v.status==='published').length.toLocaleString()}</strong></div><div><small>Views</small><strong>${fmt(total('views'))}</strong></div><div><small>Reach</small><strong>${fmt(total('reach'))}</strong></div><div><small>Engagement</small><strong>${variants.length?eng.toLocaleString():'—'}</strong></div><div><small>Clicks</small><strong>${fmt(total('clicks'))}</strong></div><div><small>Signups</small><strong>${fmt(total('signups'))}</strong></div>`;
    const html=(data.posts||[]).map(card).filter(Boolean).join('');
    root.querySelector('.app-post-list').innerHTML=html||`<div class="app-post-empty"><b>No published posts found for ${esc(NAMES[active])}.</b><span>Publish a post or reconnect the platform, then refresh analytics.</span></div>`;
    const btn=root.querySelector('.app-post-refresh');if(btn)btn.textContent=`Refresh stats${data.syncedAt?` · ${new Date(data.syncedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}`:''}`;
  }
  async function load(refresh=false){
    if(loading)return;const root=shell();if(!root)return;loading=true;root.classList.add('is-loading');
    try{
      const q=new URLSearchParams({platform:active});if(refresh)q.set('refresh','1');
      const r=await fetch(`/api/social-analytics?${q}`,{credentials:'same-origin',cache:'no-store'});const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||`Analytics request failed (${r.status})`);render(data);
    }catch(err){root.querySelector('.app-post-list').innerHTML=`<div class="app-post-empty error"><b>Post analytics could not load.</b><span>${esc(err.message)}</span><button class="btn app-post-refresh" type="button">Try again</button></div>`;}
    finally{loading=false;root.classList.remove('is-loading');}
  }
  function run(){queued=false;if(location.hash!=='#analytics')return;const root=shell();if(root&&!root.dataset.loaded){root.dataset.loaded='1';load(true);}}
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(run);}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
  addEventListener('hashchange',()=>{if(location.hash==='#analytics')setTimeout(()=>load(true),80);});
  addEventListener('load',schedule);schedule();
})();
(()=>{
  const safe=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  let queued=false;

  function removeGreyPlaceholder(card){
    // The real creative is .calendar-post-thumb-v4. Anything else that is an
    // empty visual box inside a calendar card is legacy placeholder UI.
    card.querySelectorAll('*').forEach(el=>{
      if(el===card) return;
      if(el.closest('.calendar-post-thumb-v4')) return;
      if(el.closest('.calendar-platforms')) return;
      if(el.matches('em,strong,small,.calendar-platform')) return;
      if(el.querySelector('img,video,svg,.calendar-platform')) return;
      if(el.textContent.trim()) return;
      el.remove();
    });
    card.classList.add('calendar-no-placeholder-v6');
  }

  function ensureViewer(){
    let modal=document.getElementById('calendar-post-viewer-v5');
    if(modal) return modal;
    modal=document.createElement('div');
    modal.id='calendar-post-viewer-v5';
    modal.className='calendar-post-viewer-v5';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`<div class="calendar-post-viewer-backdrop" data-close-post-viewer></div><section class="calendar-post-viewer-panel" role="dialog" aria-modal="true" aria-label="Post preview"><button type="button" class="calendar-post-viewer-close" data-close-post-viewer aria-label="Close">×</button><div class="calendar-post-viewer-media" id="calendar-post-viewer-media"></div><div class="calendar-post-viewer-copy"><span class="calendar-post-viewer-kicker">POST PREVIEW</span><h3 id="calendar-post-viewer-title">Scheduled post</h3><p id="calendar-post-viewer-caption"></p><div class="calendar-post-viewer-meta" id="calendar-post-viewer-meta"></div></div></section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll('[data-close-post-viewer]').forEach(btn=>btn.addEventListener('click',()=>closeViewer()));
    addEventListener('keydown',e=>{if(e.key==='Escape')closeViewer()});
    return modal;
  }

  function closeViewer(){
    const modal=document.getElementById('calendar-post-viewer-v5');
    if(!modal)return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden','true');
    document.body.classList.remove('post-viewer-open-v5');
  }

  function openViewer(card){
    const modal=ensureViewer();
    const thumb=card.querySelector('.calendar-post-thumb-v4 img,.calendar-post-thumb-v4 video');
    const isVideo=thumb?.tagName==='VIDEO';
    const src=thumb?.currentSrc||thumb?.src||'';
    const media=modal.querySelector('#calendar-post-viewer-media');
    media.innerHTML=src
      ? isVideo?`<video src="${safe(src)}" controls playsinline preload="metadata"></video>`:`<img src="${safe(src)}" alt="Post creative">`
      : `<div class="calendar-post-viewer-empty">No media preview available</div>`;
    const time=card.querySelector('em')?.textContent?.trim()||'';
    const type=card.querySelector('strong')?.textContent?.trim()||'Post';
    const caption=card.querySelector('small')?.textContent?.trim()||'Scheduled social post';
    const platforms=[...card.querySelectorAll('.calendar-platform')].map(el=>el.getAttribute('title')||el.dataset.brand||'').filter(Boolean);
    modal.querySelector('#calendar-post-viewer-title').textContent=caption;
    modal.querySelector('#calendar-post-viewer-caption').textContent=card.getAttribute('data-full-caption')||caption;
    modal.querySelector('#calendar-post-viewer-meta').innerHTML=`<span>${safe(type)}</span>${time?`<span>${safe(time)}</span>`:''}${platforms.length?`<span>${safe(platforms.join(' · '))}</span>`:''}`;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('post-viewer-open-v5');
  }

  function enhance(){
    if(location.hash!=='#social')return;
    document.querySelectorAll('#customer-shell .calendar-post').forEach(card=>{
      removeGreyPlaceholder(card);
      card.classList.add('calendar-post-clickable-v5');
      card.setAttribute('tabindex','0');
      card.setAttribute('role','button');
      card.setAttribute('aria-label','View scheduled post');
      if(card.dataset.viewerBound==='1')return;
      card.dataset.viewerBound='1';
      card.addEventListener('click',e=>{if(!e.target.closest('a,button'))openViewer(card)});
      card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openViewer(card)}});
    });
  }

  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('load',schedule);addEventListener('hashchange',schedule);schedule();
})();
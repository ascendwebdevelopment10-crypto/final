(()=>{
  const brands=['instagram','facebook','tiktok','linkedin','youtube'];
  const svgs={
    instagram:`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><defs><radialGradient id="ig-direct" cx="30%" cy="100%" r="120%"><stop offset="0" stop-color="#ffd600"/><stop offset=".45" stop-color="#ff0169"/><stop offset="1" stop-color="#d300c5"/></radialGradient></defs><rect width="24" height="24" rx="6" fill="url(#ig-direct)"/><rect x="5.3" y="5.3" width="13.4" height="13.4" rx="4" fill="none" stroke="white" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="white" stroke-width="1.8"/><circle cx="16.6" cy="7.6" r="1.1" fill="white"/></svg>`,
    facebook:`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#1877f2"/><path fill="white" d="M13.7 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5H17V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1V10H8v3.1h2.6v8h3.1Z"/></svg>`,
    tiktok:`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#050505"/><path fill="#25f4ee" d="M13.2 4.4h2.4c.2 1.7 1.2 2.8 2.8 3.2V10c-1.1 0-2-.3-2.8-.8v5.2a5.1 5.1 0 1 1-4.4-5v2.4a2.7 2.7 0 1 0 1.9 2.6V4.4Z"/><path fill="#fe2c55" d="M14.2 4.4h1.4c.2 1.7 1.2 2.8 2.8 3.2v1.2c-1.6-.4-2.7-1.4-3.2-2.8v8.4a4.5 4.5 0 0 1-4.5 4.5 4.6 4.6 0 0 1-2.5-.8c.6.4 1.4.6 2.2.6a4.5 4.5 0 0 0 4.5-4.5V6.1c-.3-.5-.5-1.1-.7-1.7Z" opacity=".85"/></svg>`,
    linkedin:`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="4" fill="#0a66c2"/><path fill="white" d="M6.6 8.1A1.8 1.8 0 1 0 6.6 4.5a1.8 1.8 0 0 0 0 3.6ZM5.1 19.5h3V9.8h-3v9.7Zm4.8 0h3v-4.8c0-1.3.2-2.6 1.9-2.6 1.6 0 1.7 1.6 1.7 2.7v4.7h3v-5.3c0-3.1-.7-5.4-4.2-5.4-1.7 0-2.8.9-3.3 1.8v-.8H9.9v9.7Z"/></svg>`,
    youtube:`<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#ff0000"/><path d="m10 8 6 4-6 4V8Z" fill="white"/></svg>`
  };
  function brandFor(card,index){
    const text=String(card?.textContent||'').toLowerCase();
    return brands.find(b=>text.includes(b))||brands[index]||'';
  }
  function render(){
    if(location.hash!=='#social')return;
    document.querySelectorAll('.social-account-card').forEach((card,index)=>{
      const brand=brandFor(card,index);
      const mark=card.querySelector('.social-platform-mark');
      if(!mark||!svgs[brand])return;
      mark.dataset.brand=brand;
      if(mark.dataset.directLogo===brand&&mark.querySelector('svg'))return;
      mark.innerHTML=svgs[brand];
      mark.dataset.directLogo=brand;
      mark.setAttribute('aria-label',`${brand} logo`);
      mark.style.display='grid';
      mark.style.placeItems='center';
      mark.style.overflow='visible';
    });
  }
  let queued=false;
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;render()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('hashchange',schedule);
  addEventListener('load',schedule);
  schedule();
})();
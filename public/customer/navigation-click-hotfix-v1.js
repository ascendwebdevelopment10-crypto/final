(()=>{
  const SECTIONS=new Set(['dashboard','websites','content','social','ads','messages','assistant','analytics','billing','settings','owner','outreach']);
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href^="#"]');
    if(!link||!location.pathname.startsWith('/app'))return;
    const section=(link.getAttribute('href')||'').slice(1);
    if(!SECTIONS.has(section))return;
    event.preventDefault();
    event.stopPropagation();
    const next='#'+section;
    if(location.hash===next){
      window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL:location.href,newURL:location.href}));
      return;
    }
    location.hash=section;
  },true);
})();
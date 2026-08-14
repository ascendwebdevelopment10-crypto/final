(()=>{
  const SECTIONS=new Set(['dashboard','websites','content','social','ads','messages','assistant','analytics','billing','settings','owner','outreach']);
  let navigating=false;
  function go(link,event){
    if(navigating||!link)return;
    const href=link.getAttribute('href')||'';
    if(!href.startsWith('#'))return;
    const section=href.slice(1);
    if(!SECTIONS.has(section))return;
    if(event){event.preventDefault();event.stopImmediatePropagation();event.stopPropagation();}
    navigating=true;
    const url='/app?view='+encodeURIComponent(section)+'#'+encodeURIComponent(section);
    window.location.assign(url);
  }
  document.addEventListener('pointerup',event=>{
    const link=event.target.closest('.side-link[href^="#"], .desktop-quick-panel a[href^="#"]');
    go(link,event);
  },true);
  document.addEventListener('click',event=>{
    const link=event.target.closest('.side-link[href^="#"], .desktop-quick-panel a[href^="#"]');
    go(link,event);
  },true);
})();
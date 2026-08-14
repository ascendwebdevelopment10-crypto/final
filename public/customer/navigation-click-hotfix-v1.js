(()=>{
  const SECTIONS=new Set(['dashboard','websites','content','social','ads','messages','assistant','analytics','billing','settings','owner','outreach']);
  let navigating=false;

  function isMobile(){
    return window.matchMedia('(max-width: 760px)').matches || navigator.maxTouchPoints>0;
  }

  function findLink(event){
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    const fromPath=path.find(node=>node instanceof Element && node.matches?.('.sidebar .side-link[href^="#"]'));
    if(fromPath)return fromPath;
    const target=event.target instanceof Element?event.target:event.target?.parentElement;
    return target?.closest?.('.sidebar .side-link[href^="#"]')||null;
  }

  function mobileGo(event){
    if(!isMobile()||navigating)return;
    const link=findLink(event);
    if(!link)return;
    const href=link.getAttribute('href')||'';
    const section=href.startsWith('#')?href.slice(1):'';
    if(!SECTIONS.has(section))return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    navigating=true;

    const shell=document.getElementById('customer-shell');
    shell?.classList.remove('menu-open');
    document.getElementById('mobile-menu')?.setAttribute('aria-expanded','false');

    // Force a real document navigation on mobile Safari instead of relying on
    // the same-document hash event, which is the path that has been failing.
    const url='/app?mobileNav='+encodeURIComponent(section)+'&v='+Date.now()+'#'+encodeURIComponent(section);
    window.location.href=url;
  }

  document.addEventListener('touchend',mobileGo,{capture:true,passive:false});
  document.addEventListener('click',mobileGo,true);
})();
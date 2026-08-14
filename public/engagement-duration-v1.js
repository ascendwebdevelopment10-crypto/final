(()=>{
  if(window.__nitroDurationTracker)return;
  window.__nitroDurationTracker=true;
  function attribution(){try{return JSON.parse(sessionStorage.getItem('nitro-outreach-attribution')||'{}');}catch{return {};}}
  let focusedMs=0,last=Date.now(),lastSent=0;
  async function send(force=false){
    const a=attribution();
    const seconds=Math.floor(focusedMs/1000);
    if(!a.id||!a.token||seconds<8||(!force&&seconds-lastSent<15))return;
    lastSent=seconds;
    try{await fetch('/api/track-engagement-duration',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:force,body:JSON.stringify({path:location.pathname+location.hash,outreachId:a.id,outreachToken:a.token,engagementSeconds:seconds,webdriver:navigator.webdriver===true,visibility:document.visibilityState})});}catch{}
  }
  setInterval(()=>{const now=Date.now();if(document.visibilityState==='visible'&&document.hasFocus())focusedMs+=Math.max(0,now-last);last=now;send(false);},1000);
  addEventListener('pagehide',()=>send(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')send(true);last=Date.now();});
})();

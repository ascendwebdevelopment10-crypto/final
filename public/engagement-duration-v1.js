(()=>{
  if(window.__nitroDurationTracker)return;
  window.__nitroDurationTracker=true;
  function attribution(){try{return JSON.parse(sessionStorage.getItem('nitro-outreach-attribution')||'{}');}catch{return {};}}
  function id(storage,key){try{let value=storage.getItem(key);if(!value){value=(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));storage.setItem(key,value);}return value;}catch{return Date.now()+'-'+Math.random().toString(36).slice(2);}}
  let focusedMs=0,last=Date.now(),lastSent=0;
  async function send(force=false){
    const a=attribution();
    const seconds=Math.floor(focusedMs/1000);
    if(!a.id||!a.token||seconds<8||(!force&&seconds-lastSent<15))return;
    lastSent=seconds;
    try{await fetch('/api/track-visit',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:force,body:JSON.stringify({visitorId:id(localStorage,'nitro-visitor-id'),sessionId:id(sessionStorage,'nitro-visit-session-v2'),path:location.pathname+location.hash,outreachId:a.id,outreachToken:a.token,outreachEngagement:'heartbeat',engagementSeconds:seconds,webdriver:navigator.webdriver===true,visibility:document.visibilityState})});}catch{}
  }
  setInterval(()=>{const now=Date.now();if(document.visibilityState==='visible'&&document.hasFocus())focusedMs+=Math.max(0,now-last);last=now;send(false);},1000);
  addEventListener('pagehide',()=>send(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')send(true);last=Date.now();});
})();

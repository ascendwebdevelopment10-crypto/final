(()=>{
  if(window.__nitroDiverseContentFetch)return;
  window.__nitroDiverseContentFetch=true;
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      if(/\/api\/customer-workspace(?:\?|$)/.test(url)&&init&&String(init.method||'GET').toUpperCase()==='POST'&&typeof init.body==='string'){
        const body=JSON.parse(init.body);
        if(body&&body.action==='generate-content'){
          const next={...body};delete next.action;
          return originalFetch('/api/generate-content-v2',{...init,body:JSON.stringify(next)});
        }
      }
    }catch{}
    return originalFetch(input,init);
  };
})();
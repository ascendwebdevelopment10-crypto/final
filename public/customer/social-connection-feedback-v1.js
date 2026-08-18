(()=>{
  const names={facebook:'Facebook',instagram:'Instagram',tiktok:'TikTok',linkedin:'LinkedIn',youtube:'YouTube'};
  const safe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(){
    if(location.hash!=='#social')return;
    const p=new URLSearchParams(location.search),status=p.get('social');
    if(!status)return;
    const platform=(p.get('platform')||'').toLowerCase(),name=names[platform]||'Social account';
    const message=p.get('message')||'';
    const page=document.querySelector('.socials-workspace');if(!page)return;
    page.querySelector('.social-connection-result')?.remove();
    const ok=status==='connected';
    const box=document.createElement('section');
    box.className=`social-connection-result ${ok?'is-success':'is-error'}`;
    const title=ok?`${name} connected`:`${name} connection failed`;
    const detail=message||(status==='denied'?'The provider did not approve the connection.':'Try reconnecting and grant every requested permission.');
    box.innerHTML=`<div><b>${safe(title)}</b><span>${safe(detail)}</span></div>${!ok&&platform?`<a class="btn btn-sm" href="/api/social-connect?platform=${encodeURIComponent(platform)}">Try ${safe(name)} again</a>`:''}<button type="button" aria-label="Dismiss">×</button>`;
    const toolbar=page.querySelector('.socials-toolbar');(toolbar||page).insertAdjacentElement(toolbar?'afterend':'afterbegin',box);
    box.querySelector('button')?.addEventListener('click',()=>box.remove());
    const cleanUrl=`${location.pathname}${location.hash||'#social'}`;
    history.replaceState({},'',cleanUrl);
  }
  const style=document.createElement('style');style.textContent=`.social-connection-result{margin:12px 0 16px;padding:14px 16px;border:1px solid #ffffff18;border-radius:14px;background:#0d1014;display:flex;align-items:center;gap:12px}.social-connection-result>div{display:flex;flex-direction:column;gap:3px;flex:1}.social-connection-result b{font:800 13px Manrope;color:#fff}.social-connection-result span{font:500 10px DM Sans;color:#9aa1ab;line-height:1.5}.social-connection-result.is-success{border-color:#55da8a40;background:#0c1510}.social-connection-result.is-error{border-color:#ff6b6b42;background:#180e10}.social-connection-result>button{border:0;background:transparent;color:#8f969f;font-size:20px;cursor:pointer}.social-connection-result .btn{white-space:nowrap}@media(max-width:700px){.social-connection-result{align-items:stretch;flex-direction:column}.social-connection-result>button{position:absolute;right:18px}.social-connection-result .btn{width:100%}}`;document.head.appendChild(style);
  let t;const schedule=()=>{clearTimeout(t);t=setTimeout(render,120)};new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});addEventListener('hashchange',schedule);addEventListener('load',schedule);schedule();
})();
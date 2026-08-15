(()=>{
  const message='Facebook analytics need permission. Reconnect Facebook to allow Nitro to read post performance.';
  function fix(){
    if(location.hash!=='#social')return;
    document.querySelectorAll('.platform-post-note').forEach(note=>{
      const text=String(note.textContent||'');
      if(!/pages_read_user_content|Page Public Content Access|current Page permission|Page insights access/i.test(text))return;
      if(note.dataset.fbPermissionFixed)return;
      note.dataset.fbPermissionFixed='1';
      note.classList.add('facebook-permission-note');
      note.innerHTML=`<div><b>Facebook analytics need permission</b><span>${message}</span></div><a class="btn btn-sm" href="/api/social-connect?platform=facebook">Reconnect Facebook</a>`;
    });
  }
  let t;const schedule=()=>{clearTimeout(t);t=setTimeout(fix,80)};
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,characterData:true});
  addEventListener('hashchange',schedule);addEventListener('load',schedule);schedule();
})();
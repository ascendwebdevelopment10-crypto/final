(()=>{
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const text=el=>String(el?.textContent||'').replace(/\s+/g,' ').trim();

  function dedupeMessagingLinks(){
    qa('.sidebar-primary-nav,.side-nav,.desktop-quick-panel').forEach(root=>{
      const links=qa('a[href="#messages"]',root);
      if(links.length>1)links.slice(1).forEach(a=>a.remove());
    });
  }
  function cleanCommunicateGroups(){
    const nav=q('.sidebar-primary-nav,.side-nav');if(!nav)return;
    let seen=false;
    qa('.ux-nav-group',nav).forEach(label=>{
      if(text(label).toLowerCase()!=='communicate')return;
      if(seen)label.remove();else seen=true;
    });
  }
  function addStyles(){
    if(q('#messaging-clarity-style'))return;
    const s=document.createElement('style');s.id='messaging-clarity-style';s.textContent=`#customer-shell .messaging-clarity-card{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:28px;align-items:center;padding:24px;margin:0 0 18px}#customer-shell .messaging-clarity-copy h3{font:800 22px/1.1 Manrope;margin:6px 0 8px;letter-spacing:-.025em}#customer-shell .messaging-clarity-copy p{margin:0;color:var(--muted);line-height:1.6;max-width:650px}#customer-shell .messaging-clarity-steps{display:grid;gap:8px}#customer-shell .messaging-clarity-steps>div{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:start;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.025)}#customer-shell .messaging-clarity-steps>div>b{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--workspace-primary,var(--green));color:#fff;font-size:12px}#customer-shell .messaging-clarity-steps span{display:grid;gap:2px}#customer-shell .messaging-clarity-steps strong{font-size:13px}#customer-shell .messaging-clarity-steps small{color:var(--muted);line-height:1.35}@media(max-width:820px){#customer-shell .messaging-clarity-card{grid-template-columns:1fr;gap:18px;padding:18px}}`;document.head.appendChild(s);
  }
  function polishMessagingPage(){
    if(location.hash!=='#messages')return;
    const main=q('.app-content,.main-content,.workspace-content')||q('#customer-shell main');if(!main)return;
    const toolbar=q('.section-toolbar',main);
    if(toolbar&&!toolbar.dataset.messagingClarified){toolbar.dataset.messagingClarified='1';const title=q('h2',toolbar);if(title)title.textContent='Messaging';const copy=q('p',toolbar);if(copy)copy.textContent='Manage real conversations with leads and customers. View replies, send email or SMS, and follow up from one place.';}
    if(q('.messaging-clarity-card',main))return;
    const card=document.createElement('section');card.className='glass-card messaging-clarity-card';card.innerHTML=`<div class="messaging-clarity-copy"><span class="eyebrow">WHAT THIS DOES</span><h3>Your conversation inbox</h3><p>Messaging is where you handle people who respond to Nitro. Outreach starts conversations; Messaging is where you read replies, send follow-ups, and keep email or text conversations moving.</p></div><div class="messaging-clarity-steps"><div><b>1</b><span><strong>Connect a channel</strong><small>Add your sending email or texting number.</small></span></div><div><b>2</b><span><strong>See conversations</strong><small>Replies and tracked messages appear here.</small></span></div><div><b>3</b><span><strong>Follow up</strong><small>Reply while the lead is still interested.</small></span></div></div>`;
    const anchor=toolbar||main.firstElementChild;if(anchor)anchor.insertAdjacentElement('afterend',card);else main.prepend(card);
  }
  function run(){if(!location.pathname.startsWith('/app'))return;addStyles();dedupeMessagingLinks();cleanCommunicateGroups();polishMessagingPage();}
  addEventListener('load',()=>setTimeout(run,75));
  addEventListener('hashchange',()=>setTimeout(run,75));
  setTimeout(run,125);
})();
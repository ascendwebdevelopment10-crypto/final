(() => {
  const GOALS = {
    customers:{label:'Get more customers',icon:'↗',copy:'Build the shortest path from attention to a real lead.',focus:['dashboard','websites','ads','messages','analytics'],first:'#websites'},
    content:{label:'Create content',icon:'✦',copy:'Make campaign-ready posts and get them scheduled.',focus:['dashboard','content','social','analytics'],first:'#content'},
    website:{label:'Build a website',icon:'◇',copy:'Launch a clear page that gives visitors an obvious next step.',focus:['dashboard','websites','analytics'],first:'#websites'},
    outreach:{label:'Automate outreach',icon:'✉',copy:'Set up messaging, send tracked outreach, and follow up on intent.',focus:['dashboard','messages','analytics'],first:'#messages'},
    social:{label:'Manage my social media',icon:'◎',copy:'Connect channels, create content, and keep your publishing queue full.',focus:['dashboard','social','content','analytics'],first:'#social'}
  };
  const KEY='nitro-ease-goal-v1';
  let scheduled=false;

  function num(el){const n=Number(String(el?.textContent||'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0;}
  function dashboardStats(){
    const cards=[...document.querySelectorAll('.result-kpi-grid .stat-card')];
    const byLabel=label=>num(cards.find(card=>card.querySelector('.stat-top span')?.textContent.trim()===label)?.querySelector('.stat-value'));
    const leadCard=document.querySelector('.lead-result');
    const siteCount=num(leadCard?.querySelector('.result-split div:first-child b'));
    const activeCampaigns=num(leadCard?.querySelector('.result-split div:nth-child(2) b'));
    const socialCard=document.querySelector('.social-result');
    const socialRows=[...socialCard?.querySelectorAll('.metric-rows>div')||[]];
    const connectedSocials=num(socialRows.find(row=>row.querySelector('span')?.textContent.trim()==='Connected socials')?.querySelector('b'));
    return {sites:siteCount,campaigns:activeCampaigns,socials:connectedSocials,sent:byLabel('Outreach sent'),published:byLabel('Posts published'),content:byLabel('Content created')};
  }
  function isFresh(stats){return stats.sites===0&&stats.campaigns===0&&stats.socials===0&&stats.sent===0&&stats.published===0&&stats.content===0;}
  function goal(){const id=localStorage.getItem(KEY);return GOALS[id]?id:'';}
  function setGoal(id){localStorage.setItem(KEY,id);document.documentElement.dataset.nitroGoal=id;document.querySelector('.nitro-goal-overlay')?.remove();applyGoalFocus();renderGuide();}

  function goalOverlay(){
    if(document.querySelector('.nitro-goal-overlay'))return;
    const wrap=document.createElement('div');wrap.className='nitro-goal-overlay';
    wrap.innerHTML=`<section class="nitro-goal-card" role="dialog" aria-modal="true" aria-labelledby="nitro-goal-title"><div class="nitro-goal-brand">⚡ NITRO OUTREACH</div><span class="nitro-goal-kicker">LET'S PERSONALIZE YOUR WORKSPACE</span><h1 id="nitro-goal-title">What do you want Nitro to help you do?</h1><p>You do not need to learn every tool. Pick the result you want first and Nitro will put the right workflow in front of you.</p><div class="nitro-goal-grid">${Object.entries(GOALS).map(([id,g])=>`<button type="button" data-nitro-goal="${id}"><i>${g.icon}</i><span><b>${g.label}</b><small>${g.copy}</small></span><em>→</em></button>`).join('')}</div><small class="nitro-goal-foot">You can still use every feature later. This only simplifies what Nitro shows you first.</small></section>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-nitro-goal]').forEach(button=>button.addEventListener('click',()=>setGoal(button.dataset.nitroGoal)));
  }

  function stepData(stats){
    const launchDone=stats.sent>0||stats.published>0||stats.campaigns>0;
    return [
      {label:'Business added',done:true,href:'#settings',copy:'Your workspace foundation is ready.'},
      {label:'Website ready',done:stats.sites>0,href:'#websites',copy:stats.sites?'Your website workspace is active.':'Build the page customers can land on.'},
      {label:'Connect social',done:stats.socials>0,href:'#social',copy:stats.socials?'At least one social account is connected.':'Connect the channel you actually use.'},
      {label:'Create first campaign',done:stats.campaigns>0||stats.content>0,href:'#ads',copy:(stats.campaigns>0||stats.content>0)?'Your first campaign asset exists.':'Turn your offer into something ready to publish.'},
      {label:'Launch',done:launchDone,href:goal()&&GOALS[goal()]?.first||'#content',copy:launchDone?'Nitro is now doing real work for your business.':'Publish, send, or activate your first piece of work.'}
    ];
  }

  function renderGuide(){
    const home=document.querySelector('.result-dashboard');if(!home)return;
    const stats=dashboardStats(),steps=stepData(stats),done=steps.filter(s=>s.done).length;
    document.querySelector('.nitro-setup-guide')?.remove();
    if(done===steps.length){localStorage.setItem('nitro-setup-complete-v1','1');return;}
    const current=steps.find(s=>!s.done)||steps[steps.length-1],g=GOALS[goal()]||GOALS.customers;
    const guide=document.createElement('section');guide.className='glass-card nitro-setup-guide';
    guide.innerHTML=`<div class="nitro-setup-head"><div><span class="eyebrow">YOUR SETUP · ${done}/5 COMPLETE</span><h3>Get Nitro working for you</h3><p>${g.label}: ${g.copy}</p></div><a class="btn btn-primary" href="${current.href}">Do this next →</a></div><div class="nitro-setup-progress"><i style="width:${done/5*100}%"></i></div><div class="nitro-setup-steps">${steps.map((s,i)=>`<a href="${s.href}" class="${s.done?'done':'todo'}"><span>${s.done?'✓':i+1}</span><div><b>${s.label}</b><small>${s.copy}</small></div></a>`).join('')}</div>`;
    const welcome=home.querySelector('.dashboard-welcome');welcome?.after(guide);
  }

  function applyGoalFocus(){
    const id=goal(),g=GOALS[id];if(!g)return;
    document.documentElement.dataset.nitroGoal=id;
    document.querySelectorAll('.side-nav .side-link, .sidebar-primary-nav .side-link').forEach(link=>{
      const href=link.getAttribute('href')||'';const section=href.replace(/^#/,'');link.classList.toggle('nitro-goal-priority',g.focus.includes(section));
    });
    const welcome=document.querySelector('.dashboard-welcome');
    if(welcome&&!welcome.querySelector('.nitro-goal-chip')){
      const chip=document.createElement('div');chip.className='nitro-goal-chip';chip.innerHTML=`<span>${g.icon}</span><div><small>YOUR PRIMARY GOAL</small><b>${g.label}</b></div><button type="button" data-change-goal>Change</button>`;
      welcome.querySelector('.welcome-actions')?.prepend(chip);
      chip.querySelector('[data-change-goal]').addEventListener('click',()=>{localStorage.removeItem(KEY);goalOverlay();});
    }
  }

  function improveLabels(){
    document.querySelectorAll('.result-dashboard .result-channel').forEach(card=>{
      const link=card.querySelector('.result-channel-head>a');if(link)link.setAttribute('aria-label','Open '+(card.querySelector('h3')?.textContent||'section'));
    });
    document.querySelectorAll('button[disabled]').forEach(btn=>{if(!btn.title)btn.title='Complete the required setup first.';});
  }

  function run(){scheduled=false;if(!location.pathname.startsWith('/app'))return;const home=document.querySelector('.result-dashboard');if(!home)return;const stats=dashboardStats();if(!goal()&&isFresh(stats))goalOverlay();applyGoalFocus();renderGuide();improveLabels();}
  function queue(){if(scheduled)return;scheduled=true;requestAnimationFrame(run);}
  new MutationObserver(queue).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',queue);window.addEventListener('popstate',queue);document.addEventListener('DOMContentLoaded',queue);queue();
})();
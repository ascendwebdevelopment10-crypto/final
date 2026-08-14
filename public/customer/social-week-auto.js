(()=>{
  let busy=false;
  function cleanGrayPlaceholders(root=document){
    root.querySelectorAll('.calendar-post').forEach(card=>{
      [...card.children].forEach(el=>{
        if(el.classList.contains('calendar-post-thumb-v4')||el.classList.contains('calendar-platforms')||el.classList.contains('calendar-platform'))return;
        const blank=!String(el.textContent||'').trim()&&!el.querySelector('img,video,.calendar-platform');
        if(blank&&(el.tagName==='DIV'||el.tagName==='SPAN'))el.remove();
      });
      card.setAttribute('role','button');card.tabIndex=0;
    });
  }
  function scheduleTimes(){
    const out=[];const now=new Date();
    for(let i=1;i<=7;i++){
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()+i,11,30,0,0);
      out.push(d.toISOString());
    }
    return out;
  }
  function simpleEmptyDays(calendar){
    calendar.querySelectorAll('.is-empty-day .empty-day-body').forEach(body=>{
      if(body.querySelector('.social-empty-simple'))return;
      body.innerHTML='<div class="social-empty-simple"><b>No post scheduled</b><span>Use the 7-day button above</span></div>';
    });
  }
  async function generateWeek(btn){
    if(busy)return;busy=true;const original=btn.textContent;btn.disabled=true;btn.textContent='Building your week…';
    try{
      const res=await fetch('/api/social-week',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schedule:scheduleTimes()})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||'Could not build the week.');
      btn.textContent=`✓ ${data.days} posts scheduled`;
      setTimeout(()=>location.reload(),700);
    }catch(err){
      btn.textContent=original;btn.disabled=false;busy=false;
      alert(err.message||'Could not build the week.');
    }
  }
  function addWeekButton(page){
    const calendar=page.querySelector('.social-calendar');if(!calendar)return;
    const head=calendar.querySelector('.panel-head');if(!head||head.querySelector('.social-week-auto-btn'))return;
    const wrap=document.createElement('div');wrap.className='social-week-auto-wrap';
    wrap.innerHTML='<div><button type="button" class="social-week-auto-btn">Generate 7-Day Schedule</button><span class="social-week-auto-note">7 different posts · every connected platform</span></div>';
    head.appendChild(wrap);wrap.querySelector('button').addEventListener('click',e=>generateWeek(e.currentTarget));
  }
  function enhance(){
    if(location.hash!=='#social')return;
    const page=document.querySelector('.socials-workspace');if(!page)return;
    cleanGrayPlaceholders(page);addWeekButton(page);simpleEmptyDays(page.querySelector('.social-calendar')||page);
  }
  let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance()})}
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true});
  addEventListener('load',schedule);addEventListener('hashchange',schedule);schedule();
})();

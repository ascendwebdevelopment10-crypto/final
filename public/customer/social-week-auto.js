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
    const day=now.getDay();
    const daysUntilMonday=((8-day)%7)||7;
    const monday=new Date(now.getFullYear(),now.getMonth(),now.getDate()+daysUntilMonday,11,30,0,0);
    for(let i=0;i<7;i++){
      const d=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i,11,30,0,0);
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
    if(busy)return;busy=true;const original=btn.textContent;btn.disabled=true;btn.textContent='Building next week…';
    try{
      const res=await fetch('/api/social-week',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schedule:scheduleTimes()})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||'Could not build the week.');
      sessionStorage.setItem('nitroLastAutoWeekBatch',data.batchId||'');
      btn.textContent=`✓ Next week scheduled`;
      setTimeout(()=>location.reload(),700);
    }catch(err){
      btn.textContent=original;btn.disabled=false;busy=false;
      alert(err.message||'Could not build the week.');
    }
  }
  async function undoWeek(btn){
    if(busy)return;
    if(!confirm('Remove the most recent generated 7-day schedule? This only removes future posts created by the 7-day generator.'))return;
    busy=true;const original=btn.textContent;btn.disabled=true;btn.textContent='Undoing…';
    try{
      const batchId=sessionStorage.getItem('nitroLastAutoWeekBatch')||'';
      const res=await fetch('/api/social-week',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({batchId})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(data.error||'Could not undo the generated week.');
      sessionStorage.removeItem('nitroLastAutoWeekBatch');
      btn.textContent=data.removed?`✓ Removed ${data.removed} scheduled jobs`:'Nothing to undo';
      setTimeout(()=>location.reload(),700);
    }catch(err){
      btn.textContent=original;btn.disabled=false;busy=false;
      alert(err.message||'Could not undo the generated week.');
    }
  }
  function addWeekButton(page){
    const calendar=page.querySelector('.social-calendar');if(!calendar)return;
    const head=calendar.querySelector('.panel-head');if(!head||head.querySelector('.social-week-auto-wrap'))return;
    const wrap=document.createElement('div');wrap.className='social-week-auto-wrap';
    wrap.innerHTML='<div class="social-week-actions"><button type="button" class="social-week-auto-btn">Generate Next Week</button><button type="button" class="social-week-undo-btn">Undo Generated Week</button></div><span class="social-week-auto-note">Creates Monday–Sunday of the next calendar week</span>';
    head.appendChild(wrap);
    wrap.querySelector('.social-week-auto-btn').addEventListener('click',e=>generateWeek(e.currentTarget));
    wrap.querySelector('.social-week-undo-btn').addEventListener('click',e=>undoWeek(e.currentTarget));
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

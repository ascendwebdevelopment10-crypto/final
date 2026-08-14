import { kv } from '@vercel/kv';
import { outreachTokenValid } from '../lib/sign.js';
import { isKnownAutomatedTraffic } from '../lib/analytics-traffic.js';

function clean(value,max=120){return String(value||'').replace(/[\r\n]/g,' ').trim().slice(0,max);}
function productionHost(req){const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim().split(':')[0].toLowerCase();return host==='nitrooutreach.com'||host==='www.nitrooutreach.com';}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.status(405).json({ok:false});return;}
  try{
    if(!productionHost(req)){res.status(200).json({ok:true,excluded:'non-production'});return;}
    const id=clean(req.body?.outreachId,100).replace(/[^a-zA-Z0-9_-]/g,'');
    const token=clean(req.body?.outreachToken,120);
    const seconds=Math.max(0,Math.min(7200,Math.floor(Number(req.body?.engagementSeconds||0))));
    if(!id||seconds<8||req.body?.visibility!=='visible'||!outreachTokenValid(id,token)){res.status(200).json({ok:true,excluded:'invalid'});return;}
    if(isKnownAutomatedTraffic({userAgent:req.headers['user-agent'],purpose:req.headers.purpose||req.headers['sec-purpose'],webdriver:req.body?.webdriver,visibility:req.body?.visibility,city:req.headers['x-vercel-ip-city']})){res.status(200).json({ok:true,excluded:'automated'});return;}
    const current=Number(await kv.hget('email:engagement:max-seconds',id)||0);
    if(seconds>current)await kv.hset('email:engagement:max-seconds',{[id]:seconds});
    await kv.hset('email:engagement:last',{[id]:Date.now()});
    res.status(200).json({ok:true,seconds:Math.max(current,seconds)});
  }catch{res.status(200).json({ok:true});}
}

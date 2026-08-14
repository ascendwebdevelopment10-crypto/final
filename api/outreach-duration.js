import { kv } from '@vercel/kv';
import { currentCustomer } from '../lib/customer-auth.js';

const OWNER_EMAIL=(process.env.OWNER_EMAIL||'nitrooutreach@outlook.com').toLowerCase();

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const user=await currentCustomer(req);
    if(!user){res.status(401).json({error:'Please sign in.'});return;}
    if(String(user.email||'').toLowerCase()!==OWNER_EMAIL){res.status(403).json({error:'Not authorized.'});return;}
    if(req.method!=='GET'){res.status(405).json({error:'Method not allowed'});return;}
    const [seconds,last]=await Promise.all([
      kv.hgetall('email:engagement:max-seconds'),
      kv.hgetall('email:engagement:last'),
    ]);
    res.status(200).json({seconds:seconds||{},last:last||{}});
  }catch(e){res.status(500).json({error:e.message});}
}

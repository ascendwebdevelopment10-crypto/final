import { kv } from '@vercel/kv';
import { currentCustomer, sameOrigin } from '../lib/customer-auth.js';

const KEY='nitro:social:campaign:2026-08:overrides';
const POSTS={
  '2026-08-one-workspace':{scheduledFor:'2026-08-13T17:30:00.000Z',imagePath:'/social/aug-2026/01-one-workspace.jpg',caption:'Five tabs do not make a marketing system. Nitro brings your website, content, social, ads, and outreach into one workspace so the work can actually move.\n\nStart free: nitrooutreach.com\n\n#smallbusinessmarketing #marketingworkflow #nitrooutreach'},
  '2026-08-website':{scheduledFor:'2026-08-14T17:30:00.000Z',imagePath:'/social/aug-2026/02-website.jpg',caption:'Quick question: does your website create the next conversation—or just sit there?\n\nWith Nitro, the page, visitor signal, and follow-up live together. Build it. See who came. Keep the momentum.\n\n#businesswebsite #leadgeneration #smallbusiness'},
  '2026-08-content':{scheduledFor:'2026-08-15T17:30:00.000Z',imagePath:'/social/aug-2026/03-content.jpg',caption:'The content chain:\n\nOne useful idea → one sharp hook → one Reel → one post → one campaign.\n\nNitro helps you stretch the idea without flattening your voice.\n\n#contentstudio #reelsstrategy #contentmarketing'},
  '2026-08-social':{scheduledFor:'2026-08-16T17:30:00.000Z',imagePath:'/social/aug-2026/04-social.jpg',caption:'Your future self does not want to remember what needs posting on Thursday. Put the whole week somewhere visible, adjust it once, and let the queue do its job.\n\n#socialscheduler #contentcalendar #smallbusinessowner'},
  '2026-08-outreach':{scheduledFor:'2026-08-17T17:30:00.000Z',imagePath:'/social/aug-2026/05-outreach.jpg',caption:'Opened is curiosity. Clicked is intent. Replied is a conversation.\n\nNitro keeps those signals together so your next follow-up is based on what actually happened—not a guess.\n\n#outreach #salesfollowup #leadtracking'},
  '2026-08-start-free':{scheduledFor:'2026-08-18T17:30:00.000Z',imagePath:'/social/aug-2026/06-start-free.jpg',caption:'$0 to start. No card. No forced demo.\n\nTry Nitro on one real job today: build a page, make a post, or organize your outreach. Keep it only if it earns its place.\n\nnitrooutreach.com\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach'}
  ,'2026-08-five-tabs':{scheduledFor:'2026-08-22T18:30:00.000Z',imagePath:'/social/aug-2026/07-five-tabs.jpg',caption:'Your marketing should not live in five separate tabs.\n\nNitro keeps your website, content, social scheduling, outreach, and analytics in one workspace—so the work and the results stay connected.\n\nStart free: nitrooutreach.com\n\n#smallbusinessmarketing #marketingtools #nitrooutreach'}
  ,'2026-08-visit-next':{scheduledFor:'2026-08-23T18:30:00.000Z',imagePath:'/social/aug-2026/08-visit-next.jpg',caption:'A website visit is only the start.\n\nNitro connects the page, the visitor signal, and the follow-up so a small business can see what happened and know what to do next.\n\nSee how it works: nitrooutreach.com\n\n#leadgeneration #websiteanalytics #smallbusiness'}
  ,'2026-08-start-real-job':{scheduledFor:'2026-08-24T18:30:00.000Z',imagePath:'/social/aug-2026/09-start-real-job.jpg',caption:'Start with one real part of your marketing.\n\nBuild a page, create this week’s content, or organize outreach in one workspace. Nitro has a $0 plan, no card, and no sales call.\n\nStart free: nitrooutreach.com\n\n#entrepreneurtools #smallbusinessgrowth #nitrooutreach'}
};
function clean(v,max=5000){return String(v||'').trim().slice(0,max)}
async function overrides(){let v=await kv.get(KEY);if(typeof v==='string'){try{v=JSON.parse(v)}catch{v={}}}return v&&typeof v==='object'?v:{}}
function owner(user){const email=String(user?.email||'').toLowerCase();return email&&email===String(process.env.OWNER_EMAIL||'nitrooutreach@outlook.com').toLowerCase()}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const user=await currentCustomer(req);if(!user){res.status(401).json({error:'Please sign in first.'});return}if(!owner(user)){res.status(403).json({error:'Owner access required.'});return}
  const ov=await overrides();
  if(req.method==='GET'){res.status(200).json({posts:Object.entries(POSTS).map(([id,p])=>({id,...p,...(ov[id]||{}),mediaUrl:`https://nitrooutreach.com${p.imagePath}`,mediaType:'image'}))});return}
  if(!sameOrigin(req)){res.status(403).json({error:'Invalid request origin'});return}
  const id=clean(req.body?.id,120);if(!POSTS[id]){res.status(404).json({error:'Campaign post not found.'});return}
  if(req.method==='PATCH'){
    const next={...(ov[id]||{})};
    if(req.body?.caption!==undefined){const caption=clean(req.body.caption,5000);if(!caption){res.status(400).json({error:'Caption cannot be empty.'});return}next.caption=caption}
    if(req.body?.scheduledFor!==undefined){const ts=Date.parse(req.body.scheduledFor);if(!Number.isFinite(ts)||ts<=Date.now()+60000){res.status(400).json({error:'Choose a future time.'});return}next.scheduledFor=new Date(ts).toISOString()}
    next.updatedAt=new Date().toISOString();next.cancelled=false;ov[id]=next;await kv.set(KEY,ov);res.status(200).json({ok:true,post:{id,...POSTS[id],...next}});return
  }
  if(req.method==='DELETE'){ov[id]={...(ov[id]||{}),cancelled:true,cancelledAt:new Date().toISOString()};await kv.set(KEY,ov);res.status(200).json({ok:true,cancelled:true});return}
  res.status(405).json({error:'Method not allowed'});
}

import fs from 'fs';
import path from 'path';
import { hasValidSession } from '../lib/auth.js';

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Nitro Outreach — Login</title>
<meta name="theme-color" content="#1c0f06"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Nitro"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/icon-192.png">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:'DM Sans',sans-serif;background:#060707;color:#f2f2f2;display:flex;align-items:center;justify-content:center;min-height:100vh;position:relative;overflow:hidden}
body:before,body:after{content:'';position:fixed;width:520px;height:520px;border-radius:44% 56% 62% 38%/46% 38% 62% 54%;filter:blur(72px);pointer-events:none;opacity:.2;animation:liquidFloat 14s ease-in-out infinite alternate}body:before{left:-180px;top:-160px;background:linear-gradient(135deg,#430804,#430804)}body:after{right:-220px;bottom:-190px;background:linear-gradient(135deg,#430804,#430804);animation-delay:-7s}@keyframes liquidFloat{to{transform:translate3d(70px,45px,0) rotate(24deg);border-radius:62% 38% 42% 58%/38% 59% 41% 62%}}
.card{position:relative;background:linear-gradient(145deg,rgba(34,37,35,.7),rgba(28,15,6,.54));border:1px solid rgba(67,8,4,.2);border-top-color:rgba(67,8,4,.75);border-radius:22px;padding:38px 34px 30px;width:min(390px,calc(100vw - 32px));text-align:left;box-shadow:0 32px 100px rgba(0,0,0,.54),inset 0 1px 0 rgba(255,255,255,.11),inset 0 -1px 0 rgba(67,8,4,.08);backdrop-filter:blur(26px) saturate(155%);-webkit-backdrop-filter:blur(26px) saturate(155%);overflow:hidden}
.card:before{content:'';position:absolute;inset:-1px;border-radius:inherit;background:linear-gradient(125deg,rgba(255,255,255,.12),transparent 28%,transparent 70%,rgba(67,8,4,.08));pointer-events:none}
h1{font-size:17px;letter-spacing:-.01em;margin:0 0 8px;color:#f5f6f5;font-weight:700;text-transform:none}
h1:first-letter{color:#eb9255}
p{margin:0 0 28px;font-size:13px;color:#777f7a}
input{width:100%;box-sizing:border-box;background:#151615;border:1px solid #282b29;border-radius:8px;color:#eff0ef;padding:13px 14px;font-size:14px;margin-bottom:14px;font-family:inherit;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:#430804;box-shadow:0 0 0 3px rgba(67,8,4,.1)}
button{width:100%;background:linear-gradient(120deg,#430804,#430804 52%,#430804);color:#eb9255;border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0;box-shadow:0 10px 30px rgba(67,8,4,.2),inset 0 1px 0 rgba(255,255,255,.45)}
button:disabled{opacity:.5;cursor:wait}
#err{color:#f87171;font-size:12.5px;min-height:18px;margin-top:12px}
</style></head><body>
<div class="card"><h1>&#9889; Nitro Outreach</h1><p>Enter your dashboard password</p>
<form id="f"><input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password"><button id="b" type="submit">Sign in</button><div id="err"></div></form></div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
e.preventDefault();var b=document.getElementById('b');b.disabled=true;document.getElementById('err').textContent='';
fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})})
.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
.then(function(x){if(x.ok){location.reload();}else{b.disabled=false;document.getElementById('err').textContent=x.d.error||'Login failed';}})
.catch(function(){b.disabled=false;document.getElementById('err').textContent='Network error';});
});
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}
</script></body></html>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  if (!hasValidSession(req)) {
    res.status(200).send(LOGIN_PAGE);
    return;
  }
  const file = path.join(process.cwd(), 'views', 'dashboard.html');
  const html = fs.readFileSync(file, 'utf8');
  res.status(200).send(html);
}

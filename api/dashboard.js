import fs from 'fs';
import path from 'path';
import { hasValidSession } from '../lib/auth.js';

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ascend Outreach — Login</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;font-family:'DM Sans',sans-serif;background:#050807;color:#f0f4f1;display:flex;align-items:center;justify-content:center;min-height:100vh;position:relative;overflow:hidden}
body:before,body:after{content:'';position:fixed;width:520px;height:520px;border-radius:44% 56% 62% 38%/46% 38% 62% 54%;filter:blur(72px);pointer-events:none;opacity:.2;animation:liquidFloat 14s ease-in-out infinite alternate}body:before{left:-180px;top:-160px;background:linear-gradient(135deg,#4ce59a,#20bfc1)}body:after{right:-220px;bottom:-190px;background:linear-gradient(135deg,#237e58,#5ed6ff);animation-delay:-7s}@keyframes liquidFloat{to{transform:translate3d(70px,45px,0) rotate(24deg);border-radius:62% 38% 42% 58%/38% 59% 41% 62%}}
.card{position:relative;background:linear-gradient(145deg,rgba(29,42,34,.7),rgba(7,14,11,.54));border:1px solid rgba(185,255,216,.2);border-top-color:rgba(141,255,190,.75);border-radius:22px;padding:38px 34px 30px;width:min(390px,calc(100vw - 32px));text-align:left;box-shadow:0 32px 100px rgba(0,0,0,.54),inset 0 1px 0 rgba(255,255,255,.11),inset 0 -1px 0 rgba(78,224,150,.08);backdrop-filter:blur(26px) saturate(155%);-webkit-backdrop-filter:blur(26px) saturate(155%);overflow:hidden}
.card:before{content:'';position:absolute;inset:-1px;border-radius:inherit;background:linear-gradient(125deg,rgba(255,255,255,.12),transparent 28%,transparent 70%,rgba(57,224,178,.08));pointer-events:none}
h1{font-size:17px;letter-spacing:-.01em;margin:0 0 8px;color:#f4f7f5;font-weight:700;text-transform:none}
h1:first-letter{color:#58dc8f}
p{margin:0 0 28px;font-size:13px;color:#777f7a}
input{width:100%;box-sizing:border-box;background:#141715;border:1px solid #272c29;border-radius:8px;color:#edf2ef;padding:13px 14px;font-size:14px;margin-bottom:14px;font-family:inherit;transition:border-color .15s,box-shadow .15s}
input:focus{outline:none;border-color:#58dc8f;box-shadow:0 0 0 3px rgba(88,220,143,.1)}
button{width:100%;background:linear-gradient(120deg,#53e49a,#a7f3bc 52%,#78e7dc);color:#07100a;border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0;box-shadow:0 10px 30px rgba(62,214,139,.2),inset 0 1px 0 rgba(255,255,255,.45)}
button:disabled{opacity:.5;cursor:wait}
#err{color:#f87171;font-size:12.5px;min-height:18px;margin-top:12px}
</style></head><body>
<div class="card"><h1>&#128640; Ascend Outreach</h1><p>Enter your dashboard password</p>
<form id="f"><input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password"><button id="b" type="submit">Sign in</button><div id="err"></div></form></div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
e.preventDefault();var b=document.getElementById('b');b.disabled=true;document.getElementById('err').textContent='';
fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})})
.then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d};});})
.then(function(x){if(x.ok){location.reload();}else{b.disabled=false;document.getElementById('err').textContent=x.d.error||'Login failed';}})
.catch(function(){b.disabled=false;document.getElementById('err').textContent='Network error';});
});
</script></body></html>`;

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  if (!hasValidSession(req)) {
    res.status(401).send(LOGIN_PAGE);
    return;
  }
  const file = path.join(process.cwd(), 'views', 'dashboard.html');
  const html = fs.readFileSync(file, 'utf8');
  res.status(200).send(html);
}

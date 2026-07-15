import fs from 'fs';
import path from 'path';
import { hasValidSession } from '../lib/auth.js';

const LOGIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ascend Outreach — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;800&display=swap" rel="stylesheet">
<style>
body{margin:0;font-family:'Barlow',sans-serif;background:#0b1213;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#101a1b;border:1px solid #1e2b2c;border-radius:14px;padding:36px 32px;width:320px;text-align:center}
h1{font-size:18px;letter-spacing:2px;margin:0 0 6px;color:#12fbfd;text-transform:uppercase;font-weight:800}
p{margin:0 0 22px;font-size:13px;color:#64748b}
input{width:100%;box-sizing:border-box;background:#0b1213;border:1px solid #1e2b2c;border-radius:8px;color:#e2e8f0;padding:12px 14px;font-size:14px;margin-bottom:14px;font-family:inherit}
input:focus{outline:none;border-color:#12fbfd}
button{width:100%;background:#12fbfd;color:#0b1213;border:none;border-radius:8px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:1px}
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

// (real photo variant) Find-holds-by-colour click-through on a synthetic wall with known holds. Usage: node tests/e2e_auto.mjs <baseUrl> <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = process.argv[2], out = process.argv[3] || '/tmp';
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9336', '--user-data-dir=/tmp/cdp-real', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9336/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
let fails = 0; const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: base + (process.env.PAGE || '/index.html') }); await sleep(1200);
await ev(`window.__errs=[];window.addEventListener('error',e=>__errs.push(e.message));1`);
const txt = (id) => ev(`document.getElementById('${id}').textContent`);
const vis = (id) => ev(`!document.getElementById('${id}').hidden`);
const click = (id) => ev(`document.getElementById('${id}').click()`);

const B64 = fs.readFileSync('/tmp/tochigi800.jpg').toString('base64');
await ev(`(async()=>{const bin=atob('${B64}');const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
 const f=new File([u],'wall.jpg',{type:'image/jpeg'});const dt=new DataTransfer();dt.items.add(f);const i=document.getElementById('photo');i.files=dt.files;i.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,1200));return 1})()`);
async function clickImg(ix, iy) {
  const r = await ev(`(()=>{const c=document.getElementById('wall');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height,cw:c.width,ch:c.height}})()`);
  const X = r.l + (ix * 0.75 / r.cw) * r.w, Y = r.t + (iy * 0.75 / r.ch) * r.h;
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: X, y: Y, button: 'left', clickCount: 1 });
  await sleep(60);
}
await clickImg(200, 500); await clickImg(600, 500); await click('setSizeGuess');
await clickImg(400, 950);
await click('autoFind'); await sleep(500);
const chips = await ev('[...document.querySelectorAll("#chips .chip")].map(c=>c.textContent).join(" | ")'); console.log('chips:', chips);
console.log('candidates', await ev('ClimbApp.state.cands.length'));
await ev(`document.getElementById('autoBox').scrollIntoView()`); await shot('real-1-chips');
await ev(`document.getElementById('wall').scrollIntoView({block:'center'})`); await shot('real-1b-rings');
// pick one colour (pink if present, else first)
const idx = await ev(`(()=>{const a=[...document.querySelectorAll("#chips .chip")];let i=a.findIndex(c=>/pink/i.test(c.textContent));return i<0?0:i})()`);
await ev(`document.querySelectorAll("#chips .chip")[${idx}].click()`);
console.log('route colour chip', idx, 'holds marked', await ev('ClimbApp.state.holds.length'));
await click('autoSE'); console.log('banner:', await txt('banner'));
await ev(`document.getElementById('wall').scrollIntoView({block:'center'})`); await shot('real-2-one-colour-marked');
await click('solve');
for (let i = 0; i < 400 && !(await vis('s-moves')) && !(await ev('!document.getElementById("diag").hidden')); i++) await sleep(250);
const res = JSON.parse(await ev('JSON.stringify(ClimbApp.state.result ? {ok:ClimbApp.state.result.ok, msg:ClimbApp.state.result.message, m:(ClimbApp.state.result.moves||[]).length, match:(ClimbApp.state.result.moves||[]).filter(m=>m.match).length, v:ClimbApp.state.result.verification&&ClimbApp.state.result.verification.ok, ms:ClimbApp.state.result.computeMs} : null)'));
console.log('result', JSON.stringify(res));
if (res && res.ok) { console.log('moves', await ev('JSON.stringify(ClimbApp.state.result.moves.map((m,i)=>i+":"+m.limb+(m.match?"*":"")))')); console.log((await ev(`document.getElementById('s-moves').innerText`)).slice(0,500)); let n=0; const mi = JSON.parse(await ev('JSON.stringify(ClimbApp.state.result.moves.findIndex(m=>m.match))')); for (let i=0;i<=mi;i++){ await click('next'); await sleep(300);} await sleep(3000); await shot('real-3-match-move'); n=1; console.log((await ev(`document.getElementById('moveTitle').textContent+' / '+document.getElementById('moveSub').textContent`)));
  console.log('match move captured:', n); await ev(`window.scrollTo(0,0)`); await shot('real-3-first-result'); }
else { await ev(`window.scrollTo(0,0)`); await shot('real-3-no-route'); }
console.log('errors', await ev('JSON.stringify(window.__errs)'));
chrome.kill(); process.exit(0);

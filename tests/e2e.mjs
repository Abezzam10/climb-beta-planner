// Click-through test via Chrome DevTools Protocol. Usage: node tests/e2e.mjs <baseUrl> <outDir>
// Uploads a synthetic 800x1200 "photo", calibrates with a 1 m ruler, sets ground, marks holds by real mouse clicks
// at phone size, checks coordinate mapping, solves, steps through, and saves screenshots.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = process.argv[2], out = process.argv[3] || '/tmp';
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', '--user-data-dir=/tmp/cdp-prof', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9333/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result.result.value; };
let fails = 0; const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: base + '/index.html' }); await sleep(1200);
const errors = []; await ev(`window.__errs=[];window.addEventListener('error',e=>__errs.push(e.message));window.prompt=()=> '100';1`);

// synthetic photo: 800x1200px = 200cm x 300cm (4 px per cm). Ruler: img (200,600)-(600,600) = 100cm.
const SAMPLE = await ev('JSON.stringify(SAMPLE_WALL.holds)'); const holds = JSON.parse(SAMPLE).map((h) => ({ ...h, x: h.x * 2 / 3, y: h.y * 2 / 3 }));
await ev(`(async()=>{
  const H=${JSON.stringify(holds)}; const c=document.createElement('canvas'); c.width=800;c.height=1200; const x=c.getContext('2d');
  x.fillStyle='#57534e';x.fillRect(0,0,800,1200); x.fillStyle='#292524';x.fillRect(0,1180,800,20);
  H.forEach(h=>{x.fillStyle='#e11d48';x.beginPath();x.arc(4*h.x,1200-4*h.y,16,0,7);x.fill();});
  x.fillStyle='#f0abfc';[[200,600],[600,600]].forEach(p=>{x.beginPath();x.arc(p[0],p[1],8,0,7);x.fill();});
  const blob=await new Promise(r=>c.toBlob(r,'image/png')); const f=new File([blob],'wall.png',{type:'image/png'});
  const dt=new DataTransfer(); dt.items.add(f); const i=document.getElementById('photo'); i.files=dt.files; i.dispatchEvent(new Event('change'));
  await new Promise(r=>setTimeout(r,800)); return 1;})()`);
const dims = await ev('({w:ClimbApp.state.img.width,h:ClimbApp.state.img.height,cw:document.getElementById("wall").width,ch:document.getElementById("wall").height})');
check(dims.w === 800 && dims.ch === 900, 'photo loaded; canvas resized to ' + dims.cw + 'x' + dims.ch);

async function clickImg(ix, iy) { // click at image px position
  const r = await ev(`(()=>{const c=document.getElementById('wall');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height}})()`);
  const X = r.l + (ix * 0.75) / 600 * r.w, Y = r.t + (iy * 0.75) / 900 * r.h;
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: X, y: Y, button: 'left', clickCount: 1 });
  await sleep(60);
}
const tool = (m) => ev(`document.querySelector('[data-mode="${m}"]').click()`);
await tool('calibrate'); await clickImg(200, 600); await clickImg(600, 600); await sleep(200);
const cm = await ev('ClimbApp.state.cmPerPx');
check(Math.abs(cm - 1 / 3) < 0.01, 'calibration cmPerPx=' + cm.toFixed(4) + ' (expected 0.3333) at phone width');
await tool('ground'); await clickImg(400, 1180);
const gy = await ev('ClimbApp.state.groundY'); check(Math.abs(gy - 5) < 1.5, 'ground line at ' + gy.toFixed(1) + ' cm (expected ~5)');
for (const k of ['start', 'top', 'hand', 'foot']) { await tool(k); for (const h of holds.filter((h) => h.kind === k)) await clickImg(4 * h.x, 1200 - 4 * h.y); }
const placed = await ev('JSON.stringify(ClimbApp.state.holds)'); const P = JSON.parse(placed);
check(P.length === 25, 'placed ' + P.length + ' holds by real clicks');
let maxErr = 0; for (const h of holds) { const m = P.filter((p) => p.kind === h.kind).map((p) => Math.hypot(p.x - h.x, p.y - h.y)); maxErr = Math.max(maxErr, Math.min(...m)); }
check(maxErr < 2.5, 'every placed hold within ' + maxErr.toFixed(2) + ' cm of its true position');
await shot('mobile-1-marked');
await ev(`document.getElementById('solve').click()`); await sleep(500);
const res = await ev('JSON.stringify({ok:ClimbApp.state.result.ok,m:ClimbApp.state.result.moves&&ClimbApp.state.result.moves.length,v:ClimbApp.state.result.verification,ms:ClimbApp.state.result.computeMs,msg:ClimbApp.state.result.message})');
const R = JSON.parse(res); console.log(res);
check(R.ok && R.v.ok, 'photo-flow route found and passes model re-check');
check(R.ms > 0.05, 'compute time measured in real time: ' + R.ms.toFixed(1) + ' ms');
if (R.ok) {
  await ev(`document.getElementById('next').click();document.getElementById('next').click();document.getElementById('next').click()`);
  await sleep(200); await ev(`document.getElementById('wall').scrollIntoView({block:'start'})`); await shot('mobile-2-step3');
  await ev(`document.getElementById('step').value=document.getElementById('step').max;document.getElementById('step').dispatchEvent(new Event('input'))`);
  await sleep(200); await shot('mobile-3-final');
}
// ground missing + no checkbox must block solving
await ev(`ClimbApp.state.groundY=null;document.getElementById('noGround').checked=false;document.getElementById('solve').click()`);
check((await ev('document.getElementById("status").textContent')).includes('ground'), 'solve blocked until ground is set or "no ground" ticked');
check((await ev('__errs.length')) === 0, 'no page script errors');
// desktop sample
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + '/index.html' }); await sleep(1000);
await ev(`document.getElementById('solve').click();for(let i=0;i<4;i++)document.getElementById('next').click();1`); await sleep(300); await shot('desktop-sample-step4');
console.log(fails ? 'FAILED ' + fails : 'ALL PASSED');
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);

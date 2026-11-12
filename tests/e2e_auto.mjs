// Find-holds-by-colour click-through on a synthetic wall with known holds. Usage: node tests/e2e_auto.mjs <baseUrl> <outDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const base = process.argv[2], out = process.argv[3] || '/tmp';
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9334', '--user-data-dir=/tmp/cdp-auto', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch {} await sleep(200); }
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
// synthetic wall 800x1200: blue wall, bolt dots, a mat strip, 14 holds in a zigzag (2 columns, 7 rows), plus 2 touching pairs of different colours
const COLS = ['#ec4899', '#f97316', '#eab308', '#22c55e', '#ef4444', '#f5f5f4', '#a855f7'];
const truth = []; for (let r = 0; r < 7; r++) for (let c = 0; c < 2; c++) truth.push({ x: c ? 560 : 240, y: 1060 - r * 150 + (c ? -40 : 0), col: COLS[(r * 2 + c) % 7], rad: 24 });
const extra = [{ x: 400, y: 640, col: '#f97316', rad: 22 }, { x: 436, y: 640, col: '#22c55e', rad: 22 }];
await ev(`(async()=>{
  const T=${JSON.stringify(truth.concat(extra))}; const c=document.createElement('canvas'); c.width=800;c.height=1200; const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,0,1200); g.addColorStop(0,'#3b9bfb'); g.addColorStop(1,'#1f6fd6'); x.fillStyle=g; x.fillRect(0,0,800,1200);
  x.fillStyle='#1d4ed8'; x.fillRect(0,1170,800,30);
  x.fillStyle='#0b2a5c'; for(let i=0;i<60;i++){x.beginPath();x.arc(30+(i*53)%740,40+(i*97)%1100,3,0,7);x.fill();}
  T.forEach(h=>{x.fillStyle=h.col;x.beginPath();x.ellipse(h.x,h.y,h.rad,h.rad*0.85,0,0,7);x.fill();});
  const blob=await new Promise(r=>c.toBlob(r,'image/png')); const f=new File([blob],'wall.png',{type:'image/png'});
  const dt=new DataTransfer(); dt.items.add(f); const i=document.getElementById('photo'); i.files=dt.files; i.dispatchEvent(new Event('change'));
  await new Promise(r=>setTimeout(r,800)); return 1;})()`);
async function clickImg(ix, iy) {
  const r = await ev(`(()=>{const c=document.getElementById('wall');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height,cw:c.width,ch:c.height}})()`);
  const X = r.l + (ix * 0.75 / r.cw) * r.w, Y = r.t + (iy * 0.75 / r.ch) * r.h;
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: X, y: Y, button: 'left', clickCount: 1 });
  await sleep(60);
}
check(await vis('s-setup'), 'photo opens the guided setup');
await clickImg(200, 600); await clickImg(600, 600); await click('setSizeGuess');
check((await txt('banner')).includes('Step 3 of 4'), 'floor step');
await clickImg(400, 1160);
check(await vis('autoBox') && await vis('autoFind'), 'Find holds by colour is offered in the holds step');
check(!(await vis('chips')), 'no colour chips before searching');
await click('autoFind'); await sleep(300);
const C = JSON.parse(await ev('JSON.stringify(ClimbApp.state.cands.map(c=>({x:c.x,y:c.y,color:c.color})))'));
// canvas is 600 wide for an 800 wide image: scale 0.75
const all = truth.concat(extra); let hit = 0; const used = new Set();
for (const t of all) { const k = C.findIndex((c, i) => !used.has(i) && Math.hypot(c.x - t.x * 0.75, c.y - t.y * 0.75) < 9); if (k >= 0) { hit++; used.add(k); } }
const fp = C.length - used.size;
check(hit / all.length >= 0.9, `found ${hit} of ${all.length} drawn holds (touching pair included), ${fp} extra marks (bolts, mat or wall edge)`);
check(fp <= 3, 'extra marks at most 3: ' + fp);
check(await vis('chips') && (await ev('document.querySelectorAll("#chips .chip").length')) >= 5, 'colour chips shown: ' + (await ev('[...document.querySelectorAll("#chips .chip")].map(c=>c.textContent).join(", ")')));
check((await txt('autoNote')).includes('only suggestions'), 'note says these are suggestions from colour, not a trained model');
await ev(`window.scrollTo(0,0)`); await shot('auto-1-suggestions');
const before = await ev('ClimbApp.state.holds.length');
await ev(`document.querySelector("#chips .chip").click()`);
const one = await ev('ClimbApp.state.holds.length'); check(one > before, 'tapping one colour adds its holds (' + one + ')');
await ev(`document.querySelector("#chips .chip").click()`);
check((await ev('ClimbApp.state.holds.length')) === before, 'tapping that colour again removes them');
for (let i = 0; i < 12; i++) { const n = await ev('document.querySelectorAll("#chips .chip").length'); if (i >= n) break; if ((await ev(`document.querySelectorAll("#chips .chip")[${i}].getAttribute("aria-pressed")`)) !== 'true') await ev(`document.querySelectorAll("#chips .chip")[${i}].click()`); }
const nh = await ev('ClimbApp.state.holds.length'); check(nh === C.length, 'all colours on: ' + nh + ' holds marked without tapping each one');
check(await vis('autoSE'), 'Suggest Start and Finish offered');
await click('autoSE');
const kinds = JSON.parse(await ev('JSON.stringify(ClimbApp.state.holds.map(h=>h.kind))'));
check(kinds.filter((k) => k === 'start').length === 2 && kinds.filter((k) => k === 'top').length === 1, 'two Start and one Finish suggested');
check((await txt('banner')).includes('That is a guess'), 'banner says the Start/Finish choice is a guess');
// change one by hand: pick Finish, tap another hold -> it becomes the only Finish
const hh = JSON.parse(await ev('JSON.stringify(ClimbApp.state.holds.filter(h=>h.kind==="hand")[0])')); const px = await ev(`JSON.stringify(ClimbApp.cm2px(${JSON.stringify(hh)}))`); const q = JSON.parse(px);
await ev(`document.querySelector('.kind[data-mode="top"]').click()`); await clickImg(q.x, q.y);
const k2 = JSON.parse(await ev('JSON.stringify(ClimbApp.state.holds.map(h=>h.kind))')); check(k2.filter((k) => k === 'top').length === 1 && k2.length === nh, 'tapping a marked hold in Finish mode moves the Finish there, no duplicate hold');
await ev(`window.scrollTo(0,0)`); await shot('auto-2-marked');
await click('solve');
for (let i = 0; i < 600 && !(await vis('s-moves')) && !(await ev('!!document.getElementById("diag") && !document.getElementById("diag").hidden')); i++) await sleep(250);
const res = JSON.parse(await ev('JSON.stringify(ClimbApp.state.result ? {ok:ClimbApp.state.result.ok, m:(ClimbApp.state.result.moves||[]).length, v:ClimbApp.state.result.verification&&ClimbApp.state.result.verification.ok, ms:ClimbApp.state.result.computeMs} : null)'));
check(res && (res.ok ? res.v : true), 'solver answered with ' + nh + ' marked holds: ' + JSON.stringify(res));
const errs = await ev('JSON.stringify(window.__errs)'); check(errs === '[]', 'no page script errors ' + errs);
await shot('auto-3-result');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); chrome.kill(); process.exit(fails ? 1 : 0);

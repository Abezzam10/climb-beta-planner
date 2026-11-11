// Click-through test via Chrome DevTools Protocol. Usage: node tests/e2e.mjs <baseUrl> <outDir>
const NATIVE_COST = 17.78436262817976;
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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64')); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: base + (process.env.PAGE || '/index.html') }); await sleep(1200);


async function checkAllLabels(tag) {
  const total = await ev('ClimbApp.state.result.moves.length'); let bad = [], n = 0;
  await ev(`ClimbApp.state.step=0;document.getElementById('prev').click()`);
  for (let s = 0; s <= total + 1; s++) {
    await ev(`(()=>{while(ClimbApp.state.step>0)document.getElementById('prev').click();for(let i=0;i<${s};i++)document.getElementById('next').click();})()`);
    for (const t of [0, 0.35, 0.7, 1]) {
      await ev(`ClimbApp.setAnimT(${t})`);
      const L = JSON.parse(await ev('JSON.stringify({labels:ClimbApp.state.labels,obs:ClimbApp.state.labelObstacles,w:document.getElementById("wall2").width,h:document.getElementById("wall2").height,title:document.getElementById("moveTitle").textContent})'));
      n++;
      const names = L.labels.map((l) => l.text).join('|');
      for (let i = 0; i < L.labels.length; i++) {
        const a = L.labels[i];
        if (a.l < 0 || a.t < 0 || a.r > L.w || a.b > L.h) bad.push(`step ${s} t=${t}: "${a.text}" outside canvas`);
        for (let j = i + 1; j < L.labels.length; j++) { const b = L.labels[j]; if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) bad.push(`step ${s} t=${t}: "${a.text}" overlaps "${b.text}"`); }
        for (const o of L.obs) if (a.l < o.r && a.r > o.l && a.t < o.b && a.b > o.t) bad.push(`step ${s} t=${t}: "${a.text}" covers a body end/head/target`);
      }
      const hands = /Both hands/.test(names) || (/Left hand/.test(names) && /Right hand/.test(names)), feet = /Both feet/.test(names) || (/Left foot/.test(names) && /Right foot/.test(names));
      if (!(hands && feet)) bad.push(`step ${s} t=${t}: not all four body parts labelled: ${names}`);
      if (s >= 1 && s <= total && !/ here/.test(names)) bad.push(`step ${s} t=${t}: no "<part> here" target label`);
    }
  }
  check(bad.length === 0, `${tag}: labels on ${n} step/frame combos - all four parts named, target says the exact part, no overlaps, none covering ends/head/ring` + (bad.length ? ' | ' + bad.slice(0, 6).join('; ') : ''));
}

await ev(`window.__errs=[];window.addEventListener('error',e=>__errs.push(e.message));1`);
const txt = (id) => ev(`document.getElementById('${id}').textContent`);
const vis = (id) => ev(`!document.getElementById('${id}').hidden`);
const click = (id) => ev(`document.getElementById('${id}').click()`);
const waitResult = async () => { for (let i = 0; i < 600 && !(await ev('!!ClimbApp.state.result')); i++) await sleep(250); };
check(await vis('s-home') && !(await vis('s-setup')), 'home screen shown first, with simple welcome');
check(!/\b(LH|RH|LF|RF)\b/.test(await ev('document.body.innerText')), 'no LH/RH/LF/RF codes anywhere on home');
await shot('1-home');

// ---- photo flow ----
const SAMPLE = await ev('JSON.stringify(SAMPLE_WALL.holds)'); const holds = JSON.parse(SAMPLE).map((h) => ({ ...h, x: h.x * 2 / 3, y: h.y * 2 / 3 }));
await ev(`(async()=>{
  const H=${JSON.stringify(holds)}; const c=document.createElement('canvas'); c.width=800;c.height=1200; const x=c.getContext('2d');
  x.fillStyle='#57534e';x.fillRect(0,0,800,1200); x.fillStyle='#292524';x.fillRect(0,1180,800,20);
  H.forEach(h=>{x.fillStyle='#e11d48';x.beginPath();x.arc(4*h.x,1200-4*h.y,16,0,7);x.fill();});
  x.fillStyle='#f0abfc';[[200,600],[600,600]].forEach(p=>{x.beginPath();x.arc(p[0],p[1],8,0,7);x.fill();});
  const blob=await new Promise(r=>c.toBlob(r,'image/png')); const f=new File([blob],'wall.png',{type:'image/png'});
  const dt=new DataTransfer(); dt.items.add(f); const i=document.getElementById('photo'); i.files=dt.files; i.dispatchEvent(new Event('change'));
  await new Promise(r=>setTimeout(r,800)); return 1;})()`);
check(await vis('s-setup'), 'photo upload opens the guided setup');
check((await txt('banner')).includes('Step 2 of 4'), 'banner tells what to do: ' + (await txt('banner')).slice(0, 80));
async function clickImg(ix, iy) {
  const r = await ev(`(()=>{const c=document.getElementById('wall');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height}})()`);
  const X = r.l + ix / 600 * 0.75 * r.w * (600 / 600), Y = r.t + (iy * 0.75) / 900 * r.h;
  for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: X, y: Y, button: 'left', clickCount: 1 });
  await sleep(60);
}
await clickImg(200, 600); await clickImg(600, 600);
check(await vis('sizeBox'), 'after two taps, the "how long is the line" box appears');
await shot('2-size');
await click('setSize');
const cm = await ev('ClimbApp.state.cmPerPx'); check(Math.abs(cm - 1 / 3) < 0.01, 'size set, cmPerPx=' + cm.toFixed(4));
check((await txt('banner')).includes('Step 3 of 4') && await vis('floorBox'), 'floor step shown');
await clickImg(400, 1180);
const gy = await ev('ClimbApp.state.groundY'); check(Math.abs(gy - 5) < 1.5, 'floor tapped at ' + gy.toFixed(1) + ' cm');
check(await vis('holdBox') && !(await vis('solve')), 'hold buttons shown; Find my moves hidden until start+finish marked');
for (const k of ['start', 'top', 'hand', 'foot']) { await ev(`document.querySelector('.kind[data-mode="${k}"]').click()`); for (const h of holds.filter((h) => h.kind === k)) await clickImg(4 * h.x, 1200 - 4 * h.y); }
const P = JSON.parse(await ev('JSON.stringify(ClimbApp.state.holds)'));
check(P.length === 25, 'placed ' + P.length + ' holds by real taps');
let maxErr = 0; for (const h of holds) { const m = P.filter((p) => p.kind === h.kind).map((p) => Math.hypot(p.x - h.x, p.y - h.y)); maxErr = Math.max(maxErr, Math.min(...m)); }
check(maxErr < 2.5, 'every placed hold within ' + maxErr.toFixed(2) + ' cm of its true position');
check(await vis('solve'), 'Find my moves now shown');
await ev(`window.scrollTo(0,0)`); await shot('3-holds');
await click('solve');
await sleep(300); check(await vis('busy'), 'loading message shown while the Python helper works: ' + JSON.stringify((await txt('busyText')).slice(0, 70)));
await shot('4-loading');
for (let i = 0; i < 600 && !(await vis('s-moves')); i++) await sleep(250);
check(await vis('s-moves'), 'moves screen shown');
const R = JSON.parse(await ev('JSON.stringify({ok:ClimbApp.state.result.ok,m:ClimbApp.state.result.moves.length,v:ClimbApp.state.result.verification.ok,ms:ClimbApp.state.result.computeMs})'));
check(R.ok && R.v, 'photo-flow route: ' + R.m + ' moves, passes model re-check, solved in ' + R.ms.toFixed(0) + ' ms');
check((await txt('count')) === 'Before you start', 'starts at "Before you start"'); await shot('5-start');
check(await ev('document.getElementById("prev").disabled'), 'Back disabled at the start');
// Next to move 1: check text and animation
await click('next'); await sleep(250);
const mid = await ev('ClimbApp.state.animT'); check(mid > 0 && mid < 1, 'animation is running right after Next (t=' + mid.toFixed(2) + ')');
await shot('6-move1-mid');
await click('next'); const stepNow = await ev('ClimbApp.state.step'); check(stepNow === 2, 'Next works immediately without waiting for the animation');
await ev('ClimbApp.finishAnim()'); await ev(`window.scrollTo(0,0)`);
const title = await txt('moveTitle'), sub = await txt('moveSub'); console.log('TITLE:', title, '| SUB:', sub);
check(/^Suggested: (left|right) (hand|foot) to /.test(title), 'plain move sentence');
check(!/\b(LH|RH|LF|RF)\b/.test(await ev('document.body.innerText')), 'no limb codes on the moves screen');
await shot('7-move2-end');
await click('replay'); await sleep(250); check((await ev('ClimbApp.state.animT')) < 1, 'Replay plays the move again');
await ev('ClimbApp.finishAnim()');
await click('prev'); check((await ev('ClimbApp.state.step')) === 1, 'Back goes to move 1');
// jump to the last move
for (let i = 0; i < 50 && (await ev('ClimbApp.state.step')) < R.m; i++) await click('next');
await ev('ClimbApp.finishAnim()'); check((await txt('count')) === 'Move ' + R.m + ' of ' + R.m, 'reached the last move'); check((await txt('next')).includes('Finish'), 'last move button says Finish'); await shot('8-last');
await click('next'); await ev('ClimbApp.finishAnim()'); check((await txt('count')) === 'All done' && (await ev('document.getElementById("next").disabled')), 'finish screen shown'); await shot('8b-finished'); await click('prev'); check((await ev('ClimbApp.state.step')) === R.m, 'Back from finish returns to last move');
await checkAllLabels('photo flow (phone)');
await ev(`document.querySelector('details.more:not(.about) summary').click()`); await ev(`document.getElementById('details').scrollIntoView()`); await shot('9-details');
check((await ev('__errs.length')) === 0, 'no page script errors');

// ---- reduced motion ----
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await click('prev'); await sleep(100);
check((await ev('ClimbApp.state.animT')) === 1 && (await ev('ClimbApp.state.animDone')), 'reduced motion: move shown instantly, no animation');
await send('Emulation.setEmulatedMedia', { features: [] });

// ---- sample on desktop ----
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: base + (process.env.PAGE || '/index.html') }); await sleep(1200);
await click('loadSample'); check((await txt('banner')).includes('Sample wall') && await vis('solve'), 'sample wall ready');
await click('solve'); await waitResult(); await sleep(500);
const S = JSON.parse(await ev('JSON.stringify({ok:ClimbApp.state.result.ok,cost:ClimbApp.state.result.cost,m:ClimbApp.state.result.moves.length})'));
check(S.ok && Math.abs(S.cost - NATIVE_COST) < 1e-6, "sample cost matches native Python (new stance rules): " + S.cost);
await checkAllLabels('sample wall (desktop)');
await ev('(()=>{while(ClimbApp.state.step>0)document.getElementById("prev").click();})()'); for (let i = 0; i < 7; i++) await click('next'); await ev('ClimbApp.finishAnim()'); await sleep(200); await shot('10-desktop-move7');
console.log(fails ? 'FAILED ' + fails : 'ALL PASSED');
ws.close(); chrome.kill(); process.exit(fails ? 1 : 0);

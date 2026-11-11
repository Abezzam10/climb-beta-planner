/* Climb Move Helper UI. All in the browser. The solver is Python (physics_solver.py) run through Pyodide in a Web Worker. */
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $('wall'), ctx = cv.getContext('2d'), cv2 = $('wall2'), ctx2 = cv2.getContext('2d');
  const KIND = { start: '#22c55e', top: '#ef4444', hand: '#38bdf8', foot: '#fbbf24' };
  const LIMBS = ['LH', 'RH', 'LF', 'RF'];
  const LIMB_WORD = { LH: 'left hand', RH: 'right hand', LF: 'left foot', RF: 'right foot' };
  const ORANGE = '#fb923c';
  // y in cm is measured UP from the bottom edge of the picture. groundY is the floor height on the same axis.
  const state = { img: null, cmPerPx: null, groundY: null, noGround: false, holds: [], mode: null, calib: [], phase: 'home',
                  result: null, step: 0, sample: false, animDone: true, animT: 1 };
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toCm = (v, u) => (u === 'in' ? v * 2.54 : v);
  const profile = () => ({
    heightCm: toCm(+$('height').value, $('heightUnit').value),
    wingspanCm: toCm(+$('span').value, $('spanUnit').value),
    dominantHand: $('dominant').value,
    style: $('allowStretch').checked ? 'dynamic' : 'static',
  });
  const px2cm = (p) => ({ x: p.x * state.cmPerPx, y: (cv.height - p.y) * state.cmPerPx });
  const cm2px = (p) => ({ x: p.x / state.cmPerPx, y: cv.height - p.y / state.cmPerPx });
  const fmtMs = (ms) => (ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s');

  function show(screen) {
    ['home', 'setup', 'moves'].forEach((s) => { $('s-' + s).hidden = s !== screen; });
    window.scrollTo(0, 0);
  }
  function banner(title, text) { $('banner').innerHTML = ''; const b = document.createElement('b'); b.textContent = title; $('banner').append(b, document.createTextNode(text)); }
  function busy(text) { if (text) { $('busyText').textContent = text; $('busy').hidden = false; } else $('busy').hidden = true; }

  /* ---------- drawing: shared base ---------- */
  function drawBase(c, x, dim) {
    x.clearRect(0, 0, c.width, c.height);
    if (state.img) x.drawImage(state.img, 0, 0, c.width, c.height);
    else if (state.sample) {
      const g = x.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, '#44403c'); g.addColorStop(1, '#292524');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      x.strokeStyle = '#57534e'; x.lineWidth = 2;
      for (let y = 0; y <= c.height; y += 150) { x.beginPath(); x.moveTo(0, y); x.lineTo(c.width, y); x.stroke(); }
      x.beginPath(); x.moveTo(c.width / 2, 0); x.lineTo(c.width / 2, c.height); x.stroke();
    } else { x.fillStyle = '#0c0a09'; x.fillRect(0, 0, c.width, c.height); }
    if (dim) { x.fillStyle = 'rgba(0,0,0,' + dim + ')'; x.fillRect(0, 0, c.width, c.height); }
  }
  function drawFloor(x, c) {
    if (!state.cmPerPx || state.groundY === null) return;
    const y = cm2px({ x: 0, y: state.groundY }).y;
    x.strokeStyle = '#4ade80'; x.lineWidth = 3; x.setLineDash([10, 7]); x.beginPath(); x.moveTo(0, y); x.lineTo(c.width, y); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#4ade80'; x.font = 'bold 18px sans-serif'; x.textAlign = 'left'; x.fillText('floor', 8, y - 8);
  }

  /* ---------- setup screen drawing ---------- */
  function drawSetup() {
    drawBase(cv, ctx, 0);
    ctx.fillStyle = ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 3;
    state.calib.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fill(); });
    if (state.calib.length === 2) { ctx.beginPath(); ctx.moveTo(state.calib[0].x, state.calib[0].y); ctx.lineTo(state.calib[1].x, state.calib[1].y); ctx.stroke(); }
    if (!state.cmPerPx) return;
    drawFloor(ctx, cv);
    state.holds.forEach((h) => {
      const p = cm2px(h);
      ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, 7); ctx.fillStyle = KIND[h.kind]; ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke();
    });
  }

  /* ---------- words for places and moves ---------- */
  function where(p) {
    const W = cv.width * state.cmPerPx, H = cv.height * state.cmPerPx;
    const row = p.y / H < 0.34 ? 'low down' : p.y / H < 0.67 ? 'about halfway up' : 'high up';
    const col = p.x / W < 0.34 ? 'on the left' : p.x / W < 0.67 ? 'in the middle' : 'on the right';
    return 'the hold ' + row + ', ' + col;
  }
  function holdPos(r, id) {
    if (id === 'ground') return { x: r.groundX, y: state.groundY };
    const h = state.holds.find((x) => x.id === id); return { x: h.x, y: h.y };
  }
  const whereId = (r, id) => (id === 'ground' ? 'the ground' : where(holdPos(r, id)));

  /* ---------- the figure and the move animation ---------- */
  function poseAt(r, step) { // pose after "step" moves
    if (step === 0) return { state: r.start.state, hip: r.start.hip };
    const m = r.moves[step - 1]; return { state: m.state, hip: m.hip };
  }
  const NAMES = ['Left hand', 'Right hand', 'Left foot', 'Right foot'];
  function figure(x, r, hip, ends, movingIdx) {
    const sh = cm2px({ x: hip.x, y: hip.y + r.body.shoulderUp }), hp = cm2px(hip);
    const headC = cm2px({ x: hip.x, y: hip.y + r.body.shoulderUp + r.body.height * 0.09 });
    const headR = Math.max(10, r.body.height * 0.05 / state.cmPerPx);
    x.lineCap = 'round'; x.lineJoin = 'round';
    ends.forEach((e, k) => {
      const t = cm2px(e), from = k < 2 ? sh : hp, mv = k === movingIdx;
      x.strokeStyle = mv ? ORANGE : 'rgba(255,255,255,.85)'; x.lineWidth = mv ? 9 : 5;
      x.beginPath(); x.moveTo(from.x, from.y); x.lineTo(t.x, t.y); x.stroke();
    });
    x.strokeStyle = '#fff'; x.lineWidth = 11; x.beginPath(); x.moveTo(hp.x, hp.y); x.lineTo(sh.x, sh.y); x.stroke();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(headC.x, headC.y, headR, 0, 7); x.fill();
    // joints: shoulder and hip
    [sh, hp].forEach((p) => { x.beginPath(); x.arc(p.x, p.y, 6, 0, 7); x.fillStyle = '#d6d3d1'; x.fill(); });
    // endpoints: hands are circles, feet are squares
    ends.forEach((e, k) => {
      const t = cm2px(e), mv = k === movingIdx, s = mv ? 11 : 9;
      x.fillStyle = mv ? ORANGE : '#fff'; x.strokeStyle = '#000'; x.lineWidth = 2.5; x.beginPath();
      if (k < 2) x.arc(t.x, t.y, s, 0, 7); else x.rect(t.x - s, t.y - s, 2 * s, 2 * s);
      x.fill(); x.stroke();
    });
    return { head: { x: headC.x, y: headC.y, r: headR }, ends: ends.map(cm2px) };
  }
  // Place word labels next to their anchors without overlapping each other, the figure ends, the head or the target ring.
  function layoutLabels(x, c, items, obstacles) {
    const placed = [], out = [];
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    items.forEach((it) => {
      x.font = 'bold ' + it.fs + 'px system-ui,sans-serif';
      const w = x.measureText(it.text).width + 18, h = it.fs + 10;
      const up = it.pref === 'up', ang = up ? [-90, -50, -130, -10, -170, 30, 150, 90] : [90, 50, 130, 10, 170, -30, -150, -90];
      let best = null;
      search: for (const extra of [0, 22, 48, 80]) for (const a of ang) {
        const rad = a * Math.PI / 180, cx = it.ax + Math.cos(rad) * (w / 2 + (it.gap || 16) + extra), cy = it.ay + Math.sin(rad) * (h / 2 + (it.gap || 16) + extra);
        const rc = { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
        if (rc.l < 4 || rc.r > c.width - 4 || rc.t < 4 || rc.b > c.height - 4) continue;
        if (placed.some((p) => hit(rc, p)) || obstacles.some((o) => hit(rc, o))) continue;
        best = rc; break search;
      }
      if (!best) { // nothing free nearby: scan the whole picture for the nearest free spot
        let bd = 1e9;
        for (let gy = h / 2 + 4; gy <= c.height - h / 2 - 4; gy += 12) for (let gx = w / 2 + 4; gx <= c.width - w / 2 - 4; gx += 12) {
          const rc = { l: gx - w / 2, r: gx + w / 2, t: gy - h / 2, b: gy + h / 2 };
          if (placed.some((p) => hit(rc, p)) || obstacles.some((o) => hit(rc, o))) continue;
          const d = Math.hypot(gx - it.ax, gy - it.ay); if (d < bd) { bd = d; best = rc; }
        }
      }
      if (!best) { const cx = Math.min(Math.max(it.ax, w / 2 + 4), c.width - w / 2 - 4), cy = Math.min(Math.max(it.ay + (up ? -48 : 48), h / 2 + 4), c.height - h / 2 - 4); best = { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 }; }
      placed.push(best); out.push({ it, rc: best });
    });
    out.forEach(({ it, rc }) => {
      const cx = (rc.l + rc.r) / 2, cy = (rc.t + rc.b) / 2;
      x.strokeStyle = it.moving ? ORANGE : 'rgba(255,255,255,.7)'; x.lineWidth = 2; x.beginPath(); x.moveTo(it.ax, it.ay); x.lineTo(cx, cy); x.stroke();
      x.fillStyle = it.moving ? ORANGE : '#f5f5f4'; x.beginPath(); x.roundRect ? x.roundRect(rc.l, rc.t, rc.r - rc.l, rc.b - rc.t, 9) : x.rect(rc.l, rc.t, rc.r - rc.l, rc.b - rc.t); x.fill();
      x.fillStyle = '#1c1917'; x.font = 'bold ' + it.fs + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.fillText(it.text, cx, rc.b - 6);
    });
    return out.map(({ it, rc }) => ({ text: it.text, ...rc }));
  }
  function drawMoves() {
    const r = state.result; if (!r || !r.ok) return;
    drawBase(cv2, ctx2, 0.4); drawFloor(ctx2, cv2);
    state.holds.forEach((h) => { const p = cm2px(h); ctx2.beginPath(); ctx2.arc(p.x, p.y, h.kind === 'top' ? 11 : 7, 0, 7); ctx2.fillStyle = h.kind === 'top' ? '#ef4444' : 'rgba(255,255,255,.5)'; ctx2.fill();
      if (h.kind === 'top') { ctx2.fillStyle = '#fecaca'; ctx2.font = 'bold 17px sans-serif'; const right = p.x < cv2.width - 110; ctx2.textAlign = right ? 'left' : 'right'; ctx2.fillText('FINISH', p.x + (right ? 30 : -30), p.y + 6); } });
    const total = r.moves.length, fin = state.step > total, n = Math.min(state.step, total), e = fin ? 1 : state.animT;
    const cur = poseAt(r, n); let hip = cur.hip, ends = cur.state.map((id) => holdPos(r, id)), mi = -1, m = null, ring = null;
    if (n >= 1 && !fin) {
      m = r.moves[n - 1]; const prev = poseAt(r, n - 1); mi = LIMBS.indexOf(m.limb);
      hip = { x: prev.hip.x + (cur.hip.x - prev.hip.x) * e, y: prev.hip.y + (cur.hip.y - prev.hip.y) * e };
      ends = cur.state.map((id, k) => (k === mi ? { x: m.from.x + (m.to.x - m.from.x) * e, y: m.from.y + (m.to.y - m.from.y) * e } : holdPos(r, id)));
      const a = cm2px(m.from), b = cm2px(m.to); ring = b;
      ctx2.setLineDash([9, 8]); ctx2.strokeStyle = 'rgba(251,146,60,.9)'; ctx2.lineWidth = 4; ctx2.beginPath(); ctx2.moveTo(a.x, a.y); ctx2.lineTo(b.x, b.y); ctx2.stroke(); ctx2.setLineDash([]);
      ctx2.beginPath(); ctx2.arc(a.x, a.y, 17, 0, 7); ctx2.strokeStyle = '#a8a29e'; ctx2.lineWidth = 4; ctx2.stroke();
      ctx2.beginPath(); ctx2.arc(b.x, b.y, 26, 0, 7); ctx2.strokeStyle = ORANGE; ctx2.lineWidth = 6; ctx2.stroke();
    }
    const fg = figure(ctx2, r, hip, ends, mi);
    // labels: target first, then the moving part (while moving), then the other three, so none are hidden or overlapped
    const box = (p, s) => ({ l: p.x - s, r: p.x + s, t: p.y - s, b: p.y + s });
    const obstacles = [box({ x: fg.head.x, y: fg.head.y }, fg.head.r + 4)].concat(fg.ends.map((p) => box(p, 16)));
    if (ring) obstacles.push(box(ring, 30));
    const st = cur.state, items = [];
    if (ring) items.push({ text: NAMES[mi] + ' here', ax: ring.x, ay: ring.y, fs: 30, pref: 'up', moving: true, gap: 28 });
    if (ring && state.animT < 1) items.push({ text: NAMES[mi], ax: fg.ends[mi].x, ay: fg.ends[mi].y, fs: 28, pref: mi < 2 ? 'up' : 'down', moving: true });
    [0, 1, 2, 3].forEach((k) => {
      if (k === mi) return;
      const pair = k < 2 ? 0 : 2, other = k % 2 === 0 ? k + 1 : k - 1;
      if (st[pair] === st[pair + 1] && other !== mi) { if (k % 2 === 1) return; items.push({ text: pair === 0 ? 'Both hands' : 'Both feet', ax: fg.ends[k].x, ay: fg.ends[k].y, fs: 28, pref: pair === 0 ? 'up' : 'down' }); return; }
      items.push({ text: NAMES[k], ax: fg.ends[k].x, ay: fg.ends[k].y, fs: 28, pref: k < 2 ? 'up' : 'down' });
    });
    state.labels = layoutLabels(ctx2, cv2, items, obstacles);
    state.labelObstacles = obstacles;
  }
  let raf = 0;
  function playAnim() {
    cancelAnimationFrame(raf); state.animDone = false;
    if (reduceMotion() || state.step === 0) { state.animT = 1; state.animDone = true; drawMoves(); return; }
    const t0 = performance.now(), dur = 1100; state.animT = 0;
    const tick = (now) => { state.animT = Math.min(1, (now - t0) / dur); drawMoves(); if (state.animT < 1) raf = requestAnimationFrame(tick); else state.animDone = true; };
    raf = requestAnimationFrame(tick);
  }
  function finishAnim() { cancelAnimationFrame(raf); state.animT = 1; state.animDone = true; drawMoves(); }

  /* ---------- moves screen text ---------- */
  function showStep() {
    const r = state.result, total = r.moves.length, n = state.step, fin = n > total;
    $('count').textContent = fin ? 'All done' : n === 0 ? 'Before you start' : 'Move ' + n + ' of ' + total;
    $('prev').disabled = n === 0; $('next').disabled = fin; $('replay').disabled = n === 0 || fin;
    $('next').textContent = n === total ? 'Finish \u2192' : n === 0 ? 'Start \u2192' : 'Next \u2192';
    const warn = $('warnLine'); warn.hidden = true;
    if (fin) {
      $('moveTitle').textContent = 'That is the whole suggestion';
      $('moveSub').textContent = 'It ends with a hand on the finish hold. This is only a guess from a simple model. Use your own judgment.';
    } else if (n === 0) {
      $('moveTitle').textContent = 'The suggested start';
      $('moveSub').textContent = 'The figure shows where the model puts its hands and feet. Tap Start to see the first suggested move.';
    } else {
      const m = r.moves[n - 1], w = LIMB_WORD[m.limb];
      $('moveTitle').textContent = m.toHold === 'ground' ? 'Suggested: ' + w + ' to the ground' : 'Suggested: ' + w + ' to this hold';
      $('moveSub').textContent = 'Only the orange ' + w + ' moves in this picture. The ring is ' + whereId(r, m.toHold) + '.' + (n === total ? ' This is the last suggested move.' : '');
      if (m.dynamic) { warn.hidden = false; warn.textContent = 'This one is a long stretch. Be careful with it.'; }
    }
    renderDetails();
    playAnim();
  }
  function renderDetails() {
    const r = state.result, v = r.verification, d = $('details'); d.innerHTML = '';
    const rows = r.moves.map((m, i) => '<tr class="' + (i + 1 === state.step ? 'cur' : '') + '"><td>' + m.step + '</td><td>' + LIMB_WORD[m.limb] + '</td><td>' + (m.toHold === 'ground' ? 'the ground' : where(holdPos(r, m.toHold)).replace('the hold ', '')) + '</td><td>' + (m.dynamic ? 'long stretch' : 'normal') + '</td></tr>');
    d.innerHTML = '<div class="stats"><div><span class="hint">Moves</span><b>' + r.moves.length + '</b></div><div><span class="hint">Rough balance score (0 to 100)</span><b>' + r.balanceScore + '</b></div>' +
      '<div><span class="hint">Time to work it out</span><b>' + fmtMs(r.computeMs) + '</b></div><div><span class="hint">Helper start-up</span><b>' + (r.loadMs ? fmtMs(r.loadMs) : '-') + '</b></div></div>' +
      '<p class="hint">The route follows the simple rules in "About this project" (' + v.checkedPoses + ' poses re-checked, ' + (v.ok ? 'all passed' : 'SOME FAILED') + '). That does not mean it is possible or safe. It is not the best route, only one that fits the rules.</p>' +
      '<table class="moves"><tr><th>#</th><th>Move</th><th>To</th><th>Type</th></tr>' + rows.join('') + '</table>';
  }

  /* ---------- setup flow ---------- */
  const STEPS = ['Photo', 'Size', 'Floor', 'Holds'];
  function setPhase(p) {
    state.phase = p;
    const idx = { size: 1, floor: 2, holds: 3, ready: 4 }[p]; // steps done before
    $('stepsBar').innerHTML = STEPS.map((s, i) => '<span class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"></span>').join('');
    $('stepsBar').hidden = p === 'ready';
    $('sizeBox').hidden = !(p === 'size' && state.calib.length === 2);
    $('floorBox').hidden = p !== 'floor'; $('holdBox').hidden = p !== 'holds';
    $('solve').hidden = !(p === 'ready' || (p === 'holds' && state.holds.some((h) => h.kind === 'start') && state.holds.some((h) => h.kind === 'top')));
    if (p === 'size') banner('Step 2 of 4: show the size', state.calib.length < 2 ? 'Tap two ends of something you know the length of, like a tape measure or a door.' : 'Now type how long that line is.');
    else if (p === 'floor') banner('Step 3 of 4: the floor', 'Tap the line where the floor is in your photo.');
    else if (p === 'holds') banner('Step 4 of 4: mark the holds', state.mode ? 'Pick a kind, then tap each hold in the photo. Mark 2 start holds and 1 finish hold at least.' : 'Pick a kind below, then tap each hold in the photo.');
    else if (p === 'ready') banner('Sample wall', 'This is a made-up wall with 25 holds. Tap "Find my moves".');
    drawSetup();
  }
  function setMode(m) { state.mode = m; document.querySelectorAll('.kind').forEach((b) => b.classList.toggle('active', b.dataset.mode === m)); if (state.phase === 'holds') setPhase('holds'); }
  function invalidate() { state.result = null; }
  const holdsReady = () => { if (state.phase === 'holds') setPhase('holds'); else drawSetup(); };
  function nextId() { let n = 1; const used = new Set(state.holds.map((h) => h.id)); while (used.has('H' + n)) n++; return 'H' + n; }

  cv.addEventListener('click', (e) => {
    const rect = cv.getBoundingClientRect();
    const p = { x: (e.clientX - rect.left) * cv.width / rect.width, y: (e.clientY - rect.top) * cv.height / rect.height };
    if (state.phase === 'size') { state.calib.push(p); if (state.calib.length > 2) state.calib = [p]; setPhase('size'); return; }
    if (state.phase === 'floor') { state.groundY = Math.max(0, px2cm(p).y); state.noGround = false; setMode('start'); setPhase('holds'); return; }
    if (state.phase !== 'holds' || !state.mode) { if (state.phase === 'holds') banner('Step 4 of 4: mark the holds', 'First pick a kind of hold with the buttons below the banner.'); return; }
    const c = px2cm(p); invalidate();
    if (state.mode === 'erase') {
      let best = null, bd = 30 * state.cmPerPx; state.holds.forEach((h) => { const d = Math.hypot(h.x - c.x, h.y - c.y); if (d < bd) { bd = d; best = h; } });
      if (best) state.holds = state.holds.filter((h) => h !== best);
    } else {
      if (state.mode === 'top') state.holds = state.holds.filter((h) => h.kind !== 'top');
      if (state.mode === 'start' && state.holds.filter((h) => h.kind === 'start').length >= 2) { banner('Too many start holds', 'You can only have 2 start holds. Use "Remove a hold" or "Undo last" first.'); return; }
      state.holds.push({ id: nextId(), x: c.x, y: c.y, kind: state.mode, size: 2 });
    }
    setPhase('holds');
  });
  document.querySelectorAll('.kind').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('undo').addEventListener('click', () => { state.holds.pop(); invalidate(); setPhase('holds'); });
  $('setSize').addEventListener('click', () => {
    const v = +$('realLen').value, d = state.calib.length === 2 ? Math.hypot(state.calib[0].x - state.calib[1].x, state.calib[0].y - state.calib[1].y) : 0;
    if (!(v > 0) || d < 5) { banner('Try again', 'Tap two points that are further apart, then type the real length.'); return; }
    state.cmPerPx = v / d; state.groundY = null; state.holds = []; invalidate(); setPhase('floor');
  });
  $('noGround').addEventListener('click', () => { state.groundY = null; state.noGround = true; setMode('start'); setPhase('holds'); });

  $('loadSample').addEventListener('click', () => {
    state.img = null; state.sample = true; resizeCanvases(600, 900);
    state.cmPerPx = SAMPLE_WALL.widthCm / 600; state.groundY = 0; state.noGround = false;
    state.holds = SAMPLE_WALL.holds.map((h) => ({ ...h })); state.calib = []; state.mode = null; invalidate();
    show('setup'); setPhase('ready');
  });
  $('photo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      state.img = img; state.sample = false; state.cmPerPx = null; state.groundY = null; state.noGround = false; state.holds = []; state.calib = []; state.mode = null; invalidate();
      resizeCanvases(600, Math.round(600 * img.height / img.width)); show('setup'); setPhase('size');
    };
    img.src = URL.createObjectURL(f);
  });
  function resizeCanvases(w, h) { cv.width = cv2.width = w; cv.height = cv2.height = h; }
  $('startOver').addEventListener('click', () => { state.result = null; show('home'); state.phase = 'home'; });
  $('changeWall').addEventListener('click', () => { state.result = null; cancelAnimationFrame(raf); show('home'); state.phase = 'home'; });

  // The solver is Python (physics_solver.py) running in a Web Worker through Pyodide.
  const CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
  // Prefer a copy served next to the page (./vendor/pyodide/), else fall back to the CDN.
  async function pyodideUrl() {
    if (window.PYODIDE_URL) return window.PYODIDE_URL;
    try { const u = new URL('vendor/pyodide/', location.href).href; const r = await fetch(u + 'pyodide.mjs', { method: 'HEAD' }); if (r.ok) return u; } catch (e) {}
    if (new URLSearchParams(location.search).get('cdn') === '1') return CDN_URL; // explicit opt-in only
    throw new Error('Python runtime files not found next to this page (vendor/pyodide/). Add ?cdn=1 to the address to download it from the jsDelivr CDN instead (third-party request).');
  }
  let worker = null, workerReady = null, msgId = 1; const waiting = new Map();
  const timing = { loadMs: null };
  async function startWorker() {
    if (workerReady) return workerReady;
    const code = document.getElementById('worker-src').textContent;
    const indexURL = await pyodideUrl();
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' });
    workerReady = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') { timing.loadMs = m.ms; resolve(); }
        else if (m.type === 'result') { waiting.get(m.id)(m.result); waiting.delete(m.id); }
        else if (m.type === 'error') { reject(new Error(m.message)); if (waiting.has(m.id)) { waiting.get(m.id)({ ok: false, message: 'Python error: ' + m.message, computeMs: 0, expansions: 0 }); waiting.delete(m.id); } }
      };
      worker.postMessage({ type: 'init', indexURL, src: document.getElementById('py-src').textContent });
    });
    return workerReady;
  }
  const pySolve = (input) => new Promise((resolve) => { const id = msgId++; waiting.set(id, resolve); worker.postMessage({ type: 'solve', id, input }); });

  $('solve').addEventListener('click', async () => {
    const p = profile();
    if (!(p.heightCm > 100 && p.heightCm < 250 && p.wingspanCm > 100 && p.wingspanCm < 260)) { banner('Check your size', 'Your height and arm span look wrong. Go back with "Start over" and fix them (about 100 to 250 cm).'); return; }
    if (!state.cmPerPx) { banner('One more thing', 'Set the size first.'); return; }
    if (state.groundY === null && !state.noGround && !state.sample) { banner('One more thing', 'Tap the floor, or say you cannot see it.'); return; }
    $('solve').disabled = true;
    try {
      busy(timing.loadMs ? 'Working out your moves...' : 'Getting the helper ready. The first time takes a few seconds...');
      await startWorker();
      $('busyText').textContent = 'Working out your moves... this can take a few seconds.';
      const t0 = performance.now();
      state.result = await pySolve({ profile: p, holds: state.holds, groundY: state.groundY });
      state.result.wallMs = performance.now() - t0; state.result.loadMs = timing.loadMs;
      busy(false);
      if (state.result.ok) { state.step = 0; show('moves'); showStep(); }
      else { banner('I could not find a way up', 'Try adding more holds, or check the floor and size. (Detail: ' + state.result.message + ')'); }
    } catch (err) { busy(false); banner('The helper did not start', err.message); workerReady = null; }
    finally { $('solve').disabled = false; busy(false); }
  });
  const go = (n) => { state.step = n; showStep(); };
  $('prev').addEventListener('click', () => go(Math.max(0, state.step - 1)));
  $('next').addEventListener('click', () => { const t = state.result.moves.length; if (state.step <= t) go(state.step + 1); });
  $('replay').addEventListener('click', () => { if (state.step > 0 && state.step <= state.result.moves.length) playAnim(); });
  ['height', 'heightUnit', 'span', 'spanUnit', 'dominant', 'allowStretch'].forEach((id) => $(id).addEventListener('change', invalidate));

  window.ClimbApp = { state, cm2px, px2cm, finishAnim, setAnimT: (t) => { cancelAnimationFrame(raf); state.animT = t; state.animDone = t >= 1; drawMoves(); } };
  show('home');
})();

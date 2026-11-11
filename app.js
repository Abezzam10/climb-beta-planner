/* UI for the Climb Beta Planner. All client-side, no network needed. */
(function () {
  const $ = (id) => document.getElementById(id);
  const cv = $('wall'), ctx = cv.getContext('2d');
  const KIND = { start: '#22c55e', top: '#ef4444', hand: '#38bdf8', foot: '#fbbf24' };
  const LIMBS = ['LH', 'RH', 'LF', 'RF'];
  const LIMB_COL = ['#38bdf8', '#a78bfa', '#fbbf24', '#fb923c'];
  // y in cm is measured UP from the bottom edge of the canvas/photo. groundY is the ground line height in the same axis.
  const state = { img: null, cmPerPx: null, groundY: null, holds: [], mode: null, calib: [], result: null, step: 0, sample: false };

  const toCm = (v, u) => (u === 'in' ? v * 2.54 : v);
  const profile = () => ({
    heightCm: toCm(+$('height').value, $('heightUnit').value),
    wingspanCm: toCm(+$('span').value, $('spanUnit').value),
    dominantHand: $('dominant').value,
    style: $('style').value,
  });
  const say = (m) => { $('status').textContent = m; };
  const px2cm = (p) => ({ x: p.x * state.cmPerPx, y: (cv.height - p.y) * state.cmPerPx });
  const cm2px = (p) => ({ x: p.x / state.cmPerPx, y: cv.height - p.y / state.cmPerPx });
  const fmtMs = (ms) => (ms < 1 ? '<1' : ms < 10 ? ms.toFixed(1) : Math.round(ms)) + ' ms';

  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (state.img) ctx.drawImage(state.img, 0, 0, cv.width, cv.height);
    else if (state.sample) drawSampleWall();
    else { ctx.fillStyle = '#0c0a09'; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.fillStyle = ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 2;
    state.calib.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); });
    if (state.calib.length === 2) { ctx.beginPath(); ctx.moveTo(state.calib[0].x, state.calib[0].y); ctx.lineTo(state.calib[1].x, state.calib[1].y); ctx.stroke(); }
    if (!state.cmPerPx) return;
    if (state.groundY !== null) {
      const y = cm2px({ x: 0, y: state.groundY }).y;
      ctx.setLineDash([8, 6]); ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#4ade80'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('ground', 4, y - 4);
    }
    state.holds.forEach((h) => {
      const p = cm2px(h), r = 6 + h.size * 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7);
      ctx.fillStyle = KIND[h.kind] + 'cc'; ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#000'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(h.id.replace('H', ''), p.x, p.y + 3.5);
    });
    drawRoute();
  }

  function drawSampleWall() {
    const g = ctx.createLinearGradient(0, 0, 0, cv.height);
    g.addColorStop(0, '#44403c'); g.addColorStop(1, '#292524');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#57534e'; ctx.lineWidth = 2;
    for (let y = 0; y <= cv.height; y += 150) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cv.width / 2, 0); ctx.lineTo(cv.width / 2, cv.height); ctx.stroke();
  }

  function holdPos(r, id) {
    if (id === 'ground') return { x: r.groundX, y: state.groundY };
    const h = state.holds.find((x) => x.id === id); return { x: h.x, y: h.y };
  }

  function drawRoute() {
    const r = state.result; if (!r || !r.ok) return;
    const upto = r.moves.slice(0, state.step);
    const move = upto[upto.length - 1] || null;
    const cur = move ? { state: move.state, hip: move.hip } : { state: r.start.state, hip: r.start.hip };
    // earlier move targets: small numbered rings
    upto.forEach((m, i) => {
      const p = cm2px(m.to), last = i === upto.length - 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, last ? 16 : 12, 0, 7);
      ctx.strokeStyle = m.dynamic ? '#f472b6' : '#fff'; ctx.lineWidth = last ? 3.5 : 2; ctx.stroke();
      ctx.fillStyle = last ? '#fff' : '#fde68a'; ctx.font = (last ? 'bold 12px' : '10px') + ' sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), p.x + 20, p.y - 14);
    });
    const hip = cm2px(cur.hip), sh = cm2px({ x: cur.hip.x, y: cur.hip.y + r.body.shoulderUp });
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(sh.x, sh.y); ctx.stroke();
    // limbs: moved limb thick and bright, others thin; ghost of previous hold with arrow
    cur.state.forEach((id, k) => {
      const t = cm2px(holdPos(r, id)), from = k < 2 ? sh : hip, moved = move && LIMBS[k] === move.limb;
      ctx.strokeStyle = LIMB_COL[k]; ctx.globalAlpha = moved || !move ? 1 : 0.55; ctx.lineWidth = moved ? 5 : 2.5;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(t.x, t.y); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = LIMB_COL[k]; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      const off = k % 2 === 0 ? -14 : 14;
      ctx.fillText(LIMBS[k], t.x + off * 1.3, t.y + (k < 2 ? -8 : 16));
    });
    if (move) {
      const a = cm2px(move.from), b = cm2px(move.to);
      ctx.setLineDash([5, 5]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(a.x, a.y, 10, 0, 7); ctx.strokeStyle = '#a8a29e'; ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sh.x, sh.y - 9, 7, 0, 7); ctx.fill();
  }

  const holdName = (id) => (id === 'ground' ? 'the ground' : 'hold ' + id.replace('H', ''));

  function caption() {
    const r = state.result, el = $('caption');
    if (!r || !r.ok) { el.textContent = ''; return; }
    if (state.step === 0) { el.textContent = 'Start: ' + r.start.state.map((id, k) => LIMBS[k] + ' on ' + holdName(id)).join(', ') + '.'; return; }
    const m = r.moves[state.step - 1];
    el.textContent = `Step ${m.step} of ${r.moves.length}: move ${m.limb} to ${holdName(m.toHold)}` + (m.dynamic ? ' (stretch past static reach, unverified).' : '.');
  }

  function renderResult() {
    const r = state.result, el = $('result');
    if (!r) { el.textContent = 'No sequence yet.'; return; }
    if (!r.ok) { el.innerHTML = '<p class="warn"></p>'; el.firstChild.textContent = r.message; return; }
    const rows = r.moves.map((m, i) => `<tr class="${i + 1 === state.step ? 'cur' : ''}"><td>${m.step}</td><td>${m.limb}</td><td>${holdName(m.toHold)}</td><td>${m.dynamic ? 'stretch past static reach (unverified)' : 'within assumed reach'}</td></tr>`).join('');
    const v = r.verification;
    el.innerHTML = `
      <div class="stats">
        <div><span class="hint">Moves</span><b>${r.moves.length}</b></div>
        <div><span class="hint">Reach margin, cm (0 = at assumed max)</span><b>${r.reachMarginCm}</b></div>
        <div><span class="hint">Balance score (0-100, rough)</span><b>${r.balanceScore}</b></div>
        <div><span class="hint">Biggest hip shift in one move</span><b>${r.maxHipShiftCm} cm</b></div>
        <div><span class="hint">Compute time</span><b>${fmtMs(r.computeMs)}</b> <span class="hint">${r.expansions} states searched</span></div>
      </div>
      <p>${r.dynamicMoves ? r.dynamicMoves + ' move(s) stretch past the static limit. Those are guesses, not checked for safety.' : 'All moves stay within the assumed static reach.'}</p>
      <p class="hint">Model check: ${v.ok ? 'passed' : 'FAILED'} for ${v.checkedPoses} poses and ${v.checkedTransitions} transitions (one limb per move, hips shift gradually, other limbs stay in reach). This only means the route is consistent with the simple model above, not that it is physically possible.</p>
      <div class="scroll"><table class="moves"><tr><th>#</th><th>Limb</th><th>To</th><th>Note</th></tr>${rows}</table></div>
      <p class="hint">One suggestion under a simple model. It is not the best or safest route.</p>`;
  }

  function setStep(n) { state.step = n; $('step').value = n; $('stepLabel').textContent = n; renderResult(); caption(); draw(); }
  function invalidate() { state.result = null; $('step').max = 0; setStep(0); }
  function resetCanvasFor(w, h) { cv.width = w; cv.height = h; }

  function setMode(m) {
    state.mode = m;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    if (m === 'calibrate') { state.calib = []; say('Click two points on the wall that are a known distance apart (e.g. the ends of a 1 m tape).'); draw(); }
    else if (m === 'ground') say('Click where the ground is in the photo. If the ground is not visible, tick "No ground visible" below.');
    else if (m) say('Click on the wall to place: ' + m + '. Choose Erase to remove a hold.');
  }

  function nextId() { let n = 1; const used = new Set(state.holds.map((h) => h.id)); while (used.has('H' + n)) n++; return 'H' + n; }

  cv.addEventListener('click', (e) => {
    const rect = cv.getBoundingClientRect();
    const p = { x: (e.clientX - rect.left) * cv.width / rect.width, y: (e.clientY - rect.top) * cv.height / rect.height };
    if (state.mode === 'calibrate') {
      state.calib.push(p); if (state.calib.length > 2) state.calib = [p];
      if (state.calib.length === 2) {
        const d = Math.hypot(state.calib[0].x - state.calib[1].x, state.calib[0].y - state.calib[1].y);
        const v = parseFloat(window.prompt('Real distance between those two points, in cm (100 = 1 metre):', '100'));
        if (v > 0 && d > 5) { state.cmPerPx = v / d; state.groundY = null; state.holds = []; say('Scale set: ' + state.cmPerPx.toFixed(3) + ' cm per pixel. Next: set the ground line, then mark holds.'); invalidate(); setMode('ground'); }
        else say('Calibration cancelled or points too close. Try again.');
      }
      draw(); return;
    }
    if (!state.mode) return;
    if (!state.cmPerPx) { say('Calibrate the scale first (step 1).'); return; }
    const c = px2cm(p);
    if (state.mode === 'ground') { state.groundY = Math.max(0, c.y); $('noGround').checked = false; say('Ground line set. Now mark Start, Hand, Foot and Top holds.'); setMode('start'); }
    else if (state.mode === 'erase') {
      let best = null, bd = 25 * state.cmPerPx;
      state.holds.forEach((h) => { const d = Math.hypot(h.x - c.x, h.y - c.y); if (d < bd) { bd = d; best = h; } });
      if (best) state.holds = state.holds.filter((h) => h !== best);
    } else {
      if (state.mode === 'top') state.holds = state.holds.filter((h) => h.kind !== 'top');
      if (state.mode === 'start' && state.holds.filter((h) => h.kind === 'start').length >= 2) { say('At most two start holds. Erase one first.'); return; }
      state.holds.push({ id: nextId(), x: c.x, y: c.y, kind: state.mode, size: 2 });
    }
    invalidate();
  });

  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  $('loadSample').addEventListener('click', () => {
    state.img = null; state.sample = true; resetCanvasFor(600, 900);
    state.cmPerPx = SAMPLE_WALL.widthCm / 600; state.groundY = 0;
    state.holds = SAMPLE_WALL.holds.map((h) => ({ ...h }));
    state.calib = []; state.mode = null; $('noGround').checked = false;
    document.querySelectorAll('.tool').forEach((b) => b.classList.remove('active'));
    say('Sample wall loaded (made-up 3 m x 4.5 m wall, ground at the bottom). Press "Find a sequence".');
    invalidate();
  });

  $('photo').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      state.img = img; state.sample = false; state.cmPerPx = null; state.groundY = null; state.holds = []; state.calib = [];
      resetCanvasFor(600, Math.round(600 * img.height / img.width));
      invalidate(); setMode('calibrate'); draw();
    };
    img.src = URL.createObjectURL(f);
  });

  $('clearHolds').addEventListener('click', () => { state.holds = []; invalidate(); });
  $('noGround').addEventListener('change', () => { if ($('noGround').checked) state.groundY = null; invalidate(); });

  $('solve').addEventListener('click', () => {
    const p = profile();
    if (!(p.heightCm > 100 && p.heightCm < 250 && p.wingspanCm > 100 && p.wingspanCm < 260)) { say('Check height and wingspan: expected roughly 100-250 cm.'); return; }
    if (!state.cmPerPx) { say('Calibrate the scale first.'); return; }
    if (state.groundY === null && !$('noGround').checked) { say('Set the ground line (step 2), or tick "No ground visible".'); return; }
    state.result = PhysicsSolver.solve({ profile: p, holds: state.holds, groundY: state.groundY });
    $('step').max = state.result.ok ? state.result.moves.length : 0;
    say(state.result.ok ? 'Sequence found. Use the step slider or arrows to walk through it.' : 'No sequence found. See the message below.');
    setStep(0);
  });
  $('step').addEventListener('input', (e) => setStep(+e.target.value));
  $('prev').addEventListener('click', () => setStep(Math.max(0, state.step - 1)));
  $('next').addEventListener('click', () => setStep(Math.min(+$('step').max, state.step + 1)));

  // Changing the profile clears the old result so it never goes stale.
  ['height', 'heightUnit', 'span', 'spanUnit', 'dominant', 'style'].forEach((id) => $(id).addEventListener('change', invalidate));

  window.ClimbApp = { state, cm2px, px2cm }; // read access for automated tests
  $('loadSample').click();
})();

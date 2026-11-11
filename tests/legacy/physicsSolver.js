// NOTE: copy of the first prototype solver, with one fix (a 1e-9 tolerance on the dynamic-move flag) so parity tests are not thrown off by float noise.
/*
 * physicsSolver.js - Phase 1 route search for the Climb Beta Planner.
 *
 * WHAT THIS IS: a 2D heuristic search (A*) over limb placements. It uses simple
 * body proportions (height, wingspan) to decide which limb moves are "within reach"
 * and adds cost terms for strain and balance.
 *
 * WHAT THIS IS NOT: validated biomechanics. It does not know wall angle, hold
 * quality, friction, your strength, or real forces. Body weight is collected but NOT
 * used in scoring, because weight alone does not tell us anything reliable about
 * torque or finger strength. Treat output as a suggestion to try, never as proof
 * that a move is possible or safe.
 *
 * Kept separate and pure (no DOM) so Phase 2 can benchmark variants of it offline.
 *
 * Coordinates: centimetres, x to the right, y UP from the ground.
 * Hold: {id, x, y, kind: 'hand'|'foot'|'start'|'top', size: 1 (small) .. 3 (big)}
 * Limbs: 0=LH 1=RH 2=LF 3=RF
 */
(function (root) {
  'use strict';
  const LIMB_NAMES = ['LH', 'RH', 'LF', 'RF'];

  function bodyFromProfile(p) {
    const h = p.heightCm, w = p.wingspanCm;
    return {
      height: h,
      armReach: 0.39 * w,      // shoulder to fingertip, rough proportion
      legReach: 0.50 * h,      // hip to foot with a bent knee, rough proportion
      shoulderUp: 0.29 * h,    // hip to shoulder, rough proportion
      idealHipAboveFeet: 0.45 * h,
    };
  }

  // Find a hip position that keeps all four limbs within reach, in 2D.
  // Returns null if none exists. Otherwise {x, y, strain} (strain 0..~1.2, 1 = at max reach).
  function placeBody(limbs, holds, body, strainLimit) {
    const pts = limbs.map((i) => holds[i]);
    const x = 0.25 * (pts[0].x + pts[1].x) + 0.25 * (pts[2].x + pts[3].x);
    let lo = -Infinity, hi = Infinity;
    for (let k = 0; k < 4; k++) {
      const hand = k < 2;
      const r = (hand ? body.armReach : body.legReach) * strainLimit;
      const dx = pts[k].x - x;
      if (Math.abs(dx) > r) return null;
      const s = Math.sqrt(r * r - dx * dx);
      const off = hand ? body.shoulderUp : 0;
      lo = Math.max(lo, pts[k].y - off - s);
      hi = Math.min(hi, pts[k].y - off + s);
    }
    if (lo > hi) return null;
    const feetY = 0.5 * (pts[2].y + pts[3].y);
    const y = Math.min(hi, Math.max(lo, feetY + body.idealHipAboveFeet));
    let strain = 0;
    for (let k = 0; k < 4; k++) {
      const hand = k < 2;
      const dx = pts[k].x - x;
      const dy = pts[k].y - (y + (hand ? body.shoulderUp : 0));
      strain = Math.max(strain, Math.hypot(dx, dy) / (hand ? body.armReach : body.legReach));
    }
    return { x, y, strain };
  }

  // A move is allowed only if the hips can travel from the old pose to the new one
  // without a big jump, and the three limbs that stay put remain within reach
  // at the halfway point. (Still a simple 2D check, not real dynamics.)
  const MAX_HIP_SHIFT = 0.30; // fraction of height
  function transitionOK(a, b, sa, sb, moved, holds, body, limit) {
    const shift = Math.hypot(a.x - b.x, a.y - b.y);
    if (shift > MAX_HIP_SHIFT * body.height) return false;
    const mx = 0.5 * (a.x + b.x), my = 0.5 * (a.y + b.y);
    for (let k = 0; k < 4; k++) {
      if (k === moved) continue;
      const hand = k < 2, p = holds[sb[k]];
      const d = Math.hypot(p.x - mx, p.y - (my + (hand ? body.shoulderUp : 0)));
      if (d > (hand ? body.armReach : body.legReach) * limit + 1e-6) return false;
    }
    return true;
  }

  function solve(input) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const { profile } = input;
    const body = bodyFromProfile(profile);
    const dynamicPref = profile.style === 'dynamic';
    const strainLimit = dynamicPref ? 1.15 : 1.0;
    const maxExpansions = input.maxExpansions || 40000;

    // Holds list, plus a virtual floor spot for feet.
    const holds = input.holds.map((h, i) => ({ ...h, idx: i }));
    const starts = holds.filter((h) => h.kind === 'start');
    const tops = holds.filter((h) => h.kind === 'top');
    if (!starts.length) return fail('Mark at least one Start hold.');
    if (!tops.length) return fail('Mark one Top hold.');
    const startX = starts.reduce((a, h) => a + h.x, 0) / starts.length;
    // Ground is only used if the caller gives a ground height. It is a start-only foot spot.
    const hasGround = typeof input.groundY === 'number';
    if (hasGround) holds.push({ id: 'ground', x: startX, y: input.groundY, kind: 'foot', size: 3, idx: holds.length, floor: true });

    const handOK = holds.filter((h) => !h.floor && h.kind !== 'foot').map((h) => h.idx);
    const footOK = holds.filter((h) => h.kind !== 'top' && !h.floor).map((h) => h.idx);
    const startFootOK = holds.filter((h) => h.kind !== 'top').map((h) => h.idx);
    const isTop = (i) => holds[i].kind === 'top';
    const topY = Math.max(...tops.map((h) => h.y));
    const dom = profile.dominantHand; // 'left' | 'right' | 'either'

    function handCost(limb, hi) {
      const size = holds[hi].size;
      if (size >= 3) return 0;
      const base = size === 1 ? 0.6 : 0.25;
      const isDom = (dom === 'left' && limb === 0) || (dom === 'right' && limb === 1);
      return isDom || dom === 'either' ? base * 0.6 : base; // small bonus for stronger hand on smaller holds
    }

    const key = (s) => s.join(',');
    const heap = [];
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const heur = (s) => {
      const hy = Math.max(holds[s[0]].y, holds[s[1]].y);
      return Math.ceil(Math.max(0, topY - hy) / (2.4 * body.armReach));
    };
    const best = new Map();

    // Starting states: hands on start holds, feet on any feasible foot holds / floor.
    const handPairs = starts.length === 1 ? [[starts[0].idx, starts[0].idx]]
      : [[starts[0].idx, starts[1].idx], [starts[1].idx, starts[0].idx]];
    for (const [lh, rh] of handPairs) {
      for (const lf of startFootOK) for (const rf of startFootOK) {
        const s = [lh, rh, lf, rf];
        if (holds[lf].y > Math.min(holds[lh].y, holds[rh].y)) continue;
        const bp = placeBody(s, holds, body, 1.0);
        if (!bp) continue;
        const c = balanceCost(bp, s);
        const k = key(s);
        if (best.has(k) && best.get(k) <= c) continue;
        best.set(k, c);
        push({ s, g: c, f: c + heur(s), parent: null, move: null, bp });
      }
    }
    if (!heap.length) return fail('No feasible starting position: the start holds may be out of reach of any foothold. Add a foot hold or check the calibration.');

    function balanceCost(bp, s) {
      const fx = 0.5 * (holds[s[2]].x + holds[s[3]].x);
      const off = Math.abs(bp.x - fx) / (0.25 * body.height);
      return 0.8 * off * off;
    }

    let expansions = 0, goal = null;
    while (heap.length && expansions < maxExpansions) {
      const n = pop();
      if (n.g > best.get(key(n.s)) + 1e-9) continue;
      expansions++;
      if (isTop(n.s[0]) || isTop(n.s[1])) { goal = n; break; }
      for (let limb = 0; limb < 4; limb++) {
        const cands = limb < 2 ? handOK : footOK;
        const cur = holds[n.s[limb]];
        for (const hi of cands) {
          if (hi === n.s[limb]) continue;
          const H = holds[hi];
          if (limb < 2 && hi === n.s[1 - limb] && H.kind !== 'start' && H.kind !== 'top') continue; // matching only on start/top
          if (Math.hypot(H.x - cur.x, H.y - cur.y) > 2.2 * body.armReach) continue;
          const s = n.s.slice(); s[limb] = hi;
          const bp = placeBody(s, holds, body, strainLimit);
          if (!bp) continue;
          if (!transitionOK(n.bp, bp, n.s, s, limb, holds, body, strainLimit)) continue;
          const strainTerm = 0.6 * Math.max(0, bp.strain - 0.6) ** 2 * 6;
          const dynamic = bp.strain > 1.0 + 1e-9; // tolerance for float noise at the reach edge
          const g = n.g + 1 + strainTerm + (dynamic ? 1.5 : 0) + balanceCost(bp, s) + (limb < 2 ? handCost(limb, hi) : 0);
          const k = key(s);
          if (best.has(k) && best.get(k) <= g) continue;
          best.set(k, g);
          push({ s, g, f: g + heur(s), parent: n, move: { limb, from: cur.idx, to: hi, dynamic }, bp });
        }
      }
    }
    const ms = ((typeof performance !== 'undefined' ? performance : Date).now() - t0);
    if (!goal) {
      return { ok: false, message: expansions >= maxExpansions
        ? 'Search stopped after ' + expansions + ' states without finding a route. Try adding holds, or check calibration.'
        : 'No route found with these holds and this body size. This does not mean the wall is impossible, only that these holds do not link up under the simple reach model.',
        computeMs: ms, expansions };
    }
    const chain = [];
    for (let n = goal; n; n = n.parent) chain.push(n);
    chain.reverse();
    const moves = chain.filter((n) => n.move).map((n, i) => ({
      step: i + 1,
      limb: LIMB_NAMES[n.move.limb],
      toHold: holds[n.move.to].id,
      toIdx: n.move.to,
      to: { x: holds[n.move.to].x, y: holds[n.move.to].y },
      from: { x: holds[n.move.from].x, y: holds[n.move.from].y },
      dynamic: n.move.dynamic,
      strain: n.bp.strain,
      hip: { x: n.bp.x, y: n.bp.y },
      state: n.s.map((i) => holds[i].id),
      prevState: n.parent.s.map((i) => holds[i].id),
      hipShift: Math.hypot(n.bp.x - n.parent.bp.x, n.bp.y - n.parent.bp.y),
    }));
    const start = chain[0];
    return {
      ok: true,
      start: { state: start.s.map((i) => holds[i].id), hip: { x: start.bp.x, y: start.bp.y } },
      moves,
      reachMarginCm: Math.round(Math.min(...moves.map((m) => (1 - m.strain) * body.armReach).concat([body.armReach]))),
      maxStrain: Math.max(0, ...moves.map((m) => m.strain)),
      dynamicMoves: moves.filter((m) => m.dynamic).length,
      balanceScore: Math.max(0, Math.round(100 - 100 * moves.reduce((a, m) => a + Math.abs(m.hip.x - 0.5 * (holds.find((h) => h.id === m.state[2]).x + holds.find((h) => h.id === m.state[3]).x)), 0) / (moves.length * 0.25 * body.height))),
      cost: goal.g, expansions, computeMs: ms, body,
      maxHipShiftCm: Math.round(Math.max(0, ...moves.map((m) => m.hipShift))),
      groundX: hasGround ? startX : null,
      verification: verifyRoute(holds, chain, body, strainLimit),
    };
    function fail(m) { return { ok: false, message: m, computeMs: 0, expansions: 0 }; }
  }

  // Re-checks every pose AND every transition of a finished route.
  function verifyRoute(holds, chain, body, limit) {
    const issues = [];
    for (let i = 0; i < chain.length; i++) {
      const bp = placeBody(chain[i].s, holds, body, limit);
      if (!bp) issues.push('pose ' + i + ' not reachable');
      if (i > 0) {
        const diff = chain[i].s.filter((v, k) => v !== chain[i - 1].s[k]).length;
        if (diff !== 1) issues.push('step ' + i + ' changes ' + diff + ' limbs');
        if (bp && !transitionOK(chain[i - 1].bp, bp, chain[i - 1].s, chain[i].s, chain[i].move.limb, holds, body, limit)) issues.push('step ' + i + ' transition invalid');
      }
    }
    return { ok: issues.length === 0, issues, checkedPoses: chain.length, checkedTransitions: chain.length - 1 };
  }

  const api = { solve, bodyFromProfile, LIMB_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PhysicsSolver = api;
})(typeof window !== 'undefined' ? window : globalThis);

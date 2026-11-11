// Run: node tests/solver.test.js
require('../sampleWall.js'); const S = require('../physicsSolver.js');
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL', m); } else console.log('ok  ', m); };
const base = { heightCm: 175, wingspanCm: 178, style: 'static', dominantHand: 'right' };
const W = SAMPLE_WALL.holds;
let r = S.solve({ profile: base, holds: W, groundY: 0 });
ok(r.ok && r.moves.length > 3, 'sample wall solves for default profile');
ok(r.ok && r.verification.ok, 'every pose and transition re-verified');
ok(r.ok && r.moves.every((m) => m.strain <= 1.0001), 'static style never exceeds assumed reach');
ok(r.ok && r.moves.every((m) => m.hipShift <= 0.30 * 175 + 1e-6), 'no hip jump over 30% of height');
ok(r.ok && r.moves.every((m) => m.state.filter((v, k) => v !== m.prevState[k]).length === 1), 'one limb changes per step');
r = S.solve({ profile: base, holds: W.filter((h) => h.kind !== 'top'), groundY: 0 });
ok(!r.ok, 'no top hold -> clear failure');
r = S.solve({ profile: { ...base, heightCm: 100, wingspanCm: 100 }, holds: W, groundY: 0 });
ok(!r.ok || r.verification.ok, 'tiny body does not crash or return invalid route');
// Without ground, feet must start on marked holds; sample start holds are low so this must still be checked, not assumed.
r = S.solve({ profile: base, holds: W, groundY: null });
ok(!r.ok || r.start.state.slice(2).every((id) => id !== 'ground'), 'no ground given -> feet never start on ground');
// Ground in the wrong place (high) must change or break the start
r = S.solve({ profile: base, holds: W, groundY: 400 });
ok(!r.ok || r.verification.ok, 'odd ground height still yields only verified routes');
for (const [h, w, st] of [[160, 160, 'static'], [190, 195, 'dynamic'], [150, 150, 'static']]) {
  r = S.solve({ profile: { ...base, heightCm: h, wingspanCm: w, style: st }, holds: W, groundY: 0 });
  ok(!r.ok || r.verification.ok, `profile ${h}/${w}/${st}: ${r.ok ? r.moves.length + ' moves, max hip shift ' + r.maxHipShiftCm + ' cm' : 'no route (reported honestly)'}`);
}
process.exit(fail ? 1 : 0);

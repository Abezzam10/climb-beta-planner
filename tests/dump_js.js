// Dumps the JS solver's results for a fixed set of cases, for the Python parity test.
const path = require('path'); const root = path.join(__dirname, 'legacy');
require(path.join(root, 'sampleWall.js')); const S = require(path.join(root, 'physicsSolver.js'));
const cases = require('./cases.json');
const out = cases.map((c) => { const r = S.solve({ profile: c.profile, holds: c.holds, groundY: c.groundY });
  return r.ok ? { ok: true, cost: r.cost, moves: r.moves.map((m) => m.limb + ':' + m.toHold), expansions: r.expansions, verified: r.verification.ok, dyn: r.dynamicMoves }
              : { ok: false, expansions: r.expansions }; });
process.stdout.write(JSON.stringify(out));

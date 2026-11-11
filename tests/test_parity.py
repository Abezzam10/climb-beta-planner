"""Parity test: Python solver vs the JavaScript solver on fixed cases.
Needs Node. Run from the project root: python3 tests/test_parity.py
Pass = same ok/fail and same route cost (1e-6). Equal-cost ties may pick a different route; reported, not failed."""
import json, subprocess, sys, time, os
root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, root)
import physics_solver as P
P.FEET_BELOW_HIPS = False; P.NO_CROSSING = False  # JS parity is for the old rules
cases = json.load(open(os.path.join(root, 'tests', 'cases.json')))
js = json.loads(subprocess.run(['node', os.path.join(root, 'tests', 'dump_js.js')], capture_output=True, text=True, check=True).stdout)
bad = ties = 0
for c, j in zip(cases, js):
    t = time.time(); r = P.solve({'profile': c['profile'], 'holds': c['holds'], 'groundY': c['groundY']}); dt = time.time() - t
    ok = r['ok'] == j['ok'] and (not r['ok'] or abs(r['cost'] - j['cost']) < 1e-6)
    if r['ok']:
        ok = ok and r['verification']['ok']
        if [m['limb'] + ':' + m['toHold'] for m in r['moves']] != j['moves']: ties += 1
    bad += (not ok)
    print('%-22s %s py %.2fs' % (c['name'], 'OK ' if ok else 'BAD', dt))
print('%d/%d match on ok/cost; %d equal-cost route ties differ' % (len(cases) - bad, len(cases), ties))
sys.exit(1 if bad else 0)

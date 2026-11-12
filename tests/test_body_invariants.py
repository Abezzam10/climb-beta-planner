"""Body-model invariants for every route the solver returns. Run from the project root: python3 tests/test_body_invariants.py
Checks, independent of verify_route, on stored walls and random walls at several heights (190 and 190.5 cm included):
 1. every pose: each hand and foot lies between its minimum reach (elbow/knee at its limit) and its maximum reach (times strain limit) of ONE hip;
 2. the minimum reach really equals the two-link distance at the stated interior angle, and is never below |upper - lower|;
 3. contacts: the four limbs sit exactly on the holds named in the state; the state changes one limb per move;
 4. transitions: hip shift within MAX_HIP_SHIFT; at the halfway hip the three limbs that stay put are inside [min, max];
    and the moving limb is inside [min, max] at both its old hold (old hip) and new hold (new hip);
 5. stance rules: no foot above the hips, no crossed hands or feet."""
import sys, os, json, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import physics_solver as P
fails = 0
def check(c, m):
    global fails
    if not c:
        print('FAIL', m); fails += 1
EPS = 1e-6
def seg(body, k):
    return (body['armReach'], body['armMin'], body['shoulderUp']) if k < 2 else (body['legReach'], body['legMin'], 0.0)
def in_range(d, body, k, limit):
    mx, mn, _ = seg(body, k)
    return mn - EPS <= d <= mx * limit + EPS
def run(inp):
    r = P.solve(inp)
    if not r['ok']:
        return 0, 0
    body = r['body']; limit = 1.15 if inp['profile'].get('style') == 'dynamic' else 1.0
    # 2: min reach is the two-link value
    for reach, frac, deg, mn in ((body['armReach'], P.ARM_UPPER_FRAC, P.MIN_ELBOW_DEG, body['armMin']), (body['legReach'], 0.5, P.MIN_KNEE_DEG, body['legMin'])):
        u, l = reach * frac, reach * (1 - frac)
        check(abs(mn - math.sqrt(u * u + l * l - 2 * u * l * math.cos(math.radians(deg)))) < 1e-9, 'min reach formula')
        check(mn >= abs(u - l) - 1e-9, 'min reach below |upper-lower|')
    holds = {h['id']: h for h in inp['holds']}
    holds['ground'] = {'x': r['groundX'] if r['groundX'] is not None else 0, 'y': inp.get('groundY', 0)}
    poses = [(r['start']['state'], r['start']['hip'])] + [(m['state'], m['hip']) for m in r['moves']]
    for i, (st, hip) in enumerate(poses):
        P_ = [(holds[h]['x'], holds[h]['y']) for h in st]
        for k in range(4):
            d = math.hypot(P_[k][0] - hip['x'], P_[k][1] - (hip['y'] + seg(body, k)[2]))
            check(in_range(d, body, k, limit), 'pose %d limb %d distance %.2f outside [%.2f, %.2f]' % (i, k, d, seg(body, k)[1], seg(body, k)[0] * limit))
        check(max(P_[2][1], P_[3][1]) <= hip['y'] + EPS, 'pose %d foot above hip' % i)
        check(P_[0][0] <= P_[1][0] + EPS and P_[2][0] <= P_[3][0] + EPS, 'pose %d crossed' % i)
        if i:
            prev, phip = poses[i - 1]
            ch = [k for k in range(4) if prev[k] != st[k]]
            check(len(ch) == 1, 'move %d changes %d limbs' % (i, len(ch)))
            check(math.hypot(hip['x'] - phip['x'], hip['y'] - phip['y']) <= P.MAX_HIP_SHIFT * body['height'] + 1e-4, 'move %d hip shift' % i)
            mx_, my_ = 0.5 * (hip['x'] + phip['x']), 0.5 * (hip['y'] + phip['y'])
            for k in range(4):
                a = (holds[prev[k]]['x'], holds[prev[k]]['y'])
                if k == ch[0]:
                    d_old = math.hypot(a[0] - phip['x'], a[1] - (phip['y'] + seg(body, k)[2]))
                    check(in_range(d_old, body, k, limit), 'move %d moving limb at its old hold' % i)
                else:
                    d = math.hypot(a[0] - mx_, a[1] - (my_ + seg(body, k)[2]))
                    check(in_range(d, body, k, limit), 'move %d midpoint limb %d distance %.2f' % (i, k, d))
    return len(poses), 1
n = routes = 0
cases = json.load(open(os.path.join(os.path.dirname(__file__), 'cases.json')))
for H in (150.0, 175.26, 190.0, 190.5, 200.0):
    for c in cases[:8]:
        inp = json.loads(json.dumps(c)); inp['profile'] = {'heightCm': H, 'wingspanCm': H, 'dominantHand': 'right', 'style': 'static'}; inp['maxExpansions'] = 15000
        a, b = run(inp); n += a; routes += b
random.seed(7)
for t in range(25):
    H = random.choice([190.0, 190.5, 175.26])
    holds = [{'id': 'S1', 'x': 100, 'y': 60, 'kind': 'start', 'size': 3}, {'id': 'S2', 'x': 140, 'y': 62, 'kind': 'start', 'size': 3}]
    for i in range(14):
        holds.append({'id': 'h%d' % i, 'x': random.randint(20, 240), 'y': random.randint(20, 420), 'kind': 'hand', 'size': random.choice([1, 2, 3])})
    holds.append({'id': 'T', 'x': random.randint(80, 160), 'y': 440, 'kind': 'top', 'size': 3})
    a, b = run({'profile': {'heightCm': H, 'wingspanCm': H, 'dominantHand': 'right', 'style': 'static'}, 'holds': holds, 'groundY': 0, 'maxExpansions': 15000}); n += a; routes += b
print('checked %d poses on %d routes; %d failures' % (n, routes, fails))
check(routes >= 20, 'enough routes solved to mean something (%d)' % routes)
print('ALL PASSED' if not fails else 'FAILED')
sys.exit(1 if fails else 0)

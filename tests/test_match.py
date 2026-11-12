"""Matching: two hands (or two feet) on one hold. Run from the project root: python3 tests/test_match.py"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import physics_solver as P
prof = {'heightCm': 175, 'wingspanCm': 178, 'dominantHand': 'right', 'style': 'static'}
wall = [('S', 0, 60, 'start'), ('M0', 25, 106, 'hand'), ('M1', -9, 158, 'hand'), ('M2', 21, 198, 'hand'), ('M3', -8, 272, 'hand'), ('T', -22, 344, 'top')]
holds = [{'id': a, 'x': x, 'y': y, 'kind': k, 'size': 2} for a, x, y, k in wall]
fails = 0
def check(c, m):
    global fails
    print('ok  ' if c else 'FAIL', m); fails += 0 if c else 1
P.ALLOW_HAND_MATCH = False
old = P.solve({'profile': prof, 'holds': holds, 'groundY': 0})
check(not old['ok'], 'old rule (no hand matching): this wall has no route')
P.ALLOW_HAND_MATCH = True
new = P.solve({'profile': prof, 'holds': holds, 'groundY': 0})
check(new['ok'] and new['verification']['ok'], 'matching allowed: route found and every pose and step re-checked')
hand_matches = [m for m in new['moves'] if m['match'] and m['limb'] in ('LH', 'RH')]
check(len(hand_matches) >= 1, 'route contains %d hand match(es)' % len(hand_matches))
for m in hand_matches:
    st = m['state']; check(st[0] == st[1] and m['toHold'] != 'ground', 'match move %s to %s leaves both hands on one hold' % (m['limb'], m['toHold']))
# a hand and a foot may not be matched by the output flag, and hand matching never uses a hold the user did not mark
ids = {h['id'] for h in holds} | {'ground'}
check(all(m['toHold'] in ids for m in new['moves']), 'only marked holds (and the floor) are used')
# two feet on one hold (already allowed before this change)
check(any(m['match'] and m['limb'] in ('LF', 'RF') for m in new['moves']), 'route contains a two-feet-on-one-hold step')
easy = [('S1', -15, 100, 'start'), ('S2', 15, 100, 'start'), ('M', 0, 150, 'hand'), ('T', 0, 200, 'top')]
h2 = [{'id': a, 'x': x, 'y': y, 'kind': k, 'size': 2} for a, x, y, k in easy]
r = P.solve({'profile': prof, 'holds': h2, 'groundY': 0})
check(r['ok'], 'easy wall solves (%s moves)' % (len(r['moves']) if r['ok'] else 'none'))
print('ALL PASSED' if not fails else '%d FAILED' % fails); sys.exit(1 if fails else 0)

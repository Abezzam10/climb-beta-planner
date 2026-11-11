"""physics_solver.py - Python source of truth for the Climb Beta Planner solver.

Same model as the JavaScript prototype: a 2D heuristic search (A*) over limb
placements. It is NOT validated biomechanics. Weight is not used. Coordinates are
centimetres, x right, y UP. Limbs: 0=LH 1=RH 2=LF 3=RF.

Pure standard library (no numpy), so it also runs in the browser through Pyodide.
Input and output are plain dicts so they can cross a JSON boundary.
"""
import math
import time

LIMB_NAMES = ["LH", "RH", "LF", "RF"]
MAX_HIP_SHIFT = 0.30  # fraction of height
# Conservative stance rules added after the JS prototype (set both False to match the JS solver exactly):
FEET_BELOW_HIPS = True  # a pose is rejected if a foot hold is higher than the hips
NO_CROSSING = True      # a pose is rejected if the left hand is right of the right hand, or the left foot right of the right foot


def body_from_profile(p):
    h, w = p["heightCm"], p["wingspanCm"]
    return {
        "height": h,
        "armReach": 0.39 * w,
        "legReach": 0.50 * h,
        "shoulderUp": 0.29 * h,
        "idealHipAboveFeet": 0.45 * h,
    }


def place_body(limbs, X, Y, body, strain_limit):
    """Find a hip position keeping all limbs within reach. Returns (x, y, strain) or None.
    X and Y are the hold coordinate lists; limbs are 4 hold indices."""
    i0, i1, i2, i3 = limbs
    if NO_CROSSING and (X[i0] > X[i1] or X[i2] > X[i3]):
        return None
    x = 0.25 * (X[i0] + X[i1]) + 0.25 * (X[i2] + X[i3])
    arm = body["armReach"]
    leg = body["legReach"]
    up = body["shoulderUp"]
    lo, hi = -math.inf, math.inf
    for k in range(4):
        i = limbs[k]
        hand = k < 2
        r = (arm if hand else leg) * strain_limit
        dx = X[i] - x
        if abs(dx) > r:
            return None
        s = math.sqrt(r * r - dx * dx)
        off = up if hand else 0
        t = Y[i] - off
        if t - s > lo:
            lo = t - s
        if t + s < hi:
            hi = t + s
    if FEET_BELOW_HIPS:
        fm = Y[i2] if Y[i2] > Y[i3] else Y[i3]
        if fm > lo:
            lo = fm
    if lo > hi:
        return None
    feet_y = 0.5 * (Y[i2] + Y[i3])
    y = min(hi, max(lo, feet_y + body["idealHipAboveFeet"]))
    strain = 0.0
    for k in range(4):
        i = limbs[k]
        hand = k < 2
        d = math.hypot(X[i] - x, Y[i] - (y + (up if hand else 0))) / (arm if hand else leg)
        if d > strain:
            strain = d
    return (x, y, strain)


def transition_ok(a, b, sb, moved, X, Y, body, limit):
    """Hips may not jump, and the 3 limbs that stay put must stay in reach halfway."""
    if math.hypot(a[0] - b[0], a[1] - b[1]) > MAX_HIP_SHIFT * body["height"]:
        return False
    mx, my = 0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])
    for k in range(4):
        if k == moved:
            continue
        hand = k < 2
        i = sb[k]
        d = math.hypot(X[i] - mx, Y[i] - (my + (body["shoulderUp"] if hand else 0)))
        if d > (body["armReach"] if hand else body["legReach"]) * limit + 1e-6:
            return False
    return True


class _Heap:
    """Binary min-heap on node['f'], same sift order as the JS version so ties break the same way."""

    def __init__(self):
        self.a = []

    def __len__(self):
        return len(self.a)

    def push(self, n):
        a = self.a
        a.append(n)
        i = len(a) - 1
        while i > 0:
            p = (i - 1) >> 1
            if a[p]["f"] <= a[i]["f"]:
                break
            a[p], a[i] = a[i], a[p]
            i = p

    def pop(self):
        a = self.a
        top = a[0]
        last = a.pop()
        if a:
            a[0] = last
            i = 0
            n = len(a)
            while True:
                l = 2 * i + 1
                r = l + 1
                m = i
                if l < n and a[l]["f"] < a[m]["f"]:
                    m = l
                if r < n and a[r]["f"] < a[m]["f"]:
                    m = r
                if m == i:
                    break
                a[m], a[i] = a[i], a[m]
                i = m
        return top


def _fail(msg):
    return {"ok": False, "message": msg, "computeMs": 0, "expansions": 0}


def solve(inp):
    t0 = time.perf_counter()
    profile = inp["profile"]
    body = body_from_profile(profile)
    dynamic_pref = profile.get("style") == "dynamic"
    strain_limit = 1.15 if dynamic_pref else 1.0
    max_exp = inp.get("maxExpansions") or 40000

    holds = [dict(h, idx=i) for i, h in enumerate(inp["holds"])]
    starts = [h for h in holds if h["kind"] == "start"]
    tops = [h for h in holds if h["kind"] == "top"]
    if not starts:
        return _fail("Mark at least one Start hold.")
    if not tops:
        return _fail("Mark one Top hold.")
    start_x = sum(h["x"] for h in starts) / len(starts)
    ground_y = inp.get("groundY")
    has_ground = isinstance(ground_y, (int, float)) and not isinstance(ground_y, bool)
    if has_ground:
        holds.append({"id": "ground", "x": start_x, "y": ground_y, "kind": "foot", "size": 3,
                      "idx": len(holds), "floor": True})

    hand_ok = [h["idx"] for h in holds if not h.get("floor") and h["kind"] != "foot"]
    foot_ok = [h["idx"] for h in holds if h["kind"] != "top" and not h.get("floor")]
    start_foot_ok = [h["idx"] for h in holds if h["kind"] != "top"]
    X = [h["x"] for h in holds]
    Y = [h["y"] for h in holds]
    size = [h["size"] for h in holds]
    top_y = max(h["y"] for h in tops)
    dom = profile.get("dominantHand")

    def is_top(i):
        return holds[i]["kind"] == "top"

    def hand_cost(limb, hi):
        size = holds[hi]["size"]
        if size >= 3:
            return 0
        base = 0.6 if size == 1 else 0.25
        is_dom = (dom == "left" and limb == 0) or (dom == "right" and limb == 1)
        return base * 0.6 if (is_dom or dom == "either") else base

    def heur(s):
        hy = max(holds[s[0]]["y"], holds[s[1]]["y"])
        return math.ceil(max(0, top_y - hy) / (2.4 * body["armReach"]))

    def balance_cost(bp, s):
        fx = 0.5 * (holds[s[2]]["x"] + holds[s[3]]["x"])
        off = abs(bp[0] - fx) / (0.25 * body["height"])
        return 0.8 * off * off

    heap = _Heap()
    best = {}

    hand_pairs = ([(starts[0]["idx"], starts[0]["idx"])] if len(starts) == 1 else
                  [(starts[0]["idx"], starts[1]["idx"]), (starts[1]["idx"], starts[0]["idx"])])
    for lh, rh in hand_pairs:
        for lf in start_foot_ok:
            for rf in start_foot_ok:
                s = (lh, rh, lf, rf)
                if holds[lf]["y"] > min(holds[lh]["y"], holds[rh]["y"]):
                    continue
                bp = place_body(s, X, Y, body, 1.0)
                if not bp:
                    continue
                c = balance_cost(bp, s)
                if s in best and best[s] <= c:
                    continue
                best[s] = c
                heap.push({"s": s, "g": c, "f": c + heur(s), "parent": None, "move": None, "bp": bp})
    if not len(heap):
        return _fail("No feasible starting position: the start holds may be out of reach of any foothold. "
                     "Add a foot hold or check the calibration.")

    reach_cap = 2.2 * body["armReach"]
    shift = MAX_HIP_SHIFT * body["height"] + 1e-6
    hand_cap = body["armReach"] * strain_limit + shift
    foot_cap = body["legReach"] * strain_limit + shift
    expansions, goal = 0, None
    while len(heap) and expansions < max_exp:
        n = heap.pop()
        if n["g"] > best[n["s"]] + 1e-9:
            continue
        expansions += 1
        if is_top(n["s"][0]) or is_top(n["s"][1]):
            goal = n
            break
        hip_x, hip_y = n["bp"][0], n["bp"][1]
        for limb in range(4):
            cands = hand_ok if limb < 2 else foot_ok
            cur_i = n["s"][limb]
            cur = holds[cur_i]
            for hi in cands:
                if hi == n["s"][limb]:
                    continue
                H = holds[hi]
                if limb < 2 and hi == n["s"][1 - limb] and H["kind"] not in ("start", "top"):
                    continue
                if math.hypot(X[hi] - X[cur_i], Y[hi] - Y[cur_i]) > reach_cap:
                    continue
                # Necessary condition (does not change results): the new hip is within MAX_HIP_SHIFT of the
                # old hip, so a limb that can reach from the new hip is within reach + shift of the old hip.
                if limb < 2:
                    if math.hypot(X[hi] - hip_x, Y[hi] - (hip_y + body["shoulderUp"])) > hand_cap:
                        continue
                elif math.hypot(X[hi] - hip_x, Y[hi] - hip_y) > foot_cap:
                    continue
                s = list(n["s"])
                s[limb] = hi
                s = tuple(s)
                bp = place_body(s, X, Y, body, strain_limit)
                if not bp:
                    continue
                if not transition_ok(n["bp"], bp, s, limb, X, Y, body, strain_limit):
                    continue
                strain_term = 0.6 * max(0, bp[2] - 0.6) ** 2 * 6
                dynamic = bp[2] > 1.0 + 1e-9  # tolerance: hips are clamped to the reach edge, so strain is often 1.0 up to float noise
                g = (n["g"] + 1 + strain_term + (1.5 if dynamic else 0) + balance_cost(bp, s)
                     + (hand_cost(limb, hi) if limb < 2 else 0))
                if s in best and best[s] <= g:
                    continue
                best[s] = g
                heap.push({"s": s, "g": g, "f": g + heur(s), "parent": n,
                           "move": {"limb": limb, "from": cur["idx"], "to": hi, "dynamic": dynamic}, "bp": bp})
    ms = (time.perf_counter() - t0) * 1000
    if goal is None:
        if expansions >= max_exp:
            msg = ("Search stopped after %d states without finding a route. "
                   "Try adding holds, or check calibration." % expansions)
        else:
            msg = ("No route found with these holds and this body size. This does not mean the wall is "
                   "impossible, only that these holds do not link up under the simple reach model.")
        return {"ok": False, "message": msg, "computeMs": ms, "expansions": expansions}

    chain = []
    n = goal
    while n:
        chain.append(n)
        n = n["parent"]
    chain.reverse()
    moves = []
    for i, n in enumerate([c for c in chain if c["move"]]):
        m = n["move"]
        moves.append({
            "step": i + 1, "limb": LIMB_NAMES[m["limb"]], "toHold": holds[m["to"]]["id"], "toIdx": m["to"],
            "to": {"x": holds[m["to"]]["x"], "y": holds[m["to"]]["y"]},
            "from": {"x": holds[m["from"]]["x"], "y": holds[m["from"]]["y"]},
            "dynamic": m["dynamic"], "strain": n["bp"][2],
            "hip": {"x": n["bp"][0], "y": n["bp"][1]},
            "state": [holds[j]["id"] for j in n["s"]],
            "prevState": [holds[j]["id"] for j in n["parent"]["s"]],
            "hipShift": math.hypot(n["bp"][0] - n["parent"]["bp"][0], n["bp"][1] - n["parent"]["bp"][1]),
        })
    start = chain[0]
    by_id = {h["id"]: h for h in holds}
    bal = max(0, round(100 - 100 * sum(abs(m["hip"]["x"] - 0.5 * (by_id[m["state"][2]]["x"] + by_id[m["state"][3]]["x"]))
                                       for m in moves) / (len(moves) * 0.25 * body["height"])))
    return {
        "ok": True,
        "start": {"state": [holds[j]["id"] for j in start["s"]], "hip": {"x": start["bp"][0], "y": start["bp"][1]}},
        "moves": moves,
        "reachMarginCm": round(min([(1 - m["strain"]) * body["armReach"] for m in moves] + [body["armReach"]])),
        "maxStrain": max([0] + [m["strain"] for m in moves]),
        "dynamicMoves": sum(1 for m in moves if m["dynamic"]),
        "balanceScore": bal,
        "cost": goal["g"], "expansions": expansions, "computeMs": ms, "body": body,
        "maxHipShiftCm": round(max([0] + [m["hipShift"] for m in moves])),
        "groundX": start_x if has_ground else None,
        "verification": verify_route(X, Y, chain, body, strain_limit),
    }


def verify_route(X, Y, chain, body, limit):
    issues = []
    for i, n in enumerate(chain):
        bp = place_body(n["s"], X, Y, body, limit)
        if not bp:
            issues.append("pose %d not reachable" % i)
        if i > 0:
            diff = sum(1 for k in range(4) if n["s"][k] != chain[i - 1]["s"][k])
            if diff != 1:
                issues.append("step %d changes %d limbs" % (i, diff))
            if bp and not transition_ok(chain[i - 1]["bp"], bp, n["s"], n["move"]["limb"], X, Y, body, limit):
                issues.append("step %d transition invalid" % i)
    return {"ok": not issues, "issues": issues, "checkedPoses": len(chain), "checkedTransitions": len(chain) - 1}

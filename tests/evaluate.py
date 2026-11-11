"""Fixed local evaluator for solver variants (tests-only, not published).

Usage: python3 tests/evaluate.py [path/to/solver.py] [--split tune|heldout|both]

What it checks, independent of the solver's own verify_route:
 - walls come from fixed seeds (tune 1-6, validation 101-106 - already inspected, so NOT an untouched test; final = sealed seeds in a file outside the project (FINAL_SEEDS_FILE), run with --split final only for a real final check); a variant must not read them
 - every returned route is re-checked here from the wall data and the stated body model
   (constants below are copied into the evaluator on purpose so a variant cannot edit them)
 - an invalid route scores 0, a failure scores 0, a time-out scores 0
 - when the reference solver (physics_solver.py) finds a route and a variant says "baseline-style: no route found",
   that is a regression, reported separately
It does not measure real climbing quality. It measures: found a route, route is valid under
this 2D model, cost under this model, time.
"""
import importlib.util, json, math, random, sys, time, multiprocessing as mp
ARM, LEG, SH, MAXSHIFT, TOL = 0.39, 0.50, 0.29, 0.30, 1e-6
TIME_CAP_S = 60

def make_wall(seed):
    r = random.Random(seed)
    holds = []
    for i in range(3): holds.append(dict(id=f"S{i}", x=r.uniform(110, 190), y=r.uniform(40, 80), kind="start", size=3))
    for i in range(r.randint(10, 14)): holds.append(dict(id=f"H{i}", x=r.uniform(40, 260), y=r.uniform(90, 330), kind="hand", size=3))
    for i in range(r.randint(8, 12)): holds.append(dict(id=f"F{i}", x=r.uniform(40, 260), y=r.uniform(10, 280), kind="foot", size=2))
    for i in range(2): holds.append(dict(id=f"T{i}", x=r.uniform(120, 180), y=r.uniform(340, 380), kind="top", size=3))
    return dict(name=f"seed{seed}", profile=dict(heightCm=r.choice([160, 170, 175, 185]), wingspanCm=r.choice([160, 172, 178, 190]), style="static", dominantHand="right"), holds=holds, groundY=0)

def check_route(wall, res):
    """Independent validity check. Returns list of problems (empty = valid)."""
    H = {h["id"]: h for h in wall["holds"]}
    if res.get("groundX") is not None: H["ground"] = dict(id="ground", x=res["groundX"], y=wall["groundY"], kind="foot")
    h_, w_ = wall["profile"]["heightCm"], wall["profile"]["wingspanCm"]
    arm, leg, sh = ARM * w_, LEG * h_, SH * h_
    P = []
    def pose(state, hip):
        for k, hid in enumerate(state):
            if hid not in H: P.append(f"unknown hold {hid}"); return
            x, y = H[hid]["x"], H[hid]["y"]
            if k < 2:
                if math.hypot(x - hip["x"], y - (hip["y"] + sh)) > arm + TOL: P.append(f"hand {hid} out of reach")
            else:
                if math.hypot(x - hip["x"], y - hip["y"]) > leg + TOL: P.append(f"foot {hid} out of reach")
    s = res["start"]; pose(s["state"], s["hip"])
    if not all(H[i]["kind"] == "start" for i in s["state"][:2] if i in H): P.append("start hands not on start holds")
    def stance(state, hip, tag):
        if any(H[i]["y"] > hip["y"] + TOL for i in state[2:] if i in H): P.append(tag + ": a foot is higher than the hips")
        if i_x(state, 0) > i_x(state, 1) + TOL or i_x(state, 2) > i_x(state, 3) + TOL: P.append(tag + ": crossed hands or feet")
    def i_x(state, k): return H[state[k]]["x"] if state[k] in H else 0
    stance(s["state"], s["hip"], "start")
    prev, ph = s["state"], s["hip"]
    for m in res["moves"]:
        ch = [k for k in range(4) if m["state"][k] != prev[k]]
        if ch != ["LH RH LF RF".split().index(m["limb"])]: P.append(f"step {m['step']}: not exactly the stated limb moved")
        if math.hypot(m["hip"]["x"] - ph["x"], m["hip"]["y"] - ph["y"]) > MAXSHIFT * h_ + TOL: P.append(f"step {m['step']}: hip shift too large")
        pose(m["state"], m["hip"]); stance(m["state"], m["hip"], "step %d" % m["step"]); prev, ph = m["state"], m["hip"]
    if not any(i in H and H[i]["kind"] == "top" for i in prev[:2]): P.append("no hand on a top hold at the end")
    return P

def _run(args):
    path, wall, q = args
    spec = importlib.util.spec_from_file_location("variant", path); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    t = time.time(); r = mod.solve(json.loads(json.dumps(wall))); q.put((r, time.time() - t))

def run_one(path, wall):
    q = mp.Queue(); p = mp.Process(target=_run, args=((path, wall, q),)); p.start(); p.join(TIME_CAP_S)
    if p.is_alive(): p.terminate(); return None, TIME_CAP_S, "timeout"
    r, dt = q.get(); return r, dt, ""

def main():
    path = next((a for a in sys.argv[1:] if a.endswith(".py")), "physics_solver.py")
    split = sys.argv[sys.argv.index("--split") + 1] if "--split" in sys.argv else "both"
    sets = {"tune": range(1, 7), "validation": range(101, 107)}
    import os
    if split == "final":  # sealed seeds live in an untracked file; never print them
        sets = {"final": [int(x) for x in open(os.environ["FINAL_SEEDS_FILE"]).read().split()]}
    for name, seeds in sets.items():
        if split not in (name, "both") and not (split == "final" and name == "final"): continue
        solved = valid = 0; costs = []; tt = 0
        for sd in seeds:
            w = make_wall(sd); r, dt, why = run_one(path, w); tt += dt
            lbl = w['name'] if name != 'final' else 'sealed'
            ok = bool(r and r.get("ok")); probs = check_route(w, r) if ok else []
            if ok: solved += 1
            if ok and not probs: valid += 1; costs.append(r["cost"])
            print(f"  {name} {lbl}: {'route' if ok else 'no route'}{' ' + why if why else ''} valid={ok and not probs} {dt:.1f}s {probs[:2] if probs else ''}")
        print(f"{name}: solved {solved}/{len(seeds)}, valid {valid}, mean cost {sum(costs)/len(costs) if costs else float('nan'):.2f}, time {tt:.1f}s")
if __name__ == "__main__": main()

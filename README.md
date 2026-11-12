# Climb Move Helper (early test version)

A browser tool that suggests which hand or foot to move next, one move at a time, from your height and arm span plus holds you mark on a wall photo (or a built-in sample wall). The solver is written in Python (`physics_solver.py`) and runs in your browser through Pyodide. No backend, no paid services. Your photo is not uploaded anywhere.

## What it is and is not
- A simple flat (2D) reach-and-balance search. It is not validated biomechanics.
- It cannot see wall angle, depth, hold shape, friction or your strength. Weight is not asked for or used.
- Conservative stance rules: a pose is rejected if a foot hold is higher than the hips, or if hands or feet cross left to right. This also rules out some real moves.
- Hold types come from you (sample wall: 25 preset holds). Nothing is detected automatically yet.
- The picture is an illustration of one suggested move, not a body simulation. It is a guess, not a claim that a route is best, possible or safe.

## Files
- `physics_solver.py` - the solver (standard library only). Source of truth.
- `src/` - page sources (`index.html`, `app.js`, `styles.css`, `solver_worker.js`, `sampleWall.js`). `python3 src/build_single.py` writes the single `index.html` that is served. Run it after changing any of these or the solver.
- `vendor/pyodide/` - the Pyodide 314.0.7 core runtime (about 12 MB), served from this site so no CDN is used. Unmodified official release files. Licenses for it and the components inside it are in `vendor/pyodide/licenses/` and mapped in `vendor/pyodide/NOTICE.txt`.
- `tests/` - `test_parity.py` (needs Node; compares with the first JavaScript prototype in `tests/legacy/`, with the new stance rules switched off), `evaluate.py` (fixed tune and validation walls with an independent route check), `e2e.mjs` and `e2e_auto.mjs` (headless Chrome click-through, incl. colour finder), `test_match.py` (two hands on one hold).
- `RUNBOOK.md` - plan for offline solver experiments. Not built and not run.

## Run it
`python3 -m http.server` in this folder, then open http://localhost:8000. It must be served over http (not opened as a file) so the Python runtime can load. The first load takes a few seconds and downloads about 12 MB from the same site.

## Tests
`python3 tests/test_parity.py`, `python3 tests/test_match.py`, `python3 tests/evaluate.py --split both`, `node tests/e2e.mjs http://localhost:8000 /tmp` (Chrome required).

## Hosting
Served by GitHub Pages from the `main` branch root. No build runs on the server.

## License
No license has been chosen yet for this project's own code. The bundled Pyodide runtime keeps its own licenses (MPL-2.0 and others, see `vendor/pyodide/`).

## Research idea (not built)
[Dream-RSI](https://www.dream-rsi.com/) improves the exploration policy of a coding agent by replaying recorded search trees. Adapting that idea to this solver would need a fixed benchmark, held-out walls and checks against score shortcuts. See `RUNBOOK.md`. Nothing here claims it works.

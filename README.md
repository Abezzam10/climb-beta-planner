# Climb Beta Planner (Phase 1 MVP preview)

A static, browser-only tool that suggests a hand and foot sequence up a wall, from your height and wingspan plus holds you mark on a photo (or a built-in sample wall). Open `index.html` (or run `python3 -m http.server` here) - no build step, no backend, no paid services. No CDN or network needed.

## Honest scope
- 2D heuristic search (A*) in `physicsSolver.js`. It is not validated biomechanics.
- It cannot see wall angle, depth, hold quality, friction or your strength. Weight is collected but not used in scoring.
- Hold types and sizes are marked by you (sample wall: 25 pre-set holds). The ground is wherever you set the ground line. Nothing is detected automatically yet.
- "Dynamic" means a reach slightly past the static limit, flagged and unverified.
- Output is a suggestion to try, not a claim of best, optimal or safe.
- Tested with a synthetic photo (see tests/e2e.mjs), not a real gym photo set. Mac/Ollama speed is unmeasured.

## Files
`index.html`, `styles.css`, `app.js` (UI), `physicsSolver.js` (pure solver, no DOM), `sampleWall.js`, `tests/solver.test.js` (`node tests/solver.test.js`), `tests/e2e.mjs` (Chrome click-through at phone size: `node tests/e2e.mjs http://localhost:8000 /tmp`).

## Hosting on GitHub Pages
This repo is served straight from the `main` branch (Settings > Pages > Deploy from a branch > `main` / root). No build step or workflow is needed. Tests are run by hand with `node tests/solver.test.js`.

## Phase 2 idea (research, not built)
[Dream-RSI](https://www.dream-rsi.com/) (project page; citation on the page is still a placeholder) improves the *exploration policy* of a coding agent running long discovery loops, by replaying recorded search trees as a cheap simulator. It is not a photo-to-route model. A possible adaptation: a local coding model (e.g. via Ollama) proposes variants of `physicsSolver.js`, scored offline on a fixed benchmark of walls. Needed first: a benchmark with ground-truth routes, held-out walls, and checks against shortcut gains (e.g. scoring well by making the model too permissive). Local model quality and speed on an 8GB/16GB M1 are untested.

Phase 3 idea: hold detection from photos with a small open-source detector (see https://github.com/mkurc1/climbingcrux_model, MIT, for a YOLO-based approach with marker-based scale). Check dataset and model licences before use.

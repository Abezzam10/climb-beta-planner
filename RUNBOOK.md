# Offline "dreaming" runbook (plan only, nothing here has been run on a Mac)

Status: not implemented. The Python port is the solver only.
1. Setup: Python 3.11+, no packages needed for the solver or tests/evaluate.py.
2. Baseline: `python3 tests/evaluate.py physics_solver.py` (tune 1-6, validation 101-106; validation is already inspected; sealed final seeds in a file outside the project are for the last check only).
3. A "dream" run would propose a variant solver file (heuristic weights, pruning), run evaluate.py on the TUNE split only,
   keep a log of every attempt (variant, scores), and replay that log offline to pick the next attempt.
4. Accept a variant only if: all returned routes pass evaluate.py's independent check, validation solved count and cost are no worse
   than baseline, no wall that baseline solves becomes unsolved, and the 60 s cap holds.
5. Local LLM (Ollama, 8 GB M1) is optional and unmeasured; model name, size and license must be checked before use.
6. Handoff: user runs the commands on his Mac and sends back the printed score lines. Nothing runs without him.

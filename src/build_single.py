"""Inline the sources into one index.html:  python3 src/build_single.py   (run from the repo root)
physics_solver.py (repo root) is the single source of truth for the solver; it is embedded as text and run by Pyodide in a Web Worker."""
import os
d = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(d)
r = lambda p: open(p).read()
h = r(os.path.join(d, 'index.html'))
h = h.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + r(os.path.join(d, 'styles.css')) + '</style>')
h = h.replace('<script src="sampleWall.js"></script>', '<script>\n' + r(os.path.join(d, 'sampleWall.js')) + '\n</script>')
h = h.replace('/*PYSRC*/', r(os.path.join(root, 'physics_solver.py')).replace('</script', '<\\/script'))
h = h.replace('/*WORKER*/', r(os.path.join(d, 'solver_worker.js')))
h = h.replace('<script src="app.js"></script>', '<script>\n' + r(os.path.join(d, 'app.js')) + '\n</script>')
open(os.path.join(root, 'index.html'), 'w').write(h)

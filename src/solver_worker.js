let py = null;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const t0 = performance.now();
      const mod = await import(m.indexURL + 'pyodide.mjs');
      py = await mod.loadPyodide({ indexURL: m.indexURL });
      py.runPython(m.src);
      postMessage({ type: 'ready', ms: performance.now() - t0 });
    } else if (m.type === 'solve') {
      py.globals.set('_inp', JSON.stringify(m.input));
      const out = py.runPython('import json\njson.dumps(solve(json.loads(_inp)))');
      postMessage({ type: 'result', id: m.id, result: JSON.parse(out) });
    }
  } catch (err) { postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};

/* Hold finder: plain colour segmentation, no machine learning, no network. Runs in the browser on the pixels of the photo.
   It proposes blobs that differ from the wall colour. It does not know what a hold is: shadows, bolts, mats, tape and stickers
   can show up, and holds close to the wall colour or touching each other can be missed or merged. The user checks every proposal. */
(function (root) {
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return [h, mx === 0 ? 0 : d / mx, mx];
  }
  function colourName(h, s, v, wallHsv) {
    if (v < 0.22) return 'black';
    // a pale or greyish blob in the wall's own hue is a grey or white hold lit by the wall colour, not a coloured one
    if (wallHsv && s < Math.min(0.5, wallHsv[1] * 0.6) && Math.min(Math.abs(h - wallHsv[0]), 360 - Math.abs(h - wallHsv[0])) < 30) return v > 0.72 ? 'white' : 'grey';
    if (s < 0.16) return v > 0.72 ? 'white' : 'grey';
    if (h >= 318 || h < 12) return s < 0.62 ? 'pink' : 'red';
    if (h < 42) return 'orange';
    if (h < 72) return 'yellow';
    if (h < 168) return 'green';
    if (h < 200) return 'teal';
    if (h < 258) return 'blue';
    if (h < 318) return 'purple';
    return 'other';
  }
  const hdist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  // Two touching holds of different colours: 2-means on the hue of the saturated pixels. Returns two pixel lists, or null.
  function splitByHue(px, data, W, minA) {
    const hs = [];
    for (const i of px) { const hsv = rgb2hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); if (hsv[1] > 0.35 && hsv[2] > 0.3) hs.push([i, hsv[0]]); }
    if (hs.length < 2 * minA) return null;
    let c0 = hs[0][1], c1 = c0, best = -1;
    for (const [, h] of hs) { const d = hdist(h, hs[0][1]); if (d > best) { best = d; c1 = h; } }
    for (let it = 0; it < 6; it++) {
      let x0 = 0, y0 = 0, n0 = 0, x1 = 0, y1 = 0, n1 = 0;
      for (const [, h] of hs) { const r = h * Math.PI / 180; if (hdist(h, c0) <= hdist(h, c1)) { x0 += Math.cos(r); y0 += Math.sin(r); n0++; } else { x1 += Math.cos(r); y1 += Math.sin(r); n1++; } }
      if (!n0 || !n1) return null;
      c0 = (Math.atan2(y0, x0) * 180 / Math.PI + 360) % 360; c1 = (Math.atan2(y1, x1) * 180 / Math.PI + 360) % 360;
    }
    if (hdist(c0, c1) < 50) return null;
    const A = [], B = [];
    for (const i of px) { const hsv = rgb2hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); const h = hsv[0]; (hdist(h, c0) <= hdist(h, c1) ? A : B).push(i); }
    return A.length >= minA * 1.5 && B.length >= minA * 1.5 && Math.min(A.length, B.length) >= 0.25 * px.length ? [A, B] : null;
  }
  // data: RGBA bytes, W x H. Returns { wall:[r,g,b], blobs:[{x,y,r,area,color,rgb:[r,g,b]}] } with x,y in pixels (y down).
  function findHolds(data, W, H, opt) {
    opt = opt || {};
    const N = W * H;
    // 1. wall colour: the most common colour (16 levels per channel), averaged over its neighbouring bins
    const bins = new Map();
    for (let i = 0; i < N; i += 3) {
      const k = (data[i * 4] >> 4) * 256 + (data[i * 4 + 1] >> 4) * 16 + (data[i * 4 + 2] >> 4);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
    let bk = 0, bc = -1; bins.forEach((c, k) => { if (c > bc) { bc = c; bk = k; } });
    const br = bk >> 8, bg = (bk >> 4) & 15, bb = bk & 15;
    let sr = 0, sg = 0, sb = 0, sn = 0;
    for (let i = 0; i < N; i += 3) {
      const r = data[i * 4] >> 4, g = data[i * 4 + 1] >> 4, b = data[i * 4 + 2] >> 4;
      if (Math.abs(r - br) <= 1 && Math.abs(g - bg) <= 1 && Math.abs(b - bb) <= 1) { sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; sn++; }
    }
    const wall = [sr / sn, sg / sn, sb / sn], wallHsv = rgb2hsv(sr / sn, sg / sn, sb / sn), wsum = wall[0] + wall[1] + wall[2] + 1;
    const wchr = [wall[0] / wsum, wall[1] / wsum, wall[2] / wsum];
    // 2. mask: pixels far from the wall colour, either in brightness-free colour or in plain RGB distance
    const T = opt.dist || 95, TC = opt.chroma || 0.1;
    let mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const dr = r - wall[0], dg = g - wall[1], db = b - wall[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      const sum = r + g + b + 1;
      const dc = Math.abs(r / sum - wchr[0]) + Math.abs(g / sum - wchr[1]) + Math.abs(b / sum - wchr[2]);
      if (dist > T || (dc > TC * 2 && sum > 150 && dist > 45)) mask[i] = 1;
    }
    // 3. opening (erode then dilate, 3x3) removes bolt holes, specks and thin lines
    const erode = (m) => { const o = new Uint8Array(N); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (m[i] && m[i - 1] && m[i + 1] && m[i - W] && m[i + W] && m[i - W - 1] && m[i - W + 1] && m[i + W - 1] && m[i + W + 1]) o[i] = 1; } return o; };
    const dilate = (m) => { const o = new Uint8Array(N); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (m[i] || m[i - 1] || m[i + 1] || m[i - W] || m[i + W]) o[i] = 1; } return o; };
    mask = dilate(erode(erode(mask)));
    // 4. connected blobs
    const seen = new Uint8Array(N), blobs = [], stack = [];
    const minA = opt.minArea || Math.max(40, N * 0.00018), maxA = opt.maxArea || N * 0.05;
    for (let s = 0; s < N; s++) {
      if (!mask[s] || seen[s]) continue;
      let area = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0; const px = [];
      stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % W, y = (i - x) / W; area++; sx += x; sy += y; px.push(i);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
        if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
        if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
        if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (area < minA || area > maxA) continue;
      if (Math.max(bw, bh) / Math.min(bw, bh) > 4.5) continue;   // long strips: mats, wall edges, tape
      if (area / (bw * bh) < 0.3) continue;                        // ragged shapes
      // split a blob that is clearly two colours (two holds touching), using the hues of its coloured pixels
      const parts = splitByHue(px, data, W, minA);
      for (const part of (parts || [px])) {
        let pa = part.length, psx = 0, psy = 0, px0 = W, px1 = 0, py0 = H, py1 = 0;
        for (const i of part) { const x = i % W, y = (i - x) / W; psx += x; psy += y; if (x < px0) px0 = x; if (x > px1) px1 = x; if (y < py0) py0 = y; if (y > py1) py1 = y; }
        const cx = psx / pa, cy = psy / pa, rad = Math.sqrt(pa / Math.PI);
        let r = 0, g = 0, b = 0, n = 0;
        for (const i of part) { const x = i % W, y = (i - x) / W; if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= (0.6 * rad) * (0.6 * rad)) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; } }
        if (!n) continue; r /= n; g /= n; b /= n;
        const hsv = rgb2hsv(r, g, b);
        blobs.push({ x: cx, y: cy, r: rad, area: pa, color: colourName(hsv[0], hsv[1], hsv[2], wallHsv), rgb: [Math.round(r), Math.round(g), Math.round(b)], touchesEdge: px0 <= 1 || py0 <= 1 || px1 >= W - 2 || py1 >= H - 2, split: !!parts });
      }
    }
    return { wall: wall.map(Math.round), blobs };
  }
  const api = { findHolds, colourName, rgb2hsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HoldFinder = api;
})(typeof window !== 'undefined' ? window : globalThis);

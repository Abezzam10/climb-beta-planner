/* Sample wall: a made-up 3 m x 4.5 m wall with 25 holds. Not a real gym. Units: cm, y up. */
(function (root) {
  const H = [
    // [x, y, kind, size]
    [120, 60, 'start', 3], [175, 70, 'start', 3],
    [90, 25, 'foot', 2], [200, 30, 'foot', 2], [150, 45, 'foot', 2],
    [105, 130, 'hand', 2], [190, 150, 'hand', 1], [140, 190, 'hand', 3],
    [80, 100, 'foot', 2], [215, 105, 'foot', 2], [125, 115, 'foot', 1],
    [210, 230, 'hand', 2], [100, 245, 'hand', 1], [165, 275, 'hand', 3],
    [140, 150, 'foot', 2], [180, 205, 'foot', 2], [120, 215, 'foot', 1],
    [95, 320, 'hand', 2], [205, 315, 'hand', 1], [150, 350, 'hand', 3],
    [170, 260, 'foot', 2], [115, 290, 'foot', 2], [190, 335, 'foot', 1],
    [130, 395, 'hand', 2], [160, 430, 'top', 3],
  ];
  const holds = H.map((h, i) => ({ id: 'H' + (i + 1), x: h[0], y: h[1], kind: h[2], size: h[3] }));
  root.SAMPLE_WALL = { widthCm: 300, heightCm: 450, holds };
})(typeof window !== 'undefined' ? window : globalThis);

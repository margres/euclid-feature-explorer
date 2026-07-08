// Euclid feature-space explorer — vanilla WebGL, no dependencies.
(function () {
  "use strict";

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const POS = new Float32Array(b64ToBytes(POSITIONS_B64).buffer);
  const GRD = b64ToBytes(GRADES_B64);
  const IDLIST = IDS.split("\n");
  const N = MANIFEST.n;
  const NN_K = MANIFEST.nnK || 0;
  const MER = (typeof MER_FIELDS !== "undefined") ? MER_FIELDS : null;

  const GRADE_NAME = MANIFEST.grades;
  const GRADE_HEX = { 1: "#4895ef", 2: "#f4a261", 3: "#e63946" };

  const idToIndex = new Map();
  for (let i = 0; i < N; i++) idToIndex.set(IDLIST[i], i);

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = POS[2 * i], y = POS[2 * i + 1];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const canvas = document.getElementById("gl");
  const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });

  const view = { scale: 1, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2 };
  let fitScale = 1;
  function fitView() {
    const w = canvas.width, h = canvas.height;
    const sx = w / ((xmax - xmin) || 1), sy = h / ((ymax - ymin) || 1);
    view.scale = 0.9 * Math.min(sx, sy);
    fitScale = view.scale;
    view.cx = (xmin + xmax) / 2; view.cy = (ymin + ymax) / 2;
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function link(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  // ---- main points ----
  const VS = `
    attribute vec2 aPos; attribute float aGrade;
    uniform vec2 uCenter; uniform float uScale; uniform vec2 uHalf;
    uniform float uPass; uniform float uZoom;
    uniform float uShowA; uniform float uShowB; uniform float uShowC;
    varying float vGrade;
    void main() {
      vGrade = aGrade;
      vec2 p = (aPos - uCenter) * uScale / uHalf;
      gl_Position = vec4(p, 0.0, 1.0);
      float graded = step(0.5, aGrade);
      if (uPass < 0.5 && graded > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      if (uPass > 0.5 && graded < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      if (uPass > 0.5 && graded > 0.5) {       // per-grade visibility
        float vis = aGrade > 2.5 ? uShowA : (aGrade > 1.5 ? uShowB : uShowC);
        if (vis < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      }
      float f = clamp(sqrt(uZoom), 1.0, 6.0);     // grow points as you zoom in
      float sz;
      if (aGrade > 2.5) sz = 10.0 * min(f, 2.2);
      else if (aGrade > 1.5) sz = 8.0 * min(f, 2.2);
      else if (aGrade > 0.5) sz = 7.0 * min(f, 2.2);
      else sz = 2.2 * f;                          // background grows up to ~6x
      gl_PointSize = sz;
    }`;
  const FS = `
    precision mediump float;
    varying float vGrade;
    uniform float uBgAlpha;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = length(d);
      if (r > 0.5) discard;
      vec3 col; float a;
      if (vGrade > 2.5) { col = vec3(0.902, 0.224, 0.275); a = 1.0; }
      else if (vGrade > 1.5) { col = vec3(0.957, 0.635, 0.380); a = 1.0; }
      else if (vGrade > 0.5) { col = vec3(0.282, 0.584, 0.937); a = 1.0; }
      else { col = vec3(0.45); a = uBgAlpha; }
      if (vGrade > 0.5 && r > 0.34) col = vec3(1.0);
      gl_FragColor = vec4(col, a);
    }`;
  const prog = link(VS, FS);
  const inter = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { inter[3 * i] = POS[2 * i]; inter[3 * i + 1] = POS[2 * i + 1]; inter[3 * i + 2] = GRD[i]; }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, inter, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aGrade = gl.getAttribLocation(prog, "aGrade");
  const uCenter = gl.getUniformLocation(prog, "uCenter");
  const uScale = gl.getUniformLocation(prog, "uScale");
  const uHalf = gl.getUniformLocation(prog, "uHalf");
  const uPass = gl.getUniformLocation(prog, "uPass");
  const uBgAlpha = gl.getUniformLocation(prog, "uBgAlpha");
  const uZoom = gl.getUniformLocation(prog, "uZoom");
  const uShowA = gl.getUniformLocation(prog, "uShowA");
  const uShowB = gl.getUniformLocation(prog, "uShowB");
  const uShowC = gl.getUniformLocation(prog, "uShowC");

  // ---- overlay markers (0 neighbor magenta, 1 query cyan, 2 flagged green) ----
  const OVS = `
    attribute vec2 aPos; attribute float aKind;
    uniform vec2 uCenter; uniform float uScale; uniform vec2 uHalf;
    varying float vKind;
    void main() {
      vKind = aKind;
      vec2 p = (aPos - uCenter) * uScale / uHalf;
      gl_Position = vec4(p, 0.0, 1.0);
      gl_PointSize = aKind > 0.5 ? (aKind > 1.5 ? 17.0 : 21.0) : 15.0;
    }`;
  const OFS = `
    precision mediump float;
    varying float vKind;
    void main() {
      vec2 d = gl_PointCoord - vec2(0.5);
      float r = length(d);
      if (r > 0.5 || r < 0.30) discard;
      vec3 col;
      if (vKind > 1.5) col = vec3(0.12, 1.0, 0.31);     // flagged: green
      else if (vKind > 0.5) col = vec3(0.0, 0.85, 1.0);  // query: cyan
      else col = vec3(1.0, 0.17, 0.84);                  // neighbor: magenta
      gl_FragColor = vec4(col, 1.0);
    }`;
  const ovProg = link(OVS, OFS);
  const ovPos = gl.getAttribLocation(ovProg, "aPos");
  const ovKind = gl.getAttribLocation(ovProg, "aKind");
  const ovCenter = gl.getUniformLocation(ovProg, "uCenter");
  const ovScale = gl.getUniformLocation(ovProg, "uScale");
  const ovHalf = gl.getUniformLocation(ovProg, "uHalf");
  const nbrBuf = gl.createBuffer(); let nbrCount = 0;
  const flagBuf = gl.createBuffer(); let flagCount = 0;

  // ---- paper + scale filters (graded objects only; data from refs.js) ----
  // Empty set = no filter (show all). Papers are OR-combined; scale is OR-combined;
  // the two filters are AND-combined. Untagged scale defaults to "galaxy".
  const REF_OK = (typeof REF_MAP !== "undefined") && REF_MAP;
  const SCALE_OK = (typeof SCALE_MAP !== "undefined") && SCALE_MAP;
  const selectedRefs = new Set();       // selected paper tokens
  const selectedScales = new Set();     // selected scales: galaxy|group|cluster
  const refBuf = gl.createBuffer(); let refCount = 0;   // matching graded points [x,y,grade]
  function paperPass(i) {
    if (!selectedRefs.size) return true;
    const r = REF_OK ? REF_MAP[IDLIST[i]] : null;       // "Walmsley+25|Rojas+25"
    if (!r) return false;
    const padded = "|" + r + "|";
    for (const t of selectedRefs) if (padded.indexOf("|" + t + "|") >= 0) return true;
    return false;
  }
  function scaleOf(i) {
    const s = SCALE_OK ? SCALE_MAP[IDLIST[i]] : null;    // only non-galaxy ids are stored
    return s || "galaxy";
  }
  function scalePass(i) {
    if (!selectedScales.size) return true;
    return selectedScales.has(scaleOf(i));
  }
  function filterPass(i) { return paperPass(i) && scalePass(i); }
  function filterActive() { return selectedRefs.size > 0 || selectedScales.size > 0; }
  function rebuildRefFilter() {
    if (!filterActive()) { refCount = 0; return; }
    const pts = [];
    for (const i of gradedIdx) if (filterPass(i)) pts.push(POS[2 * i], POS[2 * i + 1], GRD[i]);
    gl.bindBuffer(gl.ARRAY_BUFFER, refBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    refCount = pts.length / 3;
  }

  function setNbrOverlay(queryIdx, nbrIdx) {
    const pts = [];
    for (const j of nbrIdx) pts.push(POS[2 * j], POS[2 * j + 1], 0.0);
    pts.push(POS[2 * queryIdx], POS[2 * queryIdx + 1], 1.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, nbrBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    nbrCount = nbrIdx.length + 1; draw();
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(1, 1, 1, 1);

  let hideBg = false, bgAlpha = 0.45;
  const showGrade = { 1: true, 2: true, 3: true };   // C, B, A
  function gradeVisible(code) { return code === 0 ? !hideBg : showGrade[code]; }
  function anyGraded() { return showGrade[1] || showGrade[2] || showGrade[3]; }
  function drawOverlay(b, count) {
    if (count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(ovPos); gl.vertexAttribPointer(ovPos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(ovKind); gl.vertexAttribPointer(ovKind, 1, gl.FLOAT, false, 12, 8);
    gl.drawArrays(gl.POINTS, 0, count);
  }
  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (imageActive()) { drawImages(); drawMarkersOnly(); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(aGrade); gl.vertexAttribPointer(aGrade, 1, gl.FLOAT, false, 12, 8);
    gl.uniform2f(uCenter, view.cx, view.cy);
    gl.uniform1f(uScale, view.scale);
    gl.uniform2f(uHalf, canvas.width / 2, canvas.height / 2);
    gl.uniform1f(uBgAlpha, bgAlpha);
    gl.uniform1f(uZoom, view.scale / fitScale);
    gl.uniform1f(uShowA, showGrade[3] ? 1.0 : 0.0);
    gl.uniform1f(uShowB, showGrade[2] ? 1.0 : 0.0);
    gl.uniform1f(uShowC, showGrade[1] ? 1.0 : 0.0);
    if (!hideBg) { gl.uniform1f(uPass, 0.0); gl.drawArrays(gl.POINTS, 0, N); }
    if (anyGraded()) {
      gl.uniform1f(uPass, 1.0);
      if (filterActive()) {
        // draw only the matching graded points (per-grade still gated by uShow* in the shader)
        gl.bindBuffer(gl.ARRAY_BUFFER, refBuf);
        gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
        gl.enableVertexAttribArray(aGrade); gl.vertexAttribPointer(aGrade, 1, gl.FLOAT, false, 12, 8);
        if (refCount > 0) gl.drawArrays(gl.POINTS, 0, refCount);
      } else {
        gl.drawArrays(gl.POINTS, 0, N);     // main buf still bound
      }
    }
    drawMarkersOnly();
  }
  function drawMarkersOnly() {
    gl.useProgram(ovProg);
    gl.uniform2f(ovCenter, view.cx, view.cy);
    gl.uniform1f(ovScale, view.scale);
    gl.uniform2f(ovHalf, canvas.width / 2, canvas.height / 2);
    drawOverlay(flagBuf, flagCount);
    drawOverlay(nbrBuf, nbrCount);
  }

  const dpr = () => (window.devicePixelRatio || 1);
  function screenToWorld(sx, sy) {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    const scaleCss = view.scale / dpr();
    return [view.cx + (sx - hw) / scaleCss, view.cy - (sy - hh) / scaleCss];
  }
  function worldToScreen(wx, wy) {
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    const scaleCss = view.scale / dpr();
    return [hw + (wx - view.cx) * scaleCss, hh - (wy - view.cy) * scaleCss];
  }

  // ---- picking grid ----
  const GRID = 256;
  const cellW = (xmax - xmin) / GRID || 1, cellH = (ymax - ymin) / GRID || 1;
  const cells = new Map();
  const gradedIdx = [];
  function cellKey(cx, cy) { return cx * 100000 + cy; }
  for (let i = 0; i < N; i++) {
    if (GRD[i] > 0) gradedIdx.push(i);
    const cx = Math.min(GRID - 1, Math.max(0, Math.floor((POS[2 * i] - xmin) / cellW)));
    const cy = Math.min(GRID - 1, Math.max(0, Math.floor((POS[2 * i + 1] - ymin) / cellH)));
    const k = cellKey(cx, cy);
    let arr = cells.get(k); if (!arr) { arr = []; cells.set(k, arr); }
    arr.push(i);
  }
  function pick(sx, sy) {
    let best = -1, bestD = Infinity;
    const GRADED_R = 14, BG_R = 8;
    if (anyGraded()) {
      for (const i of gradedIdx) {
        if (!showGrade[GRD[i]]) continue;
        if (!filterPass(i)) continue;
        const [px, py] = worldToScreen(POS[2 * i], POS[2 * i + 1]);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && bestD <= GRADED_R) return best;
    }
    const [wx, wy] = screenToWorld(sx, sy);
    const ccx = Math.floor((wx - xmin) / cellW), ccy = Math.floor((wy - ymin) / cellH);
    best = -1; bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = cells.get(cellKey(ccx + dx, ccy + dy)); if (!arr) continue;
      for (const i of arr) {
        if (!gradeVisible(GRD[i])) continue;
        if (GRD[i] > 0 && !filterPass(i)) continue;
        const [px, py] = worldToScreen(POS[2 * i], POS[2 * i + 1]);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return (best >= 0 && bestD <= BG_R) ? best : -1;
  }

  // ---- sprite crop ----
  const PER_ROW = MANIFEST.perRow, PER_SHEET = MANIFEST.perSheet, THUMB = MANIFEST.thumb;
  const sheetCache = new Map();
  function loadSheet(s) {
    if (sheetCache.has(s)) return sheetCache.get(s);
    const img = new Image();
    img.src = "sheets/sheet_" + String(s).padStart(3, "0") + ".jpg";
    sheetCache.set(s, img);
    return img;
  }
  function cropInto(ctx, i, dw, dh, smooth) {
    const s = Math.floor(i / PER_SHEET), within = i % PER_SHEET;
    const col = within % PER_ROW, row = Math.floor(within / PER_ROW);
    const px = col * THUMB, py = row * THUMB;
    const img = loadSheet(s);
    const drawCrop = () => {
      // 64px source tiles upscale poorly with nearest-neighbour; smooth the big
      // panel cutout so it doesn't look blocky. Map points / small cards stay crisp.
      ctx.imageSmoothingEnabled = !!smooth;
      if (smooth) ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, dw, dh);
      ctx.drawImage(img, px, py, THUMB, THUMB, 0, 0, dw, dh);
    };
    if (img.complete && img.naturalWidth) drawCrop(); else img.onload = drawCrop;
  }

  // ---- image mode: textured cutout tiles instead of points (viewport-culled LOD) ----
  // We cannot hold all ~266 sprite sheets as GPU textures (4096²×266 ≈ 18 GB), so images
  // are drawn only for objects in view, only when zoomed in enough that a tile is visible,
  // and only a few sheets are kept on the GPU at once (LRU). Zoomed out, we fall back to points.
  const SHEET_PX = MANIFEST.sheet;          // 4096
  const IMG_MIN_PX = 9;                      // min on-screen tile size (CSS px) to show images
  const IMG_MAX_TILES = 45000;               // safety cap on tiles drawn per frame
  const IMG_TEX_CAP = 8;                     // max sheets resident on the GPU (~50 MB each)
  // tile world size ≈ average point spacing, so tiles roughly pave the plane when zoomed in
  const IMG_TILE_WORLD = 1.3 * Math.max((xmax - xmin), (ymax - ymin)) / Math.sqrt(N || 1);
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const IMG_SUPPORTED = MAX_TEX >= SHEET_PX;
  let imageMode = false;

  const IVS = `
    attribute vec2 aPos; attribute vec2 aUv;
    uniform vec2 uCenter; uniform float uScale; uniform vec2 uHalf;
    varying vec2 vUv;
    void main() {
      vUv = aUv;
      vec2 p = (aPos - uCenter) * uScale / uHalf;
      gl_Position = vec4(p, 0.0, 1.0);
    }`;
  const IFS = `
    precision mediump float;
    varying vec2 vUv; uniform sampler2D uTex;
    void main() { gl_FragColor = texture2D(uTex, vUv); }`;
  const imgProg = link(IVS, IFS);
  const iaPos = gl.getAttribLocation(imgProg, "aPos");
  const iaUv = gl.getAttribLocation(imgProg, "aUv");
  const iuCenter = gl.getUniformLocation(imgProg, "uCenter");
  const iuScale = gl.getUniformLocation(imgProg, "uScale");
  const iuHalf = gl.getUniformLocation(imgProg, "uHalf");
  const iuTex = gl.getUniformLocation(imgProg, "uTex");
  const imgVbo = gl.createBuffer();

  const glTex = new Map();   // sheet idx -> { tex, used }
  let texClock = 0;
  function getSheetTex(s) {
    const e = glTex.get(s);
    if (e) { e.used = ++texClock; return e.tex; }
    const img = loadSheet(s);
    if (!(img.complete && img.naturalWidth)) {
      if (!img.__imgHook) { img.__imgHook = true; img.addEventListener("load", () => { if (imageMode) draw(); }); }
      return null;                                   // redraw once the sheet finishes loading
    }
    if (glTex.size >= IMG_TEX_CAP) {                 // evict least-recently-used sheet
      let oldest = null, ok = Infinity;
      for (const [k, v] of glTex) if (v.used < ok) { ok = v.used; oldest = k; }
      if (oldest !== null) { gl.deleteTexture(glTex.get(oldest).tex); glTex.delete(oldest); }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    glTex.set(s, { tex: tex, used: ++texClock });
    return tex;
  }

  function imgTileScreenPx() { return IMG_TILE_WORLD * (view.scale / dpr()); }
  function imageActive() { return imageMode && IMG_SUPPORTED && imgTileScreenPx() >= IMG_MIN_PX; }

  function drawImages() {
    const [ax, ay] = screenToWorld(0, 0);
    const [bx, by] = screenToWorld(window.innerWidth, window.innerHeight);
    const m = IMG_TILE_WORLD;
    const minX = Math.min(ax, bx) - m, maxX = Math.max(ax, bx) + m;
    const minY = Math.min(ay, by) - m, maxY = Math.max(ay, by) + m;
    const cx0 = Math.max(0, Math.floor((minX - xmin) / cellW));
    const cx1 = Math.min(GRID - 1, Math.floor((maxX - xmin) / cellW));
    const cy0 = Math.max(0, Math.floor((minY - ymin) / cellH));
    const cy1 = Math.min(GRID - 1, Math.floor((maxY - ymin) / cellH));
    const bySheet = new Map();
    let total = 0;
    outer:
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const arr = cells.get(cellKey(cx, cy)); if (!arr) continue;
      for (const i of arr) {
        const x = POS[2 * i], y = POS[2 * i + 1];
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const s = Math.floor(i / PER_SHEET);
        let b = bySheet.get(s); if (!b) { b = []; bySheet.set(s, b); }
        b.push(i);
        if (++total >= IMG_MAX_TILES) break outer;
      }
    }
    const h = IMG_TILE_WORLD / 2, inv = 1 / SHEET_PX;
    gl.useProgram(imgProg);
    gl.uniform2f(iuCenter, view.cx, view.cy);
    gl.uniform1f(iuScale, view.scale);
    gl.uniform2f(iuHalf, canvas.width / 2, canvas.height / 2);
    gl.uniform1i(iuTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, imgVbo);
    gl.enableVertexAttribArray(iaPos); gl.vertexAttribPointer(iaPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(iaUv); gl.vertexAttribPointer(iaUv, 2, gl.FLOAT, false, 16, 8);
    for (const [s, idxs] of bySheet) {
      const tex = getSheetTex(s); if (!tex) continue;          // sheet still downloading
      const verts = new Float32Array(idxs.length * 24);        // 6 verts × (pos2 + uv2)
      let o = 0;
      for (const i of idxs) {
        const within = i % PER_SHEET;
        const col = within % PER_ROW, row = Math.floor(within / PER_ROW);
        const u0 = col * THUMB * inv, u1 = (col * THUMB + THUMB) * inv;
        const t0 = row * THUMB * inv, t1 = (row * THUMB + THUMB) * inv;   // t0 = top of tile (no Y-flip)
        const x = POS[2 * i], y = POS[2 * i + 1];
        const xl = x - h, xr = x + h, yt = y + h, yb = y - h;
        verts[o++] = xl; verts[o++] = yt; verts[o++] = u0; verts[o++] = t0;   // TL
        verts[o++] = xl; verts[o++] = yb; verts[o++] = u0; verts[o++] = t1;   // BL
        verts[o++] = xr; verts[o++] = yb; verts[o++] = u1; verts[o++] = t1;   // BR
        verts[o++] = xl; verts[o++] = yt; verts[o++] = u0; verts[o++] = t0;   // TL
        verts[o++] = xr; verts[o++] = yb; verts[o++] = u1; verts[o++] = t1;   // BR
        verts[o++] = xr; verts[o++] = yt; verts[o++] = u1; verts[o++] = t0;   // TR
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, idxs.length * 6);
    }
  }

  // ---- flags + notes ----
  const MARK_KEY = "euclidExplorerMarks_v1";
  let marks = {};
  try { marks = JSON.parse(localStorage.getItem(MARK_KEY) || "{}"); } catch (e) { marks = {}; }
  function saveMarks() { try { localStorage.setItem(MARK_KEY, JSON.stringify(marks)); } catch (e) {} }
  function isFlagged(id) { return !!(marks[id] && marks[id].flag); }
  function getNote(id) { return (marks[id] && marks[id].note) || ""; }
  function ensure(id) { if (!marks[id]) marks[id] = { flag: false, note: "" }; return marks[id]; }
  function cleanup(id) { if (marks[id] && !marks[id].flag && !marks[id].note) delete marks[id]; }
  function toggleFlag(i) {
    const id = IDLIST[i]; ensure(id).flag = !marks[id].flag; cleanup(id);
    saveMarks(); updateFlaggedOverlay(); refreshFlaggedBtn();
    if (i === sel) refreshFlagUI(); draw();
  }
  function setNote(i, text) {
    const id = IDLIST[i]; ensure(id).note = text; cleanup(id); saveMarks(); refreshFlaggedBtn();
  }
  const flaggedBtn = document.getElementById("flaggedBtn");
  function flaggedIds() { return Object.keys(marks).filter((id) => marks[id].flag); }
  function refreshFlaggedBtn() { flaggedBtn.textContent = "★ Flagged (" + flaggedIds().length + ")"; }
  function updateFlaggedOverlay() {
    const pts = [];
    for (const id of flaggedIds()) {
      const i = idToIndex.get(id); if (i === undefined) continue;
      pts.push(POS[2 * i], POS[2 * i + 1], 2.0);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, flagBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
    flagCount = pts.length / 3;
  }

  // ---- MER ----
  const merBox = document.getElementById("merBox");
  function fmtMer(v) {
    if (!Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(3);
    return (Math.round(v * 10000) / 10000).toString();
  }
  async function showMer(i) {
    if (!MER) { merBox.innerHTML = ""; return; }
    const F = MER.length, start = i * F * 4, want = F * 4;
    try {
      const resp = await fetch("mer.bin", { headers: { Range: `bytes=${start}-${start + want - 1}` } });
      const ab = await resp.arrayBuffer();
      let v; if (ab.byteLength === want) v = new Float32Array(ab); else v = new Float32Array(ab.slice(start, start + want));
      merBox.innerHTML = "<div class='meta'><b>MER:</b></div>" + MER.map(([k, label], j) =>
        `<div class="row"><span>${label}</span><span>${fmtMer(v[j])}</span></div>`).join("");
    } catch (e) { merBox.innerHTML = "<div class='meta' style='color:#999'>MER needs the hosted site.</div>"; }
  }

  // ---- panel ----
  let sel = -1;
  const panel = document.getElementById("panel");
  const pcv = document.getElementById("panelCanvas");
  const pctx = pcv.getContext("2d");
  const nnMsg = document.getElementById("nnMsg");
  const flagBtn = document.getElementById("flagBtn");
  const noteEl = document.getElementById("note");
  function refreshFlagUI() {
    if (sel < 0) return;
    const id = IDLIST[sel];
    flagBtn.classList.toggle("on", isFlagged(id));
    flagBtn.textContent = isFlagged(id) ? "⚑ Flagged" : "⚑ Flag";
    noteEl.value = getNote(id);
  }
  function showPanel(i) {
    sel = i;
    cropInto(pctx, i, pcv.width, pcv.height, true);
    pcv.style.borderColor = GRADE_HEX[GRD[i]] || "transparent";
    document.getElementById("panelId").textContent = IDLIST[i];
    document.getElementById("panelGrade").textContent = GRADE_NAME[String(GRD[i])];
    document.getElementById("panelXY").textContent =
      POS[2 * i].toFixed(2) + ", " + POS[2 * i + 1].toFixed(2);
    nnMsg.textContent = "";
    refreshFlagUI(); showMer(i);
    panel.style.display = "block";
  }
  function selectIndex(i, recenter) {
    if (recenter) {
      view.cx = POS[2 * i]; view.cy = POS[2 * i + 1];
      view.scale = Math.max(view.scale, fitScale * 12);
    }
    showPanel(i); draw();
  }

  flagBtn.addEventListener("click", () => { if (sel >= 0) toggleFlag(sel); });
  noteEl.addEventListener("input", () => { if (sel >= 0) setNote(sel, noteEl.value); });

  // ---- modal (used for neighbors + flagged list) ----
  const modal = document.getElementById("modal");
  const modalBody = document.getElementById("modalBody");
  const modalTitle = document.getElementById("modalTitle");
  function closeModal() { modal.style.display = "none"; }
  document.getElementById("modalClose").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
  function makeCard(j) {
    const card = document.createElement("div"); card.className = "card";
    const c = document.createElement("canvas"); c.width = 96; c.height = 96;
    c.style.borderColor = GRADE_HEX[GRD[j]] || "transparent";
    c.title = "open this object";
    cropInto(c.getContext("2d"), j, 96, 96);
    c.addEventListener("click", () => { closeModal(); selectIndex(j, true); });
    const cid = document.createElement("div"); cid.className = "cid";
    cid.textContent = IDLIST[j] + " [" + GRADE_NAME[String(GRD[j])] + "]";
    const crow = document.createElement("div"); crow.className = "crow";
    const fb = document.createElement("button"); fb.className = "fbtn";
    const setFb = () => { fb.classList.toggle("on", isFlagged(IDLIST[j])); fb.textContent = isFlagged(IDLIST[j]) ? "⚑ flagged" : "⚑ flag"; };
    setFb();
    fb.addEventListener("click", () => { toggleFlag(j); setFb(); });
    crow.appendChild(fb);
    const ta = document.createElement("textarea"); ta.placeholder = "notes…"; ta.value = getNote(IDLIST[j]);
    ta.addEventListener("input", () => setNote(j, ta.value));
    card.append(c, cid, crow, ta);
    return card;
  }
  function openModal(title, indices) {
    modalTitle.textContent = title;
    modalBody.innerHTML = "";
    if (!indices.length) { modalBody.innerHTML = "<div style='color:#666'>nothing to show</div>"; }
    indices.forEach((j) => modalBody.appendChild(makeCard(j)));
    modal.style.display = "block";
  }

  // ---- nearest neighbors: computed live from quantized (int8) features ----
  // The search is ~120M int8 multiply-adds over the full table. Run synchronously
  // on the main thread it freezes the tab for many seconds and looks dead, so it
  // runs in a Web Worker (built inline from a Blob — no extra file to ship).
  const FEAT_OK = (typeof FEAT_META !== "undefined") && FEAT_META;
  const NN_MAX = 500;                  // UI cap so the popup doesn't render endless cards
  const NN_WORKER_SRC = `
    let FEAT = null, META = null, loading = null;
    async function ensureFeats(meta, urls) {
      if (FEAT) return;
      if (loading) return loading;
      loading = (async () => {
        META = meta;
        const buf = new Int8Array(meta.n * meta.dims);
        let off = 0;
        for (let c = 0; c < urls.length; c++) {
          postMessage({ type: "progress", msg: "loading features\\u2026 (" + (c + 1) + "/" + urls.length + ")" });
          const resp = await fetch(urls[c]);
          if (!resp.ok) throw new Error("fetch " + urls[c] + " -> HTTP " + resp.status);
          const ab = await resp.arrayBuffer();
          buf.set(new Int8Array(ab), off);
          off += ab.byteLength;
        }
        FEAT = buf;
      })();
      return loading;
    }
    function computeNN(i, topN) {
      const D = META.dims, n = META.n, qi = i * D;
      const q = new Int32Array(D);
      for (let d = 0; d < D; d++) q[d] = FEAT[qi + d];
      const best = []; let worst = -Infinity;       // ascending by sim, length <= topN
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        let s = 0; const ro = r * D;
        for (let d = 0; d < D; d++) s += q[d] * FEAT[ro + d];
        if (best.length < topN || s > worst) {
          let lo = 0, hi = best.length;
          while (lo < hi) { const m = (lo + hi) >> 1; if (best[m].s < s) lo = m + 1; else hi = m; }
          best.splice(lo, 0, { s: s, r: r });
          if (best.length > topN) best.shift();
          worst = best[0].s;
        }
      }
      return best.reverse().map((b) => b.r);        // descending similarity
    }
    onmessage = async (e) => {
      const { meta, urls, i, topN, reqId } = e.data;
      try {
        await ensureFeats(meta, urls);
        postMessage({ type: "progress", msg: "computing neighbors\\u2026" });
        const nbr = computeNN(i, topN);
        postMessage({ type: "result", reqId, nbr });
      } catch (err) {
        postMessage({ type: "error", reqId, msg: String((err && err.message) || err) });
      }
    };
  `;
  let nnWorker = null, nnReqId = 0;
  const nnPending = new Map();
  function ensureWorker() {
    if (nnWorker) return nnWorker;
    const blob = new Blob([NN_WORKER_SRC], { type: "application/javascript" });
    nnWorker = new Worker(URL.createObjectURL(blob));
    nnWorker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") { nnMsg.textContent = d.msg; return; }
      const p = nnPending.get(d.reqId);
      if (!p) return;
      nnPending.delete(d.reqId);
      if (d.type === "result") p.resolve(d.nbr); else p.reject(new Error(d.msg));
    };
    nnWorker.onerror = (e) => {
      for (const [, p] of nnPending) p.reject(new Error(e.message || "worker error"));
      nnPending.clear();
    };
    return nnWorker;
  }
  function workerNN(i, topN) {
    const w = ensureWorker();
    const reqId = ++nnReqId;
    const meta = { dims: FEAT_META.dims, n: FEAT_META.n };
    const urls = [];
    for (let c = 0; c < FEAT_META.chunks; c++) urls.push(new URL("feat_" + c + ".bin", location.href).href);
    return new Promise((resolve, reject) => {
      nnPending.set(reqId, { resolve, reject });
      w.postMessage({ meta, urls, i, topN, reqId });
    });
  }
  async function showNeighbors(i, nWanted) {
    if (!FEAT_OK) { nnMsg.textContent = "neighbor features not available on this build."; return; }
    nnMsg.textContent = "loading features…";
    try {
      const nbr = await workerNN(i, nWanted);
      setNbrOverlay(i, nbr);
      nnMsg.textContent = nbr.length + " neighbors (magenta on map) — opened in popup";
      openModal(nbr.length + " nearest neighbors of " + IDLIST[i], nbr);
    } catch (e) {
      console.error("NN failed:", e);
      const local = location.protocol === "file:";
      nnMsg.textContent = local
        ? "Neighbor compute needs a server (open via the live site or run a local server, not file://)."
        : "Neighbor compute failed: " + ((e && e.message) || e);
    }
  }
  document.getElementById("nnBtn").addEventListener("click", () => {
    if (sel < 0) return;
    let n = parseInt(document.getElementById("nnN").value, 10) || 10;
    n = Math.max(1, Math.min(NN_MAX, n));
    showNeighbors(sel, n);
  });

  flaggedBtn.addEventListener("click", () => {
    const idx = flaggedIds().map((id) => idToIndex.get(id)).filter((i) => i !== undefined);
    openModal("Flagged objects (" + idx.length + ")", idx);
  });

  // ---- export ----
  document.getElementById("exportBtn").addEventListener("click", () => {
    const rows = [["id", "grade", "umap_x", "umap_y", "flagged", "note"]];
    for (const id in marks) {
      const i = idToIndex.get(id);
      const g = i === undefined ? "" : GRADE_NAME[String(GRD[i])];
      const x = i === undefined ? "" : POS[2 * i].toFixed(4);
      const y = i === undefined ? "" : POS[2 * i + 1].toFixed(4);
      const note = (marks[id].note || "").replace(/"/g, '""');
      rows.push([id, g, x, y, marks[id].flag ? "1" : "0", `"${note}"`]);
    }
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "euclid_explorer_flags.csv"; a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---- search ----
  function normalizeId(raw) {
    let s = raw.trim(); if (!s) return "";
    if (s.startsWith("Q1_R1_")) s = s.slice(6);
    const us = s.indexOf("_");
    if (us > 0) {
      const tile = s.slice(0, us), obj = s.slice(us + 1);
      if (obj.startsWith("-")) return tile + "_NEG" + obj.slice(1);
      return tile + "_" + obj;
    }
    return s;
  }
  const searchMsg = document.getElementById("searchMsg");
  function doSearch() {
    const id = normalizeId(document.getElementById("searchBox").value);
    if (!id) { searchMsg.textContent = ""; return; }
    const i = idToIndex.get(id);
    if (i === undefined) { searchMsg.textContent = "not found: " + id; return; }
    searchMsg.textContent = ""; selectIndex(i, true);
  }
  document.getElementById("searchBtn").addEventListener("click", doSearch);
  document.getElementById("searchBox").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  // ---- interaction ----
  let dragging = false, lastX = 0, lastY = 0, moved = false;
  canvas.addEventListener("mousedown", (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; canvas.classList.add("dragging"); });
  window.addEventListener("mouseup", (e) => {
    canvas.classList.remove("dragging");
    if (dragging && !moved) { const i = pick(e.clientX, e.clientY); if (i >= 0) showPanel(i); }
    dragging = false;
  });
  const tooltip = document.getElementById("tooltip");
  let hoverPending = false;
  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const scaleCss = view.scale / dpr();
      view.cx -= dx / scaleCss; view.cy += dy / scaleCss;
      lastX = e.clientX; lastY = e.clientY; draw();
      return;
    }
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(() => {
      hoverPending = false;
      const i = pick(e.clientX, e.clientY);
      if (i >= 0) {
        tooltip.style.display = "block";
        tooltip.style.left = (e.clientX + 12) + "px";
        tooltip.style.top = (e.clientY + 12) + "px";
        tooltip.textContent = IDLIST[i] + "  [" + GRADE_NAME[String(GRD[i])] + "]";
      } else { tooltip.style.display = "none"; }
    });
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    view.scale *= Math.exp(-e.deltaY * 0.001);
    const [nx, ny] = screenToWorld(e.clientX, e.clientY);
    view.cx += wx - nx; view.cy += wy - ny;
    draw();
  }, { passive: false });

  document.getElementById("hideBg").addEventListener("change", (e) => { hideBg = e.target.checked; draw(); });
  document.getElementById("imgMode").addEventListener("change", (e) => {
    if (e.target.checked && !IMG_SUPPORTED) {
      e.target.checked = false;
      searchMsg.textContent = "Image mode needs GPU max texture ≥ " + SHEET_PX + " (this device: " + MAX_TEX + ").";
      return;
    }
    imageMode = e.target.checked;
    if (imageMode && !imageActive()) searchMsg.textContent = "Zoom in to see the cutout images.";
    else if (!imageMode) searchMsg.textContent = "";
    draw();
  });
  document.getElementById("showA").addEventListener("change", (e) => { showGrade[3] = e.target.checked; draw(); });
  document.getElementById("showB").addEventListener("change", (e) => { showGrade[2] = e.target.checked; draw(); });
  document.getElementById("showC").addEventListener("change", (e) => { showGrade[1] = e.target.checked; draw(); });
  document.getElementById("bgOpacity").addEventListener("input", (e) => { bgAlpha = parseFloat(e.target.value); draw(); });
  // multi-select checkbox dropdown: empty selection = all. Calls onChange after edits.
  function makeMultiDropdown(rootId, noun, items, selSet, onChange) {
    const root = document.getElementById(rootId);
    if (!root) return;
    const btn = document.createElement("button"); btn.type = "button";
    const panel = document.createElement("div"); panel.className = "panel";
    root.append(btn, panel);
    const updateBtn = () => {
      btn.textContent = selSet.size === 0 ? ("All " + noun)
        : selSet.size === 1 ? Array.from(selSet)[0]
        : (selSet.size + " " + noun);
    };
    const allRow = document.createElement("label"); allRow.className = "allrow";
    allRow.textContent = "All " + noun;
    const allCb = document.createElement("input"); allCb.type = "checkbox"; allCb.checked = true;
    allRow.prepend(allCb);
    allRow.addEventListener("click", (e) => {
      e.stopPropagation();
      selSet.clear();
      panel.querySelectorAll("input.opt").forEach((c) => { c.checked = false; });
      allCb.checked = true; updateBtn(); onChange();
    });
    panel.appendChild(allRow);
    for (const entry of items) {
      const val = entry[0], cnt = entry[1];
      const lab = document.createElement("label");
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "opt"; cb.value = val;
      cb.addEventListener("change", () => {
        if (cb.checked) selSet.add(val); else selSet.delete(val);
        allCb.checked = selSet.size === 0;
        updateBtn(); onChange();
      });
      lab.append(cb, document.createTextNode(" " + val + " (" + cnt + ")"));
      panel.appendChild(lab);
    }
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".msdd .panel.open").forEach((p) => { if (p !== panel) p.classList.remove("open"); });
      panel.classList.toggle("open");
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    updateBtn();
  }
  document.addEventListener("click", () => {
    document.querySelectorAll(".msdd .panel.open").forEach((p) => p.classList.remove("open"));
  });
  (function initFilters() {
    const onChange = () => { rebuildRefFilter(); draw(); };
    if (typeof REF_LIST !== "undefined" && REF_LIST && REF_LIST.length) {
      makeMultiDropdown("refDD", "papers", REF_LIST, selectedRefs, onChange);
    } else { const r = document.getElementById("refRow"); if (r) r.style.display = "none"; }
    if (typeof SCALE_LIST !== "undefined" && SCALE_LIST && SCALE_LIST.length > 1) {
      makeMultiDropdown("scaleDD", "scales", SCALE_LIST, selectedScales, onChange);
    } else { const r = document.getElementById("scaleRow"); if (r) r.style.display = "none"; }
  })();
  document.getElementById("resetView").addEventListener("click", () => { fitView(); nbrCount = 0; draw(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  window.addEventListener("resize", () => { resize(); draw(); });

  // ---- legend ----
  (function legend() {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < N; i++) if (GRD[i] > 0) counts[GRD[i]]++;
    const el = document.getElementById("legend");
    const rows = [[3, "Grade A"], [2, "Grade B"], [1, "Grade C"]];
    el.innerHTML = rows.map(([g, name]) =>
      `<div><span class="swatch" style="background:${GRADE_HEX[g]}"></span>${name} (${counts[g]})</div>`).join("")
      + `<div><span class="swatch" style="background:#9aa0a6"></span>Background</div>`
      + `<div style="margin-top:4px;color:#666;font-size:11px">map markers:</div>`
      + `<div><span class="ring" style="border-color:#00d8ff"></span>NN query</div>`
      + `<div><span class="ring" style="border-color:#ff2bd6"></span>NN neighbor</div>`
      + `<div><span class="ring" style="border-color:#1fff4f"></span>Flagged</div>`;
  })();

  // ---- go ----
  document.getElementById("nnN").max = String(NN_MAX);
  refreshFlaggedBtn();
  resize(); fitView(); updateFlaggedOverlay(); draw();
})();

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
    varying float vGrade;
    void main() {
      vGrade = aGrade;
      vec2 p = (aPos - uCenter) * uScale / uHalf;
      gl_Position = vec4(p, 0.0, 1.0);
      float graded = step(0.5, aGrade);
      if (uPass < 0.5 && graded > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      if (uPass > 0.5 && graded < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
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

  let hideBg = false, hideGraded = false, bgAlpha = 0.45;
  function drawOverlay(b, count) {
    if (count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(ovPos); gl.vertexAttribPointer(ovPos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(ovKind); gl.vertexAttribPointer(ovKind, 1, gl.FLOAT, false, 12, 8);
    gl.drawArrays(gl.POINTS, 0, count);
  }
  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(aGrade); gl.vertexAttribPointer(aGrade, 1, gl.FLOAT, false, 12, 8);
    gl.uniform2f(uCenter, view.cx, view.cy);
    gl.uniform1f(uScale, view.scale);
    gl.uniform2f(uHalf, canvas.width / 2, canvas.height / 2);
    gl.uniform1f(uBgAlpha, bgAlpha);
    gl.uniform1f(uZoom, view.scale / fitScale);
    if (!hideBg) { gl.uniform1f(uPass, 0.0); gl.drawArrays(gl.POINTS, 0, N); }
    if (!hideGraded) { gl.uniform1f(uPass, 1.0); gl.drawArrays(gl.POINTS, 0, N); }
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
    if (!hideGraded) {
      for (const i of gradedIdx) {
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
        if (hideBg && GRD[i] === 0) continue;
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
  function cropInto(ctx, i, dw, dh) {
    const s = Math.floor(i / PER_SHEET), within = i % PER_SHEET;
    const col = within % PER_ROW, row = Math.floor(within / PER_ROW);
    const px = col * THUMB, py = row * THUMB;
    const img = loadSheet(s);
    const drawCrop = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, dw, dh);
      ctx.drawImage(img, px, py, THUMB, THUMB, 0, 0, dw, dh);
    };
    if (img.complete && img.naturalWidth) drawCrop(); else img.onload = drawCrop;
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
    cropInto(pctx, i, pcv.width, pcv.height);
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

  // ---- nearest neighbors ----
  async function fetchNeighbors(i) {
    if (!NN_K) throw new Error("no nn");
    const start = i * NN_K * 4, want = NN_K * 4;
    const resp = await fetch("nn.bin", { headers: { Range: `bytes=${start}-${start + want - 1}` } });
    const ab = await resp.arrayBuffer();
    let u; if (ab.byteLength === want) u = new Uint32Array(ab); else u = new Uint32Array(ab.slice(start, start + want));
    return Array.from(u).filter((v) => v >= 0 && v < N);
  }
  async function showNeighbors(i, nWanted) {
    nnMsg.textContent = "loading neighbors…";
    try {
      const nbr = (await fetchNeighbors(i)).slice(0, nWanted);
      setNbrOverlay(i, nbr);
      nnMsg.textContent = nbr.length + " neighbors (magenta on map) — opened in popup";
      openModal(nWanted + " nearest neighbors of " + IDLIST[i], nbr);
    } catch (e) { nnMsg.textContent = "Neighbors need the hosted site (network)."; }
  }
  document.getElementById("nnBtn").addEventListener("click", () => {
    if (sel < 0) return;
    let n = parseInt(document.getElementById("nnN").value, 10) || 10;
    n = Math.max(1, Math.min(NN_K || n, n));
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
  document.getElementById("showAbc").addEventListener("change", (e) => { hideGraded = !e.target.checked; draw(); });
  document.getElementById("bgOpacity").addEventListener("input", (e) => { bgAlpha = parseFloat(e.target.value); draw(); });
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
  if (NN_K) document.getElementById("nnN").max = String(NN_K);
  refreshFlaggedBtn();
  resize(); fitView(); updateFlaggedOverlay(); draw();
})();

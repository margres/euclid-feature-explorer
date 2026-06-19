# Euclid Feature-Space Explorer

Interactive WebGL explorer of the Euclid strong-lensing BYOL feature space.

**Live site:** https://margres.github.io/euclid-feature-explorer/

- **Features / embedding:** the winning model `swin | arcsinh-vis-y | 750k`
  (UMAP-projected, 1,086,667 objects).
- **Cutouts shown:** MTF-processed VIS+Y+J images (`sw_mtf_vis_y_j`); objects
  without an MTF image show a dark tile.

The rare graded lens candidates are flagged in color (A = red, B = orange,
C = blue, matching the UMAP figures). Everything runs client-side — no server.
You can also clone this repo and open `index.html` locally.

## Controls
- **Drag** — pan; **mouse wheel** — zoom toward the cursor
- **Hover** — object ID + grade
- **Click** — galaxy cutout + MER catalogue values + nearest-neighbor / flag tools
- **Show N neighbors** — top-N nearest objects in the 101-d feature space (cosine)
- **Flag + notes** — mark interesting objects and jot notes (saved in your browser);
  **Export flags** downloads them as CSV
- **Search** — jump to an object by BYOL id or Zenodo `id_str`
- **Background opacity** slider, **Hide background** / **Show A/B/C** toggles, **Reset view**

## Contents
- `index.html`, `app.js` — vanilla-WebGL front-end (no dependencies)
- `data.js` — point positions + grade codes (base64)
- `ids.js` — BYOL object IDs
- `manifest.js` — sprite-sheet + dataset metadata
- `mer.js` / `mer.bin` — MER field list + per-object values (range-fetched on click)
- `nn.bin` — top-50 feature-space neighbors per object (range-fetched on click)
- `sheets/` — JPEG sprite-sheet atlases of 64px cutouts

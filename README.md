# Euclid Feature-Space Explorer

Interactive WebGL explorer of the BYOL feature space for ~1.08M Euclid Q1 objects — UMAP projection, live nearest-neighbor search, galaxy cutouts, and graded lens candidate (A/B/C) overlays, all running client-side.

**Live site:** https://margres.github.io/euclid-feature-explorer/

## Offline use

No internet connection, installation, or account required — everything runs locally in the browser.

Double-click `index.html`, or use `Open me.command` (macOS) / `Open me.bat` (Windows) for full functionality (nearest-neighbor search and the MER catalogue panel need a local server, which the launcher scripts start automatically). See `README.txt` for controls.

## Controls

- Drag — pan
- Mouse wheel — zoom toward the cursor
- Hover — show object ID + grade
- Click — show the galaxy cutout (graded lenses get a colored border)
- "Hide background" — show only the graded lens candidates (A/B/C)
- "Reset view" — return to the full manifold

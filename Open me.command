#!/bin/bash
# Serve the explorer over HTTP so the browser can fetch() the feature/MER
# binaries — nearest-neighbour search and the MER panel do NOT work from a
# file:// page (browsers block fetch of local files). Falls back to opening
# the file directly if no Python is available.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1
PORT=8000
PY="$(command -v python3 || command -v python)"
if [ -z "$PY" ]; then
  echo "Python not found — opening directly (neighbour search will be disabled)."
  open "$DIR/index.html"
  exit 0
fi
echo "Serving the explorer at http://localhost:$PORT  — keep this window open; close it to stop."
( sleep 1; open "http://localhost:$PORT/index.html" ) &
exec "$PY" -m http.server "$PORT"

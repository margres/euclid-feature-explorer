@echo off
REM Serve the explorer over HTTP so the browser can fetch() the feature/MER
REM binaries — nearest-neighbour search and the MER panel do NOT work from a
REM file:// page. Falls back to opening the file directly if Python is missing.
cd /d "%~dp0"
set PORT=8000
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/index.html
  python -m http.server %PORT%
) else (
  echo Python not found - opening directly ^(neighbour search will be disabled^).
  start "" "%~dp0index.html"
)

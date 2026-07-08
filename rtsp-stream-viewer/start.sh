#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or not on PATH."
  echo "Install from https://nodejs.org/ then retry."
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ERROR: FFmpeg is not installed or not on PATH."
  echo
  echo "Install examples:"
  echo "  macOS (Homebrew):  brew install ffmpeg"
  echo "  Debian/Ubuntu:     sudo apt-get update && sudo apt-get install -y ffmpeg"
  echo "  Fedora/RHEL:       sudo dnf install -y ffmpeg"
  echo "  Arch:              sudo pacman -S ffmpeg"
  echo
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Starting RTSP stream server..."
npm start

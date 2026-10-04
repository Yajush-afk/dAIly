#!/usr/bin/env bash
# Run from a checked-out copy of dAIly. Default: isolated demo; --normal: personal data.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this as your regular desktop user. sudo is requested only for system setup."
  exit 1
fi
mode="${1:---demo}"
if [[ "$mode" != --demo && "$mode" != --normal ]]; then
  echo "Usage: ./start-ubuntu.sh [--demo|--normal]"
  exit 1
fi
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils build-essential python3 libnss3 libatk-bridge2.0-0t64 libgtk-3-0t64 libgbm1 libasound2t64
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) echo "Unsupported CPU architecture"; exit 1 ;;
esac
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  mkdir -p artifacts/bootstrap
  manifest="$(curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)"
  archive="$(printf '%s\n' "$manifest" | awk -v suffix="linux-${node_arch}.tar.xz" '$2 ~ suffix "$" {print $2}')"
  [[ "$archive" == node-v24.* && "$archive" != */* ]] || { echo "Unable to identify Node 24 download"; exit 1; }
  curl --fail --show-error --location "https://nodejs.org/dist/latest-v24.x/$archive" -o "artifacts/bootstrap/$archive"
  (cd artifacts/bootstrap && printf '%s\n' "$manifest" | awk -v file="$archive" '$2 == file' | sha256sum --check -)
  tar -xf "artifacts/bootstrap/$archive" -C artifacts/bootstrap
  export PATH="$PWD/artifacts/bootstrap/${archive%.tar.xz}/bin:$PATH"
fi
if ! command -v ollama >/dev/null; then
  curl --fail --show-error --location https://ollama.com/install.sh -o artifacts-ollama-install.sh
  trap 'rm -f artifacts-ollama-install.sh' EXIT
  sh artifacts-ollama-install.sh
  rm -f artifacts-ollama-install.sh
fi
mkdir -p artifacts/bootstrap
if ! curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null; then
  nohup ollama serve > artifacts/bootstrap/ollama.log 2>&1 &
  for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null; then break; fi
    sleep 1
  done
  curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null || { echo "Ollama did not start. See artifacts/bootstrap/ollama.log"; exit 1; }
fi
npm ci
# npm ci replaces this file; repair the sandbox after every dependency installation.
sandbox="$PWD/node_modules/electron/dist/chrome-sandbox"
sudo chown root:root "$sandbox"
sudo chmod 4755 "$sandbox"
ollama pull gemma3:4b-it-q4_K_M
if [[ "$mode" == --normal ]]; then npm run dev; else npm run demo; fi

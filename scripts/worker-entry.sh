#!/usr/bin/env bash
# Container entrypoint for the worker.
# On first boot, seed the Codex login from the CODEX_AUTH_JSON_B64 variable into the
# persistent volume. After that Codex refreshes its own tokens in place on the volume.
set -euo pipefail
mkdir -p "$CODEX_HOME"
if [ ! -f "$CODEX_HOME/auth.json" ] && [ -n "${CODEX_AUTH_JSON_B64:-}" ]; then
  echo "$CODEX_AUTH_JSON_B64" | base64 -d > "$CODEX_HOME/auth.json"
  chmod 600 "$CODEX_HOME/auth.json"
  echo "seeded codex login into $CODEX_HOME"
fi
printf 'approval_policy = "never"\n' > "$CODEX_HOME/config.toml"
# run in-process so SIGTERM reaches the worker and it can drain active roasts before Railway swaps containers
exec node --import tsx worker/index.mts

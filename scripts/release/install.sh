#!/bin/sh
set -eu
ATLAS_BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(id -u)" = 0 ]; then
  echo '请使用普通用户安装，无需 sudo。' >&2
  exit 1
fi
IFS= read -r ATLAS_MANIFEST_HASH < "$ATLAS_BUNDLE_DIR/release-manifest.sha256"
exec env ELECTRON_RUN_AS_NODE=1 "$ATLAS_BUNDLE_DIR/zhitu-atlas" "$ATLAS_BUNDLE_DIR/install.cjs" "$ATLAS_BUNDLE_DIR" "$ATLAS_MANIFEST_HASH" "$@"

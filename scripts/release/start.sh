#!/bin/sh
set -eu
ATLAS_BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$(id -u)" = 0 ]; then
  echo '请使用普通桌面用户启动 Atlas。无需 sudo。' >&2
  exit 1
fi
if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo '需要 Linux 图形桌面会话。远程纯终端可从源码使用 pnpm web。' >&2
  exit 1
fi
exec "$ATLAS_BUNDLE_DIR/zhitu-atlas" "$@"

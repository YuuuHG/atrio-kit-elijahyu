#!/usr/bin/env bash
# 双通道图标获取：直连优先，失败自动走 7890 代理；哪个通用哪个，固化到本地静态目录。
# 用法: fetch-icons.sh [AppName ...]   不传参数则处理默认列表（Alist Jellyfin Immich）
set -u

ICON_DIR=/var/lib/casaos/www/icons
PROXY=http://127.0.0.1:7890
BASE=https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps
DEFAULT_APPS="Alist Jellyfin Immich"
APPS="${*:-$DEFAULT_APPS}"

mkdir -p "$ICON_DIR"
for app in $APPS; do
  url="$BASE/$app/icon.svg"
  tmp="$ICON_DIR/.$app.svg.tmp"
  out="$ICON_DIR/$app.svg"
  rm -f "$tmp"
  used=""

  # 通道1：直连（5秒超时）
  if curl -fsS --max-time 5 "$url" -o "$tmp" 2>/dev/null \
     && head -c 300 "$tmp" 2>/dev/null | grep -qi '<svg'; then
    used="直连"
  fi

  # 通道2：7890 代理（仅直连失败才试）
  if [ -z "$used" ]; then
    rm -f "$tmp"
    if curl -fsS --max-time 8 -x "$PROXY" "$url" -o "$tmp" 2>/dev/null \
       && head -c 300 "$tmp" 2>/dev/null | grep -qi '<svg'; then
      used="7890代理"
    fi
  fi

  if [ -n "$used" ]; then
    mv -f "$tmp" "$out"
    printf '%-14s OK  via %-9s (%s bytes)\n' "$app.svg" "$used" "$(wc -c < "$out")"
  else
    printf '%-14s FAILED (直连/7890 均失败)\n' "$app.svg" >&2
    rm -f "$tmp"
  fi
done

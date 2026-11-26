#!/usr/bin/env bash
# atrio-kit 一键安装脚本
# 把 CasaOS/Atrio 面板的常用定制（汉化、股票小组件、本地图标、自动挂载）部署到新设备。
#
# 用法：
#   sudo bash install.sh --all                 # 安装通用部分=汉化+股票组件+图标（设备无关，推荐）
#   sudo bash install.sh --core                # 只装汉化+股票组件前端
#   sudo bash install.sh --icons               # 只装本地图标 + 图标拉取脚本
#   sudo bash install.sh --stock               # 只装股票小组件（前端+后端+服务）
#   sudo bash install.sh --mounts              # 只装 USB 硬盘自动挂载（设备相关！需先改 UUID/路径）
#   sudo bash install.sh --proxy               # 只装 Atrio 更新的本地代理 drop-in（设备相关！需 7890 代理）
#   sudo bash install.sh --uninstall           # 卸载本 kit 安装的所有东西
#
# 注意：--mounts / --proxy 含 RK3568 专属配置，默认不包含在 --all 中，请按需单独装并先改配置。
#
# 设计原则：幂等、先备份、失败即停、不碰用户数据。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWWW=/var/lib/casaos/www
STAMP="$(date +%Y%m%d_%H%M%S)"
BAK=/opt/atrio-kit-backup-$STAMP

log(){ printf '\033[1;32m[atrio-kit]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[atrio-kit WARN]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[atrio-kit ERR]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash $0 $*"

need_cmd(){ command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"; }

backup_file(){
  local f="$1"
  [ -e "$f" ] || return 0
  mkdir -p "$BAK$(dirname "$f")"
  cp -a "$f" "$BAK$f"
  log "备份 $f -> $BAK$f"
}

# ---------- 前置检查 ----------
precheck(){
  need_cmd systemctl
  [ -d /var/lib/casaos/www ] || die "未找到 /var/lib/casaos/www，请先安装 CasaOS v0.4.x + Atrio"
  log "检测到 CasaOS/Atrio 目录，继续"
}

# ---------- 核心：汉化 + 股票组件前端 ----------
install_core(){
  log "安装核心定制（汉化 + 股票组件前端）"
  need_cmd curl
  backup_file "$AWWW/js/custom.js"
  backup_file "$AWWW/js/stock-widget.js"
  install -m 0644 "$REPO_DIR/www/js/custom.js" "$AWWW/js/custom.js"
  install -m 0644 "$REPO_DIR/www/js/stock-widget.js" "$AWWW/js/stock-widget.js"
  log "已写入 custom.js / stock-widget.js"
}

# ---------- 本地图标 ----------
install_icons(){
  log "安装本地图标 + 图标拉取脚本"
  mkdir -p "$AWWW/icons" /opt/atrio-icons
  for svg in "$REPO_DIR"/www/icons/*.svg; do
    [ -f "$svg" ] || continue
    backup_file "$AWWW/icons/$(basename "$svg")"
    install -m 0644 "$svg" "$AWWW/icons/$(basename "$svg")"
  done
  backup_file /opt/atrio-icons/fetch-icons.sh
  install -m 0755 "$REPO_DIR/opt/atrio-icons/fetch-icons.sh" /opt/atrio-icons/fetch-icons.sh
  log "图标已就位：$(ls "$AWWW/icons" | tr '\n' ' ')"
  log "提示：把各 app 的 compose 里 x-casaos.icon 改为 /icons/<App>.svg（相对路径，不写死 IP），再 restart casaos-app-management"
}

# ---------- 股票组件后端 ----------
install_stock(){
  log "安装股票小组件（后端 + systemd 服务，端口 8100）"
  need_cmd python3
  backup_file /opt/stock-widget/server.py
  backup_file /etc/systemd/system/stock-widget.service
  mkdir -p /opt/stock-widget
  install -m 0755 "$REPO_DIR/opt/stock-widget/server.py" /opt/stock-widget/server.py
  install -m 0644 "$REPO_DIR/systemd/stock-widget.service" /etc/systemd/system/stock-widget.service
  # 前端 JS 也一起装（core 里已有，重复安装幂等）
  install_core
  systemctl daemon-reload
  systemctl enable --now stock-widget.service
  sleep 1
  if curl -fsS --max-time 5 http://127.0.0.1:8100/api/health >/dev/null 2>&1; then
    log "stock-widget 健康检查通过（8100）"
  else
    warn "stock-widget 已启动但 8100 未就绪，查看：journalctl -u stock-widget -f"
  fi
  log "浏览器 Ctrl+F5 强制刷新面板即可看到股票卡"
}

# ---------- USB 硬盘自动挂载（设备相关，需谨慎） ----------
install_mounts(){
  warn "自动挂载含设备专属配置（挂载点路径 + 分区 UUID），安装后必须按你的设备修改！"
  warn "详见 docs/MOUNTS.md。当前脚本里的 UUID 是原设备 RK3568 的，直接使用会失效。"
  backup_file /opt/automount/ensure-mounts.sh
  backup_file /etc/systemd/system/ensure-mounts.service
  backup_file /etc/systemd/system/ensure-mounts.timer
  mkdir -p /opt/automount
  install -m 0755 "$REPO_DIR/opt/automount/ensure-mounts.sh" /opt/automount/ensure-mounts.sh
  install -m 0644 "$REPO_DIR/systemd/ensure-mounts.service" /etc/systemd/system/ensure-mounts.service
  install -m 0644 "$REPO_DIR/systemd/ensure-mounts.timer" /etc/systemd/system/ensure-mounts.timer
  # udev 规则默认不自动装（UUID 设备专属），放一份到目录供手动改
  install -m 0644 "$REPO_DIR/udev/99-usb-hdd-automount.rules" /opt/automount/99-usb-hdd-automount.rules.example
  systemctl daemon-reload
  systemctl enable --now ensure-mounts.timer
  log "ensure-mounts.timer 已启用（每 2 分钟兜底）"
  log "⚠ 请编辑 /opt/automount/ensure-mounts.sh 里的 M_EXT4/M_NTFS 挂载点，以及 fstab/mount unit 的 UUID"
}

# ---------- Atrio 自动更新的本地代理 drop-in ----------
install_proxy(){
  log "安装 Atrio 自动更新的本地代理 drop-in（默认 127.0.0.1:7890）"
  for unit in atrio-update atrio-backup-schedule atrio-restore; do
    src="$REPO_DIR/systemd/${unit}.service.d-mirror.conf"
    [ -f "$src" ] || continue
    mkdir -p "/etc/systemd/system/${unit}.service.d"
    backup_file "/etc/systemd/system/${unit}.service.d/mirror.conf"
    install -m 0644 "$src" "/etc/systemd/system/${unit}.service.d/mirror.conf"
    log "  已装 $unit 的 mirror.conf"
  done
  systemctl daemon-reload
  warn "若你的设备没有 7890 代理，请删除这些 drop-in 或改代理地址，否则自动更新会走一个不存在的代理"
}

# ---------- 卸载 ----------
do_uninstall(){
  log "卸载 atrio-kit 安装的内容（不删除用户数据/图标以外的文件）"
  systemctl disable --now stock-widget.service 2>/dev/null || true
  systemctl disable --now ensure-mounts.timer 2>/dev/null || true
  rm -f /etc/systemd/system/stock-widget.service \
        /etc/systemd/system/ensure-mounts.service \
        /etc/systemd/system/ensure-mounts.timer \
        /opt/stock-widget/server.py \
        /opt/automount/ensure-mounts.sh \
        /opt/automount/99-usb-hdd-automount.rules.example \
        /opt/atrio-icons/fetch-icons.sh \
        "$AWWW/js/custom.js" "$AWWW/js/stock-widget.js"
  for unit in atrio-update atrio-backup-schedule atrio-restore; do
    rm -f "/etc/systemd/system/${unit}.service.d/mirror.conf"
  done
  systemctl daemon-reload
  log "已卸载。备份仍在 $BAK（若有）；如需恢复前端 JS 请从备份拷回。"
}

# ---------- 主流程 ----------
main(){
  ACTIONS=()
  case "${1:-}" in
    --all)        ACTIONS=(core icons stock) ;;
    --core)       ACTIONS=(core) ;;
    --icons)      ACTIONS=(icons) ;;
    --stock)      ACTIONS=(stock) ;;
    --mounts)     ACTIONS=(mounts) ;;
    --proxy)      ACTIONS=(proxy) ;;
    --uninstall)  do_uninstall; exit 0 ;;
    -h|--help)    head -n 14 "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "未知参数：${1:-}（用 --help 查看用法）" ;;
  esac

  precheck
  log "本次操作备份目录：$BAK"
  for a in "${ACTIONS[@]}"; do
    case "$a" in
      core)   install_core ;;
      icons)  install_icons ;;
      stock)  install_stock ;;
      mounts) install_mounts ;;
      proxy)  install_proxy ;;
    esac
  done
  log "完成！浏览器 Ctrl+F5 强制刷新面板查看效果。"
  [ -d "$BAK" ] && log "所有被替换的原文件备份在：$BAK"
}

main "$@"

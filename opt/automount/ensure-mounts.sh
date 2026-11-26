#!/usr/bin/env bash
# ensure-mounts.sh - 确保 USB 硬盘盒分区与 immich bind 挂载始终在线
# 由 systemd timer 每 2 分钟兜底 + udev 插入事件即时触发
#
# 2026-11-26 修订：mountpoint -q 只看挂载表，硬盘断电后会留下 stale mount
# （表里还在但读 EIO），旧逻辑误判为"已挂载"永不重挂。现在增加真实读取探测。
set -u
LOG=/var/log/ensure-mounts.log
log(){ printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

M_EXT4=/mount/HDD_EXT4
M_NTFS=/mount/HDD_NTFS
changed=0

# 实测挂载是否真的可读。返回 0=可用，非0=stale/不可读。
readable(){
  local mp="$1"
  timeout 8 ls "$mp" >/dev/null 2>&1
}

ensure(){
  local unit="$1" mp="$2"
  if mountpoint -q "$mp" 2>/dev/null; then
    if readable "$mp"; then
      return 0                                  # 真正在线，无需动作
    fi
    # 挂载表里有但读不动 -> stale mount，lazy umount 后重挂
    log "WARN $mp 疑似 stale mount (读超时/EIO)，lazy umount 后重挂"
    timeout 15 umount -l "$mp" >/dev/null 2>&1 || true
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
    systemctl stop "$unit" >/dev/null 2>&1 || true
  else
    systemctl reset-failed "$unit" >/dev/null 2>&1 || true
  fi

  if systemctl start "$unit" >/dev/null 2>&1 \
     && mountpoint -q "$mp" 2>/dev/null \
     && readable "$mp"; then
    log "OK  已挂载 $mp ($unit)"
    changed=1
  else
    log "SKIP $mp 挂载失败（设备不在或读错误，等待下次重试）"
  fi
}

ensure mount-HDD_EXT4.mount "$M_EXT4"
ensure mount-HDD_NTFS.mount "$M_NTFS"

if ! mountpoint -q /opt/immich/thumbs 2>/dev/null; then
  systemctl reset-failed opt-immich-thumbs.mount 2>/dev/null || true
  if systemctl start opt-immich-thumbs.mount >/dev/null 2>&1; then
    log "OK  已挂载 /opt/immich/thumbs"
    changed=1
  fi
fi

if [ "$changed" -eq 1 ]; then
  log "挂载发生变化 -> reload smbd"
  systemctl reload smbd 2>/dev/null || true
  sleep 2
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^immich_server$'; then
    log "重启 immich_server 以刷新 bind inode"
    if docker restart immich_server >/dev/null 2>&1; then
      log "OK  immich_server 已重启"
    else
      log "WARN immich_server 重启失败"
    fi
  fi
fi

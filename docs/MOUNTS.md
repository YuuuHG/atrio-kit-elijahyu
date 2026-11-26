# USB 硬盘自动挂载模块（设备相关，默认不安装）

这个模块解决一个具体问题：**机械硬盘断电/掉线后，Immich 的 `/data/library` 所在的 bind mount 变成 stale mount（内核挂载表还在，但读写全是 EIO），导致 Immich 启动时的 folder check 失败 → 无限重启**。

## 为什么默认不装

本模块包含 RK3568 原机的**设备专属参数**，直接装到别的设备会失效甚至误挂载：

| 参数 | 原机值 | 你需要改成 |
|---|---|---|
| EXT4 挂载点 | `/mount/HDD_EXT4` | 你的实际挂载点 |
| NTFS 挂载点 | `/mount/HDD_NTFS` | 你的实际挂载点 |
| thumbs bind | `/opt/immich/thumbs` | 你的 Immich 缩略图目录 |
| udev 规则分区 UUID | `9db48d8a-...`、`C333F186...` | `blkid` 查你自己的 |
| fstab 里的挂载项 | 见原机 fstab | 按你的 UUID/路径写 |

## 安装步骤

1. **先改脚本**：编辑 `/opt/automount/ensure-mounts.sh` 顶部的 `M_EXT4` / `M_NTFS` 以及函数里 `ensure mount-HDD_EXT4.mount ...` 的 systemd mount unit 名，改成你的设备。
2. **配好 fstab**：确保硬盘挂载写在 `/etc/fstab`，例如：
   ```
   UUID=<你的UUID>  /mount/HDD_EXT4  ext4  defaults,noatime,nofail,x-systemd.device-timeout=15s  0  2
   ```
   `nofail` 很重要——硬盘不在时系统也能正常启动。
3. **（可选）udev 即时触发**：把 `udev/99-usb-hdd-automount.rules.example` 里的 UUID 改成你的，复制到 `/etc/udev/rules.d/` 并 `udevadm control --reload-rules`。不改也行，2 分钟的 timer 会兜底。
4. 安装：
   ```bash
   sudo bash install.sh --mounts
   ```
5. 验证：
   ```bash
   systemctl is-active ensure-mounts.timer   # active
   tail -f /var/log/ensure-mounts.log
   ```

## 工作原理

- `ensure-mounts.timer` 每 2 分钟触发一次 `ensure-mounts.service`。
- `ensure()` 先用 `mountpoint -q` 看挂载表，**再用 `timeout 8 ls` 实测可读性**——这一步是关键，专门识别 stale mount（`mountpoint` alone 会误判）。
- 发现 stale：`umount -l` 清理 → `systemctl reset-failed/stop` → 重新 `start` mount unit。
- **只有真正挂载成功才 `docker restart immich_server`** 刷新 bind inode；重挂失败则静默等待下次，不打断服务。

## 配套：让 Immich 容忍硬盘离线

光有挂载脚本还不够——Immich 在硬盘离线那一刻仍会因 folder check 失败而重启。给 Immich 的 compose environment 加官方开关：

```yaml
IMMICH_IGNORE_MOUNT_CHECK_ERRORS: "true"
```

然后 `docker compose up -d --force-recreate`。官方说明见 `immich.app/administration/system-integrity#ignoring-the-checks`。

这样：硬盘关机时 Immich 稳定运行（浏览缩略图/元数据），硬盘开机后自动重挂 + 刷新 bind，原图直接可见。

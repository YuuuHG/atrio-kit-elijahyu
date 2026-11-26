# atrio-kit

> 把一台 RK3568 上调好的 **CasaOS + Atrio 面板定制**，打包成可一键移植到其他设备的工具集。

包含：默认简体中文、股票小组件（A/H/美股 + 实时分时图 + 搜索式自选）、应用图标本地化、USB 硬盘自动挂载（防 stale mount）、Atrio 更新的本地代理配置。

本仓库**不含 Atrio/CasaOS 本体**——这两者需先按官方方式装好（见 [前置条件](#前置条件)）。本仓库只装"定制层"。

---

## 许可（重要）

| 部分 | 许可 | 说明 |
|---|---|---|
| 本仓库的脚本/配置/文档 | Apache-2.0 | 见 [LICENSE](LICENSE)，可商用、可改写、可再分发 |
| Atrio（上游面板） | Apache-2.0 | `peppeaiello/atrio`，基于 CasaOS-UI fork |
| CasaOS（上游） | Apache-2.0 | `IceWhaleTech/CasaOS` |

**允许商用与二次开发。** 履行 Apache-2.0 义务：保留版权与许可声明、改动文件标注、分发附 LICENSE。

⚠️ **商标**：Atrio README 明确声明 "not affiliated with or endorsed by IceWhale"。商用/公开分发时**不得**使用 CasaOS / IceWhale 商标或暗示官方背书。本结论非法律意见，正式商用请法务复核。

---

## 前置条件

1. 一台已装 **CasaOS v0.4.15 + Atrio v0.1.26** 的 Linux 设备（Debian/Ubuntu 系，systemd）。
   - CasaOS：`curl -fsSL https://get.casaos.io | sudo bash`
   - Atrio：见 `peppeaiello/atrio` 的 install.sh（本仓库不包含其二进制）
2. `curl`、`python3`、`systemctl` 可用。
3. root 权限（`sudo`）。

---

## 一键安装

```bash
# 下载仓库（整包，约 20KB）
git clone https://github.com/YuuHG/atrio-kit-elijahyu.git
cd atrio-kit-elijahyu

# 安装通用部分（汉化 + 股票组件 + 图标）—— 设备无关，推荐首选
sudo bash install.sh --all
```

装完 **Ctrl+F5 强制刷新**浏览器面板。左侧小组件栏"系统状态"下方应出现股票卡。

### 单项安装

```bash
sudo bash install.sh --core     # 只装汉化 + 股票组件前端
sudo bash install.sh --icons    # 只装本地图标 + 图标拉取脚本
sudo bash install.sh --stock    # 只装股票组件（含后端服务 + 8100 端口）
sudo bash install.sh --mounts   # USB 硬盘自动挂载（设备相关，先读 docs/MOUNTS.md）
sudo bash install.sh --proxy    # Atrio 更新的本地代理（设备相关，需 7890）
```

### 卸载

```bash
sudo bash install.sh --uninstall
```

每次安装都会把被替换的原文件备份到 `/opt/atrio-kit-backup-<时间戳>/`。

---

## 功能说明

### 1. 默认简体中文
`www/js/custom.js` 通过 `localStorage` 设置 `lang=zh_cn`（Atrio 官方内置中文包），只设一次，用户后续手动切换语言不会被覆盖。
- 局限：部分硬件弹窗文本是 JS 里硬编码的英文，不在 i18n 包内，仍显示英文。
- 恢复英文：清浏览器 `localStorage.lang` 和 `atrio_lang_initialized`。

### 2. 股票小组件
浏览器只访问本机 `http://<面板host>:8100/api/*`（跟随当前 host，不写死 IP），后端 `server.py` 拉取行情：
- `/api/quote?codes=sh600519,hk00700,usAAPL` —— 腾讯财经批量报价
- `/api/kline?code=sh000001` —— 腾讯分时数据（30s 缓存）
- `/api/search?kw=茅台` —— 腾讯 smartbox 搜索联想
- 组件形态：普通卡显示前 3 只自选（涨红跌绿），点开有分时图弹窗 + 搜索式编辑自选（最多 12 只，可拖动排序）
- 自选股存浏览器 `localStorage.atrio_stock_codes`

代理策略：`STOCK_PROXY` 环境变量（默认 `http://127.0.0.1:7890`），直连优先、失败退回代理。无代理环境也能直连使用。

### 3. 本地图标
`www/icons/*.svg` 是 Alist/Immich/Jellyfin/HomeAssistant 官方图标的本地副本。面板直接 serve `/icons/`，浏览器零外网依赖（避免 CDN 不通导致显示灰色方块）。
- `opt/atrio-icons/fetch-icons.sh <AppName ...>`：直连优先、7890 兜底，把图标拉到本地。
- 使用时把各 app 的 compose 里 `x-casaos.icon` 改成 `/icons/<App>.svg`（相对路径，不写死 IP），再 `systemctl restart casaos-app-management`。

### 4. USB 硬盘自动挂载（设备相关，默认不装）
`--mounts` 装的 `ensure-mounts.sh` 每 2 分钟检测挂载点，用真实 `ls` 探测 stale mount 并自动重挂，**防止机械盘断电后 Immich 无限重启**。⚠️ 见 [docs/MOUNTS.md](docs/MOUNTS.md)，必须按你的设备改 UUID/路径。

### 5. Atrio 更新的本地代理（设备相关，默认不装）
`--proxy` 给三个 Atrio systemd unit 加 drop-in，注入 7890 代理以便在国内访问 GitHub 更新。没代理的设备请勿安装。

---

## 目录结构

```
.
├── install.sh                      # 一键安装/卸载
├── www/
│   ├── js/custom.js                # 汉化 + 股票组件加载器
│   ├── js/stock-widget.js          # 股票组件前端
│   └── icons/*.svg                 # 本地应用图标
├── opt/
│   ├── stock-widget/server.py      # 股票后端代理
│   ├── atrio-icons/fetch-icons.sh  # 图标拉取脚本
│   └── automount/ensure-mounts.sh  # 硬盘挂载守护（设备相关）
├── systemd/                        # systemd 单元 + drop-in
├── udev/                           # udev 自动挂载规则示例（设备相关）
├── docs/                           # 详细文档
└── LICENSE                         # Apache-2.0
```

---

## 来源与致谢

从一台 RK3568（Armbian jammy / aarch64）的实机配置提取整理，2026-11-26。
Atrio / CasaOS 版权归各自作者，本仓库仅提供在其之上的定制层。

> 本仓库按"现状"提供（AS IS），无担保。修改系统文件前请自行备份。

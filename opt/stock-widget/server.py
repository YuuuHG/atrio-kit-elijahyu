#!/usr/bin/env python3
"""股票数据后端代理：浏览器只访问本机 8100，本服务拉取行情数据。

接口：
  GET /api/quote?codes=sh600519,hk00700,usAAPL   批量实时报价（腾讯财经，一次请求）
  GET /api/kline?code=sh000001&klt=5&lmt=60       K线（东方财富，30 秒缓存）
  GET /api/search?kw=茅台                        股票搜索联想（腾讯 smartbox）
  GET /api/health

代码格式（腾讯风格）：
  sh600519 沪A  sz000001 深A  sh000001 上证指数  hk00700 港股  usAAPL 美股

数据源策略：
  - 报价用腾讯财经 qt.gtimg.cn：限流宽松、一次拿全、字段全（GBK 编码）
  - K线用东方财富 push2his：30 秒缓存，请求量低不易限流
  - 全部直连优先（--noproxy '*'），失败退回 7890 代理
  - 用 curl 子进程：urllib 的 TLS 指纹会被部分接口拒绝
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROXY = os.environ.get("STOCK_PROXY", "http://127.0.0.1:7890")
LISTEN = ("0.0.0.0", 8100)
TIMEOUT = 8
KLINE_CACHE = {}
CACHE_LOCK = threading.Lock()
CACHE_TTL = 30


def curl_text(url, gbk=False):
    """双通道拉取文本：直连优先，失败退回代理。"""
    last = None
    for extra in (["--noproxy", "*"], ["-x", PROXY]):
        try:
            cmd = ["curl", "-s", "--max-time", str(TIMEOUT),
                   "-e", "https://gu.qq.com/",
                   "-A", "Mozilla/5.0"] + extra + [url]
            r = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT + 2)
            if r.returncode == 0 and r.stdout.strip():
                return r.stdout.decode("gbk" if gbk else "utf-8", "replace")
            last = RuntimeError("curl rc=%d" % r.returncode)
        except Exception as e:
            last = e
    raise last


def quote(codes):
    """腾讯财经批量报价。"""
    codes = [c.strip() for c in codes if c.strip()][:30]
    if not codes:
        return []
    url = "https://qt.gtimg.cn/q=" + ",".join(codes)
    try:
        text = curl_text(url, gbk=True)
    except Exception as e:
        return [{"code": c, "error": str(e)} for c in codes]

    result_map = {}
    for line in text.split(";"):
        line = line.strip()
        if not line.startswith("v_"):
            continue
        try:
            code = line[2:line.index("=")]
            val = line[line.index('"') + 1:line.rindex('"')]
            f = val.split("~")
            if len(f) < 35:
                continue
            def num(i):
                try: return float(f[i])
                except (ValueError, IndexError): return None
            result_map[code.lower()] = {
                "code": code,
                "symbol": f[2],
                "name": f[1],
                "price": num(3),
                "prev": num(4),
                "open": num(5),
                "change": num(31),
                "pct": num(32),
                "high": num(33),
                "low": num(34),
                "time": f[30] if len(f) > 30 else "",
            }
        except (ValueError, IndexError):
            continue

    return [result_map.get(c.lower(), {"code": c, "error": "no data"}) for c in codes]


def kline(code, klt=5, lmt=60):
    """腾讯分时数据（实时轴图），带 30 秒缓存。"""
    key = (code, klt, lmt)
    now = time.time()
    with CACHE_LOCK:
        cached = KLINE_CACHE.get(key)
        if cached and now - cached[0] < CACHE_TTL:
            return cached[1]

    url = "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=" + urllib.parse.quote(code)
    try:
        j = json.loads(curl_text(url))
        node = ((j.get("data") or {}).get(code) or {}).get("data") or {}
        lines = node.get("data") or []
        rows = []
        for line in lines:
            p = line.split()
            if len(p) >= 2:
                try:
                    rows.append({"time": p[0], "close": float(p[1]),
                                 "volume": float(p[2]) if len(p) > 2 else 0})
                except ValueError:
                    continue
        result = {"code": code, "name": code, "klines": rows,
                  "date": node.get("date", "")}
    except Exception as e:
        result = {"code": code, "error": str(e), "klines": []}
    with CACHE_LOCK:
        KLINE_CACHE[key] = (now, result)
    return result


def search(kw):
    """股票搜索联想：腾讯 smartbox，返回 [{code,name,market}]。"""
    kw = (kw or '').strip()
    if not kw:
        return []
    url = "https://smartbox.gtimg.cn/s3/?q=" + urllib.parse.quote(kw) + "&t=all"
    try:
        text = curl_text(url)
    except Exception:
        return []
    # 形如：v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A^hk~00700~..."
    if '="' not in text:
        return []
    payload = text.split('="', 1)[1].rstrip().rstrip(';').rstrip('"')
    out, seen = [], set()
    for item in payload.split('^'):
        p = item.split('~')
        if len(p) < 5:
            continue
        mkt, rawcode = p[0].strip().lower(), p[1].strip()
        try:
            name = json.loads('"' + p[2] + '"')  # 解码 \uXXXX
        except Exception:
            name = p[2]
        typ = p[4].strip().upper()
        # 只留股票 / 指数；过滤基金(KJ)、债券(QZ)、理财等
        if not (typ.startswith('GP') or typ == 'ZS'):
            continue
        # 代码规范化：美股 us~aapl.oq -> usAAPL；港股/沪深保持
        if mkt == 'us':
            code = 'us' + re.sub(r'\.(oq|n|ps|of)$', '', rawcode, flags=re.I).upper()
        elif mkt in ('sh', 'sz', 'hk'):
            code = mkt + rawcode
        else:
            continue
        if code in seen:
            continue
        seen.add(code)
        label = {'sh': '沪A', 'sz': '深A', 'hk': '港股', 'us': '美股'}.get(mkt, mkt)
        if mkt == 'sh' and typ == 'ZS':
            label = '指数'
        out.append({"code": code, "name": name, "market": label})
        if len(out) >= 10:
            break
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/api/health":
                self._send({"ok": True, "proxy_fallback": PROXY})
            elif u.path == "/api/quote":
                codes = (q.get("codes") or [""])[0].split(",")
                self._send({"data": quote(codes)})
            elif u.path == "/api/kline":
                code = (q.get("code") or [""])[0]
                klt = int((q.get("klt") or ["5"])[0])
                lmt = int((q.get("lmt") or ["60"])[0])
                self._send({"data": kline(code, klt, lmt)})
            elif u.path == "/api/search":
                kw = (q.get("kw") or [""])[0]
                self._send({"data": search(kw)})
            else:
                self._send({"error": "not found"}, 404)
        except Exception as e:
            self._send({"error": str(e)}, 500)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()

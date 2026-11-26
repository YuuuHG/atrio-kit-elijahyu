/* Atrio 股票小组件 v1.0 —— 通过 custom.js 动态注入，纯原生 DOM，复用 Atrio widget 样式 */
(function () {
  'use strict';

  // API 基址：跟随浏览器当前访问的 host，拼 8100 端口。无固定 IP、无需网关反代。
  var API = location.protocol + '//' + location.hostname + ':8100';
  var REFRESH_MS = 15000;                    // 每 15 秒刷新
  var DEFAULT_CODES = [
    'sh000001',   // 上证指数
    'sh600519',   // 贵州茅台
    'hk00700',    // 腾讯控股(港股)
    'usAAPL'      // 苹果(美股)
  ];
  var LS_KEY = 'atrio_stock_codes';
  var RED = '#f0483e', GREEN = '#22b573';   // 中国习惯：涨红跌绿

  var codes = loadCodes();
  var timer = null, modal = null;

  function loadCodes() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_KEY));
      return Array.isArray(v) && v.length ? v : DEFAULT_CODES.slice();
    } catch (e) { return DEFAULT_CODES.slice(); }
  }
  function saveCodes(c) { try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) {} }

  function fmt(v, d) {
    if (v === null || v === undefined || v === '-') return '--';
    var n = Number(v);
    if (isNaN(n)) return '--';
    return n.toFixed(d === undefined ? 2 : d);
  }
  function colorOf(pct) {
    var n = Number(pct);
    return n > 0 ? RED : (n < 0 ? GREEN : '#8a94a6');
  }
  function sign(v, d) {
    var n = Number(v);
    if (isNaN(n)) return '--';
    return (n > 0 ? '+' : '') + n.toFixed(d === undefined ? 2 : d);
  }

  function fetchJSON(path) {
    return fetch(API + path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // ---------- 卡片 DOM ----------
  function makeCard() {
    var root = document.createElement('div');
    root.className = 'widget has-text-grey-100 stock-widget';
    root.id = 'atrio-stock-widget';
    root.style.position = 'relative';
    root.style.overflow = 'hidden';
    root.innerHTML =
      '<div class="blur-background" style="position:absolute;left:0;top:0;right:0;bottom:0;z-index:0;"></div>' +
      '<div class="widget-content" style="position:relative;z-index:1;padding:0.75rem 1rem;">' +
        '<div class="widget-header is-flex" style="align-items:center;margin-bottom:0.5rem;">' +
          '<div class="widget-title is-flex-grow-1" style="font-weight:600;color:#eaf0fa;">股票行情</div>' +
          '<button class="widget-icon-button atrio-widget-button" id="stk-edit" title="编辑自选股" aria-label="编辑自选股">' +
            '<span style="font-size:1rem;">✎</span>' +
          '</button>' +
          '<button class="widget-icon-button atrio-widget-button" id="stk-max" title="放大" aria-label="放大">' +
            '<span style="font-size:1rem;">⤢</span>' +
          '</button>' +
        '</div>' +
        '<div id="stk-rows" style="display:flex;flex-direction:column;gap:0.55rem;"></div>' +
        '<div id="stk-err" style="font-size:0.75rem;color:#8a94a6;margin-top:0.5rem;display:none;"></div>' +
      '</div>';
    root.querySelector('#stk-edit').onclick = openEditor;
    root.querySelector('#stk-max').onclick = function () { openModal(0); };
    return root;
  }

  // 普通态：三个一样的股票卡片，左信息 / 右数字 左右对称
  function renderRows(data) {
    var box = document.getElementById('stk-rows');
    if (!box) return;
    box.innerHTML = '';
    var list = (data || []).filter(function (x) { return !x.error; }).slice(0, 3);
    if (!list.length) {
      box.innerHTML = '<div style="font-size:0.8rem;color:#8a94a6;">暂无数据</div>';
      return;
    }
    list.forEach(function (s) {
      var c = colorOf(s.pct);
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
        'padding:0.5rem 0.6rem;border-radius:8px;background:rgba(255,255,255,0.06);cursor:pointer;';
      row.title = '点击查看大图';
      row.innerHTML =
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.82rem;font-weight:600;color:#eaf0fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>' +
          '<div style="font-size:0.68rem;color:#a9b8cf;">' + esc(String(s.code).slice(2)) + ' · ' + marketName(s.code) + '</div>' +
        '</div>' +
        '<div style="text-align:right;flex:0 0 auto;">' +
          '<div style="font-size:0.95rem;font-weight:700;color:' + c + ';">' + fmt(s.price) + '</div>' +
          '<div style="font-size:0.72rem;color:' + c + ';">' + sign(s.pct) + '%</div>' +
        '</div>';
      row.onclick = function () { openModal(codes.indexOf(s.code) >= 0 ? codes.indexOf(s.code) : 0); };
      box.appendChild(row);
    });
  }

  function marketName(code) {
    var p = String(code).toLowerCase().slice(0, 2);
    return p === 'sh' ? '沪A' : p === 'sz' ? '深A' : p === 'hk' ? '港股' : p === 'us' ? '美股' : '指数';
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  }

  // ---------- 放大弹窗：两个视图 ----------
  function openModal(index) {
    closeModal();
    modal = document.createElement('div');
    modal.id = 'stk-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,14,28,.92);' +
      'display:flex;align-items:center;justify-content:center;padding:2rem;backdrop-filter:blur(8px);';
    modal.innerHTML =
      '<div style="width:min(1100px,96vw);max-height:92vh;overflow:auto;border-radius:16px;' +
        'background:linear-gradient(160deg,rgba(30,45,70,.96),rgba(16,24,42,.98));' +
        'border:1px solid rgba(120,150,200,.2);box-shadow:0 24px 80px rgba(0,0,0,.6);padding:1.5rem;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">' +
          '<div style="font-size:1.2rem;font-weight:700;color:#eaf0fa;">股票行情 <span style="font-size:.8rem;color:#a9b8cf;font-weight:400;">每 15 秒自动刷新</span></div>' +
          '<button id="stk-close" style="background:rgba(255,255,255,.08);border:0;color:#fff;' +
            'width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:1.1rem;">✕</button>' +
        '</div>' +
        '<div id="stk-modal-body" style="display:flex;flex-direction:column;gap:1rem;"></div>' +
      '</div>';
    modal.querySelector('#stk-close').onclick = closeModal;
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
    renderModal(index);
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }

  function renderModal(index) {
    var body = document.getElementById('stk-modal-body');
    if (!body) return;
    body.innerHTML = '';

    // 视图二：横向列表 —— 左信息 + 右实时数字 + 底部百分比
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0.8rem;';
    codes.forEach(function (code, i) {
      var card = document.createElement('div');
      card.className = 'stk-modal-card';
      card.setAttribute('data-i', i);
      card.style.cssText = 'padding:0.9rem 1rem;border-radius:12px;background:rgba(255,255,255,.06);' +
        'cursor:pointer;border:1px solid rgba(255,255,255,.08);';
      card.onclick = function () { renderChart(i); };
      grid.appendChild(card);
    });
    body.appendChild(grid);

    // 视图一：最大化实时轴图（K线）—— SVG 折线 + 面积
    var chart = document.createElement('div');
    chart.id = 'stk-chart';
    chart.style.cssText = 'border-radius:12px;background:rgba(0,0,0,.25);padding:1rem;min-height:280px;';
    body.appendChild(chart);

    refreshModal();
    renderChart(index || 0);
  }

  function refreshModal() {
    fetchJSON('/api/quote?codes=' + encodeURIComponent(codes.join(','))).then(function (j) {
      var map = {};
      (j.data || []).forEach(function (s) { map[s.code] = s; });
      document.querySelectorAll('.stk-modal-card').forEach(function (el) {
        var i = Number(el.getAttribute('data-i'));
        var s = map[codes[i]];
        if (!s || s.error) { el.innerHTML = '<div style="color:#a9b8cf;">加载失败</div>'; return; }
        var c = colorOf(s.pct);
        el.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;">' +
            '<div style="min-width:0;">' +
              '<div style="font-weight:600;color:#eaf0fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(s.name) + '</div>' +
              '<div style="font-size:.72rem;color:#a9b8cf;">' + esc(s.symbol) + ' · ' + marketName(s.code) + '</div>' +
            '</div>' +
            '<div style="text-align:right;font-weight:700;color:' + c + ';font-size:1.05rem;">' + fmt(s.price) + '</div>' +
          '</div>' +
          '<div style="margin-top:.6rem;padding-top:.5rem;border-top:1px solid rgba(255,255,255,.08);' +
            'display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:.72rem;color:#a9b8cf;">昨收 ' + fmt(s.prev) + ' · 换手 ' + fmt(s.turnover) + '%</span>' +
            '<span style="font-size:.95rem;font-weight:700;color:' + c + ';">' + sign(s.pct) + '%</span>' +
          '</div>';
      });
    }).catch(function () {});
  }

  function renderChart(i) {
    var box = document.getElementById('stk-chart');
    if (!box) return;
    var code = codes[i];
    box.innerHTML = '<div style="color:#a9b8cf;font-size:.85rem;">加载走势图…</div>';
    fetchJSON('/api/kline?code=' + encodeURIComponent(code) + '&klt=5&lmt=60').then(function (j) {
      var d = j.data || {};
      var ks = d.klines || [];
      if (!ks.length) { box.innerHTML = '<div style="color:#a9b8cf;">暂无走势数据</div>'; return; }
      var vals = ks.map(function (k) { return k.close; });
      var times = ks.map(function (k) { return k.time; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      var span = max - min || 1;
      var W = 1000, H = 240, PAD = 12;
      var n = vals.length;
      var xOf = function (idx) { return PAD + idx * (W - 2 * PAD) / (n - 1 || 1); };
      var yOf = function (v) { return PAD + (1 - (v - min) / span) * (H - 2 * PAD); };
      var pts = vals.map(function (v, idx) { return xOf(idx).toFixed(1) + ',' + yOf(v).toFixed(1); }).join(' ');
      var area = PAD + ',' + (H - PAD) + ' ' + pts + ' ' + (W - PAD) + ',' + (H - PAD);
      var last = vals[n - 1], first = vals[0];
      var c = last >= first ? RED : GREEN;
      var label = esc(d.name || code) + ' · ' + marketName(code) + ' · ' + esc(times[n - 1]);
      // x 轴：均匀取 5 个交易时间点做刻度
      var tickIdx = [0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1];
      var ticks = tickIdx.map(function (idx) {
        var t = times[idx];
        var ts = t && t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) : t;
        return '<span style="position:absolute;left:' + (xOf(idx) / W * 100).toFixed(2) +
          '%;transform:translateX(-50%);">' + esc(ts) + '</span>';
      }).join('');
      box.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">' +
          '<div style="font-weight:600;color:#eaf0fa;">' + label + '</div>' +
          '<div style="color:' + c + ';font-weight:700;font-size:1.05rem;">' + fmt(last) +
            ' <span style="font-size:.72rem;color:#a9b8cf;font-weight:400;">最高 ' + fmt(max) + ' · 最低 ' + fmt(min) + '</span></div>' +
        '</div>' +
        '<div id="stk-chart-wrap" style="position:relative;">' +
          '<svg id="stk-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:240px;display:block;cursor:crosshair;">' +
            '<defs><linearGradient id="stkg" x1="0" y1="0" x2="0" y2="1">' +
              '<stop offset="0%" stop-color="' + c + '" stop-opacity="0.35"/>' +
              '<stop offset="100%" stop-color="' + c + '" stop-opacity="0"/>' +
            '</linearGradient></defs>' +
            '<polygon points="' + area + '" fill="url(#stkg)"/>' +
            '<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="2.5" vector-effect="non-scaling-stroke"/>' +
            '<line id="stk-vline" y1="0" y2="' + H + '" stroke="#eaf0fa" stroke-opacity=".5" stroke-width="1" vector-effect="non-scaling-stroke" style="display:none;"/>' +
            '<circle id="stk-dot" r="4" fill="' + c + '" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke" style="display:none;"/>' +
          '</svg>' +
          '<div id="stk-tip" style="position:absolute;display:none;pointer-events:none;background:rgba(12,20,36,.96);' +
            'border:1px solid rgba(140,170,210,.35);border-radius:8px;padding:.4rem .6rem;color:#eaf0fa;' +
            'font-size:.78rem;white-space:nowrap;z-index:10;box-shadow:0 6px 20px rgba(0,0,0,.5);"></div>' +
          '<div style="position:relative;height:1.1rem;margin-top:.25rem;color:#a9b8cf;font-size:.72rem;">' + ticks + '</div>' +
        '</div>';
      var svg = document.getElementById('stk-svg');
      var vline = document.getElementById('stk-vline');
      var dot = document.getElementById('stk-dot');
      var tip = document.getElementById('stk-tip');
      function onMove(ev) {
        var rect = svg.getBoundingClientRect();
        var cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
        var ratio = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
        var idx = Math.round(ratio * (n - 1));
        var vx = xOf(idx), vy = yOf(vals[idx]);
        vline.setAttribute('x1', vx); vline.setAttribute('x2', vx); vline.style.display = '';
        dot.setAttribute('cx', vx); dot.setAttribute('cy', vy); dot.style.display = '';
        var t = times[idx];
        var ts = t && t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) : t;
        var chg = (vals[idx] - first) / first * 100;
        tip.innerHTML = '<div style="color:#a9b8cf;margin-bottom:2px;">' + esc(ts) + '</div>' +
          '<div style="font-weight:700;">价格 ' + fmt(vals[idx]) + '</div>' +
          '<div style="color:' + colorOf(chg) + ';">较开盘 ' + sign(chg) + '%</div>';
        tip.style.display = 'block';
        var tipX = vx / W * rect.width;
        if (tipX + 110 > rect.width) tipX = rect.width - 110;
        tip.style.left = Math.max(0, tipX) + 'px';
        tip.style.top = Math.max(0, vy / H * rect.height - 62) + 'px';
      }
      function onLeave() {
        if (vline) vline.style.display = 'none';
        if (dot) dot.style.display = 'none';
        if (tip) tip.style.display = 'none';
      }
      svg.addEventListener('mousemove', onMove);
      svg.addEventListener('mouseleave', onLeave);
      svg.addEventListener('touchmove', function (e) { onMove(e); }, { passive: true });
      svg.addEventListener('touchend', onLeave);
    }).catch(function () { box.innerHTML = '<div style="color:#a9b8cf;">走势加载失败</div>'; });
  }

  // ---------- 编辑自选股：搜索添加 + 列表删除 ----------
  function openEditor() {
    var sel = codes.map(function (c) { return { code: c, name: c, market: '' }; });
    var searchTimer = null;
    var dragIdx = null;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,14,28,.9);' +
      'display:flex;align-items:center;justify-content:center;padding:2rem;';
    wrap.innerHTML =
      '<div style="width:min(560px,94vw);max-height:90vh;overflow:auto;border-radius:16px;padding:1.5rem;' +
        'background:linear-gradient(160deg,rgba(30,45,70,.97),rgba(16,24,42,.99));' +
        'border:1px solid rgba(120,150,200,.2);">' +
        '<div style="font-weight:700;font-size:1.05rem;color:#eaf0fa;margin-bottom:.8rem;">编辑自选股</div>' +
        '<div style="font-size:.78rem;color:#a9b8cf;margin-bottom:.9rem;line-height:1.6;">' +
          '输入名称或代码搜索添加（最多 12 只）；拖动已选列表（或用 ▲▼）可调整顺序，越靠前越优先展示。' +
        '</div>' +
        '<div style="position:relative;">' +
          '<input id="stk-search" type="text" autocomplete="off" placeholder="搜索：茅台 / 000001 / AAPL / 腾讯"' +
            ' style="width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.18);' +
            'border-radius:8px;color:#fff;padding:.65rem .8rem;font-size:.9rem;outline:none;">' +
          '<div id="stk-results" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);' +
            'z-index:5;max-height:240px;overflow:auto;background:#16233c;border:1px solid rgba(140,170,210,.3);' +
            'border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);"></div>' +
        '</div>' +
        '<div style="display:flex;gap:.5rem;margin-top:.6rem;">' +
          '<input id="stk-manual" type="text" placeholder="手动添加代码，如 sh600519"' +
            ' style="flex:1;min-width:0;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);' +
            'border-radius:8px;color:#fff;padding:.5rem .7rem;font-size:.8rem;outline:none;">' +
          '<button id="stk-addmanual" style="padding:.5rem .9rem;border:1px solid rgba(255,255,255,.2);' +
            'border-radius:8px;background:rgba(255,255,255,.08);color:#eaf0fa;cursor:pointer;font-size:.8rem;">添加</button>' +
        '</div>' +
        '<div style="font-size:.75rem;color:#a9b8cf;margin:1rem 0 .5rem;">已选自选股（<span id="stk-cnt">0</span>/12）</div>' +
        '<div id="stk-sel" style="display:flex;flex-direction:column;gap:.4rem;min-height:60px;max-height:220px;overflow:auto;"></div>' +
        '<div style="display:flex;gap:.6rem;justify-content:flex-end;margin-top:1.1rem;">' +
          '<button id="stk-cancel" style="padding:.5rem 1rem;border-radius:8px;border:1px solid rgba(255,255,255,.2);' +
            'background:transparent;color:#fff;cursor:pointer;">取消</button>' +
          '<button id="stk-save" style="padding:.5rem 1rem;border-radius:8px;border:0;' +
            'background:#4f7cff;color:#fff;cursor:pointer;">保存并刷新</button>' +
        '</div>' +
      '</div>';
    var $ = function (id) { return wrap.querySelector('#' + id); };
    var inp = $('stk-search'), res = $('stk-results'), selBox = $('stk-sel');

    function renderSel() {
      $('stk-cnt').textContent = sel.length;
      selBox.innerHTML = '';
      if (!sel.length) {
        selBox.innerHTML = '<div style="color:#8a94a6;font-size:.8rem;padding:.5rem 0;">尚未添加自选股</div>';
        return;
      }
      sel.forEach(function (item, idx) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;border-radius:8px;' +
          'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.06);';
        row.innerHTML =
          '<div class="stk-drag" title="按住上下拖动排序" style="cursor:grab;color:#a9b8cf;font-size:1.05rem;' +
            'user-select:none;line-height:1;padding:0 .1rem;">⠿</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:.85rem;font-weight:600;color:#eaf0fa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
              esc(item.name) + '</div>' +
            '<div style="font-size:.7rem;color:#a9b8cf;">' + esc(item.code) +
              (item.market ? ' · ' + esc(item.market) : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:.15rem;">' +
            '<button data-act="up" ' + (idx === 0 ? 'disabled ' : '') + 'title="上移" style="background:transparent;border:0;' +
              'color:' + (idx === 0 ? '#556' : '#a9b8cf') + ';cursor:pointer;font-size:.75rem;padding:.1rem .25rem;">▲</button>' +
            '<button data-act="down" ' + (idx === sel.length - 1 ? 'disabled ' : '') + 'title="下移" style="background:transparent;border:0;' +
              'color:' + (idx === sel.length - 1 ? '#556' : '#a9b8cf') + ';cursor:pointer;font-size:.75rem;padding:.1rem .25rem;">▼</button>' +
          '</div>' +
          '<button data-act="del" title="移除" style="background:transparent;border:0;color:#a9b8cf;cursor:pointer;font-size:1rem;">✕</button>';
        // ▲▼ 移动 / ✕ 删除
        row.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () {
            var act = b.getAttribute('data-act');
            if (act === 'del') sel.splice(idx, 1);
            else if (act === 'up' && idx > 0) { var t = sel[idx - 1]; sel[idx - 1] = sel[idx]; sel[idx] = t; }
            else if (act === 'down' && idx < sel.length - 1) { var t2 = sel[idx + 1]; sel[idx + 1] = sel[idx]; sel[idx] = t2; }
            renderSel();
          };
        });
        // 拖动排序：按住 ⠿ 手柄拖到目标行
        var handle = row.querySelector('.stk-drag');
        handle.addEventListener('mousedown', function () { row.draggable = true; });
        handle.addEventListener('mouseup', function () { row.draggable = false; });
        row.addEventListener('dragstart', function (e) {
          dragIdx = idx; row.style.opacity = '.35';
          try { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
        });
        row.addEventListener('dragend', function () { row.draggable = false; row.style.opacity = ''; dragIdx = null; });
        row.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
        row.addEventListener('drop', function (e) {
          e.preventDefault();
          if (dragIdx === null || dragIdx === idx) return;
          var moved = sel.splice(dragIdx, 1)[0];
          sel.splice(idx, 0, moved);
          dragIdx = null;
          renderSel();
        });
        selBox.appendChild(row);
      });
    }
    function addItem(code, name, market) {
      code = String(code || '').trim();
      if (!/^(sh|sz|hk|us)[A-Za-z0-9]+$/i.test(code)) return false;
      if (sel.some(function (x) { return x.code.toLowerCase() === code.toLowerCase(); })) return false;
      if (sel.length >= 12) { alert('最多添加 12 只'); return false; }
      sel.push({ code: code, name: name || code, market: market || '' });
      renderSel();
      return true;
    }
    function marketOf(code) {
      var p = String(code).toLowerCase().slice(0, 2);
      return p === 'sh' ? '沪A' : p === 'sz' ? '深A' : p === 'hk' ? '港股' : p === 'us' ? '美股' : '';
    }

    // 搜索：输入防抖 250ms
    inp.addEventListener('input', function () {
      var kw = inp.value.trim();
      clearTimeout(searchTimer);
      if (!kw) { res.style.display = 'none'; res.innerHTML = ''; return; }
      searchTimer = setTimeout(function () {
        res.innerHTML = '<div style="padding:.6rem;color:#a9b8cf;font-size:.8rem;">搜索中…</div>';
        res.style.display = 'block';
        fetchJSON('/api/search?kw=' + encodeURIComponent(kw)).then(function (j) {
          var list = (j.data || []).filter(function (x) { return !x.error; });
          if (!list.length) {
            res.innerHTML = '<div style="padding:.7rem;color:#a9b8cf;font-size:.8rem;">无匹配结果，可手动添加代码</div>';
            return;
          }
          res.innerHTML = '';
          list.forEach(function (x) {
            var it = document.createElement('div');
            it.style.cssText = 'display:flex;align-items:center;gap:.6rem;padding:.55rem .75rem;cursor:pointer;' +
              'border-bottom:1px solid rgba(255,255,255,.05);';
            it.innerHTML =
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:.85rem;color:#eaf0fa;">' + esc(x.name) + '</div>' +
                '<div style="font-size:.7rem;color:#a9b8cf;">' + esc(x.code) + '</div>' +
              '</div>' +
              '<span style="font-size:.7rem;color:#a9b8cf;background:rgba(255,255,255,.08);' +
                'border-radius:4px;padding:.15rem .4rem;">' + esc(x.market) + '</span>';
            it.onclick = function () {
              addItem(x.code, x.name, x.market);
              res.style.display = 'none';
              inp.value = '';
              inp.focus();
            };
            res.appendChild(it);
          });
        }).catch(function () {
          res.innerHTML = '<div style="padding:.7rem;color:#f0483e;font-size:.8rem;">搜索失败，可手动添加代码</div>';
        });
      }, 250);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { res.style.display = 'none'; }
    });
    // 点空白处关闭结果
    wrap.addEventListener('click', function (e) {
      if (!res.contains(e.target) && e.target !== inp) res.style.display = 'none';
    });

    // 手动添加
    $('stk-addmanual').onclick = function () {
      var v = $('stk-manual').value.trim();
      if (!v) return;
      if (addItem(v, v, marketOf(v))) $('stk-manual').value = '';
      else alert('代码格式无效或已存在（格式：sh600519 / sz000001 / hk00700 / usAAPL）');
    };
    $('stk-manual').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('stk-addmanual').click();
    });

    $('stk-cancel').onclick = function () { wrap.remove(); };
    $('stk-save').onclick = function () {
      if (!sel.length) { alert('至少添加一只股票'); return; }
      codes = sel.slice(0, 12).map(function (x) { return x.code; });
      saveCodes(codes);
      wrap.remove();
      refresh();
      if (modal) renderModal(0);
    };
    document.body.appendChild(wrap);
    renderSel();
    inp.focus();
  }

  // ---------- 注入到左侧 widget 栏（系统状态卡下方）----------
  function inject() {
    if (document.getElementById('atrio-stock-widget')) return;
    // 左侧栏第一张是 CPU「系统状态」卡；插到它后面，确保股票组件出现在左侧小组件列
    // 层级：.widget.cpu 的父 div 就在 .side-bar .scroll-area 左侧列里
    // 严格等左侧「系统状态」CPU 卡出现再插入；不用 .widget 兜底（会误插到中间通知卡列且不再重试）
    var anchor = document.querySelector('.side-bar .widget.cpu') || document.querySelector('.widget.cpu');
    if (!anchor || !anchor.parentNode) return;
    var card = makeCard();
    // 只补通用卡片外框 class，用于匹配 Atrio 卡片视觉；不继承 last-block 等布局修饰
    ['content', '_card', 'is-flex', 'is-flex-direction-column'].forEach(function (c) {
      if (!card.classList.contains(c)) card.classList.add(c);
    });
    anchor.parentNode.insertBefore(card, anchor.nextSibling);
    refresh();
  }

  function refresh() {
    fetchJSON('/api/quote?codes=' + encodeURIComponent(codes.slice(0, 3).join(','))).then(function (j) {
      renderRows(j.data || []);
      var err = document.getElementById('stk-err');
      if (err) err.style.display = 'none';
    }).catch(function (e) {
      var err = document.getElementById('stk-err');
      if (err) { err.textContent = '数据刷新失败：' + e.message; err.style.display = 'block'; }
    });
    if (modal) refreshModal();
  }

  function start() {
    inject();
    // Vue 重渲染会移除注入节点，用 observer 兜底
    var mo = new MutationObserver(function () {
      if (!document.getElementById('atrio-stock-widget')) inject();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
  } else {
    setTimeout(start, 1500);
  }
})();

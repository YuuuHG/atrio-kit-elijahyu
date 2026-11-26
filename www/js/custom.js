// Atrio 自定义钩子 = 汉化 + 股票小组件加载器
// 说明：本文件由 index.html 以普通 <script> 同步加载，早于 type="module" 主程序执行。

// ---- 1) 汉化：默认加载官方简体中文语言包（只设一次，不覆盖用户后续手动切换）----
(function () {
  var DEFAULT_LANG = 'zh_cn';
  var MARKER = 'atrio_lang_initialized';
  try {
    if (!localStorage.getItem(MARKER)) {
      localStorage.setItem('lang', DEFAULT_LANG);
      localStorage.setItem(MARKER, '1');
    }
  } catch (e) {}
})();

// ---- 2) 加载股票小组件（独立脚本，失败不影响面板）----
(function () {
  function load() {
    var s = document.createElement('script');
    s.src = '/js/stock-widget.js';
    s.async = true;
    s.onerror = function () { console.warn('[stock-widget] 脚本加载失败'); };
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();

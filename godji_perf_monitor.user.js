// ==UserScript==
// @name         Godji — Монитор производительности
// @namespace    godji-erp
// @version      2.0
// @description  Мониторинг ресурсоёмкости Tampermonkey-скриптов ERP
// @match        https://godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─── Перехват MutationObserver ────────────────────────────────────────────
  const _NativeObserver = window.MutationObserver;
  const _observerMap = new Map();
  let _obsIdCounter = 0;

  window.MutationObserver = function (callback) {
    const id = ++_obsIdCounter;
    const wrappedCb = function (mutations, obs) {
      const t0 = performance.now();
      callback(mutations, obs);
      const dt = performance.now() - t0;
      const e = _observerMap.get(id);
      if (e && !e.throttled) { e.callCount++; e.totalMs += dt; e.lastMs = dt; }
    };
    const native = new _NativeObserver(wrappedCb);
    _observerMap.set(id, {
      id, name: _detectScriptName(),
      callCount: 0, totalMs: 0, lastMs: 0,
      active: false, throttled: false, native,
    });
    const pub = {
      observe(target, opts) {
        const e = _observerMap.get(id);
        if (e) { e.active = true; e.target = target; e.opts = opts; }
        native.observe(target, opts);
      },
      disconnect() {
        const e = _observerMap.get(id);
        if (e) { e.active = false; e.throttled = false; }
        native.disconnect();
      },
      takeRecords() { return native.takeRecords(); },
      _id: id,
    };
    return pub;
  };

  // ─── Перехват setInterval / setTimeout ───────────────────────────────────
  const _intervals = new Map();
  const _timeouts  = new Map();
  let _timerIdCounter = 0;

  const _NativeSI = window.setInterval;
  const _NativeCI = window.clearInterval;
  const _NativeST = window.setTimeout;
  const _NativeCT = window.clearTimeout;

  window.setInterval = function (fn, ms, ...args) {
    const id = ++_timerIdCounter;
    const name = _detectScriptName();
    const wrapped = typeof fn !== 'function' ? fn : function () {
      const e = _intervals.get(id);
      if (e && e.throttled) return;
      const t0 = performance.now();
      fn(...args);
      const dt = performance.now() - t0;
      if (e) { e.callCount++; e.totalMs += dt; e.lastMs = dt; }
    };
    const nativeId = _NativeSI(wrapped, ms);
    _intervals.set(id, { id, nativeId, name, ms, callCount: 0, totalMs: 0, lastMs: 0, active: true, throttled: false });
    return nativeId;
  };
  window.clearInterval = function (nativeId) {
    for (const e of _intervals.values()) if (e.nativeId === nativeId) { e.active = false; break; }
    return _NativeCI(nativeId);
  };
  window.setTimeout = function (fn, ms, ...args) {
    const id = ++_timerIdCounter;
    const name = _detectScriptName();
    const wrapped = typeof fn !== 'function' ? fn : function () {
      const t0 = performance.now();
      fn(...args);
      const dt = performance.now() - t0;
      const e = _timeouts.get(id);
      if (e) { e.callCount++; e.totalMs += dt; e.active = false; }
    };
    const nativeId = _NativeST(wrapped, ms);
    _timeouts.set(id, { id, nativeId, name, ms, callCount: 0, totalMs: 0, active: true });
    return nativeId;
  };
  window.clearTimeout = function (nativeId) {
    for (const e of _timeouts.values()) if (e.nativeId === nativeId) { e.active = false; break; }
    return _NativeCT(nativeId);
  };

  // ─── Перехват fetch ───────────────────────────────────────────────────────
  const _fetchStats = new Map();
  const _NativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const name = _detectScriptName();
    const t0 = performance.now();
    const result = await _NativeFetch(...args);
    const dt = performance.now() - t0;
    if (!_fetchStats.has(name)) _fetchStats.set(name, { callCount: 0, totalMs: 0 });
    const e = _fetchStats.get(name); e.callCount++; e.totalMs += dt;
    return result;
  };

  // ─── Определение скрипта по стеку ────────────────────────────────────────
  function _detectScriptName() {
    try {
      const stack = new Error().stack || '';
      const m = stack.match(/name=([^&\n]+)/);
      if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
    } catch {}
    return 'Страница';
  }

  // ─── CPU-сэмплирование (rolling 5s window) ───────────────────────────────
  const _cpuSamples = [];
  const _memSamples = [];
  const _startTime = Date.now();

  function _samplePerf() {
    const now = Date.now();
    // Псевдо-CPU: суммируем время выполнения всех перехваченных вызовов за последние 1000 мс
    // и делим на 1000 мс → процент занятости JS-потока нашими скриптами
    let windowMs = 1000;
    let busyMs = 0;
    for (const e of _observerMap.values()) busyMs += e.lastMs;
    for (const e of _intervals.values()) busyMs += e.lastMs || 0;
    const cpuPct = Math.min(100, (busyMs / windowMs) * 100);
    _cpuSamples.push({ ts: now, v: cpuPct });
    if (_cpuSamples.length > 30) _cpuSamples.shift();

    // Память через performance.memory (Chrome only)
    if (performance.memory) {
      _memSamples.push({ ts: now, v: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) });
      if (_memSamples.length > 30) _memSamples.shift();
    }
  }
  _NativeSI(_samplePerf, 1000);

  // ─── Агрегация по скриптам ───────────────────────────────────────────────
  function _aggregateStats() {
    const map = new Map();
    function get(name) {
      if (!map.has(name)) map.set(name, {
        name,
        obs:   { active: 0, total: 0, callCount: 0, totalMs: 0, subtreeCount: 0 },
        ivl:   { active: 0, total: 0, callCount: 0, totalMs: 0 },
        tmo:   { pending: 0, total: 0, callCount: 0 },
        fetch: { callCount: 0, totalMs: 0 },
        totalMs: 0,
        throttled: false,
      });
      return map.get(name);
    }
    for (const e of _observerMap.values()) {
      const s = get(e.name); s.obs.total++;
      if (e.active) s.obs.active++;
      if (e.opts && e.opts.subtree) s.obs.subtreeCount++;
      s.obs.callCount += e.callCount; s.obs.totalMs += e.totalMs;
      if (e.throttled) s.throttled = true;
    }
    for (const e of _intervals.values()) {
      const s = get(e.name); s.ivl.total++;
      if (e.active) s.ivl.active++;
      s.ivl.callCount += e.callCount; s.ivl.totalMs += e.totalMs;
      if (e.throttled) s.throttled = true;
    }
    for (const e of _timeouts.values()) {
      const s = get(e.name); s.tmo.total++;
      if (e.active) s.tmo.pending++;
      s.tmo.callCount += e.callCount;
    }
    for (const [name, e] of _fetchStats) {
      const s = get(name); s.fetch.callCount = e.callCount; s.fetch.totalMs = e.totalMs;
    }
    for (const s of map.values()) {
      s.totalMs = s.obs.totalMs + s.ivl.totalMs + s.fetch.totalMs;
    }
    return [...map.values()].sort((a, b) => b.totalMs - a.totalMs);
  }

  // ─── Throttle скрипта ─────────────────────────────────────────────────────
  function _throttleScript(name, enable) {
    for (const e of _observerMap.values()) if (e.name === name) e.throttled = enable;
    for (const e of _intervals.values())  if (e.name === name) e.throttled = enable;
  }

  // ─── Утилиты ─────────────────────────────────────────────────────────────
  function _ms(v) {
    if (!v || v < 1) return '< 1 мс';
    if (v < 1000) return Math.round(v) + ' мс';
    return (v / 1000).toFixed(1) + ' с';
  }
  function _pct(v, total) {
    if (!total) return 0;
    return Math.min(100, Math.round((v / total) * 100));
  }
  function _riskColor(pct) {
    if (pct > 40) return '#e03131';
    if (pct > 15) return '#f59f00';
    return '#2f9e44';
  }

  // ─── Спарклайн ────────────────────────────────────────────────────────────
  function _sparkline(samples, color, width, height) {
    if (samples.length < 2) return `<svg width="${width}" height="${height}"></svg>`;
    const vals = samples.map(s => s.v);
    const max = Math.max(...vals, 1);
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * width;
      const y = height - (v / max) * height;
      return `${x},${y}`;
    }).join(' ');
    return `<svg width="${width}" height="${height}" style="display:block;"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  // ─── Стили ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #gj-pm-btn {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,0.55); padding: 5px;
        border-radius: 6px; display: flex; align-items: center;
        justify-content: center; transition: color .15s, background .15s;
        flex-shrink: 0;
      }
      #gj-pm-btn:hover, #gj-pm-btn.open { color: #fff; }
      #gj-pm-btn.open { background: rgba(255,255,255,0.08); }

      #gj-pm-panel {
        position: fixed; top: 0; left: 280px;
        width: 480px; height: 100vh;
        background: #fff;
        border-right: 1px solid #e9ecef;
        box-shadow: 2px 0 24px rgba(0,0,0,0.10);
        z-index: 9999; display: none; flex-direction: column;
        font-family: -apple-system, 'Segoe UI', sans-serif;
        font-size: 13px; color: #212529;
        overflow: hidden;
      }
      #gj-pm-panel.open { display: flex; }

      .gj-pm-head {
        padding: 14px 18px 12px;
        border-bottom: 1px solid #e9ecef;
        display: flex; align-items: center; gap: 10px;
        background: #fff;
        flex-shrink: 0;
      }
      .gj-pm-head-title { font-size: 14px; font-weight: 700; color: #212529; flex: 1; }
      .gj-pm-head-sub { font-size: 11px; color: #868e96; }

      .gj-pm-summary {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
        gap: 0; border-bottom: 1px solid #e9ecef;
        flex-shrink: 0;
      }
      .gj-pm-stat {
        padding: 12px 16px; border-right: 1px solid #e9ecef;
      }
      .gj-pm-stat:last-child { border-right: none; }
      .gj-pm-stat-label { font-size: 10px; font-weight: 600; color: #868e96; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
      .gj-pm-stat-val { font-size: 22px; font-weight: 700; color: #212529; line-height: 1; }
      .gj-pm-stat-unit { font-size: 11px; color: #868e96; margin-top: 2px; }

      .gj-pm-tabs {
        display: flex; border-bottom: 1px solid #e9ecef;
        flex-shrink: 0; background: #f8f9fa;
      }
      .gj-pm-tab {
        padding: 8px 14px; background: none; border: none;
        border-bottom: 2px solid transparent;
        font-size: 12px; font-weight: 500; color: #868e96;
        cursor: pointer; transition: color .15s, border-color .15s;
        white-space: nowrap;
      }
      .gj-pm-tab:hover { color: #495057; }
      .gj-pm-tab.active { color: #212529; border-bottom-color: #e03131; font-weight: 600; }

      .gj-pm-body { flex: 1; overflow-y: auto; padding: 12px 16px; background: #f8f9fa; }

      /* Карточка скрипта */
      .gj-pm-card {
        background: #fff; border: 1px solid #e9ecef; border-radius: 8px;
        margin-bottom: 8px; overflow: hidden;
        transition: box-shadow .15s;
      }
      .gj-pm-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
      .gj-pm-card-head {
        padding: 10px 14px; display: flex; align-items: center; gap: 10px;
        cursor: pointer; user-select: none;
      }
      .gj-pm-card-dot {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .gj-pm-card-name {
        flex: 1; font-weight: 600; font-size: 12px; color: #212529;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .gj-pm-card-ms { font-size: 12px; font-weight: 700; margin-right: 6px; }
      .gj-pm-card-pct {
        font-size: 11px; color: #868e96; width: 34px; text-align: right;
      }

      .gj-pm-bar-wrap {
        height: 3px; background: #f1f3f5; margin: 0 14px 10px;
      }
      .gj-pm-bar {
        height: 3px; border-radius: 2px; transition: width .4s;
      }

      .gj-pm-details {
        padding: 0 14px 12px; display: none;
        border-top: 1px solid #f1f3f5;
      }
      .gj-pm-details.open { display: block; }

      .gj-pm-detail-row {
        display: flex; align-items: center; gap: 6px;
        padding: 5px 0; border-bottom: 1px solid #f8f9fa;
        font-size: 11px;
      }
      .gj-pm-detail-row:last-child { border-bottom: none; }
      .gj-pm-detail-label { color: #868e96; flex: 1; }
      .gj-pm-detail-val { font-weight: 600; color: #212529; }
      .gj-pm-badge {
        display: inline-block; padding: 1px 6px; border-radius: 3px;
        font-size: 10px; font-weight: 700;
      }
      .gj-pm-badge-red   { background: #fff5f5; color: #c92a2a; }
      .gj-pm-badge-amber { background: #fff9db; color: #e67700; }
      .gj-pm-badge-green { background: #ebfbee; color: #2f9e44; }
      .gj-pm-badge-gray  { background: #f1f3f5; color: #495057; }

      /* Кнопка оптимизации */
      .gj-pm-opt-btn {
        margin-top: 10px; width: 100%;
        padding: 7px 12px; border-radius: 6px; border: none;
        font-size: 12px; font-weight: 600; cursor: pointer;
        transition: background .15s, color .15s;
      }
      .gj-pm-opt-btn.throttle {
        background: #fff5f5; color: #c92a2a;
        border: 1px solid #ffc9c9;
      }
      .gj-pm-opt-btn.throttle:hover { background: #ffe3e3; }
      .gj-pm-opt-btn.restore {
        background: #ebfbee; color: #2f9e44;
        border: 1px solid #b2f2bb;
      }
      .gj-pm-opt-btn.restore:hover { background: #d3f9d8; }

      /* Графики */
      .gj-pm-chart-wrap { margin-top: 6px; }
      .gj-pm-chart-label { font-size: 10px; color: #868e96; margin-bottom: 2px; }

      /* Footer */
      .gj-pm-footer {
        padding: 10px 16px; border-top: 1px solid #e9ecef;
        display: flex; align-items: center; gap: 8px;
        background: #fff; flex-shrink: 0;
      }
      .gj-pm-footer-btn {
        padding: 5px 12px; border-radius: 5px;
        font-size: 11px; font-weight: 600; cursor: pointer;
        border: 1px solid #dee2e6; background: #fff; color: #495057;
        transition: background .15s;
      }
      .gj-pm-footer-btn:hover { background: #f1f3f5; }
      .gj-pm-uptime { margin-left: auto; font-size: 11px; color: #adb5bd; }

      .gj-pm-empty { text-align: center; padding: 32px; color: #adb5bd; font-size: 12px; }

      /* Scrollbar */
      .gj-pm-body::-webkit-scrollbar { width: 4px; }
      .gj-pm-body::-webkit-scrollbar-track { background: transparent; }
      .gj-pm-body::-webkit-scrollbar-thumb { background: #dee2e6; border-radius: 4px; }
    `;
    document.head.appendChild(s);
  }

  // ─── Панель ───────────────────────────────────────────────────────────────
  let _panelOpen = false;
  let _activeTab = 'scripts';
  let _expandedCards = new Set();
  let _uiReady = false;

  function _buildPanel() {
    if (document.getElementById('gj-pm-panel')) return true;
    const header = document.querySelector('.Sidebar_header__dm6Ua');
    if (!header) return false;

    _injectStyles();

    // Кнопка
    const btn = document.createElement('button');
    btn.id = 'gj-pm-btn';
    btn.title = 'Монитор производительности';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 7.76a6 6 0 0 0 0 8.49"/></svg>`;
    const flex = header.querySelector('.mantine-Flex-root');
    (flex || header).appendChild(btn);

    // Панель
    const panel = document.createElement('div');
    panel.id = 'gj-pm-panel';
    panel.innerHTML = `
      <div class="gj-pm-head">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#e03131" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="gj-pm-head-title">Производительность</span>
        <span class="gj-pm-head-sub" id="gj-pm-uptime">uptime 0с</span>
      </div>
      <div class="gj-pm-summary">
        <div class="gj-pm-stat">
          <div class="gj-pm-stat-label">JS-нагрузка</div>
          <div class="gj-pm-stat-val" id="gj-pm-s-cpu">—</div>
          <div class="gj-pm-stat-unit">% от JS-потока</div>
        </div>
        <div class="gj-pm-stat">
          <div class="gj-pm-stat-label">Память</div>
          <div class="gj-pm-stat-val" id="gj-pm-s-mem">—</div>
          <div class="gj-pm-stat-unit">МБ heap</div>
        </div>
        <div class="gj-pm-stat">
          <div class="gj-pm-stat-label">Скриптов</div>
          <div class="gj-pm-stat-val" id="gj-pm-s-count">—</div>
          <div class="gj-pm-stat-unit">активных</div>
        </div>
      </div>
      <div class="gj-pm-tabs">
        <button class="gj-pm-tab active" data-tab="scripts">Скрипты</button>
        <button class="gj-pm-tab" data-tab="observers">Observers</button>
        <button class="gj-pm-tab" data-tab="timers">Таймеры</button>
        <button class="gj-pm-tab" data-tab="fetch">Fetch</button>
      </div>
      <div class="gj-pm-body" id="gj-pm-body"></div>
      <div class="gj-pm-footer">
        <button class="gj-pm-footer-btn" id="gj-pm-reset">Сбросить статистику</button>
        <button class="gj-pm-footer-btn" id="gj-pm-restore-all">Снять все ограничения</button>
        <span class="gj-pm-uptime" id="gj-pm-uptime2">uptime 0с</span>
      </div>`;
    document.body.appendChild(panel);

    // Tabs
    panel.querySelectorAll('.gj-pm-tab').forEach(t => {
      t.onclick = () => {
        _activeTab = t.dataset.tab;
        panel.querySelectorAll('.gj-pm-tab').forEach(x => x.classList.toggle('active', x === t));
        _render();
      };
    });

    btn.onclick = () => {
      _panelOpen = !_panelOpen;
      panel.classList.toggle('open', _panelOpen);
      btn.classList.toggle('open', _panelOpen);
      if (_panelOpen) _render();
    };

    panel.querySelector('#gj-pm-reset').onclick = () => {
      for (const e of _observerMap.values()) { e.callCount = 0; e.totalMs = 0; e.lastMs = 0; }
      for (const e of _intervals.values())   { e.callCount = 0; e.totalMs = 0; e.lastMs = 0; }
      for (const e of _timeouts.values())    { e.callCount = 0; e.totalMs = 0; }
      _fetchStats.clear();
      _render();
    };

    panel.querySelector('#gj-pm-restore-all').onclick = () => {
      for (const e of _observerMap.values()) e.throttled = false;
      for (const e of _intervals.values())  e.throttled = false;
      _render();
    };

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _panelOpen) {
        _panelOpen = false;
        panel.classList.remove('open');
        btn.classList.remove('open');
      }
    });

    _uiReady = true;
    return true;
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────
  function _render() {
    if (!_uiReady) return;
    const stats = _aggregateStats();
    const uptime = Math.floor((Date.now() - _startTime) / 1000);
    const uptimeStr = uptime < 60 ? uptime + 'с' : Math.floor(uptime/60) + 'м ' + (uptime%60) + 'с';

    ['gj-pm-uptime','gj-pm-uptime2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'uptime ' + uptimeStr;
    });

    // Summary
    const totalMs = stats.reduce((a, s) => a + s.totalMs, 0);
    // JS-нагрузка = сумма последних busyMs за 1с / 1000
    let busyMs = 0;
    for (const e of _observerMap.values()) busyMs += e.lastMs;
    for (const e of _intervals.values())  busyMs += e.lastMs || 0;
    const cpuPct = Math.min(99, Math.round((busyMs / 50) * 100)); // относительно 50мс кадра

    const mem = performance.memory;
    const memMb = mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : null;
    const activeCount = stats.filter(s => s.obs.active || s.ivl.active).length;

    const cpuEl = document.getElementById('gj-pm-s-cpu');
    if (cpuEl) { cpuEl.textContent = cpuPct; cpuEl.style.color = cpuPct > 40 ? '#e03131' : cpuPct > 15 ? '#f59f00' : '#2f9e44'; }
    const memEl = document.getElementById('gj-pm-s-mem');
    if (memEl) memEl.textContent = memMb !== null ? memMb : '—';
    const cntEl = document.getElementById('gj-pm-s-count');
    if (cntEl) cntEl.textContent = activeCount;

    const body = document.getElementById('gj-pm-body');
    if (!body) return;

    if (_activeTab === 'scripts') _renderScripts(body, stats, totalMs);
    else if (_activeTab === 'observers') _renderObservers(body);
    else if (_activeTab === 'timers') _renderTimers(body);
    else if (_activeTab === 'fetch') _renderFetch(body);
  }

  function _shortName(name) {
    return name.replace(/Godji\s*[—–-]\s*/gi, '').replace(/\.user\.js$/i, '').trim().substring(0, 38) || name.substring(0, 38);
  }

  function _renderScripts(body, stats, totalMs) {
    if (!stats.length) { body.innerHTML = '<div class="gj-pm-empty">Нет данных — дождитесь нескольких секунд активности</div>'; return; }

    body.innerHTML = stats.map(s => {
      const pct = _pct(s.totalMs, totalMs);
      const rc = _riskColor(pct);
      const short = _shortName(s.name);
      const expanded = _expandedCards.has(s.name);
      const isThrottled = s.throttled;

      const badges = [
        s.obs.subtreeCount ? `<span class="gj-pm-badge gj-pm-badge-red">subtree×${s.obs.subtreeCount}</span>` : '',
        s.obs.active ? `<span class="gj-pm-badge gj-pm-badge-gray">${s.obs.active} observer</span>` : '',
        s.ivl.active ? `<span class="gj-pm-badge gj-pm-badge-gray">${s.ivl.active} interval</span>` : '',
        isThrottled ? `<span class="gj-pm-badge gj-pm-badge-amber">ограничен</span>` : '',
      ].filter(Boolean).join(' ');

      const details = `
        <div class="gj-pm-details${expanded ? ' open' : ''}">
          <div style="height:8px;"></div>
          ${s.obs.total ? `<div class="gj-pm-detail-row">
            <span class="gj-pm-detail-label">MutationObserver</span>
            <span class="gj-pm-detail-val">${s.obs.active}/${s.obs.total} активных · ${s.obs.callCount} вызовов · ${_ms(s.obs.totalMs)}</span>
          </div>` : ''}
          ${s.obs.subtreeCount ? `<div class="gj-pm-detail-row">
            <span class="gj-pm-detail-label">⚠ subtree:true</span>
            <span class="gj-pm-badge gj-pm-badge-red">${s.obs.subtreeCount} шт — дорого!</span>
          </div>` : ''}
          ${s.ivl.total ? `<div class="gj-pm-detail-row">
            <span class="gj-pm-detail-label">setInterval</span>
            <span class="gj-pm-detail-val">${s.ivl.active}/${s.ivl.total} активных · ${s.ivl.callCount} вызовов · ${_ms(s.ivl.totalMs)}</span>
          </div>` : ''}
          ${s.tmo.total ? `<div class="gj-pm-detail-row">
            <span class="gj-pm-detail-label">setTimeout</span>
            <span class="gj-pm-detail-val">${s.tmo.pending} ожидают · ${s.tmo.callCount} выполнено</span>
          </div>` : ''}
          ${s.fetch.callCount ? `<div class="gj-pm-detail-row">
            <span class="gj-pm-detail-label">Fetch-запросы</span>
            <span class="gj-pm-detail-val">${s.fetch.callCount} запросов · ${_ms(s.fetch.totalMs)} суммарно</span>
          </div>` : ''}
          <button class="gj-pm-opt-btn ${isThrottled ? 'restore' : 'throttle'}" data-name="${s.name}">
            ${isThrottled ? 'Снять ограничение' : 'Снизить нагрузку (приостановить observers и intervals)'}
          </button>
        </div>`;

      return `<div class="gj-pm-card" data-script="${s.name}">
        <div class="gj-pm-card-head" data-toggle="${s.name}">
          <div class="gj-pm-card-dot" style="background:${rc};"></div>
          <div class="gj-pm-card-name" title="${s.name}">${short}</div>
          <div class="gj-pm-card-ms" style="color:${rc};">${_ms(s.totalMs)}</div>
          <div class="gj-pm-card-pct" style="color:${rc};">${pct}%</div>
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#adb5bd" stroke-width="2.5" stroke-linecap="round"><polyline points="${expanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9'}"/></svg>
        </div>
        ${badges ? `<div style="padding:0 14px 8px;display:flex;gap:4px;flex-wrap:wrap;">${badges}</div>` : ''}
        <div class="gj-pm-bar-wrap"><div class="gj-pm-bar" style="width:${pct}%;background:${rc};"></div></div>
        ${details}
      </div>`;
    }).join('');

    // Клики
    body.querySelectorAll('[data-toggle]').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.toggle;
        if (_expandedCards.has(name)) _expandedCards.delete(name);
        else _expandedCards.add(name);
        _render();
      };
    });
    body.querySelectorAll('[data-name]').forEach(el => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        const name = el.dataset.name;
        const isThrottled = [..._observerMap.values()].find(e => e.name === name && e.throttled) ||
                            [..._intervals.values()].find(e => e.name === name && e.throttled);
        _throttleScript(name, !isThrottled);
        _render();
      };
    });
  }

  function _renderObservers(body) {
    const rows = [..._observerMap.values()].sort((a, b) => b.totalMs - a.totalMs);
    if (!rows.length) { body.innerHTML = '<div class="gj-pm-empty">Нет observers</div>'; return; }
    body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:10px;font-weight:600;color:#868e96;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:6px 8px 10px;">Скрипт</th>
        <th style="padding:6px 8px 10px;text-align:center;">Вызовы</th>
        <th style="padding:6px 8px 10px;text-align:center;">Всего</th>
        <th style="padding:6px 8px 10px;text-align:center;">subtree</th>
        <th style="padding:6px 8px 10px;text-align:center;">Статус</th>
      </tr></thead>
      <tbody>${rows.map(e => {
        const st = e.active ? '<span class="gj-pm-badge gj-pm-badge-green">active</span>' : '<span class="gj-pm-badge gj-pm-badge-gray">idle</span>';
        const sub = e.opts && e.opts.subtree ? '<span class="gj-pm-badge gj-pm-badge-red">true</span>' : '<span class="gj-pm-badge gj-pm-badge-gray">false</span>';
        const thr = e.throttled ? '<span class="gj-pm-badge gj-pm-badge-amber">throttled</span>' : '';
        return `<tr style="border-top:1px solid #f1f3f5;">
          <td style="padding:7px 8px;font-size:12px;color:#212529;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.name}">${_shortName(e.name)}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:#495057;">${e.callCount}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;font-weight:600;color:${e.totalMs>500?'#e03131':'#212529'};">${_ms(e.totalMs)}</td>
          <td style="padding:7px 8px;text-align:center;">${sub}</td>
          <td style="padding:7px 8px;text-align:center;">${st}${thr ? ' ' + thr : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function _renderTimers(body) {
    const rows = [
      ...[..._intervals.values()].map(e => ({...e, type:'interval'})),
      ...[...Array.from(_timeouts.values()).filter(e => e.active)].map(e => ({...e, type:'timeout'})),
    ].sort((a, b) => b.totalMs - a.totalMs);
    if (!rows.length) { body.innerHTML = '<div class="gj-pm-empty">Нет активных таймеров</div>'; return; }
    body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:10px;font-weight:600;color:#868e96;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:6px 8px 10px;">Скрипт</th>
        <th style="padding:6px 8px 10px;text-align:center;">Тип</th>
        <th style="padding:6px 8px 10px;text-align:center;">Интервал</th>
        <th style="padding:6px 8px 10px;text-align:center;">Вызовы</th>
        <th style="padding:6px 8px 10px;text-align:center;">Всего</th>
      </tr></thead>
      <tbody>${rows.map(e => {
        const typeBadge = e.type === 'interval'
          ? '<span class="gj-pm-badge gj-pm-badge-amber">interval</span>'
          : '<span class="gj-pm-badge gj-pm-badge-gray">timeout</span>';
        return `<tr style="border-top:1px solid #f1f3f5;">
          <td style="padding:7px 8px;font-size:12px;color:#212529;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.name}">${_shortName(e.name)}</td>
          <td style="padding:7px 8px;text-align:center;">${typeBadge}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:#495057;">${e.ms || '?'} мс</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:#495057;">${e.callCount}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;font-weight:600;color:${e.totalMs>500?'#e03131':'#212529'};">${_ms(e.totalMs)}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function _renderFetch(body) {
    if (!_fetchStats.size) { body.innerHTML = '<div class="gj-pm-empty">Нет fetch-запросов</div>'; return; }
    const rows = [..._fetchStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
    body.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:10px;font-weight:600;color:#868e96;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:6px 8px 10px;">Скрипт</th>
        <th style="padding:6px 8px 10px;text-align:center;">Запросов</th>
        <th style="padding:6px 8px 10px;text-align:center;">Суммарно</th>
        <th style="padding:6px 8px 10px;text-align:center;">Среднее</th>
      </tr></thead>
      <tbody>${rows.map(([name, e]) => {
        const avg = e.callCount ? e.totalMs / e.callCount : 0;
        return `<tr style="border-top:1px solid #f1f3f5;">
          <td style="padding:7px 8px;font-size:12px;color:#212529;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${name}">${_shortName(name)}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:#495057;">${e.callCount}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;font-weight:600;color:#212529;">${_ms(e.totalMs)}</td>
          <td style="padding:7px 8px;text-align:center;font-size:12px;color:#495057;">${_ms(avg)}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  // ─── Автообновление ───────────────────────────────────────────────────────
  _NativeSI(() => { if (_panelOpen) _render(); }, 1000);

  // ─── Инициализация ────────────────────────────────────────────────────────
  function _tryInit() {
    if (document.querySelector('.Sidebar_header__dm6Ua')) {
      _buildPanel();
      return true;
    }
    return false;
  }

  const _initObs = new _NativeObserver(() => {
    if (_tryInit()) _initObs.disconnect();
  });

  if (document.readyState !== 'loading') {
    if (!_tryInit()) _initObs.observe(document.body, { childList: true, subtree: false });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!_tryInit()) _initObs.observe(document.body, { childList: true, subtree: false });
    });
  }

})();

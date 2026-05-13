// ==UserScript==
// @name         Godji — Монитор производительности
// @namespace    godji-erp
// @version      1.0
// @description  Мониторинг ресурсоёмкости Tampermonkey-скриптов ERP
// @match        https://godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ── Конфиг ──────────────────────────────────────────────────────────────
  const POLL_MS = 1000;
  const HISTORY_SIZE = 60; // секунд истории для графика

  // ── Перехват MutationObserver ────────────────────────────────────────────
  const _NativeObserver = window.MutationObserver;
  const _observerMap = new Map(); // id → { name, callCount, totalMs, active }
  let _obsIdCounter = 0;

  window.MutationObserver = function (callback) {
    const id = ++_obsIdCounter;
    const wrappedCb = function (mutations, obs) {
      const t0 = performance.now();
      callback(mutations, obs);
      const dt = performance.now() - t0;
      const entry = _observerMap.get(id);
      if (entry) {
        entry.callCount++;
        entry.totalMs += dt;
        entry.lastMs = dt;
      }
    };
    const native = new _NativeObserver(wrappedCb);
    const scriptName = _detectScriptName();
    _observerMap.set(id, {
      id,
      name: scriptName,
      callCount: 0,
      totalMs: 0,
      lastMs: 0,
      active: false,
      native,
    });
    return {
      observe(target, opts) {
        const e = _observerMap.get(id);
        if (e) { e.active = true; e.target = target; e.opts = opts; }
        return native.observe(target, opts);
      },
      disconnect() {
        const e = _observerMap.get(id);
        if (e) e.active = false;
        return native.disconnect();
      },
      takeRecords() { return native.takeRecords(); },
    };
  };

  // ── Перехват setInterval / setTimeout ───────────────────────────────────
  const _intervals = new Map();
  const _timeouts  = new Map();
  let _timerIdCounter = 0;

  const _NativeSetInterval = window.setInterval;
  const _NativeClearInterval = window.clearInterval;
  const _NativeSetTimeout = window.setTimeout;
  const _NativeClearTimeout = window.clearTimeout;

  window.setInterval = function (fn, ms, ...args) {
    const id = ++_timerIdCounter;
    const scriptName = _detectScriptName();
    const wrapped = typeof fn === 'function' ? function () {
      const t0 = performance.now();
      fn(...args);
      const dt = performance.now() - t0;
      const e = _intervals.get(id);
      if (e) { e.callCount++; e.totalMs += dt; e.lastMs = dt; }
    } : fn;
    const nativeId = _NativeSetInterval(wrapped, ms, ...(typeof fn === 'function' ? [] : args));
    _intervals.set(id, { id, nativeId, name: scriptName, ms, callCount: 0, totalMs: 0, lastMs: 0, active: true });
    return nativeId;
  };

  window.clearInterval = function (nativeId) {
    for (const [id, e] of _intervals) {
      if (e.nativeId === nativeId) { e.active = false; break; }
    }
    return _NativeClearInterval(nativeId);
  };

  window.setTimeout = function (fn, ms, ...args) {
    const id = ++_timerIdCounter;
    const scriptName = _detectScriptName();
    const wrapped = typeof fn === 'function' ? function () {
      const t0 = performance.now();
      fn(...args);
      const dt = performance.now() - t0;
      const e = _timeouts.get(id);
      if (e) { e.callCount++; e.totalMs += dt; e.active = false; }
    } : fn;
    const nativeId = _NativeSetTimeout(wrapped, ms, ...(typeof fn === 'function' ? [] : args));
    _timeouts.set(id, { id, nativeId, name: scriptName, ms, callCount: 0, totalMs: 0, active: true });
    return nativeId;
  };

  window.clearTimeout = function (nativeId) {
    for (const [id, e] of _timeouts) {
      if (e.nativeId === nativeId) { e.active = false; break; }
    }
    return _NativeClearTimeout(nativeId);
  };

  // ── Перехват fetch ───────────────────────────────────────────────────────
  const _fetchStats = new Map(); // scriptName → { callCount, totalMs }
  const _NativeFetch = window.fetch;

  window.fetch = async function (...args) {
    const scriptName = _detectScriptName();
    const t0 = performance.now();
    const result = await _NativeFetch(...args);
    const dt = performance.now() - t0;
    if (!_fetchStats.has(scriptName)) _fetchStats.set(scriptName, { callCount: 0, totalMs: 0 });
    const e = _fetchStats.get(scriptName);
    e.callCount++;
    e.totalMs += dt;
    return result;
  };

  // ── Определение имени скрипта по стеку ──────────────────────────────────
  function _detectScriptName() {
    try {
      const stack = new Error().stack || '';
      const match = stack.match(/name=([^&]+)&/);
      if (match) {
        try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
      }
      if (stack.includes('userscript')) return 'userscript (unknown)';
    } catch (e) {}
    return 'page';
  }

  // ── CPU-сэмплирование через performance.now ──────────────────────────────
  const _cpuHistory = []; // { ts, cpu% by script }

  // ── Агрегация данных по скриптам ─────────────────────────────────────────
  function _aggregateStats() {
    const byScript = new Map();

    function ensure(name) {
      if (!byScript.has(name)) byScript.set(name, {
        name,
        observers: { active: 0, total: 0, callCount: 0, totalMs: 0 },
        intervals: { active: 0, total: 0, callCount: 0, totalMs: 0 },
        timeouts:  { pending: 0, total: 0, callCount: 0, totalMs: 0 },
        fetch:     { callCount: 0, totalMs: 0 },
      });
      return byScript.get(name);
    }

    for (const e of _observerMap.values()) {
      const s = ensure(e.name);
      s.observers.total++;
      if (e.active) s.observers.active++;
      s.observers.callCount += e.callCount;
      s.observers.totalMs  += e.totalMs;
    }

    for (const e of _intervals.values()) {
      const s = ensure(e.name);
      s.intervals.total++;
      if (e.active) s.intervals.active++;
      s.intervals.callCount += e.callCount;
      s.intervals.totalMs  += e.totalMs;
    }

    for (const e of _timeouts.values()) {
      const s = ensure(e.name);
      s.timeouts.total++;
      if (e.active) s.timeouts.pending++;
      s.timeouts.callCount += e.callCount;
      s.timeouts.totalMs  += e.totalMs;
    }

    for (const [name, e] of _fetchStats) {
      const s = ensure(name);
      s.fetch.callCount = e.callCount;
      s.fetch.totalMs   = e.totalMs;
    }

    // Суммарная нагрузка по скрипту (ms потрачено)
    for (const s of byScript.values()) {
      s.totalMs = s.observers.totalMs + s.intervals.totalMs + s.timeouts.totalMs;
    }

    return [...byScript.values()].sort((a, b) => b.totalMs - a.totalMs);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  function _buildUI() {
    // Кнопка в header сайдбара
    const btn = document.createElement('button');
    btn.id = 'gj-perf-btn';
    btn.title = 'Монитор производительности';
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7-.7.7M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 12v-7"/><path d="M9 15l-2 2M15 15l2 2"/><path d="M2 19h20"/></svg>`;
    Object.assign(btn.style, {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'rgba(255,255,255,0.6)',
      padding: '4px',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'color 0.15s',
      flexShrink: '0',
    });
    btn.onmouseenter = () => btn.style.color = '#fff';
    btn.onmouseleave = () => { if (!_panelOpen) btn.style.color = 'rgba(255,255,255,0.6)'; };

    // Панель
    const panel = document.createElement('div');
    panel.id = 'gj-perf-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      left: '280px',
      width: '520px',
      height: '100vh',
      background: '#1a1b1e',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      zIndex: '9999',
      display: 'none',
      flexDirection: 'column',
      fontFamily: 'Inter,system-ui,sans-serif',
      fontSize: '12px',
      color: '#c1c2c5',
      boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
    });

    panel.innerHTML = `
      <div style="padding:16px 20px 12px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:10px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e03131" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h1m8-9v1m8 8h1M5.6 5.6l.7.7m12.1-.7-.7.7M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M12 12v-7"/><path d="M9 15l-2 2M15 15l2 2"/><path d="M2 19h20"/></svg>
        <span style="font-size:13px;font-weight:600;color:#fff;">Монитор производительности</span>
        <span id="gj-perf-uptime" style="margin-left:auto;font-size:11px;color:rgba(255,255,255,0.3);">uptime 0s</span>
      </div>

      <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.08);">
        <button class="gj-tab active" data-tab="scripts" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid #e03131;color:#fff;cursor:pointer;font-size:11px;font-weight:500;">Скрипты</button>
        <button class="gj-tab" data-tab="timers" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid transparent;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px;font-weight:500;">Таймеры</button>
        <button class="gj-tab" data-tab="observers" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid transparent;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px;font-weight:500;">Observers</button>
        <button class="gj-tab" data-tab="fetch" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid transparent;color:rgba(255,255,255,0.4);cursor:pointer;font-size:11px;font-weight:500;">Fetch</button>
      </div>

      <div id="gj-perf-body" style="flex:1;overflow-y:auto;padding:12px 16px;"></div>

      <div style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:8px;align-items:center;">
        <span style="font-size:11px;color:rgba(255,255,255,0.3);">Оптимизация:</span>
        <button id="gj-perf-reset-stats" style="padding:4px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#c1c2c5;cursor:pointer;font-size:11px;">Сбросить статистику</button>
        <button id="gj-perf-disconnect-obs" style="padding:4px 10px;background:rgba(224,49,49,0.12);border:1px solid rgba(224,49,49,0.3);border-radius:4px;color:#ff6b6b;cursor:pointer;font-size:11px;">Отключить неактивные observers</button>
      </div>
    `;

    document.body.appendChild(panel);

    // Tabs
    let _activeTab = 'scripts';
    panel.querySelectorAll('.gj-tab').forEach(tab => {
      tab.onclick = () => {
        _activeTab = tab.dataset.tab;
        panel.querySelectorAll('.gj-tab').forEach(t => {
          t.style.borderBottomColor = t === tab ? '#e03131' : 'transparent';
          t.style.color = t === tab ? '#fff' : 'rgba(255,255,255,0.4)';
        });
        _renderPanel(_activeTab);
      };
    });

    panel.querySelector('#gj-perf-reset-stats').onclick = () => {
      for (const e of _observerMap.values()) { e.callCount = 0; e.totalMs = 0; }
      for (const e of _intervals.values())   { e.callCount = 0; e.totalMs = 0; }
      for (const e of _timeouts.values())    { e.callCount = 0; e.totalMs = 0; }
      _fetchStats.clear();
      _renderPanel(_activeTab);
    };

    panel.querySelector('#gj-perf-disconnect-obs').onclick = () => {
      let count = 0;
      for (const e of _observerMap.values()) {
        if (!e.active && e.callCount === 0) { /* already inactive */ continue; }
        if (!e.active) { e.native.disconnect(); count++; }
      }
      _showToast(`Отключено ${count} неактивных observers`);
    };

    return { btn, panel, getTab: () => _activeTab };
  }

  function _showToast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '99999',
      background: '#2c2e33', color: '#fff', padding: '8px 14px',
      borderRadius: '6px', fontSize: '12px', border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Рендер таблиц ─────────────────────────────────────────────────────────
  const _startTime = Date.now();

  function _renderPanel(tab) {
    const body = document.getElementById('gj-perf-body');
    if (!body) return;
    const stats = _aggregateStats();
    const uptime = Math.floor((Date.now() - _startTime) / 1000);
    const el = document.getElementById('gj-perf-uptime');
    if (el) el.textContent = `uptime ${uptime}s`;

    if (tab === 'scripts') {
      body.innerHTML = _renderScripts(stats);
    } else if (tab === 'timers') {
      body.innerHTML = _renderTimers();
    } else if (tab === 'observers') {
      body.innerHTML = _renderObservers();
    } else if (tab === 'fetch') {
      body.innerHTML = _renderFetch();
    }
  }

  function _ms(v) {
    if (v < 1) return '<1ms';
    if (v < 1000) return Math.round(v) + 'ms';
    return (v / 1000).toFixed(1) + 's';
  }

  function _badge(color, text) {
    return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;background:${color}22;color:${color};">${text}</span>`;
  }

  function _renderScripts(stats) {
    if (!stats.length) return '<div style="color:rgba(255,255,255,0.3);padding:20px 0;text-align:center;">Данных пока нет — подождите несколько секунд</div>';
    const maxMs = Math.max(...stats.map(s => s.totalMs), 1);
    return stats.map(s => {
      const pct = Math.min(100, (s.totalMs / maxMs) * 100);
      const risk = s.totalMs > 2000 ? '#ff6b6b' : s.totalMs > 500 ? '#ffa94d' : '#69db7c';
      const shortName = s.name.replace(/Godji — /g, '').replace(/\.user\.js/g, '').substring(0, 40);
      return `
        <div style="margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-weight:500;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${s.name}">${shortName}</span>
            <span style="color:${risk};font-weight:600;font-size:11px;">${_ms(s.totalMs)}</span>
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.07);border-radius:2px;margin-bottom:6px;">
            <div style="height:4px;background:${risk};border-radius:2px;width:${pct}%;transition:width 0.3s;"></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${s.observers.total ? _badge('#74c0fc', `obs ${s.observers.active}/${s.observers.total} · ${_ms(s.observers.totalMs)}`) : ''}
            ${s.intervals.total ? _badge('#ffa94d', `intervals ${s.intervals.active}/${s.intervals.total} · ${s.intervals.callCount} вызовов`) : ''}
            ${s.timeouts.total  ? _badge('#b197fc', `timeouts ${s.timeouts.pending} pending · ${s.timeouts.callCount} вызовов`) : ''}
            ${s.fetch.callCount ? _badge('#63e6be', `fetch ${s.fetch.callCount} · ${_ms(s.fetch.totalMs)}`) : ''}
          </div>
        </div>`;
    }).join('');
  }

  function _renderTimers() {
    const rows = [..._intervals.values(), ..._timeouts.values()]
      .sort((a, b) => b.totalMs - a.totalMs);
    if (!rows.length) return '<div style="color:rgba(255,255,255,0.3);padding:20px 0;text-align:center;">Нет таймеров</div>';
    return `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:4px 6px;">Скрипт</th>
        <th style="padding:4px 6px;">Тип</th>
        <th style="padding:4px 6px;">ms</th>
        <th style="padding:4px 6px;">Вызовы</th>
        <th style="padding:4px 6px;">Всего</th>
        <th style="padding:4px 6px;">Статус</th>
      </tr></thead>
      <tbody>${rows.map(e => {
        const isInterval = _intervals.has(e.id);
        const status = e.active ? _badge('#69db7c', 'active') : _badge('#868e96', 'idle');
        const shortName = e.name.replace(/Godji — /g, '').substring(0, 30);
        return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
          <td style="padding:5px 6px;color:#c1c2c5;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.name}">${shortName}</td>
          <td style="padding:5px 6px;text-align:center;">${isInterval ? _badge('#ffa94d','interval') : _badge('#b197fc','timeout')}</td>
          <td style="padding:5px 6px;text-align:center;color:#fff;">${e.ms || '?'}</td>
          <td style="padding:5px 6px;text-align:center;">${e.callCount}</td>
          <td style="padding:5px 6px;text-align:center;color:${e.totalMs > 500 ? '#ffa94d' : '#c1c2c5'};">${_ms(e.totalMs)}</td>
          <td style="padding:5px 6px;text-align:center;">${status}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function _renderObservers() {
    const rows = [..._observerMap.values()].sort((a, b) => b.totalMs - a.totalMs);
    if (!rows.length) return '<div style="color:rgba(255,255,255,0.3);padding:20px 0;text-align:center;">Нет observers</div>';
    return `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:4px 6px;">Скрипт</th>
        <th style="padding:4px 6px;">Вызовы</th>
        <th style="padding:4px 6px;">Всего</th>
        <th style="padding:4px 6px;">Послед.</th>
        <th style="padding:4px 6px;">subtree</th>
        <th style="padding:4px 6px;">Статус</th>
      </tr></thead>
      <tbody>${rows.map(e => {
        const status = e.active ? _badge('#69db7c', 'active') : _badge('#868e96', 'idle');
        const subtree = e.opts && e.opts.subtree ? _badge('#ff6b6b','true') : _badge('#69db7c','false');
        const shortName = e.name.replace(/Godji — /g, '').substring(0, 30);
        return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
          <td style="padding:5px 6px;color:#c1c2c5;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${e.name}">${shortName}</td>
          <td style="padding:5px 6px;text-align:center;">${e.callCount}</td>
          <td style="padding:5px 6px;text-align:center;color:${e.totalMs > 500 ? '#ffa94d' : '#c1c2c5'};">${_ms(e.totalMs)}</td>
          <td style="padding:5px 6px;text-align:center;">${_ms(e.lastMs)}</td>
          <td style="padding:5px 6px;text-align:center;">${subtree}</td>
          <td style="padding:5px 6px;text-align:center;">${status}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function _renderFetch() {
    if (!_fetchStats.size) return '<div style="color:rgba(255,255,255,0.3);padding:20px 0;text-align:center;">Нет fetch-вызовов</div>';
    const rows = [..._fetchStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
    return `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="color:rgba(255,255,255,0.4);font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">
        <th style="text-align:left;padding:4px 6px;">Скрипт</th>
        <th style="padding:4px 6px;">Вызовы</th>
        <th style="padding:4px 6px;">Суммарно</th>
        <th style="padding:4px 6px;">Среднее</th>
      </tr></thead>
      <tbody>${rows.map(([name, e]) => {
        const avg = e.callCount ? e.totalMs / e.callCount : 0;
        const shortName = name.replace(/Godji — /g, '').substring(0, 35);
        return `<tr style="border-top:1px solid rgba(255,255,255,0.04);">
          <td style="padding:5px 6px;color:#c1c2c5;" title="${name}">${shortName}</td>
          <td style="padding:5px 6px;text-align:center;">${e.callCount}</td>
          <td style="padding:5px 6px;text-align:center;">${_ms(e.totalMs)}</td>
          <td style="padding:5px 6px;text-align:center;">${_ms(avg)}</td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  // ── Инициализация UI ─────────────────────────────────────────────────────
  let _panelOpen = false;
  let _uiRefs = null;
  let _pollTimer = null;

  function _initUI() {
    const header = document.querySelector('.Sidebar_header__dm6Ua');
    if (!header) return false;
    if (document.getElementById('gj-perf-btn')) return true;

    _uiRefs = _buildUI();
    const { btn, panel, getTab } = _uiRefs;

    // Вставляем кнопку в Flex-контейнер header рядом с логотипом
    const flex = header.querySelector('.mantine-Flex-root');
    if (flex) {
      flex.appendChild(btn);
    } else {
      header.appendChild(btn);
    }

    btn.onclick = () => {
      _panelOpen = !_panelOpen;
      panel.style.display = _panelOpen ? 'flex' : 'none';
      btn.style.color = _panelOpen ? '#e03131' : 'rgba(255,255,255,0.6)';
      if (_panelOpen) _renderPanel(getTab());
    };

    // Закрытие по Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _panelOpen) {
        _panelOpen = false;
        panel.style.display = 'none';
        btn.style.color = 'rgba(255,255,255,0.6)';
      }
    });

    // Автообновление раз в секунду пока открыта панель
    _pollTimer = setInterval(() => {
      if (_panelOpen) _renderPanel(getTab());
    }, POLL_MS);

    return true;
  }

  // Ждём появления сайдбара
  const _initObs = new _NativeObserver(() => {
    if (_initUI()) _initObs.disconnect();
  });

  if (document.body) {
    if (!_initUI()) _initObs.observe(document.body, { childList: true, subtree: false });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!_initUI()) _initObs.observe(document.body, { childList: true, subtree: false });
    });
  }

})();

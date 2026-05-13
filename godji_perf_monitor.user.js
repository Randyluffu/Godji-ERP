// ==UserScript==
// @name         Godji — Монитор производительности
// @namespace    godji-erp
// @version      3.0
// @description  Мониторинг ресурсоёмкости Tampermonkey-скриптов ERP
// @match        https://godji.cloud/*
// @grant        GM_info
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─── Реестр скриптов (известные имена по подстрокам в URL стека) ──────────
  const KNOWN_SCRIPTS = [
    { key: 'perf',        label: 'Монитор производительности' },
    { key: 'cashbox',     label: 'Касса' },
    { key: 'settings',    label: 'Настройки' },
    { key: 'operations',  label: 'История операций' },
    { key: 'session',     label: 'История сеансов' },
    { key: 'client',      label: 'Поиск клиентов' },
    { key: 'seating',     label: 'Карта посадки' },
    { key: 'map_sync',    label: 'Синхронизация карты' },
    { key: 'cleanup',     label: 'Напоминание об уборке' },
    { key: 'multi',       label: 'Мультиселект' },
    { key: 'menu',        label: 'Цвета меню' },
    { key: 'mgmt',        label: 'Управление настройками' },
    { key: 'auto_beg',    label: 'Авто-новичок' },
    { key: 'banlist',     label: 'Бан-лист' },
    { key: 'debit',       label: 'Списание с баланса' },
    { key: 'tightvnc',    label: 'Просмотр экрана' },
    { key: 'vnc',         label: 'Просмотр экрана' },
  ];

  function _resolveScriptName(rawName) {
    if (!rawName) return 'Страница';
    let decoded = rawName;
    try { decoded = decodeURIComponent(rawName); } catch {}
    // Убираем префикс "Godji — " и суффикс ".user.js"
    decoded = decoded
      .replace(/Godji\s*[—–-]\s*/gi, '')
      .replace(/\.user\.js$/i, '')
      .trim();
    // Проверяем по ключам
    const lc = rawName.toLowerCase();
    for (const s of KNOWN_SCRIPTS) {
      if (lc.includes(s.key)) return s.label;
    }
    return decoded || rawName;
  }

  // ─── Определение имени текущего скрипта из стека ─────────────────────────
  function _detectScriptName() {
    try {
      const stack = new Error().stack || '';
      // Tampermonkey кладёт имя в URL вида: name=...&id=...
      const m = stack.match(/name=([^&\s\n]+)/);
      if (m) return _resolveScriptName(m[1]);
      if (stack.includes('userscript')) return 'Неизвестный скрипт';
    } catch {}
    return 'Страница';
  }

  // ─── Хранилище метрик ────────────────────────────────────────────────────
  const _scripts = new Map(); // label → ScriptStats

  function _getScript(name) {
    if (!_scripts.has(name)) {
      _scripts.set(name, {
        name,
        obs:   { items: [], callCount: 0, totalMs: 0 },
        ivl:   { items: [], callCount: 0, totalMs: 0 },
        tmo:   { pending: 0, done: 0 },
        fetch: { callCount: 0, totalMs: 0 },
        throttled: false,
        visible: true,
      });
    }
    return _scripts.get(name);
  }

  // ─── Перехват MutationObserver ────────────────────────────────────────────
  const _NativeObserver = window.MutationObserver;

  window.MutationObserver = function (callback) {
    const scriptName = _detectScriptName();
    let _obsEntry = null;

    const wrapped = function (mutations, obs) {
      if (_obsEntry && _obsEntry.throttled) return;
      const t0 = performance.now();
      callback(mutations, obs);
      const dt = performance.now() - t0;
      if (_obsEntry) { _obsEntry.callCount++; _obsEntry.totalMs += dt; _obsEntry.lastMs = dt; }
      const s = _getScript(scriptName);
      s.obs.callCount++; s.obs.totalMs += dt;
    };

    const native = new _NativeObserver(wrapped);

    return {
      observe(target, opts) {
        const s = _getScript(scriptName);
        _obsEntry = { native, callCount: 0, totalMs: 0, lastMs: 0, throttled: false, opts: opts || {}, active: true };
        s.obs.items.push(_obsEntry);
        native.observe(target, opts);
      },
      disconnect() {
        if (_obsEntry) _obsEntry.active = false;
        native.disconnect();
      },
      takeRecords() { return native.takeRecords(); },
    };
  };

  // ─── Перехват setInterval ─────────────────────────────────────────────────
  const _NativeSI = window.setInterval;
  const _NativeCI = window.clearInterval;

  window.setInterval = function (fn, ms, ...args) {
    const scriptName = _detectScriptName();
    let _ivlEntry = null;

    const wrapped = typeof fn !== 'function' ? fn : function () {
      if (_ivlEntry && _ivlEntry.throttled) return;
      const t0 = performance.now();
      fn(...args);
      const dt = performance.now() - t0;
      if (_ivlEntry) { _ivlEntry.callCount++; _ivlEntry.totalMs += dt; _ivlEntry.lastMs = dt; }
      const s = _getScript(scriptName);
      s.ivl.callCount++; s.ivl.totalMs += dt;
    };

    const nativeId = _NativeSI(wrapped, ms);
    _ivlEntry = { nativeId, ms, callCount: 0, totalMs: 0, lastMs: 0, throttled: false, active: true };
    _getScript(scriptName).ivl.items.push(_ivlEntry);
    return nativeId;
  };

  window.clearInterval = function (nativeId) {
    for (const s of _scripts.values()) {
      const e = s.ivl.items.find(i => i.nativeId === nativeId);
      if (e) { e.active = false; break; }
    }
    return _NativeCI(nativeId);
  };

  // ─── Перехват setTimeout ──────────────────────────────────────────────────
  const _NativeST = window.setTimeout;
  const _NativeCT = window.clearTimeout;

  window.setTimeout = function (fn, ms, ...args) {
    const scriptName = _detectScriptName();
    const s = _getScript(scriptName);
    s.tmo.pending++;
    const nativeId = _NativeST(() => {
      s.tmo.pending = Math.max(0, s.tmo.pending - 1);
      s.tmo.done++;
      if (typeof fn === 'function') fn(...args);
    }, ms);
    return nativeId;
  };

  window.clearTimeout = function (nativeId) { return _NativeCT(nativeId); };

  // ─── Перехват fetch ───────────────────────────────────────────────────────
  const _NativeFetch = window.fetch;
  window.fetch = async function (...args) {
    const scriptName = _detectScriptName();
    const t0 = performance.now();
    const result = await _NativeFetch(...args);
    const dt = performance.now() - t0;
    const s = _getScript(scriptName);
    s.fetch.callCount++; s.fetch.totalMs += dt;
    return result;
  };

  // ─── Реальные системные метрики ──────────────────────────────────────────
  const _startTime = Date.now();
  const _perfHistory = []; // { ts, mem, cpu }

  function _getMemMb() {
    if (performance.memory) return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    return null;
  }
  function _getTotalMemMb() {
    if (performance.memory) return Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024);
    return null;
  }

  // Простое CPU-приближение: измеряем сколько тиков в секунду пропускается
  let _lastCpuCheck = performance.now();
  let _cpuPct = 0;
  function _measureCpu() {
    const now = performance.now();
    const elapsed = now - _lastCpuCheck;
    // Если elapsed >> 16.7ms (1 кадр) значит JS-поток был занят
    _cpuPct = Math.min(100, Math.round(Math.max(0, (elapsed - 16) / 16 * 100)));
    _lastCpuCheck = now;
  }
  _NativeSI(_measureCpu, 200);

  function _samplePerf() {
    _perfHistory.push({ ts: Date.now(), mem: _getMemMb(), cpu: _cpuPct });
    if (_perfHistory.length > 60) _perfHistory.shift();
  }
  _NativeSI(_samplePerf, 1000);

  // ─── Суммарная нагрузка по скрипту ───────────────────────────────────────
  function _getScriptLoad(s) {
    // Реальные мс потрачены на этот скрипт за всё время
    const ms = s.obs.totalMs + s.ivl.totalMs + s.fetch.totalMs;
    const uptime = Math.max(1, (Date.now() - _startTime) / 1000);
    const pct = Math.min(99, Math.round((ms / (uptime * 1000)) * 100));
    return { ms, pct };
  }

  function _getThreatLevel(s) {
    const hasSubtree = s.obs.items.some(e => e.active && e.opts.subtree);
    const activeIntervals = s.ivl.items.filter(e => e.active).length;
    const { pct } = _getScriptLoad(s);
    if (hasSubtree || pct > 30) return 'high';
    if (activeIntervals > 3 || pct > 10) return 'medium';
    return 'low';
  }

  // ─── Throttle ─────────────────────────────────────────────────────────────
  function _throttleScript(name, enable) {
    const s = _scripts.get(name);
    if (!s) return;
    s.throttled = enable;
    s.obs.items.forEach(e => e.throttled = enable);
    s.ivl.items.forEach(e => e.throttled = enable);
  }

  // ─── Стили ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('gj-pm-styles')) return;
    const style = document.createElement('style');
    style.id = 'gj-pm-styles';
    style.textContent = `
      #gj-pm-btn {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,0.55); padding: 5px;
        border-radius: 6px; display: flex; align-items: center;
        justify-content: center; transition: color .15s, background .15s;
        flex-shrink: 0;
      }
      #gj-pm-btn:hover { color: #fff; }
      #gj-pm-btn.open { color: #fff; background: rgba(255,255,255,0.1); }

      #gj-pm-panel {
        position: fixed; top: 0; left: 280px;
        width: 400px; height: 100vh;
        background: #fff; border-right: 1px solid #dee2e6;
        box-shadow: 4px 0 20px rgba(0,0,0,0.08);
        z-index: 9999; display: none; flex-direction: column;
        font-family: -apple-system,'Segoe UI',sans-serif;
        font-size: 13px; color: #212529; overflow: hidden;
      }
      #gj-pm-panel.open { display: flex; }

      /* Шапка */
      .pm-head {
        padding: 16px 18px 14px; border-bottom: 1px solid #e9ecef;
        background: #fff; flex-shrink: 0;
        display: flex; align-items: center; gap: 10px;
      }
      .pm-head-title { font-size: 14px; font-weight: 700; color: #212529; flex: 1; }
      .pm-head-close {
        background: none; border: none; cursor: pointer;
        color: #adb5bd; padding: 4px; border-radius: 4px;
        display: flex; align-items: center; transition: color .15s;
      }
      .pm-head-close:hover { color: #495057; }

      /* Общие метрики */
      .pm-metrics {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 0; border-bottom: 1px solid #e9ecef; flex-shrink: 0;
        background: #f8f9fa;
      }
      .pm-metric {
        padding: 14px 18px; border-right: 1px solid #e9ecef;
      }
      .pm-metric:last-child { border-right: none; }
      .pm-metric-label {
        font-size: 10px; font-weight: 700; color: #868e96;
        text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px;
      }
      .pm-metric-row { display: flex; align-items: baseline; gap: 4px; }
      .pm-metric-val { font-size: 28px; font-weight: 800; line-height: 1; }
      .pm-metric-unit { font-size: 12px; color: #868e96; font-weight: 500; }
      .pm-metric-bar {
        height: 3px; border-radius: 2px; background: #e9ecef; margin-top: 6px;
      }
      .pm-metric-bar-fill {
        height: 3px; border-radius: 2px; transition: width .5s;
      }

      /* Список скриптов */
      .pm-list { flex: 1; overflow-y: auto; padding: 10px 12px; background: #f8f9fa; }
      .pm-list::-webkit-scrollbar { width: 4px; }
      .pm-list::-webkit-scrollbar-thumb { background: #dee2e6; border-radius: 4px; }

      .pm-section-label {
        font-size: 10px; font-weight: 700; color: #adb5bd;
        text-transform: uppercase; letter-spacing: 0.6px;
        padding: 6px 4px 4px; margin-bottom: 2px;
      }

      /* Карточка скрипта */
      .pm-card {
        background: #fff; border: 1px solid #e9ecef; border-radius: 8px;
        margin-bottom: 6px; overflow: hidden;
        transition: box-shadow .15s, border-color .15s;
      }
      .pm-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-color: #ced4da; }
      .pm-card.throttled { border-color: #ffc9c9; background: #fff5f5; }
      .pm-card.throttled .pm-card-name { color: #868e96; }

      .pm-card-row {
        padding: 10px 14px; display: flex; align-items: center; gap: 10px;
        cursor: pointer;
      }
      .pm-card-icon {
        width: 28px; height: 28px; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; font-size: 13px;
      }
      .pm-card-body { flex: 1; min-width: 0; }
      .pm-card-name { font-weight: 600; font-size: 12px; color: #212529; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pm-card-sub { font-size: 11px; color: #868e96; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .pm-card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
      .pm-card-pct { font-size: 16px; font-weight: 800; line-height: 1; }
      .pm-card-pct-label { font-size: 10px; color: #868e96; }

      /* Прогресс под карточкой */
      .pm-card-progress { height: 2px; background: #f1f3f5; margin: 0 14px 10px; }
      .pm-card-progress-fill { height: 2px; border-radius: 1px; transition: width .5s; }

      /* Детали */
      .pm-card-details { border-top: 1px solid #f1f3f5; display: none; }
      .pm-card-details.open { display: block; }
      .pm-details-inner { padding: 10px 14px 12px; }

      .pm-detail-item {
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 0; font-size: 11px; color: #495057;
        border-bottom: 1px solid #f8f9fa;
      }
      .pm-detail-item:last-of-type { border-bottom: none; }
      .pm-detail-key { color: #868e96; }
      .pm-detail-val { font-weight: 600; color: #212529; }

      .pm-warn {
        background: #fff9db; border: 1px solid #ffe066; border-radius: 5px;
        padding: 6px 10px; margin-top: 8px; font-size: 11px; color: #e67700; font-weight: 500;
      }

      /* Кнопка снизить нагрузку */
      .pm-throttle-btn {
        width: 100%; margin-top: 10px;
        padding: 7px; border-radius: 6px; border: none;
        font-size: 12px; font-weight: 600; cursor: pointer;
        transition: background .15s;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }
      .pm-throttle-btn.on {
        background: #fff5f5; color: #c92a2a; border: 1px solid #ffc9c9;
      }
      .pm-throttle-btn.on:hover { background: #ffe3e3; }
      .pm-throttle-btn.off {
        background: #ebfbee; color: #2f9e44; border: 1px solid #b2f2bb;
      }
      .pm-throttle-btn.off:hover { background: #d3f9d8; }

      /* Футер */
      .pm-footer {
        padding: 10px 14px; border-top: 1px solid #e9ecef;
        background: #fff; flex-shrink: 0;
        display: flex; align-items: center; gap: 6px;
      }
      .pm-footer-btn {
        padding: 5px 10px; border-radius: 5px;
        font-size: 11px; font-weight: 600; cursor: pointer;
        border: 1px solid #dee2e6; background: #fff; color: #495057;
        transition: background .15s;
      }
      .pm-footer-btn:hover { background: #f8f9fa; }
      .pm-uptime { margin-left: auto; font-size: 11px; color: #ced4da; }

      /* Цвета нагрузки */
      .load-high { color: #e03131; }
      .load-med  { color: #f59f00; }
      .load-low  { color: #2f9e44; }
      .bg-high   { background: #ffc9c9; }
      .bg-med    { background: #ffec99; }
      .bg-low    { background: #b2f2bb; }
      .fill-high { background: #e03131; }
      .fill-med  { background: #f59f00; }
      .fill-low  { background: #2f9e44; }
      .icon-high { background: #fff5f5; }
      .icon-med  { background: #fff9db; }
      .icon-low  { background: #ebfbee; }
    `;
    document.head.appendChild(style);
  }

  // ─── Иконки по типу скрипта ───────────────────────────────────────────────
  function _scriptEmoji(name) {
    if (name.includes('Касса'))            return '🧾';
    if (name.includes('История опер'))     return '📋';
    if (name.includes('История сеанс'))    return '🕐';
    if (name.includes('Поиск'))            return '🔍';
    if (name.includes('Карта'))            return '🗺';
    if (name.includes('Синхронизация'))    return '🔄';
    if (name.includes('Уборка'))           return '🧹';
    if (name.includes('Мульти'))           return '☑';
    if (name.includes('Цвет'))             return '🎨';
    if (name.includes('Настройки'))        return '⚙';
    if (name.includes('Управление'))       return '💾';
    if (name.includes('Новичок'))          return '🎮';
    if (name.includes('Бан'))              return '🚫';
    if (name.includes('Списание'))         return '💸';
    if (name.includes('Просмотр'))         return '🖥';
    if (name.includes('Монитор'))          return '📊';
    return '🔧';
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────
  let _openCards = new Set();
  let _panelOpen = false;
  let _uiReady = false;

  function _levelOf(threat) {
    return threat === 'high' ? 'high' : threat === 'medium' ? 'med' : 'low';
  }

  function _render() {
    if (!_uiReady || !_panelOpen) return;

    const uptime = Math.max(1, (Date.now() - _startTime) / 1000);
    const uptimeStr = uptime < 60 ? Math.round(uptime) + ' с' : Math.floor(uptime / 60) + ' м ' + (Math.round(uptime) % 60) + ' с';

    // Uptime
    const ut = document.getElementById('pm-uptime');
    if (ut) ut.textContent = uptimeStr;

    // Метрики
    const memMb  = _getMemMb();
    const totalMb = _getTotalMemMb();
    const memPct  = totalMb && memMb ? Math.round((memMb / totalMb) * 100) : 0;

    // JS-нагрузка = суммарно потраченное время всеми скриптами / uptime
    let totalScriptMs = 0;
    for (const s of _scripts.values()) totalScriptMs += s.obs.totalMs + s.ivl.totalMs;
    const jsPct = Math.min(99, Math.round((totalScriptMs / (uptime * 1000)) * 100));

    const memColor = memPct > 70 ? '#e03131' : memPct > 40 ? '#f59f00' : '#2f9e44';
    const jsColor  = jsPct > 30  ? '#e03131' : jsPct  > 10 ? '#f59f00' : '#2f9e44';

    const jsEl  = document.getElementById('pm-js-val');
    const memEl = document.getElementById('pm-mem-val');
    const jsFill = document.getElementById('pm-js-fill');
    const memFill = document.getElementById('pm-mem-fill');
    if (jsEl) { jsEl.textContent = jsPct; jsEl.style.color = jsColor; }
    if (memEl && memMb) { memEl.textContent = memMb; memEl.style.color = memColor; }
    if (jsFill) { jsFill.style.width = jsPct + '%'; jsFill.style.background = jsColor; }
    if (memFill && memPct) { memFill.style.width = memPct + '%'; memFill.style.background = memColor; }

    // Список скриптов
    const list = document.getElementById('pm-list');
    if (!list) return;

    const scripts = [..._scripts.values()].sort((a, b) => {
      const la = _getScriptLoad(a).pct;
      const lb = _getScriptLoad(b).pct;
      return lb - la;
    });

    // Разбиваем по уровням
    const high   = scripts.filter(s => _getThreatLevel(s) === 'high');
    const medium = scripts.filter(s => _getThreatLevel(s) === 'medium');
    const low    = scripts.filter(s => _getThreatLevel(s) === 'low');

    let html = '';

    function renderGroup(label, items) {
      if (!items.length) return '';
      let out = `<div class="pm-section-label">${label}</div>`;
      out += items.map(s => {
        const { ms, pct } = _getScriptLoad(s);
        const threat = _getThreatLevel(s);
        const lvl = _levelOf(threat);
        const isOpen = _openCards.has(s.name);
        const isThrottled = s.throttled;

        const activeObs = s.obs.items.filter(e => e.active).length;
        const subtreeObs = s.obs.items.filter(e => e.active && e.opts.subtree).length;
        const activeIvl = s.ivl.items.filter(e => e.active).length;

        // Подпись под именем
        const parts = [];
        if (activeObs) parts.push(activeObs + ' observer' + (activeObs > 1 ? 's' : ''));
        if (activeIvl) parts.push(activeIvl + ' interval' + (activeIvl > 1 ? 's' : ''));
        if (s.fetch.callCount) parts.push(s.fetch.callCount + ' запросов');
        if (isThrottled) parts.push('⏸ ограничен');
        const sub = parts.join(' · ') || 'нет активности';

        // Предупреждения
        const warns = [];
        if (subtreeObs) warns.push(`⚠ ${subtreeObs} observer(s) с subtree:true — сильно нагружают браузер`);

        const detailRows = [
          s.obs.callCount ? `<div class="pm-detail-item"><span class="pm-detail-key">Observer — вызовов</span><span class="pm-detail-val">${s.obs.callCount} · ${_ms(s.obs.totalMs)}</span></div>` : '',
          s.ivl.callCount ? `<div class="pm-detail-item"><span class="pm-detail-key">Intervals — вызовов</span><span class="pm-detail-val">${s.ivl.callCount} · ${_ms(s.ivl.totalMs)}</span></div>` : '',
          s.tmo.done ? `<div class="pm-detail-item"><span class="pm-detail-key">Timeouts выполнено</span><span class="pm-detail-val">${s.tmo.done}</span></div>` : '',
          s.fetch.callCount ? `<div class="pm-detail-item"><span class="pm-detail-key">Fetch-запросов</span><span class="pm-detail-val">${s.fetch.callCount} · ${_ms(s.fetch.totalMs)}</span></div>` : '',
        ].filter(Boolean).join('');

        return `<div class="pm-card${isThrottled ? ' throttled' : ''}" data-script="${s.name}">
          <div class="pm-card-row" data-toggle="${s.name}">
            <div class="pm-card-icon icon-${lvl}">${_scriptEmoji(s.name)}</div>
            <div class="pm-card-body">
              <div class="pm-card-name">${s.name}</div>
              <div class="pm-card-sub">${sub}</div>
            </div>
            <div class="pm-card-right">
              <div class="pm-card-pct load-${lvl}">${pct}%</div>
              <div class="pm-card-pct-label">нагрузка</div>
            </div>
          </div>
          <div class="pm-card-progress">
            <div class="pm-card-progress-fill fill-${lvl}" style="width:${Math.min(100,pct*3)}%;"></div>
          </div>
          <div class="pm-card-details${isOpen ? ' open' : ''}">
            <div class="pm-details-inner">
              ${detailRows || '<div style="color:#adb5bd;font-size:11px;padding:4px 0;">Нет активных операций</div>'}
              ${warns.map(w => `<div class="pm-warn">${w}</div>`).join('')}
              <button class="pm-throttle-btn ${isThrottled ? 'off' : 'on'}" data-name="${s.name}">
                ${isThrottled
                  ? '▶ Снять ограничение'
                  : '⏸ Снизить нагрузку'}
              </button>
            </div>
          </div>
        </div>`;
      }).join('');
      return out;
    }

    html += renderGroup('🔴 Высокая нагрузка', high);
    html += renderGroup('🟡 Средняя нагрузка', medium);
    html += renderGroup('🟢 В норме', low);

    if (!scripts.length) html = '<div style="text-align:center;padding:40px 20px;color:#adb5bd;font-size:12px;">Ожидаем данные...<br><span style="font-size:11px;">Скрипты появятся после первой активности</span></div>';

    list.innerHTML = html;

    // События
    list.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const name = el.dataset.toggle;
        if (_openCards.has(name)) _openCards.delete(name);
        else _openCards.add(name);
        _render();
      });
    });
    list.querySelectorAll('[data-name]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        const name = el.dataset.name;
        const s = _scripts.get(name);
        if (s) _throttleScript(name, !s.throttled);
        _render();
      });
    });
  }

  function _ms(v) {
    if (!v || v < 1) return '< 1 мс';
    if (v < 1000) return Math.round(v) + ' мс';
    return (v / 1000).toFixed(1) + ' с';
  }

  // ─── Построение UI ────────────────────────────────────────────────────────
  function _buildUI() {
    if (document.getElementById('gj-pm-panel')) return true;
    const header = document.querySelector('.Sidebar_header__dm6Ua');
    if (!header) return false;

    _injectStyles();

    // Кнопка
    const btn = document.createElement('button');
    btn.id = 'gj-pm-btn';
    btn.title = 'Монитор производительности';
    // Иконка спидометра (как в v1.0)
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M13.41 10.59l2.59 -2.59"></path><path d="M7 12a5 5 0 0 1 5 -5"></path></svg>`;
    const flex = header.querySelector('.mantine-Flex-root');
    (flex || header).appendChild(btn);

    // Панель
    const panel = document.createElement('div');
    panel.id = 'gj-pm-panel';
    panel.innerHTML = `
      <div class="pm-head">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e03131" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M13.41 10.59l2.59 -2.59"/><path d="M7 12a5 5 0 0 1 5 -5"/></svg>
        <span class="pm-head-title">Производительность скриптов</span>
        <button class="pm-head-close" id="pm-close">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div class="pm-metrics">
        <div class="pm-metric">
          <div class="pm-metric-label">JS-нагрузка скриптов</div>
          <div class="pm-metric-row">
            <span class="pm-metric-val" id="pm-js-val" style="color:#2f9e44;">0</span>
            <span class="pm-metric-unit">%</span>
          </div>
          <div class="pm-metric-bar"><div class="pm-metric-bar-fill" id="pm-js-fill" style="width:0%;background:#2f9e44;"></div></div>
        </div>
        <div class="pm-metric">
          <div class="pm-metric-label">Память браузера</div>
          <div class="pm-metric-row">
            <span class="pm-metric-val" id="pm-mem-val" style="color:#2f9e44;">—</span>
            <span class="pm-metric-unit">МБ</span>
          </div>
          <div class="pm-metric-bar"><div class="pm-metric-bar-fill" id="pm-mem-fill" style="width:0%;background:#2f9e44;"></div></div>
        </div>
      </div>

      <div id="pm-list" class="pm-list"></div>

      <div class="pm-footer">
        <button class="pm-footer-btn" id="pm-reset-btn">Сбросить статистику</button>
        <button class="pm-footer-btn" id="pm-restore-btn">Снять все ограничения</button>
        <span class="pm-uptime" id="pm-uptime">0 с</span>
      </div>`;

    document.body.appendChild(panel);

    btn.onclick = () => {
      _panelOpen = !_panelOpen;
      panel.classList.toggle('open', _panelOpen);
      btn.classList.toggle('open', _panelOpen);
      if (_panelOpen) _render();
    };

    panel.querySelector('#pm-close').onclick = () => {
      _panelOpen = false;
      panel.classList.remove('open');
      btn.classList.remove('open');
    };

    panel.querySelector('#pm-reset-btn').onclick = () => {
      for (const s of _scripts.values()) {
        s.obs.callCount = 0; s.obs.totalMs = 0;
        s.ivl.callCount = 0; s.ivl.totalMs = 0;
        s.tmo.pending = 0; s.tmo.done = 0;
        s.fetch.callCount = 0; s.fetch.totalMs = 0;
        s.obs.items.forEach(e => { e.callCount = 0; e.totalMs = 0; e.lastMs = 0; });
        s.ivl.items.forEach(e => { e.callCount = 0; e.totalMs = 0; e.lastMs = 0; });
      }
      _render();
    };

    panel.querySelector('#pm-restore-btn').onclick = () => {
      for (const s of _scripts.values()) _throttleScript(s.name, false);
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

  // Автообновление
  _NativeSI(() => { if (_panelOpen) _render(); }, 1000);

  // ─── Инициализация ────────────────────────────────────────────────────────
  function _tryInit() {
    if (document.querySelector('.Sidebar_header__dm6Ua')) {
      return _buildUI();
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

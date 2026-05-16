// ==UserScript==
// @name         Godji — Монитор производительности
// @namespace    godji-erp
// @version      5.2
// @description  Мониторинг ресурсоёмкости Tampermonkey-скриптов ERP
// @match        https://godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─── Глобальный реестр — другие скрипты регистрируются здесь ─────────────
  // Каждый скрипт при старте вызывает: window.__gjPerfRegister('Имя скрипта')
  // Монитор создаёт этот реестр первым (document-start), остальные скрипты
  // подхватывают его. Без регистрации — используем перехват стека.
  window.__gjPerfRegistry = window.__gjPerfRegistry || {};

  // ─── Известные имена (для авторазрешения из имени файла) ─────────────────
  const KNOWN = [
    { key: 'perf',       label: 'Монитор производительности' },
    { key: 'cashbox',    label: 'Касса' },
    { key: 'settings_management', label: 'Управление настройками' },
    { key: 'settings',   label: 'Настройки' },
    { key: 'operation',  label: 'История операций' },
    { key: 'session',    label: 'История сеансов' },
    { key: 'client',     label: 'Поиск клиентов' },
    { key: 'seating',    label: 'Карта посадки' },
    { key: 'map_sync',   label: 'Синхронизация карты' },
    { key: 'cleanup',    label: 'Напоминание об уборке' },
    { key: 'multi',      label: 'Мультиселект' },
    { key: 'menu',       label: 'Цвета меню' },
    { key: 'auto_beg',   label: 'Авто-новичок' },
    { key: 'banlist',    label: 'Бан-лист' },
    { key: 'debit',      label: 'Списание с баланса' },
    { key: 'tightvnc',   label: 'Просмотр экрана' },
    { key: 'vnc',        label: 'Просмотр экрана' },
  ];

  // SVG-иконки (tabler, 16×16)
  const SVG = {
    'Монитор производительности': `<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M13.41 10.59l2.59 -2.59"/><path d="M7 12a5 5 0 0 1 5 -5"/>`,
    'Касса':          `<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>`,
    'Настройки':      `<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>`,
    'История операций': `<path d="M9 5h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><line x1="9" y1="12" x2="9.01" y2="12"/><line x1="13" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="9.01" y2="16"/><line x1="13" y1="16" x2="15" y2="16"/>`,
    'История сеансов':  `<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>`,
    'Поиск клиентов':   `<circle cx="10" cy="10" r="7"/><line x1="21" y1="21" x2="15" y2="15"/>`,
    'Карта посадки':    `<polyline points="3 7 9 4 15 7 21 4 21 17 15 20 9 17 3 20 3 7"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/>`,
    'Синхронизация карты': `<path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>`,
    'Напоминание об уборке': `<path d="M5 5m0 1a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z"/><path d="M5 9l1.5 11h11l1.5-11"/>`,
    'Мультиселект':     `<rect x="3" y="5" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><line x1="13" y1="8" x2="21" y2="8"/><line x1="13" y1="16" x2="21" y2="16"/>`,
    'Цвета меню':       `<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="19" cy="14" r="2.5"/><circle cx="6" cy="14" r="2.5"/><path d="M5 20a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1h-14v-1z"/>`,
    'Управление настройками': `<path d="M7 18a4.6 4.4 0 0 1 0-9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-12"/>`,
    'Авто-новичок':     `<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1-8.5 15a12 12 0 0 1-8.5-15a12 12 0 0 0 8.5-3"/>`,
    'Бан-лист':         `<circle cx="12" cy="12" r="9"/><line x1="5.7" y1="5.7" x2="18.3" y2="18.3"/>`,
    'Списание с баланса': `<path d="M17 8v-3a1 1 0 0 0-1-1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1-1 1h-12a2 2 0 0 1-2-2v-12"/><path d="M20 12v4h-4a2 2 0 0 1 0-4h4"/>`,
    'Просмотр экрана':  `<rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="22" x2="16" y2="22"/><line x1="12" y1="18" x2="12" y2="22"/>`,
    '__':               `<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>`,
  };

  function _ico(name, color, sz) {
    sz = sz || 16;
    const d = SVG[name] || SVG['__'];
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">${d}</svg>`;
  }

  // ─── Разрешение имени из стека / URL-encoded строки ───────────────────────
  function _resolveName(raw) {
    if (!raw) return null;
    let dec = raw;
    try { dec = decodeURIComponent(raw); } catch {}
    // Убираем типовой префикс и суффикс
    dec = dec.replace(/Godji\s*[—–-]\s*/gi, '').replace(/\.user\.js$/i, '').trim();
    const lc = (raw + ' ' + dec).toLowerCase();
    for (const k of KNOWN) if (lc.includes(k.key)) return k.label;
    // Неизвестный — возвращаем декодированное имя
    return dec || raw;
  }

  // ─── Получение имени текущего скрипта ────────────────────────────────────
  // Tampermonkey кладёт имя файла в URL iframe: ...name=XXX&id=YYY
  // Ищем в стеке строку с userscript.html и вытаскиваем name=
  function _detectName() {
    try {
      const st = new Error().stack || '';
      // Вариант 1: name=XXX в URL
      let m = st.match(/[?&]name=([^&\s\n#]+)/);
      if (m) return _resolveName(m[1]);
      // Вариант 2: просто "userscript" в стеке
      if (st.includes('userscript')) return 'Неизвестный скрипт';
    } catch {}
    return null; // не скрипт — страница ERP
  }

  // ─── Хранилище метрик ────────────────────────────────────────────────────
  const _db = new Map(); // name → stats
  const _t0 = Date.now();

  function _db_get(name) {
    if (!name) return null;
    if (!_db.has(name)) _db.set(name, {
      name,
      obs:   { items:[], calls:0, ms:0 },
      ivl:   { items:[], calls:0, ms:0 },
      tmo:   { pending:0, done:0 },
      fetch: { calls:0, ms:0 },
      throttled: false,
    });
    return _db.get(name);
  }

  // ─── Перехват MutationObserver ────────────────────────────────────────────
  const _NatObs = window.MutationObserver;
  window.MutationObserver = function(cb) {
    const sn = _detectName();
    let ent = null;
    const wrapped = function(mut, obs) {
      if (ent && ent.thr) return;
      const t = performance.now();
      cb(mut, obs);
      const dt = performance.now() - t;
      if (ent) { ent.calls++; ent.ms += dt; }
      if (sn) { const s = _db_get(sn); s.obs.calls++; s.obs.ms += dt; }
    };
    const nat = new _NatObs(wrapped);
    return {
      observe(target, opts) {
        if (sn) {
          const s = _db_get(sn);
          ent = { nat, calls:0, ms:0, thr:false, opts: opts||{}, active:true };
          s.obs.items.push(ent);
        }
        nat.observe(target, opts);
      },
      disconnect() { if(ent){ent.active=false;ent.thr=false;} nat.disconnect(); },
      takeRecords() { return nat.takeRecords(); },
    };
  };

  // ─── Перехват setInterval ─────────────────────────────────────────────────
  const _NatSI = window.setInterval;
  const _NatCI = window.clearInterval;
  window.setInterval = function(fn, ms, ...args) {
    const sn = _detectName();
    let ent = null;
    const w = typeof fn !== 'function' ? fn : function() {
      if (ent && ent.thr) return;
      const t = performance.now();
      fn(...args);
      const dt = performance.now() - t;
      if (ent) { ent.calls++; ent.ms += dt; }
      if (sn) { const s = _db_get(sn); s.ivl.calls++; s.ivl.ms += dt; }
    };
    const nid = _NatSI(w, ms);
    if (sn) {
      ent = { nid, ms_interval:ms, calls:0, ms:0, thr:false, active:true };
      _db_get(sn).ivl.items.push(ent);
    }
    return nid;
  };
  window.clearInterval = function(nid) {
    for (const s of _db.values()) {
      const e = s.ivl.items.find(i=>i.nid===nid);
      if (e) { e.active=false; break; }
    }
    return _NatCI(nid);
  };

  // ─── Перехват setTimeout ──────────────────────────────────────────────────
  const _NatST = window.setTimeout;
  const _NatCT = window.clearTimeout;
  window.setTimeout = function(fn, ms, ...args) {
    const sn = _detectName();
    if (sn) {
      const s = _db_get(sn);
      s.tmo.pending++;
      return _NatST(function() {
        s.tmo.pending = Math.max(0, s.tmo.pending-1);
        s.tmo.done++;
        if (typeof fn === 'function') fn(...args);
      }, ms);
    }
    return _NatST(fn, ms, ...args);
  };
  window.clearTimeout = function(id) { return _NatCT(id); };

  // ─── Перехват fetch ───────────────────────────────────────────────────────
  const _NatFetch = window.fetch;
  window.fetch = async function(...args) {
    const sn = _detectName();
    const t = performance.now();
    const r = await _NatFetch(...args);
    const dt = performance.now() - t;
    if (sn) { const s = _db_get(sn); s.fetch.calls++; s.fetch.ms += dt; }
    return r;
  };

  // ─── Регистрация скрипта вручную (вызывается из других скриптов) ─────────
  window.__gjPerfRegister = function(name) {
    _db_get(name); // просто создаёт запись
  };

  // ─── Throttle ─────────────────────────────────────────────────────────────
  function _throttle(name, on) {
    const s = _db.get(name); if(!s) return;
    s.throttled = on;
    s.obs.items.forEach(e=>e.thr=on);
    s.ivl.items.forEach(e=>e.thr=on);
  }

  // ─── Вычисления ───────────────────────────────────────────────────────────
  function _uptime() { return Math.max(1, (Date.now()-_t0)/1000); }

  function _pct(s) {
    const ms = s.obs.ms + s.ivl.ms;
    return Math.min(99, Math.round((ms / (_uptime()*1000)) * 100));
  }

  function _level(s) {
    const sub = s.obs.items.some(e=>e.active&&e.opts.subtree);
    const p = _pct(s);
    if (sub || p > 20) return 'high';
    if (p > 5 || s.ivl.items.filter(e=>e.active).length > 2) return 'med';
    return 'low';
  }

  function _fms(v) {
    if (!v||v<1) return '< 1 мс';
    return v < 1000 ? Math.round(v)+' мс' : (v/1000).toFixed(1)+' с';
  }

  function _mem()  { return performance.memory ? Math.round(performance.memory.usedJSHeapSize/1024/1024) : null; }
  function _memL() { return performance.memory ? Math.round(performance.memory.jsHeapSizeLimit/1024/1024) : null; }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('gj-pm-css')) return;
    const s = document.createElement('style');
    s.id = 'gj-pm-css';
    s.textContent = `
    #gj-pm-btn{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.55);
      padding:5px;border-radius:6px;display:flex;align-items:center;justify-content:center;
      transition:color .15s,background .15s;flex-shrink:0;}
    #gj-pm-btn:hover,#gj-pm-btn.open{color:#fff;}
    #gj-pm-btn.open{background:rgba(255,255,255,.1);}

    /* z-index ниже модалок Mantine (обычно 200-300), но выше обычного контента */
    #gj-pm-panel{
      position:fixed;top:0;left:280px;width:390px;height:100vh;
      background:#fff;border-right:1px solid #dee2e6;
      box-shadow:4px 0 20px rgba(0,0,0,.09);
      z-index:150;display:none;flex-direction:column;
      font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px;color:#212529;
    }
    #gj-pm-panel.open{display:flex;}

    .pm-head{padding:15px 18px 13px;border-bottom:1px solid #e9ecef;
      background:#fff;flex-shrink:0;display:flex;align-items:center;gap:10px;}
    .pm-head-title{font-size:14px;font-weight:700;color:#212529;flex:1;}
    .pm-x{background:none;border:none;cursor:pointer;color:#adb5bd;padding:4px;
      border-radius:4px;display:flex;transition:color .15s;}
    .pm-x:hover{color:#495057;}

    .pm-hint{font-size:11px;color:#adb5bd;background:#f8f9fa;
      border-bottom:1px solid #e9ecef;padding:7px 18px;flex-shrink:0;
      display:flex;align-items:flex-start;gap:6px;}
    .pm-hint a{color:#1c7ed6;text-decoration:none;}
    .pm-hint a:hover{text-decoration:underline;}

    .pm-metrics{display:grid;grid-template-columns:1fr 1fr;
      border-bottom:1px solid #e9ecef;flex-shrink:0;}
    .pm-m{padding:13px 18px;border-right:1px solid #e9ecef;}
    .pm-m:last-child{border-right:none;}
    .pm-ml{font-size:10px;font-weight:700;color:#868e96;text-transform:uppercase;
      letter-spacing:.6px;margin-bottom:5px;}
    .pm-mv{font-size:26px;font-weight:800;line-height:1;transition:color .3s;}
    .pm-mu{font-size:12px;color:#868e96;font-weight:500;margin-left:3px;}
    .pm-mbar{height:3px;border-radius:2px;background:#f1f3f5;margin-top:7px;}
    .pm-mfill{height:3px;border-radius:2px;transition:width .5s,background .5s;}
    .pm-msub{font-size:10px;color:#adb5bd;margin-top:4px;}

    .pm-toolbar{display:flex;align-items:center;gap:5px;padding:8px 12px;
      border-bottom:1px solid #e9ecef;background:#f8f9fa;flex-shrink:0;}
    .pm-tl{font-size:11px;color:#868e96;margin-right:2px;}
    .pm-fb{padding:3px 9px;border-radius:4px;border:1px solid #dee2e6;
      background:#fff;color:#495057;font-size:11px;font-weight:500;
      cursor:pointer;transition:background .12s;}
    .pm-fb.on{background:#212529;color:#fff;border-color:#212529;}
    .pm-fb:hover:not(.on){background:#f1f3f5;}

    .pm-list{flex:1;overflow-y:auto;padding:8px 10px;background:#f8f9fa;}
    .pm-list::-webkit-scrollbar{width:4px;}
    .pm-list::-webkit-scrollbar-thumb{background:#dee2e6;border-radius:4px;}
    .pm-empty{text-align:center;padding:40px 20px;color:#adb5bd;font-size:12px;line-height:1.6;}

    .pm-glabel{font-size:10px;font-weight:700;color:#adb5bd;text-transform:uppercase;
      letter-spacing:.5px;padding:8px 4px 4px;display:flex;align-items:center;gap:5px;}

    .pm-card{background:#fff;border:1px solid #e9ecef;border-radius:8px;
      margin-bottom:5px;overflow:hidden;transition:box-shadow .15s,border-color .15s;}
    .pm-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06);border-color:#ced4da;}
    .pm-card.thr{border-color:#ffc9c9;background:#fffafa;}

    .pm-ct{padding:11px 14px;display:flex;align-items:center;gap:10px;
      cursor:pointer;user-select:none;}
    .pm-ci{width:30px;height:30px;border-radius:6px;display:flex;
      align-items:center;justify-content:center;flex-shrink:0;}
    .pm-ci.high{background:#fff5f5;}
    .pm-ci.med {background:#fff9db;}
    .pm-ci.low {background:#f3f3f3;}
    .pm-cb{flex:1;min-width:0;}
    .pm-cn{font-weight:600;font-size:13px;color:#212529;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pm-cn.thr-name{color:#adb5bd;text-decoration:line-through;}
    .pm-cs{font-size:11px;color:#868e96;margin-top:1px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pm-cr{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;gap:1px;}
    .pm-cp{font-size:18px;font-weight:800;line-height:1;}
    .pm-cpl{font-size:10px;color:#adb5bd;font-weight:500;}

    .pm-prog{height:2px;background:#f1f3f5;margin:0 14px 9px;}
    .pm-pfill{height:2px;border-radius:1px;transition:width .5s;}

    .pm-det{border-top:1px solid #f1f3f5;display:none;padding:10px 14px 12px;}
    .pm-det.open{display:block;}
    .pm-dr{display:flex;justify-content:space-between;padding:4px 0;
      font-size:11px;border-bottom:1px solid #f8f9fa;}
    .pm-dr:last-of-type{border-bottom:none;}
    .pm-dk{color:#868e96;}
    .pm-dv{font-weight:600;color:#212529;text-align:right;margin-left:8px;}

    .pm-warn{background:#fff9db;border:1px solid #ffe066;border-radius:5px;
      padding:6px 10px;margin-top:7px;font-size:11px;color:#866800;
      display:flex;align-items:flex-start;gap:6px;line-height:1.5;}

    .pm-optbtn{width:100%;margin-top:10px;padding:7px 12px;border-radius:6px;
      border:none;font-size:12px;font-weight:600;cursor:pointer;
      transition:background .15s;display:flex;align-items:center;
      justify-content:center;gap:6px;}
    .pm-optbtn.stop{background:#fff5f5;color:#c92a2a;border:1px solid #ffc9c9;}
    .pm-optbtn.stop:hover{background:#ffe3e3;}
    .pm-optbtn.go{background:#ebfbee;color:#2f9e44;border:1px solid #b2f2bb;}
    .pm-optbtn.go:hover{background:#d3f9d8;}

    .pm-foot{padding:9px 14px;border-top:1px solid #e9ecef;background:#fff;
      flex-shrink:0;display:flex;align-items:center;gap:6px;}
    .pm-btn{padding:5px 10px;border-radius:5px;font-size:11px;font-weight:600;
      cursor:pointer;border:1px solid #dee2e6;background:#fff;color:#495057;
      transition:background .12s;}
    .pm-btn:hover{background:#f8f9fa;}
    .pm-up{margin-left:auto;font-size:11px;color:#ced4da;}

    .c-high{color:#e03131;}.c-med{color:#e67700;}.c-low{color:#2f9e44;}
    .f-high{background:#e03131;}.f-med{background:#f59f00;}.f-low{background:#2f9e44;}
    `;
    document.head.appendChild(s);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  let _open=false, _filter='all', _exp=new Set(), _ready=false;

  function _buildUI() {
    if (document.getElementById('gj-pm-panel')) return true;
    const hdr = document.querySelector('.Sidebar_header__dm6Ua');
    if (!hdr) return false;
    _injectCSS();

    // Кнопка — tabler gauge (v1.0 оригинал)
    const btn = document.createElement('button');
    btn.id='gj-pm-btn'; btn.title='Производительность скриптов';
    btn.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M13.41 10.59l2.59 -2.59"/><path d="M7 12a5 5 0 0 1 5 -5"/></svg>`;
    (hdr.querySelector('.mantine-Flex-root')||hdr).appendChild(btn);

    const panel = document.createElement('div');
    panel.id='gj-pm-panel';
    panel.innerHTML=`
      <div class="pm-head">
        ${_ico('Монитор производительности','#e03131',16)}
        <span class="pm-head-title">Производительность</span>
        <button class="pm-x" id="pm-x" title="Закрыть">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="pm-hint">
        ${_ico('__','#adb5bd',12)}
        <span>Показывает нагрузку <b>от скриптов</b> на JS-поток. Для реальных данных по CPU/памяти всей вкладки — нажмите <b>Shift+Esc</b> в Chrome.</span>
      </div>
      <div class="pm-metrics">
        <div class="pm-m">
          <div class="pm-ml">JS-нагрузка скриптов</div>
          <div style="display:flex;align-items:baseline;">
            <span class="pm-mv c-low" id="pm-js">0</span><span class="pm-mu">%</span>
          </div>
          <div class="pm-mbar"><div class="pm-mfill f-low" id="pm-jsb" style="width:0%"></div></div>
          <div class="pm-msub">от времени JS-потока</div>
        </div>
        <div class="pm-m">
          <div class="pm-ml">Память (JS heap)</div>
          <div style="display:flex;align-items:baseline;">
            <span class="pm-mv c-low" id="pm-mem">—</span><span class="pm-mu">МБ</span>
          </div>
          <div class="pm-mbar"><div class="pm-mfill f-low" id="pm-memb" style="width:0%"></div></div>
          <div class="pm-msub">лимит: <span id="pm-meml">–</span> МБ</div>
        </div>
      </div>
      <div class="pm-toolbar">
        <span class="pm-tl">Фильтр:</span>
        <button class="pm-fb on" data-f="all">Все</button>
        <button class="pm-fb" data-f="high">Проблемные</button>
        <button class="pm-fb" data-f="throttled">Ограниченные</button>
      </div>
      <div class="pm-list" id="pm-list">
        <div class="pm-empty">Ожидаем данные…<br><span style="font-size:11px;">Данные появятся через несколько секунд после активности скриптов</span></div>
      </div>
      <div class="pm-foot">
        <button class="pm-btn" id="pm-rst">Сбросить статистику</button>
        <button class="pm-btn" id="pm-rall">Снять все ограничения</button>
        <span class="pm-up" id="pm-ut">0 с</span>
      </div>`;
    document.body.appendChild(panel);

    btn.onclick=()=>{ _open=!_open; panel.classList.toggle('open',_open); btn.classList.toggle('open',_open); if(_open)_render(); };
    panel.querySelector('#pm-x').onclick=()=>{ _open=false; panel.classList.remove('open'); btn.classList.remove('open'); };
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&_open){_open=false;panel.classList.remove('open');btn.classList.remove('open');}});

    panel.querySelectorAll('.pm-fb').forEach(b=>{
      b.onclick=()=>{ _filter=b.dataset.f; panel.querySelectorAll('.pm-fb').forEach(x=>x.classList.toggle('on',x===b)); _render(); };
    });

    panel.querySelector('#pm-rst').onclick=()=>{
      for(const s of _db.values()){
        s.obs.calls=0;s.obs.ms=0;s.obs.items.forEach(e=>{e.calls=0;e.ms=0;});
        s.ivl.calls=0;s.ivl.ms=0;s.ivl.items.forEach(e=>{e.calls=0;e.ms=0;});
        s.tmo.done=0;s.fetch.calls=0;s.fetch.ms=0;
      }
      _render();
    };
    panel.querySelector('#pm-rall').onclick=()=>{ for(const s of _db.values())_throttle(s.name,false); _render(); };

    _ready=true; return true;
  }

  // ─── Рендер ───────────────────────────────────────────────────────────────
  function _render() {
    if(!_ready||!_open) return;
    const up = _uptime();
    const upStr = up<60 ? Math.round(up)+'с' : Math.floor(up/60)+'м '+(Math.round(up)%60)+'с';
    const ut=document.getElementById('pm-ut'); if(ut) ut.textContent=upStr;

    // Метрики
    let totMs=0;
    for(const s of _db.values()) totMs += s.obs.ms + s.ivl.ms;
    const jp = Math.min(99, Math.round((totMs/(up*1000))*100));
    const jc = jp>20?'#e03131':jp>8?'#e67700':'#2f9e44';
    const jf = jp>20?'f-high':jp>8?'f-med':'f-low';
    _upd('pm-js', jp, jc); _bar('pm-jsb', jp, jf);

    const mm=_mem(), ml=_memL();
    const mp = mm&&ml ? Math.round((mm/ml)*100) : 0;
    const mc = mp>70?'#e03131':mp>40?'#e67700':'#2f9e44';
    const mf = mp>70?'f-high':mp>40?'f-med':'f-low';
    _upd('pm-mem', mm||'—', mc); _bar('pm-memb', mp, mf);
    const mle=document.getElementById('pm-meml'); if(mle&&ml) mle.textContent=ml;

    // Скрипты
    const list=document.getElementById('pm-list'); if(!list) return;
    let arr=[..._db.values()].sort((a,b)=>_pct(b)-_pct(a));
    if(_filter==='high') arr=arr.filter(s=>_level(s)==='high');
    if(_filter==='throttled') arr=arr.filter(s=>s.throttled);

    if(!arr.length){
      list.innerHTML=`<div class="pm-empty">${_filter==='all'?'Скрипты появятся после первой активности':'Нет скриптов в этой категории'}</div>`;
      return;
    }

    const grps={high:[],med:[],low:[]};
    arr.forEach(s=>grps[_level(s)].push(s));
    const gCfg=[
      {k:'high',lbl:'Высокая нагрузка',dot:'#e03131'},
      {k:'med', lbl:'Средняя нагрузка',dot:'#f59f00'},
      {k:'low', lbl:'В норме',         dot:'#2f9e44'},
    ];

    let html='';
    for(const g of gCfg){
      if(!grps[g.k].length) continue;
      html+=`<div class="pm-glabel"><svg width="7" height="7" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="${g.dot}"/></svg>${g.lbl}</div>`;
      html+=grps[g.k].map(s=>{
        const p=_pct(s), lvl=_level(s), isOpen=_exp.has(s.name), isThr=s.throttled;
        const aObs=s.obs.items.filter(e=>e.active).length;
        const aSub=s.obs.items.filter(e=>e.active&&e.opts.subtree).length;
        const aIvl=s.ivl.items.filter(e=>e.active).length;
        const icoColor=lvl==='high'?'#e03131':lvl==='med'?'#e67700':'#495057';
        const sp=[];
        if(aObs) sp.push(`${aObs} observer${aObs>1?'s':''}`);
        if(aIvl) sp.push(`${aIvl} interval${aIvl>1?'s':''}`);
        if(s.fetch.calls) sp.push(`${s.fetch.calls} запросов`);
        if(isThr) sp.push('⏸ ограничен');
        const sub=sp.join(' · ')||'нет активности';

        const rows=[
          s.obs.calls ? `<div class="pm-dr"><span class="pm-dk">Observer-вызовов</span><span class="pm-dv">${s.obs.calls} · ${_fms(s.obs.ms)}</span></div>` : '',
          s.ivl.calls ? `<div class="pm-dr"><span class="pm-dk">Interval-вызовов</span><span class="pm-dv">${s.ivl.calls} · ${_fms(s.ivl.ms)}</span></div>` : '',
          s.tmo.done  ? `<div class="pm-dr"><span class="pm-dk">setTimeout выполнено</span><span class="pm-dv">${s.tmo.done}</span></div>` : '',
          s.fetch.calls ? `<div class="pm-dr"><span class="pm-dk">Fetch-запросов</span><span class="pm-dv">${s.fetch.calls} · ${_fms(s.fetch.ms)}</span></div>` : '',
          aObs ? `<div class="pm-dr"><span class="pm-dk">Активных observers</span><span class="pm-dv">${aObs}${aSub?` (${aSub} с subtree)`:''}</span></div>` : '',
          aIvl ? `<div class="pm-dr"><span class="pm-dk">Активных intervals</span><span class="pm-dv">${aIvl}</span></div>` : '',
        ].filter(Boolean).join('');

        const warn=aSub ? `<div class="pm-warn">${_ico('__','#866800',13)}<span>Этот скрипт использует <b>subtree:true</b> в MutationObserver — отслеживает изменения по всей странице. Это самая частая причина тормозов. Рекомендуется снизить нагрузку.</span></div>` : '';

        const chev=isOpen
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#adb5bd" stroke-width="2.5" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#adb5bd" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

        const pauseIco=`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        const playIco=`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

        return `<div class="pm-card${isThr?' thr':''}">
          <div class="pm-ct" data-toggle="${s.name}">
            <div class="pm-ci ${lvl}">${_ico(s.name,icoColor,15)}</div>
            <div class="pm-cb">
              <div class="pm-cn${isThr?' thr-name':''}">${s.name}</div>
              <div class="pm-cs">${sub}</div>
            </div>
            <div class="pm-cr">
              <div class="pm-cp c-${lvl}">${p}%</div>
              <div class="pm-cpl">нагрузка</div>
            </div>
            ${chev}
          </div>
          <div class="pm-prog"><div class="pm-pfill f-${lvl}" style="width:${Math.min(100,p*4)}%"></div></div>
          <div class="pm-det${isOpen?' open':''}">
            ${rows||'<div style="color:#adb5bd;font-size:11px;padding:3px 0;">Активных операций нет</div>'}
            ${warn}
            <button class="pm-optbtn ${isThr?'go':'stop'}" data-name="${s.name}">
              ${isThr ? playIco+' Снять ограничение' : pauseIco+' Снизить нагрузку'}
            </button>
          </div>
        </div>`;
      }).join('');
    }
    list.innerHTML=html;

    list.querySelectorAll('[data-toggle]').forEach(el=>{
      el.onclick=()=>{ const n=el.dataset.toggle; if(_exp.has(n))_exp.delete(n);else _exp.add(n); _render(); };
    });
    list.querySelectorAll('[data-name]').forEach(el=>{
      el.onclick=ev=>{ ev.stopPropagation(); const s=_db.get(el.dataset.name); if(s)_throttle(s.name,!s.throttled); _render(); };
    });
  }

  function _upd(id,val,color){ const e=document.getElementById(id); if(!e)return; e.textContent=val; e.style.color=color; }
  function _bar(id,pct,cls){ const e=document.getElementById(id); if(!e)return; e.style.width=Math.min(100,pct)+'%'; e.className='pm-mfill '+cls; }

  // Автообновление + экспорт данных для расширения Chrome
  _NatSI(()=>{
    if(_open) _render();
    // Пишем метрики в localStorage под ключом __gjPerfData
    // localStorage доступен и из Tampermonkey sandbox, и из инжектированного кода расширения
    try {
      const up = _uptime();
      const export_data = {};
      for(const [name, s] of _db.entries()){
        const ms  = s.obs.ms + s.ivl.ms;
        const pct = Math.min(99, Math.round((ms/(up*1000))*100));
        export_data[name] = {
          name,
          totalMs:   Math.round(ms),
          pct,
          throttled: s.throttled,
          obs: {
            total:        s.obs.items.length,
            active:       s.obs.items.filter(e=>e.active).length,
            subtreeCount: s.obs.items.filter(e=>e.active&&e.opts&&e.opts.subtree).length,
            calls:        s.obs.calls,
            ms:           Math.round(s.obs.ms),
          },
          ivl: {
            total:  s.ivl.items.length,
            active: s.ivl.items.filter(e=>e.active).length,
            calls:  s.ivl.calls,
            ms:     Math.round(s.ivl.ms),
          },
          tmo:   { pending: s.tmo.pending, done: s.tmo.done },
          fetch: { calls: s.fetch.calls,  ms:   Math.round(s.fetch.ms) },
        };
      }
      localStorage.setItem('__gjPerfData',   JSON.stringify(export_data));
      localStorage.setItem('__gjPerfUptime', String(Math.round(up)));
      localStorage.setItem('__gjPerfTs',     String(Date.now()));
    } catch(e) {}
  }, 1000);

  // ─── Чтение throttle-команд от расширения Chrome ─────────────────────────
  _NatSI(()=>{
    try {
      const raw = localStorage.getItem('__gjPerfCmdPending');
      if (!raw) return;
      localStorage.removeItem('__gjPerfCmdPending');
      const cmd = JSON.parse(raw);
      if (!cmd || !cmd.ts || Date.now() - cmd.ts > 5000) return;
      if (cmd.action === 'throttle' && cmd.name) {
        _throttle(cmd.name, !!cmd.enable);
        if (_open) _render();
      } else if (cmd.action === 'throttle_all') {
        for (const s of _db.values()) _throttle(s.name, !!cmd.enable);
        if (_open) _render();
      }
    } catch {}
  }, 500);

  // ─── Инит ─────────────────────────────────────────────────────────────────
  const _iObs=new _NatObs(()=>{ if(_buildUI())_iObs.disconnect(); });
  function _try(){ return !!document.querySelector('.Sidebar_header__dm6Ua')&&_buildUI(); }
  if(document.readyState!=='loading'){ if(!_try())_iObs.observe(document.body,{childList:true,subtree:false}); }
  else document.addEventListener('DOMContentLoaded',()=>{ if(!_try())_iObs.observe(document.body,{childList:true,subtree:false}); });

})();

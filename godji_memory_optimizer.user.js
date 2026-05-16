// ==UserScript==
// @name         Godji — Оптимизатор памяти
// @namespace    godji-erp
// @version      1.0
// @description  Снижает потребление памяти Chrome на странице Godji ERP
// @match        https://godji.cloud/*
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const _win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // ─── Конфиг ──────────────────────────────────────────────────────────────
  const CFG = {
    // Интервал основной очистки (мс)
    CLEAN_INTERVAL_MS:     60_000,  // каждую минуту
    // Интервал агрессивной очистки при высокой памяти (мс)
    AGGRESSIVE_INTERVAL_MS: 10_000,
    // Порог heap для агрессивного режима (МБ)
    HEAP_THRESHOLD_MB:       400,
    // Максимальный размер Apollo-кеша (записей) до принудительной очистки
    APOLLO_CACHE_LIMIT:      200,
    // Сколько секунд ждать неактивности перед очисткой
    IDLE_TIMEOUT_S:           30,
  };

  // ─── Состояние ───────────────────────────────────────────────────────────
  let _lastActivity  = Date.now();
  let _cleanCount    = 0;
  let _savedMb       = 0;
  let _logLines      = [];

  function _log(msg) {
    const ts = new Date().toLocaleTimeString('ru');
    const line = `[${ts}] ${msg}`;
    _logLines.push(line);
    if (_logLines.length > 100) _logLines.shift();
    console.debug('[GodjiOpt]', msg);
  }

  function _memMb() {
    return performance.memory
      ? Math.round(performance.memory.usedJSHeapSize / 1048576)
      : null;
  }

  // ─── Трекер активности ───────────────────────────────────────────────────
  ['click','keydown','scroll','mousemove','touchstart'].forEach(ev => {
    document.addEventListener(ev, () => { _lastActivity = Date.now(); }, { passive: true });
  });

  function _isIdle() {
    return (Date.now() - _lastActivity) / 1000 > CFG.IDLE_TIMEOUT_S;
  }

  // ─── 1. Очистка Apollo Client кеша ───────────────────────────────────────
  // Apollo хранит нормализованный кеш в window.__APOLLO_CLIENT__ или в React DevTools hook
  function _cleanApolloCache() {
    let cleaned = 0;
    try {
      // Способ 1: прямой доступ к клиенту
      const client = _win.__APOLLO_CLIENT__;
      if (client && client.cache) {
        const cache = client.cache;
        // gc() удаляет unreachable объекты из нормализованного кеша
        if (typeof cache.gc === 'function') {
          const removed = cache.gc();
          if (removed && removed.length) {
            cleaned += removed.length;
            _log(`Apollo gc(): удалено ${removed.length} записей`);
          }
        }
        // Проверяем размер кеша
        if (typeof cache.extract === 'function') {
          const data = cache.extract();
          const keys = Object.keys(data || {});
          if (keys.length > CFG.APOLLO_CACHE_LIMIT) {
            _log(`Apollo кеш: ${keys.length} записей (лимит ${CFG.APOLLO_CACHE_LIMIT}) — запускаем gc()`);
            if (typeof cache.gc === 'function') cache.gc();
          }
        }
      }
    } catch (e) {}

    // Способ 2: через React Fiber (ищем Apollo Provider)
    try {
      const root = document.getElementById('__NEXT_DATA__');
      if (root) {
        // Next.js — Apollo может быть в window.__NEXT_REDUX_STORE__ или аналоге
        const store = _win.__NEXT_REDUX_STORE__;
        if (store && store.getState) {
          // Если есть redux — можно диспатчить очистку
        }
      }
    } catch (e) {}

    return cleaned;
  }

  // ─── 2. Очистка detached DOM узлов ───────────────────────────────────────
  // Detached узлы — DOM-элементы удалённые из дерева но удерживаемые JS-переменными
  // Мы можем найти и явно обнулить те, что хранятся в глобальных переменных godji-скриптов
  function _cleanDetachedNodes() {
    let cleaned = 0;
    const globalKeys = [
      // Известные глобальные переменные godji-скриптов
      '__godji_panel', '__godji_modal', '__godji_overlay',
      'godji_search_panel', 'godji_history_panel',
      '_gjPanel', '_gjModal', '_gjOverlay',
    ];
    for (const key of globalKeys) {
      try {
        const el = _win[key];
        if (el instanceof Element && !document.contains(el)) {
          _win[key] = null;
          cleaned++;
        }
      } catch {}
    }

    // Чистим orphaned порталы Mantine (они создаются в document.body и иногда не удаляются)
    try {
      const portals = document.querySelectorAll('[data-portal="true"]');
      portals.forEach(p => {
        // Если портал пустой и не видимый — удаляем
        if (!p.children.length || p.style.display === 'none') {
          p.remove();
          cleaned++;
        }
      });
    } catch {}

    return cleaned;
  }

  // ─── 3. Очистка устаревших localStorage записей godji-скриптов ───────────
  function _cleanLocalStorage() {
    let cleaned = 0;
    const now = Date.now();
    const MAX_AGE = 72 * 60 * 60 * 1000; // 72 часа
    const PERF_MAX_AGE = 5 * 60 * 1000;  // perf данные — 5 минут

    try {
      const keysToCheck = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keysToCheck.push(key);
      }

      for (const key of keysToCheck) {
        try {
          // Старые perf-метрики
          if (key.startsWith('__gjScript_') || key.startsWith('__gjPerf')) {
            const raw = localStorage.getItem(key);
            if (raw) {
              const obj = JSON.parse(raw);
              if (obj.ts && now - obj.ts > PERF_MAX_AGE) {
                localStorage.removeItem(key);
                cleaned++;
              }
            }
            continue;
          }

          // Godji-скрипты хранят данные с timestamp
          if (key.startsWith('godji_')) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            // Если это массив с timestamp записями — чистим старые
            try {
              const arr = JSON.parse(raw);
              if (Array.isArray(arr)) {
                const cutoff = now - MAX_AGE;
                const filtered = arr.filter(item =>
                  item && (item.timestamp || item.ts || item.time || now) > cutoff
                );
                if (filtered.length < arr.length) {
                  localStorage.setItem(key, JSON.stringify(filtered));
                  cleaned += arr.length - filtered.length;
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}

    return cleaned;
  }

  // ─── 4. Принудительный GC через Image trick ──────────────────────────────
  // Создание и немедленное удаление большого объекта помогает V8
  // решить что пора собирать мусор (не гарантировано, но работает на практике)
  function _nudgeGC() {
    try {
      // Метод 1: URL.revokeObjectURL на несуществующий URL
      URL.revokeObjectURL(URL.createObjectURL(new Blob([''])));
    } catch {}
    try {
      // Метод 2: большой временный ArrayBuffer
      const buf = new ArrayBuffer(1024 * 1024); // 1 MB
      void buf;
      // buf выходит из scope → V8 может запустить minor GC
    } catch {}
  }

  // ─── 5. Остановка избыточных polling-запросов ─────────────────────────────
  // ERP polling'ит getDashboardDevices каждые ~3 сек
  // Когда вкладка неактивна — throttle через document.visibilityState

  let _origFetch = _win.fetch;
  let _pollThrottleActive = false;
  let _pollBlockedCount = 0;

  // Запросы которые можно замедлять когда вкладка неактивна
  const THROTTLE_OPS = new Set([
    'GetDashboardDevicesForScript',
    'getDashboardDevices',
    'getAvailableTariffs',
  ]);
  // Запросы которые НЕЛЬЗЯ трогать никогда
  const CRITICAL_OPS = new Set([
    'userReservationCreate', 'userReservationCancel', 'userReservationProlongate',
    'walletDepositWithBonus', 'walletWithdrawWithBonus',
    'userReservationFinish', 'createBooking',
  ]);

  let _lastPollTime = {};  // operationName → ts последнего запроса

  function _setupFetchThrottle() {
    const native = _win.fetch;
    _win.fetch = async function (...args) {
      // Не трогаем если throttle не активен
      if (!_pollThrottleActive) return native.apply(this, args);

      try {
        const req = new Request(...args);
        const cloned = req.clone();
        const body = await cloned.json().catch(() => null);
        const opName = body && body.operationName;

        if (opName && THROTTLE_OPS.has(opName) && !CRITICAL_OPS.has(opName)) {
          const now = Date.now();
          const last = _lastPollTime[opName] || 0;
          // При неактивной вкладке — не чаще раза в 15 секунд
          const minInterval = document.hidden ? 15000 : 5000;
          if (now - last < minInterval) {
            _pollBlockedCount++;
            // Возвращаем последний известный ответ из кеша если есть
            const cached = sessionStorage.getItem('__gjFetchCache_' + opName);
            if (cached) {
              return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            // Иначе пустой но валидный ответ
            return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          _lastPollTime[opName] = now;

          // Выполняем запрос и кешируем ответ
          const response = await native.apply(this, args);
          const respClone = response.clone();
          respClone.text().then(text => {
            try { sessionStorage.setItem('__gjFetchCache_' + opName, text); } catch {}
          }).catch(() => {});
          return response;
        }
      } catch {}

      return native.apply(this, args);
    };
  }

  // Активируем throttle когда вкладка скрыта / пользователь неактивен
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _pollThrottleActive = true;
      _log('Вкладка скрыта → throttle polling активен');
    } else {
      _pollThrottleActive = false;
      _lastPollTime = {};
      _log('Вкладка активна → throttle снят');
    }
  });

  // ─── 6. Блокировка стороннего расширения ─────────────────────────────────
  // ID из heap: bgnkhhnnamicmpeenaelnjfhikgbkllg
  // Блокируем его скрипты через перехват appendChild/insertBefore
  const BAD_EXT_ID = 'bgnkhhnnamicmpeenaelnjfhikgbkllg';
  let _blockedExt = 0;

  function _blockBadExtension() {
    const orig = document.head.appendChild.bind(document.head);
    const origBody = document.body.appendChild.bind(document.body);

    function _checkAndBlock(el) {
      if (el && el.src && el.src.includes(BAD_EXT_ID)) {
        _blockedExt++;
        _log(`Заблокирован скрипт расширения: ${el.src.substring(0, 80)}`);
        return true;
      }
      return false;
    }

    // Наблюдаем за добавлением новых script тегов
    const obs = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.tagName === 'SCRIPT' && node.src && node.src.includes(BAD_EXT_ID)) {
            node.remove();
            _blockedExt++;
            _log(`Удалён script тег расширения ${BAD_EXT_ID}`);
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ─── Главный цикл очистки ─────────────────────────────────────────────────
  async function _runClean(aggressive = false) {
    // Только когда пользователь не активен (не мешаем работе)
    if (!aggressive && !_isIdle()) return;

    const memBefore = _memMb();
    _cleanCount++;

    const apollo   = _cleanApolloCache();
    const detached = _cleanDetachedNodes();
    const lsItems  = _cleanLocalStorage();
    _nudgeGC();

    // Небольшая пауза чтобы GC успел сработать
    await new Promise(r => setTimeout(r, 500));

    const memAfter = _memMb();
    const saved = memBefore && memAfter ? memBefore - memAfter : 0;
    if (saved > 0) _savedMb += saved;

    const msg = [
      `Очистка #${_cleanCount}`,
      memBefore ? `${memBefore}→${memAfter} МБ` : '',
      apollo   ? `Apollo: -${apollo} записей` : '',
      detached ? `DOM: -${detached} узлов` : '',
      lsItems  ? `LS: -${lsItems} записей` : '',
    ].filter(Boolean).join(' | ');
    _log(msg);

    // Обновляем UI кнопки если открыт
    _updateUI();
  }

  // ─── UI — кнопка в сайдбаре ───────────────────────────────────────────────
  let _panelOpen = false;

  function _buildUI() {
    if (document.getElementById('gjopt-btn')) return;
    const footer = document.querySelector('.Sidebar_footer__1BA98');
    if (!footer) return;

    // Кнопка
    const btn = document.createElement('button');
    btn.id = 'gjopt-btn';
    btn.title = 'Оптимизатор памяти';
    Object.assign(btn.style, {
      background: 'none', border: 'none', cursor: 'pointer',
      color: 'rgba(255,255,255,0.55)', padding: '5px',
      borderRadius: '6px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', transition: 'color .15s',
      position: 'absolute', right: '36px', top: '50%',
      transform: 'translateY(-50%)', flexShrink: '0',
    });
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21l6-8l6 8"/><path d="M3 10l9-6l9 6"/></svg>`;

    const footerInner = footer.querySelector('button')?.parentElement || footer;
    footerInner.style.position = 'relative';
    footerInner.appendChild(btn);

    // Панель
    const panel = document.createElement('div');
    panel.id = 'gjopt-panel';
    Object.assign(panel.style, {
      position: 'fixed', left: '280px', bottom: '0',
      width: '360px', background: '#fff',
      border: '1px solid #e9ecef', borderRadius: '8px 8px 0 0',
      boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
      zIndex: '200', display: 'none', flexDirection: 'column',
      fontFamily: '-apple-system,\'Segoe UI\',sans-serif',
      fontSize: '12px', color: '#212529', overflow: 'hidden',
    });

    panel.innerHTML = `
      <div style="padding:12px 16px 10px;border-bottom:1px solid #e9ecef;display:flex;align-items:center;gap:8px;background:#fff;">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e03131" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 21l6-8l6 8"/><path d="M3 10l9-6l9 6"/></svg>
        <span style="font-size:13px;font-weight:700;color:#212529;flex:1;">Оптимизатор памяти</span>
        <button id="gjopt-close" style="background:none;border:none;cursor:pointer;color:#adb5bd;padding:2px;font-size:16px;line-height:1;">×</button>
      </div>

      <div id="gjopt-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;border-bottom:1px solid #e9ecef;">
        <div style="padding:10px 12px;border-right:1px solid #e9ecef;">
          <div style="font-size:9px;font-weight:700;color:#868e96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Heap сейчас</div>
          <div style="font-size:20px;font-weight:800;color:#212529;" id="gjopt-mem">—</div>
          <div style="font-size:9px;color:#adb5bd;">МБ</div>
        </div>
        <div style="padding:10px 12px;border-right:1px solid #e9ecef;">
          <div style="font-size:9px;font-weight:700;color:#868e96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Сохранено</div>
          <div style="font-size:20px;font-weight:800;color:#2f9e44;" id="gjopt-saved">0</div>
          <div style="font-size:9px;color:#adb5bd;">МБ всего</div>
        </div>
        <div style="padding:10px 12px;">
          <div style="font-size:9px;font-weight:700;color:#868e96;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Очисток</div>
          <div style="font-size:20px;font-weight:800;color:#212529;" id="gjopt-count">0</div>
          <div style="font-size:9px;color:#adb5bd;">за сессию</div>
        </div>
      </div>

      <div style="padding:8px 12px;border-bottom:1px solid #e9ecef;display:flex;align-items:center;gap:6px;">
        <div style="width:7px;height:7px;border-radius:50%;background:#2f9e44;flex-shrink:0;" id="gjopt-status-dot"></div>
        <span style="font-size:11px;color:#495057;" id="gjopt-status-txt">Авто-очистка активна</span>
        <label style="margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;color:#495057;cursor:pointer;">
          <input type="checkbox" id="gjopt-throttle-chk" ${_pollThrottleActive ? 'checked' : ''}>
          Throttle polling
        </label>
      </div>

      <div style="padding:6px 12px 2px;">
        <div style="font-size:9px;font-weight:700;color:#adb5bd;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Лог</div>
        <div id="gjopt-log" style="font-size:10px;color:#495057;max-height:100px;overflow-y:auto;font-family:monospace;background:#f8f9fa;border-radius:4px;padding:6px;margin-bottom:8px;line-height:1.5;"></div>
      </div>

      <div style="padding:8px 12px 12px;display:flex;gap:6px;">
        <button id="gjopt-now" style="flex:1;padding:7px;border-radius:5px;border:1px solid #dee2e6;background:#fff;color:#495057;font-size:11px;font-weight:600;cursor:pointer;">
          Очистить сейчас
        </button>
        <button id="gjopt-aggressive" style="flex:1;padding:7px;border-radius:5px;border:1px solid #ffc9c9;background:#fff5f5;color:#c92a2a;font-size:11px;font-weight:600;cursor:pointer;">
          Агрессивно
        </button>
      </div>

      <div style="padding:6px 12px 10px;background:#f8f9fa;border-top:1px solid #e9ecef;">
        <div style="font-size:9px;color:#adb5bd;line-height:1.5;">
          🔴 Расш. <code style="font-size:9px;">bgnkhhnnamicmpeenaelnjfhikgbkllg</code> — <span id="gjopt-ext-status">проверяем…</span><br>
          Заблокировано скриптов расширения: <span id="gjopt-ext-blocked">0</span>
        </div>
      </div>`;

    document.body.appendChild(panel);

    btn.onclick = () => {
      _panelOpen = !_panelOpen;
      panel.style.display = _panelOpen ? 'flex' : 'none';
      btn.style.color = _panelOpen ? '#e03131' : 'rgba(255,255,255,0.55)';
      if (_panelOpen) _updateUI();
    };
    panel.querySelector('#gjopt-close').onclick = () => {
      _panelOpen = false; panel.style.display = 'none';
      btn.style.color = 'rgba(255,255,255,0.55)';
    };
    panel.querySelector('#gjopt-now').onclick = () => _runClean(true);
    panel.querySelector('#gjopt-aggressive').onclick = () => {
      _runClean(true);
      setTimeout(() => _runClean(true), 1000);
      setTimeout(() => _runClean(true), 3000);
    };
    panel.querySelector('#gjopt-throttle-chk').onchange = function () {
      _pollThrottleActive = this.checked;
      _log(this.checked ? 'Throttle polling включён вручную' : 'Throttle polling выключен');
      _updateUI();
    };

    _updateUI();
  }

  function _updateUI() {
    if (!_panelOpen) return;
    const mem = _memMb();
    const memEl = document.getElementById('gjopt-mem');
    if (memEl && mem) {
      memEl.textContent = mem;
      memEl.style.color = mem > 500 ? '#e03131' : mem > 300 ? '#e67700' : '#212529';
    }
    const saved = document.getElementById('gjopt-saved');
    if (saved) saved.textContent = _savedMb;
    const cnt = document.getElementById('gjopt-count');
    if (cnt) cnt.textContent = _cleanCount;

    const logEl = document.getElementById('gjopt-log');
    if (logEl) {
      logEl.innerHTML = _logLines.slice(-15).map(l =>
        `<div>${l}</div>`
      ).join('');
      logEl.scrollTop = logEl.scrollHeight;
    }

    const blocked = document.getElementById('gjopt-ext-blocked');
    if (blocked) blocked.textContent = _blockedExt;

    const extStatus = document.getElementById('gjopt-ext-status');
    if (extStatus) {
      // Проверяем есть ли расширение в DOM
      const extScripts = document.querySelectorAll(`script[src*="${BAD_EXT_ID}"]`);
      extStatus.textContent = extScripts.length ? `⚠ активно (${extScripts.length} скриптов)` : '✓ не обнаружено';
      extStatus.style.color = extScripts.length ? '#e03131' : '#2f9e44';
    }

    const dot = document.getElementById('gjopt-status-dot');
    if (dot) dot.style.background = _pollThrottleActive ? '#e67700' : '#2f9e44';
    const txt = document.getElementById('gjopt-status-txt');
    if (txt) txt.textContent = _pollThrottleActive ? 'Throttle активен' : 'Авто-очистка активна';

    const chk = document.getElementById('gjopt-throttle-chk');
    if (chk) chk.checked = _pollThrottleActive;
  }

  // ─── Инициализация ────────────────────────────────────────────────────────
  function _init() {
    _setupFetchThrottle();
    _blockBadExtension();

    // Авто-очистка каждую минуту (только в idle)
    setInterval(() => {
      const mem = _memMb();
      if (mem && mem > CFG.HEAP_THRESHOLD_MB) {
        _runClean(true); // выше порога — без ожидания idle
      } else {
        _runClean(false);
      }
      _updateUI();
    }, CFG.CLEAN_INTERVAL_MS);

    // Очистка при скрытии вкладки
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        setTimeout(() => _runClean(true), 2000);
      }
    });

    _log('Оптимизатор инициализирован');
    _log(`Heap: ${_memMb() || '?'} МБ`);
  }

  // Ждём сайдбара для UI
  const obs = new MutationObserver(() => {
    if (document.querySelector('.Sidebar_footer__1BA98')) {
      _buildUI();
      obs.disconnect();
    }
  });

  if (document.querySelector('.Sidebar_footer__1BA98')) {
    _buildUI();
  } else {
    obs.observe(document.body, { childList: true, subtree: false });
  }

  _init();

})();

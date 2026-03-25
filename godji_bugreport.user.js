// ==UserScript==
// @name         Godji Bug Report
// @namespace    https://github.com/Randyluffu/Godji-CRM/
// @version      1.3
// @description  Собирает диагностический отчёт по всем Godji скриптам одной кнопкой
// @author       Randyluffu
// @match        https://godji.cloud/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_bugreport.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_bugreport.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ─── Перехват через XMLHttpRequest.prototype + fetch через setInterval ───
    // Проблема: godji_free_time перезаписывает window.fetch и вызывает origFetch,
    // минуя наш хук. Решение: патчим XMLHttpRequest.prototype.open/send (нативный,
    // не перезаписывается) + переустанавливаем fetch-хук поверх любых обёрток.

    var _fetchLog = [];
    var _MAX_LOG  = 40;

    function _logEntry(url, op, vars) {
        var entry = { url: String(url), ts: new Date().toISOString(), op: op || null, vars: vars || null, response: null, error: null };
        _fetchLog.push(entry);
        if (_fetchLog.length > _MAX_LOG) _fetchLog.shift();
        return entry;
    }

    // --- Патч XMLHttpRequest (нативный прототип — не перезаписывается скриптами) ---
    var _xhrOpen = XMLHttpRequest.prototype.open;
    var _xhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._godjiUrl = url;
        return _xhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr  = this;
        var url  = xhr._godjiUrl || '';
        var isGodji = url && (url.includes('godji') || url.includes('hasura'));

        if (isGodji) {
            var op = null, vars = null;
            try { var b = JSON.parse(body); op = b.operationName; vars = b.variables; } catch (e) {}
            var entry = _logEntry(url, op, vars);

            var _origOnLoad = xhr.onload;
            xhr.onload = function () {
                try {
                    var d = JSON.parse(xhr.responseText);
                    entry.response = d;
                } catch (e) {}
                if (_origOnLoad) _origOnLoad.apply(xhr, arguments);
            };
        }

        return _xhrSend.apply(this, arguments);
    };

    // --- Патч window.fetch — переустанавливаем каждые 300мс поверх любых обёрток ---
    function _installFetchPatch() {
        // Не ставим поверх себя
        if (window.fetch && window.fetch._godjiBugReport) return;

        var _wrapped = window.fetch;

        var _patched = function (url, opts) {
            var isGodji = String(url).includes('godji') || String(url).includes('hasura');
            var op = null, vars = null;
            if (opts && opts.body) {
                try { var b = JSON.parse(opts.body); op = b.operationName; vars = b.variables; } catch (e) {}
            }

            var entry = isGodji ? _logEntry(url, op, vars) : null;

            var result = _wrapped.apply(this, arguments);

            if (entry) {
                result.then(function (r) {
                    r.clone().json().then(function (d) { entry.response = d; }).catch(function () {});
                }).catch(function (e) { entry.error = String(e); });
            }

            return result;
        };

        _patched._godjiBugReport = true;
        window.fetch = _patched;
    }

    _installFetchPatch();
    // Переустанавливаем каждые 500мс — перекрывает любой скрипт который re-wraps fetch
    setInterval(_installFetchPatch, 500);

    window._godji_fetchLog = _fetchLog;

    // ─── Перехват ошибок ──────────────────────────────────────────────────────
    var _errorLog   = [];
    var _MAX_ERRORS = 30;

    var _origError = console.error.bind(console);
    console.error = function () {
        var msg = Array.prototype.slice.call(arguments).map(function (a) {
            try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
            catch (e) { return String(a); }
        }).join(' ');
        _errorLog.push({ ts: new Date().toISOString(), msg: msg });
        if (_errorLog.length > _MAX_ERRORS) _errorLog.shift();
        _origError.apply(console, arguments);
    };

    window.addEventListener('error', function (e) {
        _errorLog.push({ ts: new Date().toISOString(), msg: e.message + ' (' + e.filename + ':' + e.lineno + ')' });
        if (_errorLog.length > _MAX_ERRORS) _errorLog.shift();
    });

    window.addEventListener('unhandledrejection', function (e) {
        _errorLog.push({ ts: new Date().toISOString(), msg: 'UnhandledRejection: ' + String(e.reason) });
        if (_errorLog.length > _MAX_ERRORS) _errorLog.shift();
    });

    window._godji_errorLog = _errorLog;

    // ─── Сбор отчёта ─────────────────────────────────────────────────────────
    function collectReport() {
        var lines = [];
        var now = new Date().toISOString();

        lines.push('══════════════════════════════════════════');
        lines.push('  GODJI BUG REPORT  ' + now);
        lines.push('══════════════════════════════════════════');

        lines.push('\n── ВЕРСИИ СКРИПТОВ ──');
        [
            'godji_seating_map', 'godji_client_search', 'godji_multi_select',
            'godji_map_sync', 'godji_cleanup_alert', 'godji_free_time',
            'godji_menu_colors', 'godji_bugreport',
        ].forEach(function (name) {
            lines.push('  ' + name + ': ' + (window['_' + name + '_version'] || '?'));
        });

        lines.push('\n── СТРАНИЦА ──');
        lines.push('  URL: ' + window.location.href);

        lines.push('\n── DOM ──');
        [
            ['Sidebar',         '.Sidebar_linksInner__oTy_4'],
            ['MapContainer',    '.Map_mapContainer__a7ebY'],
            ['Наша карта',      '#godji-map-wrapper'],
            ['Поиск',           '#godji-search-btn'],
            ['Меню дашборда',   '[data-menu-dropdown="true"]'],
            ['Модалка клиента', '#godji-client-modal'],
        ].forEach(function (pair) {
            var el = document.querySelector(pair[1]);
            if (el) {
                var r = el.getBoundingClientRect();
                lines.push('  ' + pair[0] + ': ✓ ' + Math.round(r.width) + 'x' + Math.round(r.height));
            } else {
                lines.push('  ' + pair[0] + ': ✗');
            }
        });

        lines.push('\n── СЕССИИ ──');
        try {
            var sd = window._godjiSessionsData;
            if (sd && typeof sd === 'object') {
                var keys = Object.keys(sd);
                var occ  = keys.filter(function (k) { return sd[k] && sd[k].occ; });
                lines.push('  Всего: ' + keys.length + ', занято: ' + occ.length);
            } else {
                lines.push('  _godjiSessionsData не найден');
            }
        } catch (e) { lines.push('  Ошибка: ' + e.message); }

        lines.push('\n── AUTH ──');
        try {
            var tok = window._godjiAuthToken || '';
            lines.push('  Token: ' + (tok ? tok.substring(0, 20) + '...' + tok.slice(-8) : 'не найден'));
            lines.push('  Role: '  + (window._godjiHasuraRole || '?'));
            lines.push('  Club: '  + (window._godjiClubId    || '?'));
        } catch (e) { lines.push('  Ошибка: ' + e.message); }

        lines.push('\n── ОШИБКИ (' + _errorLog.length + ') ──');
        if (!_errorLog.length) {
            lines.push('  (нет)');
        } else {
            _errorLog.slice(-10).forEach(function (e) {
                lines.push('  [' + e.ts.substring(11, 19) + '] ' + e.msg.substring(0, 220));
            });
        }

        var godjiReqs = _fetchLog.filter(function (f) {
            return f.url && (f.url.includes('godji') || f.url.includes('hasura'));
        });
        lines.push('\n── API ЗАПРОСЫ (' + godjiReqs.length + ') ──');
        if (!godjiReqs.length) {
            lines.push('  (нет — воспроизведи проблему и нажми Обновить)');
        } else {
            godjiReqs.slice(-15).forEach(function (f) {
                lines.push('  [' + f.ts.substring(11, 19) + '] ' + (f.op || f.url.substring(0, 60)));
                if (f.vars) lines.push('    vars: ' + JSON.stringify(f.vars).substring(0, 160));
                if (f.response) {
                    if (f.response.errors) {
                        lines.push('    ❌ ' + JSON.stringify(f.response.errors).substring(0, 300));
                    } else if (f.response.data) {
                        lines.push('    ✓ ' + JSON.stringify(f.response.data).substring(0, 160));
                    }
                }
                if (f.error) lines.push('    ❌ ' + f.error);
            });
        }

        lines.push('\n══════════════════════════════════════════');
        return lines.join('\n');
    }

    // ─── Модальное окно в стиле Mantine CRM ──────────────────────────────────
    function showModal() {
        var old = document.getElementById('godji-bugreport-modal');
        if (old) old.remove();

        var report = collectReport();

        var overlay = document.createElement('div');
        overlay.id = 'godji-bugreport-modal';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:300',
            'background:rgba(0,0,0,0.55)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'padding:16px',
        ].join(';');

        var box = document.createElement('div');
        box.style.cssText = [
            'background:var(--mantine-color-body,#1a1b1e)',
            'border-radius:var(--mantine-radius-md,8px)',
            'width:min(720px,calc(100vw - 32px))',
            'max-height:85vh',
            'display:flex', 'flex-direction:column',
            'overflow:hidden',
            'box-shadow:0 16px 48px rgba(0,0,0,0.6)',
            'font-family:var(--mantine-font-family,inherit)',
        ].join(';');

        // Header
        var header = document.createElement('div');
        header.style.cssText = [
            'display:flex', 'align-items:center', 'justify-content:space-between',
            'padding:16px 20px',
            'border-bottom:1px solid var(--mantine-color-dark-4,rgba(255,255,255,0.1))',
            'flex-shrink:0',
        ].join(';');

        var title = document.createElement('div');
        title.style.cssText = 'display:flex;align-items:center;gap:10px;';
        title.innerHTML = [
            '<div style="width:28px;height:28px;border-radius:6px;background:#cc0001;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;">',
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M9 9v-1a3 3 0 0 1 6 0v1"/><path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"/>',
            '<line x1="3" y1="13" x2="7" y2="13"/><line x1="17" y1="13" x2="21" y2="13"/>',
            '<line x1="12" y1="20" x2="12" y2="14"/>',
            '<line x1="4" y1="19" x2="7.35" y2="17"/><line x1="20" y1="19" x2="16.65" y2="17"/>',
            '<line x1="4" y1="7" x2="7.35" y2="9"/><line x1="20" y1="7" x2="16.65" y2="9"/>',
            '</svg></div>',
            '<span style="font-size:15px;font-weight:600;color:var(--mantine-color-text,#c1c2c5);">Баг-репорт</span>',
        ].join('');

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed,#868e96);cursor:pointer;padding:6px;border-radius:4px;display:flex;align-items:center;';
        closeBtn.onclick = function () { overlay.remove(); };

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Hint
        var hint = document.createElement('div');
        hint.style.cssText = [
            'margin:12px 20px 0',
            'padding:10px 14px',
            'background:var(--mantine-color-dark-6,rgba(255,255,255,0.04))',
            'border-radius:var(--mantine-radius-sm,6px)',
            'border-left:3px solid #cc0001',
            'font-size:12px',
            'color:var(--mantine-color-dimmed,#868e96)',
            'line-height:1.5', 'flex-shrink:0',
        ].join(';');
        hint.textContent = 'Воспроизведи проблему → нажми «Обновить» → скопируй и отправь текст.';

        // Textarea
        var textarea = document.createElement('textarea');
        textarea.value = report;
        textarea.readOnly = true;
        textarea.style.cssText = [
            'flex:1', 'min-height:240px',
            'margin:12px 20px',
            'background:var(--mantine-color-dark-7,rgba(0,0,0,0.3))',
            'color:var(--mantine-color-dimmed,#868e96)',
            'border:1px solid var(--mantine-color-dark-4,rgba(255,255,255,0.1))',
            'border-radius:var(--mantine-radius-sm,6px)',
            'padding:10px 12px',
            'font-family:ui-monospace,monospace',
            'font-size:11px', 'line-height:1.6',
            'resize:none', 'outline:none',
            'box-sizing:border-box',
        ].join(';');

        // Footer
        var ftr = document.createElement('div');
        ftr.style.cssText = [
            'display:flex', 'gap:8px',
            'padding:12px 20px 16px',
            'border-top:1px solid var(--mantine-color-dark-4,rgba(255,255,255,0.1))',
            'flex-shrink:0',
        ].join(';');

        var copyBtn = document.createElement('button');
        copyBtn.textContent = 'Скопировать';
        copyBtn.style.cssText = [
            'flex:1', 'padding:9px 16px',
            'background:#cc0001', 'color:#fff',
            'border:none', 'border-radius:var(--mantine-radius-sm,6px)',
            'font-size:13px', 'font-weight:600', 'cursor:pointer',
            'transition:background 0.15s',
        ].join(';');
        copyBtn.onmouseenter = function () { copyBtn.style.background = '#a50001'; };
        copyBtn.onmouseleave = function () { copyBtn.style.background = '#cc0001'; };
        copyBtn.onclick = function () {
            navigator.clipboard.writeText(textarea.value).then(function () {
                copyBtn.textContent = '✓ Скопировано';
                setTimeout(function () { copyBtn.textContent = 'Скопировать'; }, 2000);
            }).catch(function () {
                textarea.select();
                document.execCommand('copy');
                copyBtn.textContent = '✓ Скопировано';
                setTimeout(function () { copyBtn.textContent = 'Скопировать'; }, 2000);
            });
        };

        var refreshBtn = document.createElement('button');
        refreshBtn.textContent = 'Обновить';
        refreshBtn.style.cssText = [
            'padding:9px 16px',
            'background:var(--mantine-color-dark-5,rgba(255,255,255,0.08))',
            'color:var(--mantine-color-text,#c1c2c5)',
            'border:1px solid var(--mantine-color-dark-4,rgba(255,255,255,0.12))',
            'border-radius:var(--mantine-radius-sm,6px)',
            'font-size:13px', 'font-weight:500', 'cursor:pointer',
        ].join(';');
        refreshBtn.onclick = function () { textarea.value = collectReport(); };

        ftr.appendChild(copyBtn);
        ftr.appendChild(refreshBtn);
        box.appendChild(header);
        box.appendChild(hint);
        box.appendChild(textarea);
        box.appendChild(ftr);
        overlay.appendChild(box);

        overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });

        document.body.appendChild(overlay);
    }

    // ─── Кнопка — только иконка, вровень с "Гоголя Админ" ───────────────────
    var _btnInjected = false;

    function injectButton() {
        if (_btnInjected) return;
        if (document.getElementById('godji-bugreport-btn')) { _btnInjected = true; return; }

        var footer = document.querySelector('.Sidebar_footer__1BA98');
        if (!footer) return;

        var userBtn = footer.querySelector('button[aria-haspopup="menu"], button.mantine-UnstyledButton-root');
        if (!userBtn) return;

        _btnInjected = true;

        // Иконка-кнопка
        var btn = document.createElement('button');
        btn.id = 'godji-bugreport-btn';
        btn.title = 'Баг-репорт';
        btn.className = 'mantine-focus-auto m_87cf2631 mantine-UnstyledButton-root';
        btn.style.cssText = [
            'flex-shrink:0',
            'width:34px', 'height:34px',
            'border-radius:8px',
            'background:rgba(204,0,1,0.15)',
            'border:none', 'cursor:pointer',
            'display:flex', 'align-items:center', 'justify-content:center',
            'color:#cc0001',
            'transition:background 0.15s',
        ].join(';');
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9v-1a3 3 0 0 1 6 0v1"/><path d="M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3"/><line x1="3" y1="13" x2="7" y2="13"/><line x1="17" y1="13" x2="21" y2="13"/><line x1="12" y1="20" x2="12" y2="14"/><line x1="4" y1="19" x2="7.35" y2="17"/><line x1="20" y1="19" x2="16.65" y2="17"/><line x1="4" y1="7" x2="7.35" y2="9"/><line x1="20" y1="7" x2="16.65" y2="9"/></svg>';
        btn.onmouseenter = function () { btn.style.background = 'rgba(204,0,1,0.28)'; };
        btn.onmouseleave = function () { btn.style.background = 'rgba(204,0,1,0.15)'; };
        btn.onclick = function (e) { e.stopPropagation(); showModal(); };

        // Оборачиваем userBtn + нашу кнопку в flex-строку
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;width:100%;gap:4px;padding:0 12px;box-sizing:border-box;';

        userBtn.style.flex = '1';
        userBtn.style.minWidth = '0';
        userBtn.style.padding = '0';

        userBtn.parentNode.insertBefore(row, userBtn);
        row.appendChild(userBtn);
        row.appendChild(btn);
    }

    // ─── Observer ─────────────────────────────────────────────────────────────
    var _obs = new MutationObserver(function () { if (!_btnInjected) injectButton(); });
    _obs.observe(document.body, { childList: true, subtree: true });

    injectButton();
    setTimeout(injectButton, 1000);
    setTimeout(injectButton, 3000);

})();

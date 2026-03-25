// ==UserScript==
// @name         Годжи — Цвета меню
// @namespace    http://tampermonkey.net/
// @version      7.6
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_menu_colors.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_menu_colors.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var COLORS = {
        'Посадить за ПК':               { color: '#1b5e20', bg: 'rgba(46, 125, 50, 0.13)' },
        'Бронирование':                 { color: '#bf360c', bg: 'rgba(191, 54, 12, 0.10)' },
        'Запустить сессию':             { color: '#1b5e20', bg: 'rgba(46, 125, 50, 0.13)' },
        'Пополнить наличными':          { color: '#1b5e20', bg: 'rgba(46, 125, 50, 0.10)' },
        'Пополнить бонусами':           { color: '#2e7d32', bg: 'rgba(46, 125, 50, 0.07)' },
        'Добавить бесплатное время':    { color: '#33691e', bg: 'rgba(51, 105, 30, 0.07)' },
        'Смена места':                  { color: '#1565c0', bg: 'rgba(21, 101, 192, 0.10)' },
        'Продление сеанса':             { color: '#bf360c', bg: 'rgba(191, 54, 12, 0.10)' },
        'Завершить сессию':             { color: '#b71c1c', bg: 'rgba(183, 28, 28, 0.10)' },
        'Выйти из аккаунта':            { color: '#880e4f', bg: 'rgba(136, 14, 79, 0.08)' },
        'Выключить':                    { color: '#ffffff', bg: 'rgba(127, 0, 0, 0.82)' },
        'Включить':                     { color: '#ffffff', bg: 'rgba(27, 94, 32, 0.82)' },
        'Перезагрузить':                { color: '#bf360c', bg: 'rgba(191, 54, 12, 0.12)' },
        'Активировать защиту':          { color: '#283593', bg: 'rgba(40, 53, 147, 0.10)' },
        'Снять защиту':                 { color: '#283593', bg: 'rgba(40, 53, 147, 0.07)' },
        'Командная строка':             { color: '#1a237e', bg: 'rgba(26, 35, 126, 0.10)' },
        'Диспетчер задач':              { color: '#37474f', bg: 'rgba(55, 71, 79, 0.08)' },
        'Редактировать':                { color: '#546e7a', bg: 'rgba(84, 110, 122, 0.08)' },
        'Удалить':                      { color: '#b71c1c', bg: 'rgba(183, 28, 28, 0.10)' },
        'Убрать подсветку':             { color: '#6a1b9a', bg: 'rgba(106, 27, 154, 0.10)' },
    };

    window._godjiMenuColors = COLORS;



    var enabled = GM_getValue('colorsEnabled', true);

    // --- Скролл меню ---
    function setupMenuScroll(menu) {
        if (menu.getAttribute('data-godji-scroll')) return;
        menu.setAttribute('data-godji-scroll', '1');
        menu.style.maxHeight = '85vh';
        menu.style.overflowY = 'auto';
        menu.style.overflowX = 'hidden';
        // Позиционируем меню чтобы не уходило за экран
        var rect = menu.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 8) {
            menu.style.maxHeight = (window.innerHeight - rect.top - 8) + 'px';
        }
        if (!document.getElementById('godji-scroll-style')) {
            var s = document.createElement('style');
            s.id = 'godji-scroll-style';
            s.textContent = [
                '.mantine-Menu-dropdown::-webkit-scrollbar { width: 4px; }',
                '.mantine-Menu-dropdown::-webkit-scrollbar-thumb { background:rgba(0,0,0,0); border-radius:4px; }',
                '.mantine-Menu-dropdown:hover::-webkit-scrollbar-thumb { background:rgba(0,0,0,0.2); }',
            ].join('\n');
            document.head.appendChild(s);
        }
    }

    // --- VNC кнопка в контекстном меню ПК ---
    var VNC_PROXY = 'http://localhost:6080';

    function showVncToast(msg, ok) {
        var old = document.getElementById('godji-vnc-toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.id = 'godji-vnc-toast';
        t.textContent = msg;
        var bg = ok ? 'rgba(27,94,32,0.95)' : 'rgba(183,28,28,0.95)';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + bg + ';color:#fff;padding:8px 18px;border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-family:var(--mantine-font-family,inherit);font-weight:500;z-index:999999;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(function(){if(t.parentNode)t.remove();},300); }, 2500);
    }

    function injectVncButton(menu) {
        if (!menu || menu.querySelector('[data-godji-vnc]')) return;        var pcName = window._godjiLastContextPc;
        if (!pcName) return;

        // Показываем кнопку только для включённых ПК
        // Проверяем статус в таблице
        var pcOn = false;
        var rows = document.querySelectorAll('tr.mantine-Table-tr');
        for (var ri = 0; ri < rows.length; ri++) {
            var c0 = rows[ri].querySelector('td[data-index="0"]') || rows[ri].querySelector('td');
            if (c0 && c0.textContent.trim() === pcName) {
                var c2 = rows[ri].querySelector('td[data-index="2"]');
                var statusText = c2 ? c2.textContent.trim() : '';
                pcOn = statusText.length > 0 && statusText !== 'Недоступен' && statusText !== 'НЕДОСТУПЕН';
                break;
            }
        }
        // Fallback: если не нашли в таблице но есть в sessionsData — точно включён
        if (!pcOn && window._godjiSessionsData && window._godjiSessionsData[pcName]) {
            pcOn = true;
        }

        if (!pcOn) return;

        var btn = document.createElement('button');
        btn.setAttribute('data-godji-vnc', '1');
        btn.setAttribute('type', 'button');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-menu-item', 'true');
        btn.setAttribute('data-mantine-stop-propagation', 'true');
        btn.className = 'mantine-focus-auto m_99ac2aa1 mantine-Menu-item m_87cf2631 mantine-UnstyledButton-root';
        btn.style.cssText = 'color:#1565c0;background-color:rgba(21,101,192,0.10);--menu-item-color:#1565c0;--menu-item-hover:rgba(21,101,192,0.15);';

        btn.innerHTML = '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">' +
            '<div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1565c0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>' +
            '</svg></div></div>' +
            '<div class="m_5476e0d3 mantine-Menu-itemLabel">Просмотр экрана</div>';

        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var name = pcName;
            document.body.click();
            fetch(VNC_PROXY + '/connect?pc=' + encodeURIComponent(name))
                .then(function(r) { return r.json(); })
                .then(function(res) {
                    if (res.error) throw new Error(res.error);
                    showVncToast('✓ TightVNC открыт для ПК ' + name, true);
                })
                .catch(function(e) {
                    showVncToast('✗ ' + (e.message || 'Сервер недоступен'), false);
                });
        });

        // Находим контейнер с пунктами меню динамически
        var container = menu;
        var maxItems = 0;
        for (var ci = 0; ci < menu.children.length; ci++) {
            var cnt = menu.children[ci].querySelectorAll('[role="menuitem"]').length;
            if (cnt > maxItems) { maxItems = cnt; container = menu.children[ci]; }
        }
        if (maxItems === 0) container = menu;

        // Вставляем перед "Командная строка"
        var targetBtn = null;
        var items = container.querySelectorAll('[role="menuitem"]');
        for (var j = 0; j < items.length; j++) {
            var lbl = items[j].querySelector('.mantine-Menu-itemLabel');
            if (lbl && lbl.textContent.trim() === 'Командная строка') { targetBtn = items[j]; break; }
        }
        if (targetBtn && targetBtn.parentNode === container) {
            container.insertBefore(btn, targetBtn);
        } else {
            container.appendChild(btn);
        }
    }

    // --- Цвета ---
    function colorize() {
        var items = document.querySelectorAll('button[role="menuitem"]');
        for (var i = 0; i < items.length; i++) {
            var btn = items[i];
            if (btn.getAttribute('data-godji-colored')) continue;
            var labelEl = btn.querySelector('.mantine-Menu-itemLabel');
            if (!labelEl) continue;
            var text = labelEl.textContent.trim();
            var cfg = COLORS[text];
            if (!cfg) continue;
            if (enabled) {
                btn.style.color = cfg.color;
                btn.style.backgroundColor = cfg.bg;
                btn.style.setProperty('--menu-item-color', cfg.color);
                btn.style.setProperty('--menu-item-hover', cfg.bg);
                var svg = btn.querySelector('svg');
                if (svg) svg.style.stroke = cfg.color;
            } else {
                btn.style.color = '';
                btn.style.backgroundColor = '';
                btn.style.removeProperty('--menu-item-color');
                btn.style.removeProperty('--menu-item-hover');
                var svg2 = btn.querySelector('svg');
                if (svg2) svg2.style.stroke = '';
            }
            btn.setAttribute('data-godji-colored', '1');
        }
    }

    // --- Observer ---
    // Разделяем colorize (быстро) и injectHideButton (с задержкой)
    // чтобы не мешать godji_free_time вставлять свою кнопку
    var _colorizeTimer = null;

    // MutationObserver — основной способ отслеживания изменений
    var _colorizeTimer = null;
    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(_colorizeTimer);
                _colorizeTimer = setTimeout(function() {
                    colorize();
                    var menu = document.querySelector('[data-menu-dropdown="true"]');
                    if (menu) {
                        setupMenuScroll(menu);
                        adjustLayout();
                    }
                }, 0);
                break;
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Вставка VNC через contextmenu — самый надёжный способ
    document.addEventListener('contextmenu', function() {
        // После contextmenu ждём пока меню появится с пунктами
        var attempts = 0;
        var t = setInterval(function() {
            attempts++;
            var menu = document.querySelector('[data-menu-dropdown="true"]');
            if (!menu) { if (attempts > 30) clearInterval(t); return; }
            var items = menu.querySelectorAll('[role="menuitem"]');
            if (items.length < 5) { if (attempts > 30) clearInterval(t); return; }
            clearInterval(t);
            injectVncButton(menu);
        }, 50);
    }, true);

    // --- Подстройка ширины под наличие кнопки карты ---
    function adjustLayout() {
        var wrap = document.getElementById('godji-colors-toggle');
        if (!wrap) return;
        var mapBtn = document.getElementById('godji-map-toggle');
        if (mapBtn) {
            // Кнопка карты есть — занимаем правую половину
            wrap.style.left  = '140px';
            wrap.style.width = '140px';
        } else {
            // Кнопки карты нет — растягиваемся на всю ширину
            wrap.style.left  = '0px';
            wrap.style.width = '280px';
        }
    }

    // Убиваем hover Mantine на кнопке-обёртке через глобальный CSS
    if (!document.getElementById('godji-colors-no-hover')) {
        var noHoverStyle = document.createElement('style');
        noHoverStyle.id = 'godji-colors-no-hover';
        noHoverStyle.textContent = '#godji-colors-toggle:hover { background-color: transparent !important; }';
        document.head.appendChild(noHoverStyle);
    }

    // --- Тогглер ---
    function createToggle() {
        if(document.getElementById('godji-colors-toggle'))return;
        var wrap = document.createElement('a');
        wrap.id = 'godji-colors-toggle';
        wrap.href = 'javascript:void(0)';
        wrap.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        // Начальные размеры — подстроятся через adjustLayout()
        wrap.style.cssText = [
            'position:fixed', 'bottom:260px', 'left:140px', 'z-index:150',
            'display:flex', 'align-items:center', 'gap:12px',
            'width:140px', 'height:46px', 'padding:8px 12px 8px 18px',
            'cursor:default', 'user-select:none',
            'font-family:inherit', 'box-sizing:border-box', 'text-decoration:none',
            'pointer-events:none',
        ].join(';');

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#ffffff;';
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25"></path><path d="M8.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M12.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M16.5 10.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path></svg>';

        var right = document.createElement('div');
        right.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex:1;min-width:0;';

        var label = document.createElement('span');
        label.textContent = 'Цвета меню';
        label.style.cssText = 'font-size:14px;font-weight:600;color:#ffffff;white-space:nowrap;letter-spacing:0.1px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;';

        var track = document.createElement('div');
        track.style.cssText = 'width:42px;height:24px;border-radius:12px;position:relative;flex-shrink:0;transition:background 0.25s;cursor:pointer;pointer-events:all;';
        var thumb = document.createElement('div');
        thumb.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.25s;box-shadow:0 1px 4px rgba(0,0,0,0.35);';

        function updateVisual() {
            if (enabled) { track.style.background = '#cc0001'; thumb.style.left = '21px'; }
            else { track.style.background = 'rgba(255,255,255,0.25)'; thumb.style.left = '3px'; }
        }

        track.appendChild(thumb);
        right.appendChild(label);
        right.appendChild(track);
        wrap.appendChild(iconWrap);
        wrap.appendChild(right);
        document.body.appendChild(wrap);
        updateVisual();
        adjustLayout();

        track.addEventListener('click', function(e) {
            e.stopPropagation();
            enabled = !enabled;
            GM_setValue('colorsEnabled', enabled);
            updateVisual();
            document.querySelectorAll('[data-godji-colored]').forEach(function(el) {
                el.removeAttribute('data-godji-colored');
            });
            colorize();
        });
    }

    createToggle();

})();

// ==UserScript==
// @name         Годжи — Подсветка уборки
// @namespace    http://tampermonkey.net/
// @version      3.10
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cleanup_alert.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cleanup_alert.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Меняй это число чтобы изменить время подсветки (в минутах)
    var HIGHLIGHT_DURATION_MS = 30 * 60 * 1000;
    var STORAGE_KEY = 'godji_cleanup_pcs';
    var STATE_KEY = 'godji_cleanup_state';
    var BUTTON_ID = 'godji-clear-highlight-btn';
    var TIMER_BOTTOM_CLASS = 'godji-timer-bottom'; // под индикаторами (обычный режим)
    var TIMER_INLINE_CLASS = 'godji-timer-inline'; // рядом с номером (режим ожидания)

    var state = {};
    var initialized = false;
    var lastContextPc = null;

    // --- localStorage ---
    function loadNeedsCleanup() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; }
    }
    function saveNeedsCleanup(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
    }

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch(e) { return {}; }
    }
    function saveState(data) {
        try { localStorage.setItem(STATE_KEY, JSON.stringify(data)); } catch(e) {}
    }

    // --- Форматирование времени ---
    function formatElapsed(ms) {
        var totalSec = Math.floor(ms / 1000);
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return m + 'м ' + s + 'с';
    }

    // --- Проверка: карточка в режиме ожидания (голубой фон) ---
    function isWaiting(card) {
        if (!card) return false;
        // Наша gm-card — смотрим на цвет рамки
        if (card.classList.contains('gm-card')) {
            var brd = card.style.borderColor || '';
            return brd.indexOf('42a5f5') !== -1 || brd.indexOf('1976d2') !== -1 || brd.indexOf('1565c0') !== -1;
        }
        var bg = card.style.backgroundColor || '';
        return bg.indexOf('103') !== -1 && bg.indexOf('232') !== -1 && bg.indexOf('249') !== -1;
    }

    // --- Поиск элементов ---
    function findTableRow(name) {
        var rows = document.querySelectorAll('tr.mantine-Table-tr');
        for (var i = 0; i < rows.length; i++) {
            var nc = rows[i].querySelector('td[data-index="0"]') ||
                     rows[i].querySelector('td[style*="col-deviceName-size"]');
            if (nc && nc.textContent.trim() === name) return rows[i];
        }
        return null;
    }
    function findCard(name) {
        // Наша карта — возвращаем первую найденную (для обратной совместимости)
        var gm = document.querySelector('.gm-card[data-pc="' + name + '"]');
        if (gm) return gm;
        var cards = document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
        for (var i = 0; i < cards.length; i++) {
            var ne = cards[i].querySelector('.DeviceItem_deviceName__yC1tT');
            if (ne && ne.textContent.trim() === name) return cards[i];
        }
        return null;
    }

    // Возвращает ВСЕ карточки по имени (и нашу и оригинальную)
    function findAllCards(name) {
        var result = [];
        var gm = document.querySelector('.gm-card[data-pc="' + name + '"]');
        if (gm) result.push(gm);
        var cards = document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
        for (var i = 0; i < cards.length; i++) {
            var ne = cards[i].querySelector('.DeviceItem_deviceName__yC1tT');
            if (ne && ne.textContent.trim() === name) result.push(cards[i]);
        }
        return result;
    }

    // --- Восстановить ячейки таблицы ---
    function getCell(row, idx, colName) {
        return row.querySelector('td[data-index="'+idx+'"]') ||
               row.querySelector('td[style*="'+colName+'"]');
    }
    function restoreTableCells(row) {
        var statusCell = getCell(row, '8', 'col-sessionStatus-size');
        if (statusCell) {
            var fake = statusCell.querySelector('.godji-fake-status');
            if (fake) fake.remove();
            var orig = statusCell.querySelector('.mantine-Flex-root');
            if (orig) orig.style.display = '';
        }
        var leftCell = getCell(row, '7', 'col-sessionLeftTime-size');
        if (leftCell) {
            var fakeTime = leftCell.querySelector('.godji-fake-time');
            if (fakeTime) fakeTime.remove();
            var origTime = leftCell.querySelector('.mantine-Flex-root');
            if (origTime) origTime.style.display = '';
        }
        var startCell = getCell(row, '4', 'col-sessionStart-size');
        if (startCell) {
            var fakeStart = startCell.querySelector('.godji-fake-start');
            if (fakeStart) fakeStart.remove();
            var origStart = startCell.querySelector('.mantine-Flex-root');
            if (origStart) origStart.style.display = '';
        }
    }

    // --- Снять подсветку ---
    function clearHighlight(pc) {
        var data = loadNeedsCleanup();
        delete data[pc];
        saveNeedsCleanup(data);

        findAllCards(pc).forEach(function(card) {
            card.style.outline = '';
            card.style.outlineOffset = '';
            card.style.boxShadow = '';
            if (card.classList.contains('gm-card')) {
                var gmT = card.querySelector('.gm-timer');
                if (gmT) { gmT.textContent = ''; gmT.style.color = ''; gmT.style.display = 'none'; }
                var gmN = card.querySelector('.gm-nick');
                if (gmN) gmN.style.display = '';
                var gmP = card.querySelector('.gm-pbw');
                if (gmP) gmP.style.display = '';
            }
            var tb = card.querySelector('.' + TIMER_BOTTOM_CLASS); if (tb) tb.remove();
            var ti = card.querySelector('.' + TIMER_INLINE_CLASS); if (ti) ti.remove();
            var wrapper = card.querySelector('.godji-name-wrapper');
            if (wrapper) {
                var nameEl = wrapper.querySelector('.DeviceItem_deviceName__yC1tT');
                if (nameEl) wrapper.parentNode.insertBefore(nameEl, wrapper);
                wrapper.remove();
            }
        });
        var row = findTableRow(pc);
        if (row) { row.style.backgroundColor = ''; restoreTableCells(row); }
        removeMenuButton();
    }

    // --- Применить подсветку и таймеры ---
    function applyHighlights() {
        var data = loadNeedsCleanup();
        var now = Date.now();
        var changed = false;

        for (var pc in data) {
            var elapsed = now - data[pc];

            if (elapsed >= HIGHLIGHT_DURATION_MS) {
                delete data[pc];
                changed = true;
                var c0 = findCard(pc);
                if (c0) {
                    c0.style.outline = ''; c0.style.outlineOffset = ''; c0.style.boxShadow = '';
                    var tb0 = c0.querySelector('.' + TIMER_BOTTOM_CLASS); if (tb0) tb0.remove();
                    var ti0 = c0.querySelector('.' + TIMER_INLINE_CLASS); if (ti0) ti0.remove();
                    var w0 = c0.querySelector('.godji-name-wrapper');
                    if (w0) { var n0 = w0.querySelector('.DeviceItem_deviceName__yC1tT'); if (n0) w0.parentNode.insertBefore(n0, w0); w0.remove(); }
                }
                var r0 = findTableRow(pc);
                if (r0) { r0.style.backgroundColor = ''; restoreTableCells(r0); }
                continue;
            }

            var elapsedStr = formatElapsed(elapsed);
            var card = findCard(pc);
            var allCards = findAllCards(pc);
            var waiting = isWaiting(card);

            // --- Все карточки на карте (и наша и оригинальная) ---
            allCards.forEach(function(c) {
                c.style.outline = '3px solid #7c3aed';
                c.style.outlineOffset = '0px';
                c.style.boxShadow = '0 0 10px 2px rgba(124, 58, 237, 0.5)';
            });

            // Применяем таймер ко всем карточкам
            allCards.forEach(function(c) {
                if (c.classList.contains('gm-card')) {
                    // gm-card — таймер внутри карточки
                    var gmNick = c.querySelector('.gm-nick');
                    if (gmNick) gmNick.style.display = 'none';
                    var gmPbw = c.querySelector('.gm-pbw');
                    if (gmPbw) gmPbw.style.display = 'none';
                    var gmTimer = c.querySelector('.gm-timer');
                    if (!gmTimer) {
                        gmTimer = document.createElement('div');
                        gmTimer.className = 'gm-timer';
                        gmTimer.style.cssText = 'font-size:8px;font-weight:800;text-align:center;width:100%;pointer-events:none;line-height:1;flex-shrink:0;';
                        c.appendChild(gmTimer);
                    }
                    gmTimer.textContent = elapsedStr;
                    gmTimer.style.color = '#c084fc';
                    gmTimer.style.display = 'block';
                } else {
                    // Оригинальная карточка — таймер снизу или inline
                    if (waiting) {
                        var timerBottom2 = c.querySelector('.' + TIMER_BOTTOM_CLASS);
                        if (timerBottom2) timerBottom2.remove();
                        var nameEl2 = c.querySelector('.DeviceItem_deviceName__yC1tT');
                        var timerInline2 = c.querySelector('.' + TIMER_INLINE_CLASS);
                        if (!timerInline2 && nameEl2) {
                            var wrapper2 = document.createElement('div');
                            wrapper2.className = 'godji-name-wrapper';
                            wrapper2.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:nowrap;';
                            nameEl2.parentNode.insertBefore(wrapper2, nameEl2);
                            wrapper2.appendChild(nameEl2);
                            timerInline2 = document.createElement('span');
                            timerInline2.className = TIMER_INLINE_CLASS;
                            timerInline2.style.cssText = 'font-size:10px;font-weight:700;color:#7c3aed;white-space:nowrap;flex-shrink:0;';
                            wrapper2.appendChild(timerInline2);
                        }
                        if (timerInline2) timerInline2.textContent = elapsedStr;
                    } else {
                        var timerInlineOld = c.querySelector('.' + TIMER_INLINE_CLASS);
                        if (timerInlineOld) timerInlineOld.remove();
                        var timerBottom3 = c.querySelector('.' + TIMER_BOTTOM_CLASS);
                        if (!timerBottom3) {
                            timerBottom3 = document.createElement('div');
                            timerBottom3.className = TIMER_BOTTOM_CLASS;
                            timerBottom3.style.cssText = 'text-align:center;font-size:10px;font-weight:700;color:#7c3aed;margin-top:4px;letter-spacing:0.5px;';
                            c.appendChild(timerBottom3);
                        }
                        timerBottom3.textContent = elapsedStr;
                    }
                }
            });

            if (card) {
                var isGmCard = card.classList.contains('gm-card');
                if (false) { // логика перенесена в allCards.forEach выше
                } else if (!isGmCard) {
                    // Обычный режим: таймер под индикаторами (только для оригинальных карточек)
                    var timerInline2 = card.querySelector('.' + TIMER_INLINE_CLASS);
                    if (timerInline2) timerInline2.remove();

                    var timerBottom = card.querySelector('.' + TIMER_BOTTOM_CLASS);
                    if (!timerBottom) {
                        timerBottom = document.createElement('div');
                        timerBottom.className = TIMER_BOTTOM_CLASS;
                        timerBottom.style.cssText = 'text-align:center;font-size:10px;font-weight:700;color:#7c3aed;margin-top:4px;letter-spacing:0.5px;';
                        card.appendChild(timerBottom);
                    }
                    timerBottom.textContent = elapsedStr;
                }
            }

            // --- Строка в таблице ---
            var row = findTableRow(pc);
            if (row) {
                row.style.backgroundColor = 'rgba(124, 58, 237, 0.20)';

                if (!waiting) {
                    // Не ожидание — заменяем статус и остаток времени
                    var statusCell = getCell(row, '8', 'col-sessionStatus-size');
                    if (statusCell) {
                        var orig = statusCell.querySelector('.mantine-Flex-root');
                        if (orig) orig.style.display = 'none';
                        var fake = statusCell.querySelector('.godji-fake-status');
                        if (!fake) {
                            fake = document.createElement('div');
                            fake.className = 'godji-fake-status';
                            fake.style.cssText = 'display:flex;justify-content:center;align-items:center;';
                            fake.innerHTML = '<div style="background:#7c3aed;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:0.5px;">УШЁЛ</div>';
                            statusCell.appendChild(fake);
                        }
                    }

                    var leftCell = getCell(row, '7', 'col-sessionLeftTime-size');
                    if (leftCell) {
                        var origTime = leftCell.querySelector('.mantine-Flex-root');
                        if (origTime) origTime.style.display = 'none';
                        var fakeTime = leftCell.querySelector('.godji-fake-time');
                        if (!fakeTime) {
                            fakeTime = document.createElement('div');
                            fakeTime.className = 'godji-fake-time';
                            fakeTime.style.cssText = 'display:flex;justify-content:center;align-items:center;font-size:13px;font-weight:700;color:#7c3aed;';
                            leftCell.appendChild(fakeTime);
                        }
                        fakeTime.textContent = elapsedStr;
                    }

                    // Ячейка "Старт" — пишем время ухода
                    var startCell = getCell(row, '4', 'col-sessionStart-size');
                    if (startCell) {
                        var origStart = startCell.querySelector('.mantine-Flex-root');
                        if (origStart) origStart.style.display = 'none';
                        var fakeStart = startCell.querySelector('.godji-fake-start');
                        if (!fakeStart) {
                            fakeStart = document.createElement('div');
                            fakeStart.className = 'godji-fake-start';
                            var endDate = new Date(data[pc]);
                            var hh = String(endDate.getHours()).padStart(2, '0');
                            var mm = String(endDate.getMinutes()).padStart(2, '0');
                            fakeStart.style.cssText = 'display:flex;justify-content:center;align-items:center;font-size:13px;color:rgba(124,58,237,0.8);';
                            fakeStart.textContent = hh + ':' + mm;
                            startCell.appendChild(fakeStart);
                        }
                    }
                } else {
                    // Ожидание — восстанавливаем ячейки если были изменены
                    restoreTableCells(row);
                }
            }
        }

        if (changed) saveNeedsCleanup(data);
    }

    // --- Читаем состояние таблицы ---
    function getTableState() {
        var result = {};
        var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td');
            if (cells.length < 9) continue;
            // data-index="0" = имя, data-index="2" = статус устройства, data-index="8" = статус сеанса
            var nameCell = rows[i].querySelector('td[data-index="0"]') ||
                           rows[i].querySelector('td[style*="col-deviceName-size"]');
            if (!nameCell) continue;
            var pcName = nameCell.textContent.trim();
            if (!pcName) continue;

            // Статус сеанса: data-index=8 или col-sessionStatus
            var sessionCell = rows[i].querySelector('td[data-index="8"]') ||
                              rows[i].querySelector('td[style*="col-sessionStatus-size"]');
            var sessionBadge = sessionCell ? sessionCell.querySelector('.mantine-Badge-label') : null;
            var sessionStatus = sessionBadge ? sessionBadge.textContent.trim() :
                                (sessionCell ? sessionCell.textContent.trim() : '');

            // Статус устройства: data-index=2 или col-deviceStatus
            var deviceCell = rows[i].querySelector('td[data-index="2"]') ||
                             rows[i].querySelector('td[style*="col-deviceStatus-size"]');
            var deviceBadge = deviceCell ? deviceCell.querySelector('.mantine-Badge-label') : null;
            var deviceStatus = deviceBadge ? deviceBadge.textContent.trim() : '';

            result[pcName] = { session: sessionStatus, device: deviceStatus };
        }
        return result;
    }

    // --- Инициализация ---
    function tryInit() {
        // Восстанавливаем state из localStorage если есть
        var savedState = loadState();
        if (Object.keys(savedState).length > 0) {
            state = savedState;
        }
        var current = getTableState();
        var keys = Object.keys(current);

        // Проверяем не только что строки есть, но и что статусы загружены
        // Если все статусы пустые — React ещё рендерит
        var hasRealData = false;
        for (var i = 0; i < keys.length; i++) {
            var s = current[keys[i]].session;
            if (s && s !== '') { hasRealData = true; break; }
        }

        if (keys.length === 0 || !hasRealData) {
            setTimeout(tryInit, 1000);
            return;
        }

        // Дополнительная пауза после того как данные появились —
        // даём React завершить рендер полностью
        setTimeout(function() {
            var final = getTableState();
            var savedState = loadState();

            for (var pc in final) {
                // Если state из localStorage говорит что ПК был свободен,
                // а сейчас "Играет" — это новый сеанс, не триггерим подсветку.
                // Просто обновляем state текущими данными.
                state[pc] = final[pc];
            }

            // Дополняем state ПК которые есть в сохранённом но нет в таблице
            for (var pc2 in savedState) {
                if (!(pc2 in state)) {
                    state[pc2] = savedState[pc2];
                }
            }

            saveState(state);
            initialized = true;
            applyHighlights();
        }, 1500);
    }

    // --- Основное сканирование ---
    function scan() {
        if (!initialized) return;

        var current = getTableState();

        // Защита: если state пустой а таблица не пустая
        if (Object.keys(state).length === 0 && Object.keys(current).length > 0) {
            // Всегда используем текущие данные таблицы как базу —
            // это предотвращает ложные срабатывания из устаревшего state
            for (var pcX in current) state[pcX] = current[pcX];
            saveState(state);
            applyHighlights();
            return;
        }

        var data = loadNeedsCleanup();
        var changed = false;

        for (var pc in current) {
            var newSession = current[pc].session;
            var oldSession = state[pc] ? state[pc].session : undefined;

            // Сеанс завершился — добавляем в очередь уборки
            if (oldSession === 'Играет' && newSession !== 'Играет') {
                data[pc] = Date.now();
                changed = true;
            }

            state[pc] = current[pc];
        }
        saveState(state);

        if (changed) saveNeedsCleanup(data);
        applyHighlights();
    }

    // --- Кнопка "Убрать подсветку" ---
    function removeMenuButton() {
        var b = document.getElementById(BUTTON_ID); if (b) b.remove();
    }

    function injectMenuButton(pcName) {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');
        if (!menuEl || !pcName) return;
        removeMenuButton();
        var data = loadNeedsCleanup();
        if (!data[pcName]) return;

        var btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('type', 'button');
        btn.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:7px 14px;background:#f3e8ff;color:#7c3aed;border:none;cursor:pointer;font-size:13px;font-family:inherit;text-align:left;box-sizing:border-box;';
        btn.innerHTML = '<span style="font-size:15px">&#x1F7E3;</span><span>Убрать подсветку</span>';
        btn.addEventListener('mousedown', function(e) {
            e.preventDefault(); e.stopPropagation();
            clearHighlight(pcName);
            setTimeout(function() { document.body.click(); }, 10);
        });
        menuEl.insertBefore(btn, menuEl.firstChild);
    }

    function detectPcFromMenu(menuEl) {
        var data = loadNeedsCleanup();
        if (lastContextPc && data[lastContextPc]) return lastContextPc;

        var rect = menuEl.getBoundingClientRect();
        var mx = rect.left + rect.width / 2, my = rect.top;
        var bestDist = 999999, bestPc = null;

        var cards = document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
        for (var i = 0; i < cards.length; i++) {
            var ne = cards[i].querySelector('.DeviceItem_deviceName__yC1tT');
            if (!ne) continue;
            var name = ne.textContent.trim();
            if (!data[name]) continue;
            var cr = cards[i].getBoundingClientRect();
            var d = Math.abs(cr.left + cr.width / 2 - mx) + Math.abs(cr.bottom - my);
            if (d < bestDist) { bestDist = d; bestPc = name; }
        }
        if (bestPc && bestDist < 300) return bestPc;

        var rows = document.querySelectorAll('tr.mantine-Table-tr');
        bestDist = 999999; bestPc = null;
        for (var j = 0; j < rows.length; j++) {
            var nc = rows[j].querySelector('td[data-index="0"]') || rows[j].querySelector('td[style*="col-deviceName-size"]');
            if (!nc) continue;
            var pcName = nc.textContent.trim();
            if (!data[pcName]) continue;
            var rr = rows[j].getBoundingClientRect();
            var d2 = Math.abs(rr.left + rr.width / 2 - mx) + Math.abs(rr.bottom - my);
            if (d2 < bestDist) { bestDist = d2; bestPc = pcName; }
        }
        if (bestPc && bestDist < 300) return bestPc;
        return null;
    }

    // --- Снимаем подсветку при нажатии "Выключить" в меню ---
    document.addEventListener('click', function(e) {
        var menuItem = e.target.closest('[role="menuitem"]');
        if (!menuItem || menuItem.id === BUTTON_ID) return;
        var label = menuItem.querySelector('.mantine-Menu-itemLabel');
        if (!label) return;
        if (label.textContent.trim() === 'Выключить' && lastContextPc) {
            var data = loadNeedsCleanup();
            if (data[lastContextPc]) clearHighlight(lastContextPc);
        }
    }, true);

    var menuObserver = new MutationObserver(function() {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');
        if (!menuEl) return;
        setTimeout(function() {
            var pc = detectPcFromMenu(menuEl);
            if (pc) injectMenuButton(pc);
        }, 80);
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('mouseover', function(e) {
        var row = e.target.closest('tr.mantine-Table-tr');
        if (row) {
            var nc = row.querySelector('td[data-index="0"]') || row.querySelector('td[style*="col-deviceName-size"]');
            if (nc) lastContextPc = nc.textContent.trim();
            return;
        }
        var card = e.target.closest('.DeviceItem_deviceBox__pzNUf');
        if (card) {
            var ne = card.querySelector('.DeviceItem_deviceName__yC1tT');
            if (ne) lastContextPc = ne.textContent.trim();
        }
    });


    // --- Кнопка "Сбросить подсветки" ---
    function createResetButton() {
        var wrap = document.createElement('a');
        wrap.id = 'godji-reset-btn';
        wrap.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        wrap.href = 'javascript:void(0)';
        wrap.style.cssText = [
            'position:fixed',
            'bottom:310px',
            'left:0',
            'z-index:150',
            'display:flex',
            'align-items:center',
            'gap:12px',
            'width:280px',
            'height:46px',
            'padding:8px 12px 8px 18px',
            'cursor:pointer',
            'user-select:none',
            'font-family:inherit',
            'box-sizing:border-box',
            'text-decoration:none',
        ].join(';');

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = [
            'width:32px',
            'height:32px',
            'border-radius:8px',
            'background:#cc0001',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'flex-shrink:0',
            'color:#ffffff',
        ].join(';');
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"></path><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"></path><path d="M10 12l4 4m0 -4l-4 4"></path></svg>';

        var label = document.createElement('span');
        label.className = 'godji-reset-label';
        label.textContent = '\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0438';
        label.style.cssText = [
            'font-size:14px',
            'font-weight:600',
            'color:#ffffff',
            'white-space:nowrap',
            'letter-spacing:0.1px',
        ].join(';');

        wrap.appendChild(iconWrap);
        wrap.appendChild(label);
        document.body.appendChild(wrap);

        wrap.addEventListener('click', function() {
            // Сбрасываем localStorage
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STATE_KEY);

            // Снимаем стили с карточек
            // Сбрасываем gm-card таймеры
            document.querySelectorAll('.gm-card').forEach(function(c) {
                c.style.outline = ''; c.style.outlineOffset = ''; c.style.boxShadow = '';
                var gmT = c.querySelector('.gm-timer');
                if (gmT) { gmT.textContent = ''; gmT.style.color = ''; gmT.style.display = 'none'; }
                var gmN = c.querySelector('.gm-nick');
                if (gmN) gmN.style.display = '';
                var gmP = c.querySelector('.gm-pbw');
                if (gmP) gmP.style.display = '';
            });
            var cards = document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
            for (var i = 0; i < cards.length; i++) {
                cards[i].style.outline = '';
                cards[i].style.outlineOffset = '';
                cards[i].style.boxShadow = '';
                var tb = cards[i].querySelector('.' + TIMER_BOTTOM_CLASS); if (tb) tb.remove();
                var ti = cards[i].querySelector('.' + TIMER_INLINE_CLASS); if (ti) ti.remove();
                var wrapper = cards[i].querySelector('.godji-name-wrapper');
                if (wrapper) {
                    var nameEl = wrapper.querySelector('.DeviceItem_deviceName__yC1tT');
                    if (nameEl) wrapper.parentNode.insertBefore(nameEl, wrapper);
                    wrapper.remove();
                }
            }

            // Снимаем стили со строк таблицы
            var rows = document.querySelectorAll('tr.mantine-Table-tr');
            for (var j = 0; j < rows.length; j++) {
                rows[j].style.backgroundColor = '';
                var fs = rows[j].querySelector('.godji-fake-status'); if (fs) fs.remove();
                var os = rows[j].querySelector('td[style*="col-sessionStatus-size"] .mantine-Flex-root'); if (os) os.style.display = '';
                var ft = rows[j].querySelector('.godji-fake-time'); if (ft) ft.remove();
                var ot = rows[j].querySelector('td[style*="col-sessionLeftTime-size"] .mantine-Flex-root'); if (ot) ot.style.display = '';
                var fst = rows[j].querySelector('.godji-fake-start'); if (fst) fst.remove();
                var ost = rows[j].querySelector('td[style*="col-sessionStart-size"] .mantine-Flex-root'); if (ost) ost.style.display = '';
            }

            // Сбрасываем state
            state = {};
            initialized = false;

            // Визуальный фидбек
            var lbl = wrap.querySelector('.godji-reset-label');
            if (lbl) {
                lbl.textContent = '\u0421\u0431\u0440\u043e\u0448\u0435\u043d\u043e!';
                setTimeout(function() { lbl.textContent = '\u0421\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u043f\u043e\u0434\u0441\u0432\u0435\u0442\u043a\u0438'; }, 2000);
            }

            // Реинициализация
            setTimeout(tryInit, 500);
        });
    }

    setTimeout(tryInit, 5000);
    setInterval(scan, 2000);
    createResetButton();

})();

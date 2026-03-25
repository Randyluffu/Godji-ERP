// ==UserScript==
// @name         Годжи — Мультивыбор ПК
// @namespace    http://tampermonkey.net/
// @version      5.7
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_multi_select.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_multi_select.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    // --- Токен ---
    var _origFetch = window.fetch;
    var _authToken = null;
    var _hasuraRole = 'club_admin';

    window.fetch = function(url, options) {
        if (options && options.headers && options.headers.authorization) {
            _authToken = options.headers.authorization;
            _hasuraRole = options.headers['x-hasura-role'] || 'club_admin';
        }
        return _origFetch.apply(this, arguments);
    };

    function getToken() { return _authToken || window._godjiAuthToken; }
    function getRole()  { return _hasuraRole || window._godjiHasuraRole || 'club_admin'; }

    function getHeaders() {
        var t = getToken();
        if (!t) return null;
        return { 'authorization': t, 'content-type': 'application/json', 'x-hasura-role': getRole() };
    }

    // --- Выделение ---
    var selected = {}; // { deviceId: pcName }

    function getDeviceId(card) {
        var c = card.closest('.DeviceItem_deviceContainer__jCrmD');
        return c ? c.getAttribute('data-device-id') : null;
    }
    function getPcName(card) {
        var el = card.querySelector('.DeviceItem_deviceName__yC1tT');
        return el ? el.textContent.trim() : null;
    }
    function selectedCount() { return Object.keys(selected).length; }

    function setCardStyle(card, on) {
        card.style.outline = on ? '3px solid rgba(99,102,241,0.9)' : '';
        card.style.outlineOffset = on ? '2px' : '';
        // Для gm-card дополнительно
        if (card.classList && card.classList.contains('gm-card')) {
            card.style.boxShadow = on ? '0 0 0 4px rgba(99,102,241,0.3)' : '';
        }
    }

    function setRowStyle(row, on) {
        row.style.outline = on ? '2px solid rgba(99,102,241,0.8)' : '';
        row.style.outlineOffset = on ? '-1px' : '';
        row.style.backgroundColor = on ? 'rgba(99,102,241,0.10)' : '';
    }

    // Находим deviceId по имени ПК через карточку на карте
    function getDeviceIdByName(pcName) {
        var cards = document.querySelectorAll('.DeviceItem_deviceContainer__jCrmD');
        for (var i = 0; i < cards.length; i++) {
            var nameEl = cards[i].querySelector('.DeviceItem_deviceName__yC1tT');
            if (nameEl && nameEl.textContent.trim() === pcName) {
                return cards[i].getAttribute('data-device-id');
            }
        }
        return null;
    }

    // Находим карточку на карте по deviceId
    function findCardByDeviceId(deviceId) {
        var container = document.querySelector('.DeviceItem_deviceContainer__jCrmD[data-device-id="' + deviceId + '"]');
        return container ? container.querySelector('.DeviceItem_deviceBox__pzNUf') : null;
    }

    // Находим строку таблицы по имени ПК
    function findRowByName(pcName) {
        var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
        for (var i = 0; i < rows.length; i++) {
            var cell = rows[i].querySelector('td[data-index="0"]');
            if (cell && cell.textContent.trim() === pcName) return rows[i];
        }
        return null;
    }

    function toggle(card) {
        var id = getDeviceId(card), name = getPcName(card);
        if (!id || !name) return;
        if (selected[id]) {
            delete selected[id];
            setCardStyle(card, false);
            var row = findRowByName(name);
            if (row) setRowStyle(row, false);
        } else {
            selected[id] = name;
            setCardStyle(card, true);
            var row2 = findRowByName(name);
            if (row2) setRowStyle(row2, true);
        }
        window._godjiSelected = selected;
        updateCounter();
    }

    function toggleRow(row) {
        var cell = row.querySelector('td[data-index="0"]');
        if (!cell) return;
        var pcName = cell.textContent.trim();
        var deviceId = getDeviceIdByName(pcName);
        // Если deviceId не найден — используем имя как ключ
        var key = deviceId || ('name_' + pcName);
        if (selected[key]) {
            delete selected[key];
            setRowStyle(row, false);
            var card = deviceId ? findCardByDeviceId(deviceId) : null;
            if (card) setCardStyle(card, false);
        } else {
            selected[key] = pcName;
            setRowStyle(row, true);
            var card2 = deviceId ? findCardByDeviceId(deviceId) : null;
            if (card2) setCardStyle(card2, true);
        }
        window._godjiSelected = selected;
        updateCounter();
    }

    function clearAll() {
        Object.keys(selected).forEach(function(k) { delete selected[k]; });
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf, .gm-card').forEach(function(c) { setCardStyle(c, false); });
        document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(r) { setRowStyle(r, false); });
        updateCounter();
    }

    // --- Получаем цвета из godji_menu_colors ---
    function getColor(name, fallback) {
        var colors = window._godjiMenuColors;
        if (colors && colors[name]) return colors[name].color;
        return fallback;
    }
    function getBg(name, fallback) {
        var colors = window._godjiMenuColors;
        if (colors && colors[name]) return colors[name].bg;
        return fallback;
    }

    // --- Получение данных сессий на лету ---
    async function fetchSessionsForSelected() {
        var h = getHeaders();
        if (!h) return {};
        var clubId = parseInt((document.cookie.match(/clubId=(\d+)/) || [])[1] || '14');
        try {
            var res = await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                method: 'POST', headers: h,
                body: JSON.stringify({
                    query: 'query GetDashboardDevicesForScript($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name sessions { id status tariff { id name } user { nickname wallet { id } } } } } }',
                    variables: { clubId: clubId },
                }),
            });
            var data = await res.json();
            var devices = data.data && data.data.getDashboardDevices && data.data.getDashboardDevices.devices;
            if (!devices) return {};
            var result = {};
            devices.forEach(function(d) {
                if (d.sessions && d.sessions.length > 0) {
                    d.sessions.forEach(function(s) {
                        if (s && s.user && s.user.wallet && s.id) {
                            result[d.name] = {
                                sessionId: s.id,
                                tariffId: s.tariff ? s.tariff.id : null,
                                walletId: s.user.wallet.id,
                                pcName: d.name,
                            };
                        }
                    });
                }
            });
            return result;
        } catch(e) { return {}; }
    }

    // --- GraphQL ---
    var MUTATIONS = {
        DevicePowerOn:          'mutation DevicePowerOn($deviceId: Int!) { devicePowerOn(params: {deviceId: $deviceId}) { success } }',
        DevicePowerOff:         'mutation DevicePowerOff($deviceId: Int!) { devicePowerOff(params: {deviceId: $deviceId}) { success } }',
        DeviceReboot:           'mutation DeviceReboot($deviceId: Int!) { deviceReboot(params: {deviceId: $deviceId}) { success } }',
        DeviceProtectionOn:     'mutation DeviceProtectionOn($deviceId: Int!) { deviceProtectionOn(params: {deviceId: $deviceId}) { success } }',
        DeviceProtectionOff:    'mutation DeviceProtectionOff($deviceId: Int!) { deviceProtectionOff(params: {deviceId: $deviceId}) { success } }',
        UserReservationCancel:  'mutation UserReservationCancel($sessionId: Int!) { userReservationCancel(params: {sessionId: $sessionId}) { success } }',
    };

    async function gql(op, variables) {
        var h = getHeaders();
        if (!h) return null;
        try {
            var r = await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                method: 'POST', headers: h,
                body: JSON.stringify({ operationName: op, variables: variables, query: MUTATIONS[op] }),
            });
            return await r.json();
        } catch(e) { return null; }
    }

    async function runForAll(op) {
        // Снимаем снапшот selected ДО closeMenu — чтобы не потерять данные
        var snapshot = {};
        Object.keys(selected).forEach(function(k) { snapshot[k] = selected[k]; });
        var ids = Object.keys(snapshot);

        closeMenu();

        if (!ids.length) return;
        if (!getToken()) { alert('Нет авторизации. Обновите страницу.'); return; }

        // Для завершения сеансов — загружаем актуальные данные
        if (op === 'UserReservationCancel' && !Object.keys(window._godjiSessionsData || {}).length) {
            showToast('Загрузка данных сессий...');
            window._godjiSessionsData = await fetchSessionsForSelected();
        }

        var labels = {
            DevicePowerOn: 'Включение', DevicePowerOff: 'Выключение', DeviceReboot: 'Перезагрузка',
            DeviceProtectionOn: 'Защита вкл', DeviceProtectionOff: 'Защита выкл',
            UserReservationCancel: 'Завершение сеансов',
        };
        showToast('Выполняется: ' + labels[op] + ' для ' + ids.length + ' ПК...');

        for (var i = 0; i < ids.length; i++) {
            var deviceId = parseInt(ids[i]);
            var pcName = snapshot[ids[i]];
            var vars;

            if (op === 'UserReservationCancel') {
                var sessions2 = window._godjiSessionsData || {};
                var s = sessions2[pcName];
                if (!s || !s.sessionId) continue;
                vars = { sessionId: parseInt(s.sessionId) };
            } else {
                vars = { deviceId: deviceId };
            }

            await gql(op, vars);
            if (i < ids.length - 1) await new Promise(function(r) { setTimeout(r, 150); });
        }

        showToast(labels[op] + ' ✓ для ' + ids.length + ' ПК');
        clearAll();
    }

    // --- Бесплатное время ---
    function showFreeTimeModal() {
        closeMenu();
        var ids = Object.keys(selected);
        if (!ids.length) return;

        var overlay = document.createElement('div');
        overlay.id = 'godji-multi-ft-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;background:rgba(0,0,0,0.5);';

        var modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:420px;max-width:95vw;background:#ffffff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-family:inherit;overflow:hidden;';
        modal.addEventListener('click', function(e) { e.stopPropagation(); });

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 4px;';
        var title = document.createElement('div');
        title.style.cssText = 'font-size:18px;font-weight:600;color:#1a1a1a;';
        title.textContent = 'Бесплатное время';
        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#999;font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Подзаголовок
        var subtitle = document.createElement('div');
        subtitle.style.cssText = 'padding:2px 24px 16px;font-size:13px;color:#666;';
        subtitle.textContent = 'Выделено ПК: ' + ids.length + '. Бонусы начислятся по поминутному тарифу.';

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:0 24px 24px;';

        // Минуты
        var mLabel = document.createElement('div');
        mLabel.style.cssText = 'font-size:13px;font-weight:500;color:#1a1a1a;margin-bottom:6px;';
        mLabel.innerHTML = 'Количество минут <span style="color:#cc0001;">*</span>';
        var mInput = document.createElement('input');
        mInput.type = 'number'; mInput.min = '1'; mInput.max = '480'; mInput.value = '15';
        mInput.style.cssText = 'width:100%;padding:10px 12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;color:#1a1a1a;font-size:15px;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color 0.2s;';
        mInput.addEventListener('focus', function() { mInput.style.borderColor = '#cc0001'; });
        mInput.addEventListener('blur', function() { mInput.style.borderColor = '#e0e0e0'; });

        // Комментарий
        var cLabel = document.createElement('div');
        cLabel.style.cssText = 'font-size:13px;font-weight:500;color:#1a1a1a;margin-top:14px;margin-bottom:6px;';
        cLabel.textContent = 'Комментарий';
        var cInput = document.createElement('textarea');
        cInput.placeholder = 'Бесплатное время';
        cInput.style.cssText = 'width:100%;padding:10px 12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;color:#1a1a1a;font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;resize:vertical;min-height:60px;transition:border-color 0.2s;';
        cInput.addEventListener('focus', function() { cInput.style.borderColor = '#cc0001'; });
        cInput.addEventListener('blur', function() { cInput.style.borderColor = '#e0e0e0'; });

        // Кнопки
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px;';
        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'flex:1;padding:11px;background:#fff;color:#1a1a1a;border:1px solid #e0e0e0;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('click', function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); });
        var confirmBtn = document.createElement('button');
        confirmBtn.style.cssText = 'flex:1;padding:11px;background:#cc0001;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;';
        confirmBtn.textContent = 'Начислить';
        confirmBtn.addEventListener('click', async function() {
            var minutes = parseInt(mInput.value);
            if (!minutes || minutes < 1) return;
            var comment = cInput.value.trim() || 'Бесплатное время';
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            await addFreeTimeForAll(minutes, comment);
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        body.appendChild(mLabel); body.appendChild(mInput);
        body.appendChild(cLabel); body.appendChild(cInput);
        body.appendChild(btnRow);
        modal.appendChild(header); modal.appendChild(subtitle); modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); });
    }

    async function addFreeTimeForAll(minutes, comment) {
        var ids = Object.keys(selected);
        comment = comment || 'Бесплатное время';
        showToast('Загрузка данных сессий...');

        // Получаем актуальные данные сессий прямо сейчас
        var sessions = window._godjiSessionsData || {};
        if (!Object.keys(sessions).length) {
            sessions = await fetchSessionsForSelected();
        }
        showToast('Добавление ' + minutes + ' мин для ' + ids.length + ' ПК...');

        for (var i = 0; i < ids.length; i++) {
            var pcName = selected[ids[i]];
            var s = sessions[pcName];
            if (!s || !s.sessionId || !s.walletId) continue;

            var h = getHeaders();
            if (!h) continue;

            try {
                // 1. Получаем тарифы (точный query из godji_free_time)
                var tariffRes = await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                    method: 'POST', headers: h,
                    body: JSON.stringify({
                        query: 'query availableTariffsForProlongation($minutes: Int, $sessionId: Int!) { getAvailableTariffsForProlongation(params: {minutes: $minutes, sessionId: $sessionId}) { tariffs { id name durationMin cost } } }',
                        variables: { sessionId: s.sessionId, minutes: 1 },
                    }),
                });
                var tariffData = await tariffRes.json();
                var tariffs = tariffData.data && tariffData.data.getAvailableTariffsForProlongation && tariffData.data.getAvailableTariffsForProlongation.tariffs;
                if (!tariffs || !tariffs.length) continue;

                // Берём поминутный тариф (наименьший durationMin)
                var tariff = tariffs.slice().sort(function(a, b) { return a.durationMin - b.durationMin; })[0];
                var costPerMin = tariff.cost / tariff.durationMin;
                var totalCost = Math.round(costPerMin * minutes * 100) / 100;

                // 2. Начисляем бонусы (точный query из godji_free_time)
                await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                    method: 'POST', headers: h,
                    body: JSON.stringify({
                        query: 'mutation DepositBalanceWithBonus($amount: Float!, $walletId: Int!, $comment: String) { walletDepositWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) { operationId __typename } }',
                        variables: { amount: totalCost, walletId: s.walletId, comment: comment },
                    }),
                });

                // 3. Продлеваем сеанс (точный query из godji_free_time)
                await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                    method: 'POST', headers: h,
                    body: JSON.stringify({
                        query: 'mutation prolongateSession($sessionId: Int!, $tariffId: Int!, $minutes: Int) { userReservationProlongate(params: {sessionId: $sessionId, tariffId: $tariffId, minutes: $minutes}) { success __typename } }',
                        variables: { sessionId: s.sessionId, tariffId: tariff.id, minutes: minutes },
                    }),
                });

            } catch(e) {}

            if (i < ids.length - 1) await new Promise(function(r) { setTimeout(r, 300); });
        }

        showToast('Бесплатное время +' + minutes + ' мин ✓ для ' + ids.length + ' ПК');
        clearAll();
    }

    // --- Убрать подсветку ---
    function clearHighlights() {
        var snapshot = {};
        Object.keys(selected).forEach(function(k) { snapshot[k] = selected[k]; });
        closeMenu();
        var pcs = {};
        try { pcs = JSON.parse(localStorage.getItem('godji_cleanup_pcs') || '{}'); } catch(e) {}
        var ids = Object.keys(snapshot);
        var count = 0;
        ids.forEach(function(id) {
            var name = snapshot[id];
            if (pcs[name]) { delete pcs[name]; count++; }
        });
        localStorage.setItem('godji_cleanup_pcs', JSON.stringify(pcs));
        if (window._godjiApplyHighlights) window._godjiApplyHighlights();
        showToast('Подсветка снята для ' + count + ' ПК');
        clearAll();
    }

    // --- Меню ---
    var _menu = null;

    function closeMenu() {
        if (_menu && _menu.parentNode) _menu.parentNode.removeChild(_menu);
        _menu = null;
        if (_hlWatcher) { _hlWatcher.disconnect(); _hlWatcher = null; }
    }

    function makeMenuItem(text, svgPaths, color, onClick, bgColor, hoverColor, useEmoji) {
        var btn = document.createElement('button');
        btn.className = 'mantine-focus-auto m_99ac2aa1 mantine-Menu-item m_87cf2631 mantine-UnstyledButton-root';
        btn.setAttribute('type', 'button');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-menu-item', 'true');
        btn.setAttribute('data-mantine-stop-propagation', 'true');
        var bg    = bgColor    || 'transparent';
        var hover = hoverColor || bg;
        btn.style.cssText = 'color:' + color + ';background-color:' + bg + ';--menu-item-color:' + color + ';--menu-item-hover:' + hover + ';';

        var iconWrap = document.createElement('div');
        iconWrap.className = 'm_8b75e504 mantine-Menu-itemSection';
        iconWrap.setAttribute('data-position', 'left');

        if (useEmoji) {
            // Убрать подсветку — эмодзи как в оригинале
            iconWrap.innerHTML = '<span style="font-size:15px">🟣</span>';
        } else {
            iconWrap.innerHTML = '<div class="" style="align-items: center; justify-content: center; width: calc(1.25rem * var(--mantine-scale)); display: flex;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="stroke: ' + color + ';">' + svgPaths + '</svg></div>';
        }

        var labelEl = document.createElement('div');
        labelEl.className = 'm_5476e0d3 mantine-Menu-itemLabel';
        labelEl.textContent = text;

        btn.appendChild(iconWrap);
        btn.appendChild(labelEl);

        btn.addEventListener('mouseenter', function() { btn.style.backgroundColor = hover; });
        btn.addEventListener('mouseleave', function() { btn.style.backgroundColor = bg; });
        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });

        return btn;
    }

    function makeDivider() {
        var d = document.createElement('div');
        d.className = 'm_efdf90cb mantine-Menu-divider';
        return d;
    }

    // Наблюдатель за кнопкой подсветки от cleanup_alert
    var _hlWatcher = null;
    function watchAndKillHlBtn() {
        if (_hlWatcher) _hlWatcher.disconnect();
        _hlWatcher = new MutationObserver(function() {
            var btn = document.getElementById('godji-clear-highlight-btn');
            if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        });
        _hlWatcher.observe(document.body, { childList: true, subtree: true });
        // Останавливаем наблюдение когда наше меню закрывается
        setTimeout(function() {
            if (_hlWatcher) { _hlWatcher.disconnect(); _hlWatcher = null; }
        }, 5000);
    }

    function openMenu(x, y) {
        closeMenu();
        // Убиваем кнопку cleanup_alert синхронно
        var hlBtn = document.getElementById('godji-clear-highlight-btn');
        if (hlBtn && hlBtn.parentNode) hlBtn.parentNode.removeChild(hlBtn);
        // Убиваем стандартное меню CRM
        document.querySelectorAll('[data-menu-dropdown="true"]').forEach(function(el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        // Следим чтобы кнопка не появилась снова
        watchAndKillHlBtn();

        var sessions = window._godjiSessionsData || {};
        // Проверяем наличие активных сеансов двумя способами
        var hasActive = Object.keys(selected).some(function(id) {
            var pcName = selected[id];
            // Способ 1: через _godjiSessionsData
            if (sessions[pcName]) return true;
            // Способ 2: через таблицу — ищем строку с этим ПК и смотрим статус
            var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
            for (var ri = 0; ri < rows.length; ri++) {
                var cell = rows[ri].querySelector('td[data-index="0"]');
                if (cell && cell.textContent.trim() === pcName) {
                    var statusCell = rows[ri].querySelector('td[data-index="8"] .mantine-Badge-label');
                    if (statusCell && statusCell.textContent.trim() !== '—') return true;
                }
            }
            return false;
        });
        var hasHighlight = (function() {
            try {
                var pcs = JSON.parse(localStorage.getItem('godji_cleanup_pcs') || '{}');
                if (!Object.keys(pcs).length) return false;
                return Object.keys(selected).some(function(id) {
                    return pcs.hasOwnProperty(selected[id]);
                });
            } catch(e) { return false; }
        })();

        var menu = document.createElement('div');
        menu.id = 'godji-multi-menu';
        menu.className = 'm_38a85659 mantine-Menu-dropdown m_dc9b7c9f';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('data-menu-dropdown', 'true');
        menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:9999;width:calc(15rem * var(--mantine-scale));';

        // Лейбл
        var lbl = document.createElement('div');
        lbl.className = 'm_9bfac126 mantine-Menu-label';
        lbl.textContent = 'Выделено: ' + selectedCount() + ' ПК';
        menu.appendChild(lbl);

        // Подсветка — сверху как в оригинале (скрипт cleanup добавляет её первой)
        if (hasHighlight) {
            menu.appendChild(makeMenuItem('Убрать подсветку', '', getColor('Убрать подсветку', '#6a1b9a'), clearHighlights, getBg('Убрать подсветку', 'rgba(106,27,154,0.10)'), getBg('Убрать подсветку', 'rgba(106,27,154,0.18)'), true));
            menu.appendChild(makeDivider());
        }

        // Электропитание
        var lblPower = document.createElement('div');
        lblPower.className = 'm_9bfac126 mantine-Menu-label';
        lblPower.textContent = 'Электропитание';
        menu.appendChild(lblPower);
        // Включить — точная иконка из оригинала tabler-icon-power
        menu.appendChild(makeMenuItem('Включить',
            '<path d="M7 6a7.75 7.75 0 1 0 10 0"></path><path d="M12 4l0 8"></path>',
            getColor('Включить', '#ffffff'),
            function() { runForAll('DevicePowerOn'); },
            getBg('Включить', 'rgba(27,94,32,0.82)'),
            getBg('Включить', 'rgba(27,94,32,0.70)')));
        menu.appendChild(makeMenuItem('Выключить',
            '<path d="M7 6a7.75 7.75 0 1 0 10 0"></path><path d="M12 4l0 8"></path>',
            getColor('Выключить', '#ffffff'),
            function() { runForAll('DevicePowerOff'); },
            getBg('Выключить', 'rgba(127,0,0,0.82)'),
            getBg('Выключить', 'rgba(127,0,0,0.70)')));
        menu.appendChild(makeMenuItem('Перезагрузить',
            '<path d="M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747"></path><path d="M20 4v5h-5"></path>',
            getColor('Перезагрузить', '#bf360c'),
            function() { runForAll('DeviceReboot'); },
            getBg('Перезагрузить', 'rgba(191,54,12,0.12)'),
            getBg('Перезагрузить', 'rgba(191,54,12,0.20)')));

        menu.appendChild(makeDivider());

        // Защита — иконки shield-check и shield
        var lblProtect = document.createElement('div');
        lblProtect.className = 'm_9bfac126 mantine-Menu-label';
        lblProtect.textContent = 'Защита';
        menu.appendChild(lblProtect);
        menu.appendChild(makeMenuItem('Активировать защиту',
            '<path d="M11.5 21h-4.5a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v.5"></path><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"></path><path d="M8 11v-4a4 4 0 1 1 8 0v4"></path><path d="M15 19l2 2l4 -4"></path>',
            getColor('Активировать защиту', '#283593'),
            function() { runForAll('DeviceProtectionOn'); },
            getBg('Активировать защиту', 'rgba(40,53,147,0.10)'),
            getBg('Активировать защиту', 'rgba(40,53,147,0.18)')));
        menu.appendChild(makeMenuItem('Снять защиту',
            '<path d="M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"></path><path d="M12 16m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"></path><path d="M8 11v-5a4 4 0 0 1 8 0"></path>',
            getColor('Снять защиту', '#283593'),
            function() { runForAll('DeviceProtectionOff'); },
            getBg('Снять защиту', 'rgba(40,53,147,0.07)'),
            getBg('Снять защиту', 'rgba(40,53,147,0.15)')));

        menu.appendChild(makeDivider());

        // Сеанс
        var lblSession = document.createElement('div');
        lblSession.className = 'm_9bfac126 mantine-Menu-label';
        lblSession.textContent = 'Сеанс';
        menu.appendChild(lblSession);
        // Бесплатное время — tabler-icon-clock-plus
        if (hasActive) {
            menu.appendChild(makeMenuItem('Добавить бесплатное время',
                '<path d="M20.942 13.021a9 9 0 1 0 -9.909 7.954"></path><path d="M12 7v5l3 3"></path><path d="M16 19h6"></path><path d="M19 16v6"></path>',
                getColor('Добавить бесплатное время', '#33691e'),
                showFreeTimeModal,
                getBg('Добавить бесплатное время', 'rgba(51,105,30,0.07)'),
                getBg('Добавить бесплатное время', 'rgba(51,105,30,0.14)')));
        }

        if (hasActive) {
            menu.appendChild(makeMenuItem('Завершить сеансы',
                '<path d="M4 4m0 1a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"></path><path d="M4 8h16"></path><path d="M8 4v4"></path><path d="M10 16l4 -4"></path><path d="M14 16l-4 -4"></path>',
                getColor('Завершить сессию', '#b71c1c'),
                function() { runForAll('UserReservationCancel'); },
                getBg('Завершить сессию', 'rgba(183,28,28,0.10)'),
                getBg('Завершить сессию', 'rgba(183,28,28,0.18)')));
        }

        document.body.appendChild(menu);
        _menu = menu;

        // Не вылезать за экран + скролл если меню длиннее экрана
        var r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth)  menu.style.left = Math.max(0, x - r.width) + 'px';

        var maxH = window.innerHeight - 16;
        if (r.height > maxH) {
            menu.style.maxHeight = maxH + 'px';
            menu.style.overflowY = 'auto';
            menu.style.overflowX = 'hidden';
            menu.style.top = '8px';
        } else if (r.bottom > window.innerHeight) {
            menu.style.top = Math.max(8, y - r.height) + 'px';
        }
    }

    // --- События ---
    document.addEventListener('click', function(e) {
        if (!e.ctrlKey && !e.metaKey) {
            if (_menu && !_menu.contains(e.target)) closeMenu();
            return;
        }

        // Ctrl+клик по нашей gm-card
        var gmCard = e.target.closest('.gm-card[data-pc]');
        if (gmCard) {
            e.preventDefault();
            e.stopPropagation();
            var pcName = gmCard.getAttribute('data-pc');
            // Ищем deviceId через оригинальную карточку
            var deviceId = getDeviceIdByName(pcName) || ('gm_' + pcName);
            if (selected[deviceId]) {
                delete selected[deviceId];
                setCardStyle(gmCard, false);
                var row = findRowByName(pcName);
                if (row) setRowStyle(row, false);
            } else {
                selected[deviceId] = pcName;
                setCardStyle(gmCard, true);
                var row2 = findRowByName(pcName);
                if (row2) setRowStyle(row2, true);
            }
            window._godjiSelected = selected;
            updateCounter();
            return;
        }
        // Ctrl+клик по карточке на карте
        var card = e.target.closest('.DeviceItem_deviceBox__pzNUf');
        if (card) {
            e.preventDefault();
            e.stopPropagation();
            toggle(card);
            return;
        }

        // Ctrl+клик по строке таблицы
        var row = e.target.closest('tr.mantine-Table-tr[data-index]');
        if (row) {
            e.preventDefault();
            e.stopPropagation();
            toggleRow(row);
            return;
        }
    }, true);

    document.addEventListener('contextmenu', function(e) {
        // Если есть выделенные ПК — наше меню появляется в любом месте
        if (selectedCount() > 0) {
            // Не показываем наше меню внутри самого нашего меню
            if (_menu && _menu.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // блокируем все остальные обработчики
            openMenu(e.clientX, e.clientY);

            return;
        }
        // Нет выделенных — стандартное меню CRM
        if (_menu) closeMenu();
    }, true);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { if (_menu) closeMenu(); else clearAll(); }
    });

    // --- Счётчик ---
    function createCounter() {
        if (document.getElementById('godji-multi-counter')) return;
        var el = document.createElement('div');
        el.id = 'godji-multi-counter';
        el.style.cssText = [
            'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
            'display:none', 'align-items:center', 'gap:8px', 'padding:6px 14px',
            'background:var(--mantine-color-body)',
            'border:1px solid rgba(99,102,241,0.5)',
            'border-radius:var(--mantine-radius-md)',
            'box-shadow:var(--mantine-shadow-sm)',
            'z-index:9998', 'font-family:inherit', 'font-size:13px',
            'color:var(--mantine-color-text)', 'font-weight:500', 'white-space:nowrap',
        ].join(';');

        var txt = document.createElement('span');
        txt.id = 'godji-multi-counter-text';

        var btn = document.createElement('button');
        btn.textContent = '✕';
        btn.style.cssText = 'border:none;background:none;cursor:pointer;color:var(--mantine-color-dimmed);font-size:14px;padding:0 2px;';
        btn.addEventListener('click', clearAll);

        el.appendChild(txt);
        el.appendChild(btn);
        document.body.appendChild(el);
    }

    function updateCounter() {
        var el = document.getElementById('godji-multi-counter');
        if (!el) return;
        var count = selectedCount();
        var txt = document.getElementById('godji-multi-counter-text');
        if (txt) txt.textContent = 'Выделено: ' + count + ' ПК — ПКМ для команд';
        el.style.display = count > 0 ? 'flex' : 'none';
    }

    function showToast(msg) {
        var old = document.getElementById('godji-multi-toast');
        if (old && old.parentNode) old.parentNode.removeChild(old);
        var t = document.createElement('div');
        t.id = 'godji-multi-toast';
        t.textContent = msg;
        t.style.cssText = [
            'position:fixed', 'bottom:70px', 'left:50%', 'transform:translateX(-50%)',
            'background:rgba(30,30,30,0.92)', 'color:#fff', 'padding:8px 18px',
            'border-radius:var(--mantine-radius-sm)', 'font-size:13px',
            'font-family:inherit', 'font-weight:500', 'z-index:99999',
            'box-shadow:0 4px 12px rgba(0,0,0,0.2)', 'transition:opacity 0.3s', 'white-space:nowrap',
        ].join(';');
        document.body.appendChild(t);
        setTimeout(function() { t.style.opacity = '0'; }, 2500);
        setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 2900);
    }

    function init() { createCounter(); }

    if (document.body) { init(); }
    else { document.addEventListener('DOMContentLoaded', init); }

})();

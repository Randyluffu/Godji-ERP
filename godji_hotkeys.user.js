// ==UserScript==
// @name         Годжи — Горячие клавиши
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_hotkeys.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_hotkeys.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Перехватываем токен авторизации
    var _tok = null, _role = 'club_admin', _oF = window.fetch;
    window.fetch = function(url, opts) {
        if (opts && opts.headers && opts.headers.authorization) {
            _tok = opts.headers.authorization;
            _role = opts.headers['x-hasura-role'] || 'club_admin';
            window._godjiAuthToken = _tok;
            window._godjiHasuraRole = _role;
        }
        return _oF.apply(this, arguments);
    };

    function hdrs() {
        var t = _tok || window._godjiAuthToken;
        if (!t) return null;
        return { 'authorization': t, 'content-type': 'application/json', 'x-hasura-role': _role || 'club_admin' };
    }

    async function gql(op, query, vars) {
        var h = hdrs(); if (!h) return null;
        try {
            var r = await _oF('https://hasura.godji.cloud/v1/graphql', {
                method: 'POST', headers: h,
                body: JSON.stringify({ operationName: op, query: query, variables: vars })
            });
            return await r.json();
        } catch(e) { return null; }
    }

    // Работаем только на дашборде
    function onDashboard() {
        return window.location.pathname === '/' || window.location.pathname === '';
    }

    // ─── UI хелперы ───────────────────────────────────────────────────────────

    function showToast(msg, type) {
        var old = document.getElementById('godji-hk-toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.id = 'godji-hk-toast';
        var bg = type === 'error' ? 'rgba(183,28,28,0.95)' :
                 type === 'ok'    ? 'rgba(27,94,32,0.95)'  : 'rgba(30,30,30,0.92)';
        t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + bg + ';color:#fff;padding:8px 18px;border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-family:var(--mantine-font-family,inherit);font-weight:500;z-index:999999;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
    }

    function showConfirm(title, body, onConfirm) {
        var old = document.getElementById('godji-hk-confirm');
        if (old) old.remove();
        var overlay = document.createElement('div');
        overlay.id = 'godji-hk-confirm';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';
        var box = document.createElement('div');
        box.style.cssText = 'background:var(--mantine-color-body,#1a1b1e);border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));border-radius:var(--mantine-radius-md,8px);width:min(400px,calc(100vw - 32px));font-family:var(--mantine-font-family,inherit);box-shadow:0 16px 48px rgba(0,0,0,0.6);overflow:hidden;';
        var hdr = document.createElement('div');
        hdr.style.cssText = 'padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));';
        hdr.innerHTML = '<div style="font-size:15px;font-weight:700;color:var(--mantine-color-text,#c1c2c5);">' + title + '</div>';
        var content = document.createElement('div');
        content.style.cssText = 'padding:14px 20px;font-size:13px;color:var(--mantine-color-dimmed,#868e96);line-height:1.5;';
        content.innerHTML = body;
        var footer = document.createElement('div');
        footer.style.cssText = 'padding:12px 20px 16px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));';
        var cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отмена';
        cancelBtn.style.cssText = 'padding:8px 16px;background:var(--mantine-color-dark-5,rgba(255,255,255,0.08));color:var(--mantine-color-text,#c1c2c5);border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.12));border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-weight:500;cursor:pointer;';
        cancelBtn.onclick = function() { overlay.remove(); };
        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Подтвердить';
        confirmBtn.style.cssText = 'padding:8px 16px;background:#cc0001;color:#fff;border:none;border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-weight:600;cursor:pointer;';
        confirmBtn.onclick = function() { overlay.remove(); onConfirm(); };
        footer.appendChild(cancelBtn); footer.appendChild(confirmBtn);
        box.appendChild(hdr); box.appendChild(content); box.appendChild(footer);
        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });
        document.body.appendChild(overlay);
        confirmBtn.focus();
    }

    // ─── API действия (без открытия меню) ────────────────────────────────────

    // Ctrl+D — Пополнить наличными напрямую через API
    async function actionDeposit() {
        var pc = window._godjiSelectedPc;
        if (!pc) { showToast('Выберите ПК кликом на карточку или строку', 'error'); return; }
        var sd = window._godjiSessionsData && window._godjiSessionsData[pc];
        if (!sd || !sd.walletId) { showToast('Нет активной сессии на ПК ' + pc, 'error'); return; }

        var old = document.getElementById('godji-hk-deposit');
        if (old) old.remove();

        var overlay = document.createElement('div');
        overlay.id = 'godji-hk-deposit';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';

        var box = document.createElement('div');
        box.style.cssText = 'background:var(--mantine-color-body,#1a1b1e);border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));border-radius:var(--mantine-radius-md,8px);width:min(360px,calc(100vw - 32px));font-family:var(--mantine-font-family,inherit);box-shadow:0 16px 48px rgba(0,0,0,0.6);overflow:hidden;';

        var hdr = document.createElement('div');
        hdr.style.cssText = 'padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;';
        hdr.innerHTML = '<div style="font-size:15px;font-weight:700;color:var(--mantine-color-text,#c1c2c5);">Пополнить наличными · ПК ' + pc + '</div>';
        var cls = document.createElement('button');
        cls.textContent = '×'; cls.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed,#868e96);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;';
        cls.onclick = function() { overlay.remove(); };
        hdr.appendChild(cls);

        var body = document.createElement('div');
        body.style.cssText = 'padding:14px 20px 20px;display:flex;flex-direction:column;gap:12px;';

        var amtLabel = document.createElement('label');
        amtLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text,#c1c2c5);display:flex;flex-direction:column;gap:6px;';
        amtLabel.textContent = 'Сумма (₽)';
        var amtInput = document.createElement('input');
        amtInput.type = 'number'; amtInput.min = '1'; amtInput.step = '1'; amtInput.placeholder = '0';
        amtInput.style.cssText = 'padding:8px 12px;border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));border-radius:var(--mantine-radius-sm,6px);background:var(--mantine-color-dark-7,rgba(0,0,0,0.3));color:var(--mantine-color-text,#c1c2c5);font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;width:100%;';
        amtLabel.appendChild(amtInput);

        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Пополнить';
        confirmBtn.style.cssText = 'padding:9px 16px;background:#2e7d32;color:#fff;border:none;border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;';
        confirmBtn.onclick = async function() {
            var amt = parseFloat(amtInput.value);
            if (!amt || amt <= 0) { showToast('Введите сумму', 'error'); return; }
            confirmBtn.disabled = true; confirmBtn.textContent = 'Выполняю...';
            var res = await gql('DepositCash',
                'mutation DepositCash($amount: Float!, $walletId: Int!, $isCash: Boolean!) { walletDepositWithCash(params: {amount: $amount, walletId: $walletId, isCash: $isCash}) { operationId } }',
                { amount: amt, walletId: sd.walletId, isCash: true }
            );
            overlay.remove();
            if (res && res.data && res.data.walletDepositWithCash) {
                showToast('Пополнено на ' + amt + ' ₽ · ПК ' + pc + ' ✓', 'ok');
            } else {
                showToast('Ошибка: ' + (res && res.errors ? res.errors[0].message : 'неизвестно'), 'error');
            }
        };

        body.appendChild(amtLabel); body.appendChild(confirmBtn);
        box.appendChild(hdr); box.appendChild(body);
        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });
        document.body.appendChild(overlay);
        setTimeout(function() { amtInput.focus(); }, 50);
    }

    // Ctrl+G — Добавить бесплатное время (через меню CRM)
    function actionFreeTime() {
        var pc = window._godjiSelectedPc;
        if (!pc) { showToast('Выберите ПК кликом на карточку или строку', 'error'); return; }
        var sd = window._godjiSessionsData && window._godjiSessionsData[pc];
        if (!sd) { showToast('Нет активной сессии на ПК ' + pc, 'error'); return; }
        // Открываем меню и кликаем пункт
        var card = document.querySelector('.gm-card[data-pc="' + pc + '"]');
        if (!card) {
            var cards = document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
            for (var i = 0; i < cards.length; i++) {
                var el = cards[i].querySelector('.DeviceItem_deviceName__yC1tT');
                if (el && el.textContent.trim() === pc) { card = cards[i]; break; }
            }
        }
        if (!card) { showToast('Карточка ПК ' + pc + ' не найдена', 'error'); return; }
        var rect = card.getBoundingClientRect();
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 }));
        var attempts = 0;
        var t = setInterval(function() {
            attempts++;
            var menu = document.querySelector('[data-menu-dropdown="true"]');
            if (!menu) { if (attempts > 20) clearInterval(t); return; }
            var items = menu.querySelectorAll('[role="menuitem"]');
            for (var i = 0; i < items.length; i++) {
                var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
                if (lbl && lbl.textContent.trim() === 'Добавить бесплатное время') {
                    clearInterval(t);
                    items[i].click();
                    return;
                }
            }
            if (attempts > 20) clearInterval(t);
        }, 50);
    }

    // Ctrl+P — Продление сеанса через API напрямую
    async function actionProlong() {
        var pc = window._godjiSelectedPc;
        if (!pc) { showToast('Выберите ПК кликом на карточку или строку', 'error'); return; }
        var sd = window._godjiSessionsData && window._godjiSessionsData[pc];
        if (!sd || !sd.sessionId) { showToast('Нет активной сессии на ПК ' + pc, 'error'); return; }

        // Получаем доступные тарифы
        var tariffsRes = await gql('GetTariffs',
            'query GetTariffs($sessionId: Int!) { getAvailableTariffsForProlongation(params: {minutes: 60, sessionId: $sessionId}) { tariffs { id name durationMin cost } } }',
            { sessionId: sd.sessionId }
        );
        var tariffs = tariffsRes && tariffsRes.data &&
                      tariffsRes.data.getAvailableTariffsForProlongation &&
                      tariffsRes.data.getAvailableTariffsForProlongation.tariffs;
        if (!tariffs || !tariffs.length) { showToast('Не удалось получить тарифы для ПК ' + pc, 'error'); return; }

        // Показываем модалку выбора времени продления
        showProlongModal(pc, sd, tariffs);
    }

    function showProlongModal(pc, sd, tariffs) {
        var old = document.getElementById('godji-hk-prolong');
        if (old) old.remove();

        var overlay = document.createElement('div');
        overlay.id = 'godji-hk-prolong';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;';

        var box = document.createElement('div');
        box.style.cssText = 'background:var(--mantine-color-body,#1a1b1e);border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));border-radius:var(--mantine-radius-md,8px);width:min(360px,calc(100vw - 32px));font-family:var(--mantine-font-family,inherit);box-shadow:0 16px 48px rgba(0,0,0,0.6);overflow:hidden;';

        var hdr = document.createElement('div');
        hdr.style.cssText = 'padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));display:flex;justify-content:space-between;align-items:center;';
        hdr.innerHTML = '<div style="font-size:15px;font-weight:700;color:var(--mantine-color-text,#c1c2c5);">Продление · ПК ' + pc + '</div>';
        var cls = document.createElement('button');
        cls.textContent = '×';
        cls.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed,#868e96);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;';
        cls.onclick = function() { overlay.remove(); };
        hdr.appendChild(cls);

        var body = document.createElement('div');
        body.style.cssText = 'padding:14px 20px 20px;display:flex;flex-direction:column;gap:12px;';

        // Поле минут
        var minLabel = document.createElement('label');
        minLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text,#c1c2c5);display:flex;flex-direction:column;gap:6px;';
        minLabel.textContent = 'Минуты продления';
        var minInput = document.createElement('input');
        minInput.type = 'number'; minInput.min = '1'; minInput.value = '60';
        minInput.style.cssText = 'padding:8px 12px;border:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));border-radius:var(--mantine-radius-sm,6px);background:var(--mantine-color-dark-7,rgba(0,0,0,0.3));color:var(--mantine-color-text,#c1c2c5);font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;width:100%;';
        minLabel.appendChild(minInput);

        // Стоимость
        var costEl = document.createElement('div');
        costEl.style.cssText = 'font-size:12px;color:var(--mantine-color-dimmed,#868e96);';
        costEl.textContent = 'Рассчитываю стоимость...';

        var currentCost = null;
        var costTimer = null;

        async function recalc() {
            var mins = parseInt(minInput.value);
            if (!mins || mins < 1) { costEl.textContent = 'Введите количество минут'; currentCost = null; return; }
            costEl.textContent = 'Считаю...';
            var res = await gql('GetCost',
                'query GetCost($sessionId: Int!, $minutes: Int) { getAvailableTariffsForProlongation(params: {minutes: $minutes, sessionId: $sessionId}) { tariffs { id cost durationMin } } }',
                { sessionId: sd.sessionId, minutes: mins }
            );
            var t = res && res.data && res.data.getAvailableTariffsForProlongation &&
                    res.data.getAvailableTariffsForProlongation.tariffs &&
                    res.data.getAvailableTariffsForProlongation.tariffs[0];
            if (t) {
                var cost = Math.round(t.cost / t.durationMin * mins * 100) / 100;
                currentCost = { tariffId: t.id, cost: cost };
                costEl.textContent = 'Стоимость: ' + cost + ' бонусов';
                costEl.style.color = 'var(--mantine-color-text,#c1c2c5)';
            } else {
                costEl.textContent = 'Не удалось рассчитать';
                currentCost = null;
            }
        }

        minInput.addEventListener('input', function() {
            clearTimeout(costTimer);
            costTimer = setTimeout(recalc, 500);
        });

        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Продлить';
        confirmBtn.style.cssText = 'padding:9px 16px;background:#cc0001;color:#fff;border:none;border-radius:var(--mantine-radius-sm,6px);font-size:13px;font-weight:600;cursor:pointer;';
        confirmBtn.onclick = async function() {
            var mins = parseInt(minInput.value);
            if (!mins || mins < 1) { showToast('Введите минуты', 'error'); return; }
            confirmBtn.disabled = true; confirmBtn.textContent = 'Выполняю...';
            // 1. Начисляем бонусы
            if (currentCost && currentCost.cost > 0) {
                await gql('DepositBonus',
                    'mutation DepositBonus($amount: Float!, $walletId: Int!, $comment: String) { walletDepositWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) { operationId } }',
                    { amount: currentCost.cost, walletId: sd.walletId, comment: 'Продление на ' + mins + ' мин (ПК ' + pc + ')' }
                );
            }
            // 2. Продлеваем
            var res = await gql('ProlongSession',
                'mutation ProlongSession($sessionId: Int!, $tariffId: Int!, $minutes: Int) { userReservationProlongate(params: {sessionId: $sessionId, tariffId: $tariffId, minutes: $minutes}) { success } }',
                { sessionId: sd.sessionId, tariffId: (currentCost && currentCost.tariffId) || sd.tariffId, minutes: mins }
            );
            overlay.remove();
            if (res && res.data && res.data.userReservationProlongate && res.data.userReservationProlongate.success) {
                showToast('ПК ' + pc + ' продлён на ' + mins + ' мин ✓', 'ok');
            } else {
                showToast('Ошибка продления: ' + (res && res.errors ? res.errors[0].message : 'неизвестно'), 'error');
            }
        };

        body.appendChild(minLabel); body.appendChild(costEl); body.appendChild(confirmBtn);
        box.appendChild(hdr); box.appendChild(body);
        overlay.appendChild(box);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
        });
        document.body.appendChild(overlay);
        minInput.focus(); minInput.select();
        recalc();
    }

    // Backspace — Завершить сеанс через API
    async function actionEndSession() {
        var pc = window._godjiSelectedPc;
        if (!pc) { showToast('Выберите ПК кликом на карточку или строку', 'error'); return; }
        var sd = window._godjiSessionsData && window._godjiSessionsData[pc];
        if (!sd || !sd.sessionId) { showToast('Нет активной сессии на ПК ' + pc, 'error'); return; }

        showConfirm(
            'Завершить сеанс',
            'Завершить сеанс на <strong>ПК ' + pc + '</strong>' + (sd.nickname ? ' (клиент: ' + sd.nickname + ')' : '') + '?',
            async function() {
                var res = await gql('CancelSession',
                    'mutation CancelSession($sessionId: Int!) { userReservationCancel(params: {sessionId: $sessionId}) { success } }',
                    { sessionId: sd.sessionId }
                );
                if (res && res.data && res.data.userReservationCancel && res.data.userReservationCancel.success) {
                    showToast('Сеанс на ПК ' + pc + ' завершён ✓', 'ok');
                } else {
                    showToast('Ошибка завершения: ' + (res && res.errors ? res.errors[0].message : 'неизвестно'), 'error');
                }
            }
        );
    }

    // Ctrl+E — История сеансов
    function actionHistory() {
        var histBtn = document.getElementById('godji-history-btn');
        if (histBtn) { histBtn.click(); return; }
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            if (links[i].textContent.trim() === 'История сеансов') { links[i].click(); return; }
        }
        showToast('Кнопка "История сеансов" не найдена', 'error');
    }

    // F3 — Поиск клиента
    function actionSearch() {
        var panel = document.getElementById('godji-search-panel');
        var input = document.getElementById('godji-search-input');
        if (panel && panel.style.display !== 'none') {
            if (input) { input.focus(); input.select(); }
            return;
        }
        var btn = document.getElementById('godji-search-btn');
        if (btn) {
            btn.click();
            setTimeout(function() {
                var inp = document.getElementById('godji-search-input');
                if (inp) { inp.focus(); inp.select(); }
            }, 60);
        }
    }

    // ─── Кнопка горячих клавиш в сайдбаре (вместо баг-репорта) ──────────────

    var _hintVisible = false;

    function toggleHint() {
        _hintVisible = !_hintVisible;
        var hint = document.getElementById('godji-hk-hint');
        if (!_hintVisible) { if (hint) hint.remove(); return; }
        if (hint) hint.remove();

        // Оверлей как у Mantine модалок
        var overlay = document.createElement('div');
        overlay.id = 'godji-hk-hint';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.onclick = function(e) { if(e.target===overlay){overlay.remove();_hintVisible=false;} };

        // Окно в стиле mantine-Modal-content
        var box = document.createElement('div');
        box.style.cssText = [
            'background:var(--mantine-color-body,#1a1b1e)',
            'border-radius:var(--mantine-radius-md,8px)',
            'width:min(400px,calc(100vw - 32px))',
            'font-family:var(--mantine-font-family,inherit)',
            'box-shadow:0 16px 48px rgba(0,0,0,0.6)',
            'overflow:hidden',
        ].join(';');

        // Шапка
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1));';
        var title = document.createElement('div');
        title.style.cssText = 'display:flex;align-items:center;gap:10px;';
        title.innerHTML = '<div style="width:28px;height:28px;border-radius:6px;background:#cc0001;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4"/></svg></div><span style="font-size:15px;font-weight:600;color:var(--mantine-color-text,#c1c2c5);">Горячие клавиши</span>';
        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        closeBtn.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed,#868e96);cursor:pointer;padding:6px;border-radius:4px;display:flex;align-items:center;';
        closeBtn.onclick = function() { overlay.remove(); _hintVisible = false; };
        hdr.appendChild(title); hdr.appendChild(closeBtn);

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px 20px;display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:center;';

        var hotkeys = [
            ['Ctrl+Shift+D', 'Пополнить наличными'],
            ['Ctrl+Shift+P', 'Продление сеанса'],
            ['Ctrl+Shift+G', 'Добавить бесплатное время'],
            ['Ctrl+Shift+Q', 'Завершить сеанс'],
            ['Ctrl+Shift+E', 'История сеансов'],
            ['F3', 'Поиск клиента'],
            ['F1', 'Эта подсказка'],
        ];
        hotkeys.forEach(function(hk) {
            var kbd = document.createElement('kbd');
            kbd.textContent = hk[0];
            kbd.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:5px;padding:3px 8px;font-size:11px;font-family:ui-monospace,monospace;color:var(--mantine-color-text,#c1c2c5);white-space:nowrap;';
            var desc = document.createElement('span');
            desc.textContent = hk[1];
            desc.style.cssText = 'font-size:13px;color:var(--mantine-color-dimmed,#868e96);';
            body.appendChild(kbd); body.appendChild(desc);
        });

        // Подсказка внизу
        var note = document.createElement('div');
        note.style.cssText = 'padding:0 20px 16px;font-size:11px;color:var(--mantine-color-dimmed,#868e96);opacity:0.7;';
        note.textContent = 'Для Ctrl+D / Ctrl+P / Backspace — сначала выбери ПК кликом';

        box.appendChild(hdr); box.appendChild(body); box.appendChild(note);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { overlay.remove(); _hintVisible = false; document.removeEventListener('keydown', esc); }
        });
    }

    function injectHotkeyBtn() {
        if (document.getElementById('godji-hk-btn')) return;
        var footer = document.querySelector('.Sidebar_footer__1BA98');
        if (!footer) return;
        var userBtn = footer.querySelector('button[aria-haspopup="menu"], button.mantine-UnstyledButton-root');
        if (!userBtn) return;
        // Не добавляем если row уже создан
        if (userBtn.parentNode && userBtn.parentNode.id === 'godji-hk-row') return;

        var btn = document.createElement('button');
        btn.id = 'godji-hk-btn';
        btn.title = 'Горячие клавиши (F1)';
        btn.className = 'mantine-focus-auto m_87cf2631 mantine-UnstyledButton-root';
        btn.style.cssText = 'flex-shrink:0;width:34px;height:34px;border-radius:8px;background:rgba(204,0,1,0.12);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#cc0001;transition:background 0.15s;';
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4"/></svg>';
        btn.onmouseenter = function() { btn.style.background = 'rgba(204,0,1,0.22)'; };
        btn.onmouseleave = function() { btn.style.background = 'rgba(204,0,1,0.12)'; };
        btn.onclick = function(e) { e.stopPropagation(); toggleHint(); };

        var row = document.createElement('div');
        row.id = 'godji-hk-row';
        row.style.cssText = 'display:flex;align-items:center;width:100%;gap:4px;padding:0 12px;box-sizing:border-box;';

        userBtn.style.flex = '1';
        userBtn.style.minWidth = '0';
        userBtn.style.padding = '0';

        userBtn.parentNode.insertBefore(row, userBtn);
        row.appendChild(userBtn);
        row.appendChild(btn);
    }

    // ─── Обработчик клавиш ────────────────────────────────────────────────────

    document.addEventListener('keydown', function(e) {
        var tag = document.activeElement && document.activeElement.tagName;
        var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
                      (document.activeElement && document.activeElement.isContentEditable);

        // F3 — всегда
        if (e.key === 'F3') { e.preventDefault(); if (onDashboard()) actionSearch(); return; }

        // F1 — подсказка
        if (e.key === 'F1') { e.preventDefault(); toggleHint(); return; }

        if (isInput) return;
        if (!onDashboard()) return;

        // Backspace — завершить сеанс (оставляем как fallback)
        if (e.key === 'Backspace' && !e.altKey) {
            if (document.querySelector('.mantine-Modal-content, #godji-hk-confirm, #godji-hk-prolong')) return;
            e.preventDefault();
            actionEndSession();
            return;
        }

        if (!e.ctrlKey || !e.shiftKey) return;

        switch (e.key.toLowerCase()) {
            case 'd':
                e.preventDefault();
                e.stopImmediatePropagation();
                actionDeposit();
                break;
            case 'p':
                e.preventDefault();
                actionProlong();
                break;
            case 'e':
                e.preventDefault();
                actionHistory();
                break;
            case 'g':
                e.preventDefault();
                actionFreeTime();
                break;
            case 'q':
                e.preventDefault();
                actionEndSession();
                break;
        }
    }, true); // true = capture phase — перехватываем раньше браузера

    // ─── MutationObserver для кнопки ─────────────────────────────────────────

    var _obs = new MutationObserver(function() { injectHotkeyBtn(); });
    _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(injectHotkeyBtn, 1000);
    setTimeout(injectHotkeyBtn, 3000);

    // Экспортируем openClientModal для Ctrl+D
    window._godjiOpenClientModal = function(clientId) {
        // Пробуем вызвать функцию из godji_client_search
        if (typeof openClientModal === 'function') { openClientModal(clientId); return; }
        // Fallback — открываем в новой вкладке
        window.open('/clients/' + clientId, '_blank');
    };

})();

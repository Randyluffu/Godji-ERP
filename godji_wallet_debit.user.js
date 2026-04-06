// ==UserScript==
// @name         Годжи — Списание с баланса
// @namespace    http://tampermonkey.net/
// @version      3.0
// @match        https://godji.cloud/clients/*
// @match        https://*.godji.cloud/clients/*
// @include      https://godji.cloud/clients/*
// @include      https://*.godji.cloud/clients/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_wallet_debit.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_wallet_debit.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var CLUB_ID = 14;
    var API_URL = 'https://hasura.godji.cloud/v1/graphql';

    var _authToken = null;
    var _hasuraRole = 'club_admin';
    var _origFetch = window.fetch;

    // ── Перехват токена ───────────────────────────────────────
    window.fetch = function (url, options) {
        if (options && options.headers && options.headers.authorization) {
            _authToken = options.headers.authorization;
            window._godjiAuthToken = _authToken;
            _hasuraRole = options.headers['x-hasura-role'] || 'club_admin';
            window._godjiHasuraRole = _hasuraRole;
        }
        return _origFetch.apply(this, arguments);
    };

    function getHeaders() {
        var t = _authToken || window._godjiAuthToken;
        if (!t) return null;
        return {
            'authorization': t,
            'content-type': 'application/json',
            'x-hasura-role': _hasuraRole || 'club_admin'
        };
    }

    function gql(query, variables, opName) {
        var h = getHeaders();
        if (!h) return Promise.reject(new Error('Нет токена авторизации'));
        return _origFetch(API_URL, {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ operationName: opName || null, query: query, variables: variables || {} })
        }).then(function (r) { return r.json(); });
    }

    function getClientId() {
        var m = window.location.pathname.match(/\/clients\/([a-f0-9-]{36})/);
        return m ? m[1] : null;
    }

    // ── Получить данные клиента (баланс рублей + бонусов + walletId) ──
    function getClientData(clientId) {
        return gql(
            'query GetClientWallet($userId: String!, $clubId: Int!) { users_by_pk(id: $userId) { users_wallets(where: {club_id: {_eq: $clubId}}, limit: 1) { id balance_amount balance_bonus } } }',
            { userId: clientId, clubId: CLUB_ID },
            'GetClientWallet'
        ).then(function (data) {
            var wallets = data.data && data.data.users_by_pk && data.data.users_by_pk.users_wallets;
            if (!wallets || !wallets.length) return null;
            return {
                walletId: wallets[0].id,
                balance: wallets[0].balance_amount,
                bonus: wallets[0].balance_bonus
            };
        });
    }

    // ── Тариф из кэша (записывает godji_free_time) ───────────
    // Кэш хранит утренний и ночной тарифы бессрочно, обновляется при использовании
    var TARIFF_CACHE_KEY = 'godji_tariff_cache';

    function getTariffFromCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(TARIFF_CACHE_KEY) || '{}');
            var h = new Date().getHours();
            var slot = (h >= 2 && h < 13) ? 'morning' : 'night';
            var t = raw[slot];
            if (t && t.costPerMin && t.tariffId) return t;
            // Если нужного слота нет — берём любой имеющийся
            var other = raw[slot === 'morning' ? 'night' : 'morning'];
            if (other && other.costPerMin && other.tariffId) return other;
            return null;
        } catch(e) { return null; }
    }

    // ── Получить свободные ПК ────────────────────────────────
    function getFreePCs() {
        return gql(
            'query GetDashboardFree($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name status } } }',
            { clubId: CLUB_ID },
            'GetDashboardFree'
        ).then(function (data) {
            var devices = data.data && data.data.getDashboardDevices && data.data.getDashboardDevices.devices;
            if (!devices) return [];
            return devices.filter(function (d) { return d.status === 'available'; });
        });
    }

    // ── Запустить сеанс (посадить клиента за ПК) ─────────────
    function startSession(clientId, deviceName, tariffId, minutes) {
        return gql(
            'mutation StartSession($clientId: String!, $deviceName: String!, $tariffId: Int!, $minutes: Int!, $clubId: Int!) { userReservationCreate(params: {userId: $clientId, deviceName: $deviceName, tariffId: $tariffId, minutes: $minutes, clubId: $clubId}) { id status } }',
            { clientId: clientId, deviceName: deviceName, tariffId: tariffId, minutes: minutes, clubId: CLUB_ID },
            'StartSession'
        );
    }

    // ── Завершить сеанс ───────────────────────────────────────
    function finishSession(sessionId) {
        return gql(
            'mutation FinishSession($sessionId: Int!) { userReservationFinish(params: {sessionId: $sessionId}) { success } }',
            { sessionId: sessionId },
            'FinishSession'
        );
    }

    // ── Списать бонусы ────────────────────────────────────────
    function withdrawBonus(walletId, amount, comment) {
        return gql(
            'mutation ChargeBonus($amount: Float!, $walletId: Int!, $comment: String) { walletWithdrawWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) { operationId } }',
            { amount: amount, walletId: walletId, comment: comment },
            'ChargeBonus'
        );
    }

    // ── Расчёт минут и тарифа по нужной сумме ────────────────
    // Рубли 1:1 с бонусами, поэтому amount рублей = amount бонусов
    // Нужно подобрать кол-во минут так чтобы стоимость = amount
    // cost_per_minute * minutes = amount => minutes = amount / cost_per_minute
    function calcMinutes(amount, costPerMinute) {
        if (!costPerMinute || costPerMinute <= 0) return null;
        var mins = Math.ceil(amount / costPerMinute);
        return mins < 1 ? 1 : mins;
    }

    // ── Основной процесс списания ─────────────────────────────
    // 1. Найти свободный ПК
    // 2. Получить тариф
    // 3. Рассчитать минуты для нужной суммы (с учётом бонусов клиента)
    // 4. Пополнить рубли если бонусов больше нуля (чтобы при посадке не ушли бонусы)
    //    — НЕТ: наоборот, нам нужно чтобы после завершения сеанса
    //    вернулась именно нужная сумма рублей в виде бонусов
    //    Проблема: при посадке сначала списываются бонусы, потом рубли
    //    Решение: если у клиента есть бонусы B, то сажаем на (amount + B) рублей,
    //    тогда после завершения вернётся (amount + B) бонусов,
    //    из которых B — это "старые" бонусы клиента, а amount — новые (конвертированные рубли)
    //    Потом списываем ровно amount бонусов
    async function performDebit(clientId, walletId, amount, bonus, comment, statusCallback) {
        // Шаг 1: найти свободные ПК
        statusCallback('Ищем свободный ПК…');
        var freePCs = await getFreePCs();
        if (!freePCs || freePCs.length === 0) {
            throw new Error('Нет свободных ПК. Дождитесь освобождения места и попробуйте снова.');
        }

        // Шаг 2: получить тариф из кэша (записывается godji_free_time при работе с сессиями)
        statusCallback('Получаем тариф…');
        var cachedTariff = getTariffFromCache();
        if (!cachedTariff) {
            throw new Error('Тариф не определён. Перейдите на дашборд и добавьте бесплатное время любому клиенту — кэш обновится автоматически.');
        }

        var chosenPC = freePCs[0];
        var chosenTariff = cachedTariff;

        if (!chosenTariff.costPerMin || chosenTariff.costPerMin <= 0) {
            throw new Error('Некорректные данные тарифа в кэше. Обновите кэш через дашборд.');
        }

        // Шаг 3: рассчитать сумму посадки с учётом бонусов
        // При посадке сначала списываются бонусы, потом рубли
        // Чтобы списать ровно `amount` рублей и получить обратно `amount` бонусов:
        // нужно посадить на (amount + bonus) чтобы покрыть существующие бонусы + нужную сумму
        var totalAmount = amount + (bonus || 0);
        var minutes = calcMinutes(totalAmount, chosenTariff.costPerMin);
        if (!minutes) throw new Error('Ошибка расчёта минут');

        // Реальная стоимость (округление вверх может дать чуть больше)
        var realCost = Math.round(chosenTariff.costPerMin * minutes * 100) / 100;

        statusCallback('Запускаем сеанс на ПК ' + chosenPC.name + ' (' + minutes + ' мин)…');

        // Шаг 4: запустить сеанс
        var startResult = await startSession(clientId, chosenPC.name, chosenTariff.tariffId, minutes);
        if (!startResult || !startResult.data || startResult.errors) {
            var errMsg = startResult && startResult.errors ? startResult.errors[0].message : 'неизвестная ошибка';
            throw new Error('Не удалось запустить сеанс: ' + errMsg);
        }
        var sessionId = startResult.data.userReservationCreate && startResult.data.userReservationCreate.id;
        if (!sessionId) throw new Error('Сеанс запущен, но ID не получен');

        // Шаг 5: завершить сеанс немедленно
        statusCallback('Завершаем сеанс…');
        await finishSession(sessionId);

        // Небольшая пауза — дать серверу время зачислить бонусы
        await new Promise(function (resolve) { setTimeout(resolve, 800); });

        // Шаг 6: списать нужное количество бонусов (ровно amount)
        statusCallback('Списываем ' + amount + ' ₽…');
        var debitResult = await withdrawBonus(walletId, amount, comment);
        if (!debitResult || debitResult.errors) {
            var errMsg2 = debitResult && debitResult.errors ? debitResult.errors[0].message : 'неизвестная ошибка';
            throw new Error('Сеанс завершён, но списание бонусов не прошло: ' + errMsg2);
        }

        // Уведомляем кассу
        document.dispatchEvent(new CustomEvent('__godji_debit__', {
            detail: { amount: amount, comment: comment, ts: Date.now() }
        }));

        return { amount: amount, pc: chosenPC.name };
    }

    // ── Модальное окно ────────────────────────────────────────
    function showModal(clientData) {
        if (document.getElementById('godji-debit-overlay')) return;

        var clientId = getClientId();
        if (!clientId) return;

        var overlay = document.createElement('div');
        overlay.id = 'godji-debit-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        var modal = document.createElement('div');
        modal.style.cssText = 'background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md);width:100%;max-width:380px;font-family:inherit;box-shadow:var(--mantine-shadow-xl);overflow:hidden;';
        modal.addEventListener('click', function (e) { e.stopPropagation(); });

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border);';
        var title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:700;color:var(--mantine-color-text);';
        title.textContent = 'Списание с рублёвого баланса';
        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed);font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function () { overlay.remove(); });
        header.appendChild(title);
        header.appendChild(closeBtn);

        // Инфо о балансе
        var balInfo = document.createElement('div');
        balInfo.style.cssText = 'padding:10px 20px 0;display:flex;gap:16px;font-size:12px;color:var(--mantine-color-dimmed);';
        balInfo.innerHTML =
            '<span>Рубли: <b style="color:var(--mantine-color-text)">' + Math.round(clientData.balance) + ' ₽</b></span>' +
            '<span>Бонусы: <b style="color:var(--mantine-color-text)">' + Math.round(clientData.bonus) + ' бон.</b></span>';

        // Предупреждение если бонусов много
        var warnEl = document.createElement('div');
        warnEl.style.cssText = 'margin:8px 20px 0;padding:8px 10px;background:#fff8e1;border-radius:6px;font-size:11px;color:#7c5800;display:' + (clientData.bonus > 0 ? 'block' : 'none') + ';';
        warnEl.textContent = '⚠ У клиента есть бонусы (' + Math.round(clientData.bonus) + '). При посадке они будут временно задействованы и возвращены.';

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:12px 20px 20px;display:flex;flex-direction:column;gap:12px;';

        // Сумма
        var amountLabel = document.createElement('label');
        amountLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text);display:flex;flex-direction:column;gap:6px;';
        amountLabel.textContent = 'Сумма списания (₽)';
        var amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.min = '1';
        amountInput.step = '1';
        amountInput.placeholder = '0';
        amountInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm);font-size:14px;font-family:inherit;background:var(--mantine-color-default);color:var(--mantine-color-text);box-sizing:border-box;outline:none;';
        amountInput.addEventListener('focus', function () { amountInput.style.borderColor = 'var(--mantine-color-red-filled)'; });
        amountInput.addEventListener('blur', function () { amountInput.style.borderColor = 'var(--mantine-color-default-border)'; });
        amountLabel.appendChild(amountInput);

        // Комментарий
        var commentLabel = document.createElement('label');
        commentLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text);display:flex;flex-direction:column;gap:6px;';
        commentLabel.textContent = 'Причина списания';
        var commentInput = document.createElement('input');
        commentInput.type = 'text';
        commentInput.placeholder = 'Укажите причину…';
        commentInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm);font-size:14px;font-family:inherit;background:var(--mantine-color-default);color:var(--mantine-color-text);box-sizing:border-box;outline:none;';
        commentInput.addEventListener('focus', function () { commentInput.style.borderColor = 'var(--mantine-color-red-filled)'; });
        commentInput.addEventListener('blur', function () { commentInput.style.borderColor = 'var(--mantine-color-default-border)'; });
        commentLabel.appendChild(commentInput);

        // Статус/ошибка
        var statusEl = document.createElement('div');
        statusEl.style.cssText = 'font-size:12px;color:var(--mantine-color-dimmed);min-height:18px;';

        // Кнопка
        var submitBtn = document.createElement('button');
        submitBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        submitBtn.setAttribute('data-variant', 'filled');
        submitBtn.style.cssText = '--button-bg:var(--mantine-color-red-filled);--button-hover:var(--mantine-color-red-filled-hover);--button-color:#fff;--button-bd:none;width:100%;margin-top:4px;';
        var submitInner = document.createElement('span');
        submitInner.className = 'm_80f1301b mantine-Button-inner';
        var submitLabelEl = document.createElement('span');
        submitLabelEl.className = 'm_811560b9 mantine-Button-label';
        submitLabelEl.textContent = 'Списать';
        submitInner.appendChild(submitLabelEl);
        submitBtn.appendChild(submitInner);

        submitBtn.addEventListener('click', function () {
            var amount = parseInt(amountInput.value);
            var comment = commentInput.value.trim();

            statusEl.style.color = 'var(--mantine-color-red-filled)';

            if (!amount || amount <= 0) {
                statusEl.textContent = 'Введите корректную сумму';
                return;
            }
            if (amount > Math.round(clientData.balance)) {
                statusEl.textContent = 'Сумма превышает рублёвый баланс (' + Math.round(clientData.balance) + ' ₽)';
                return;
            }
            if (!comment) {
                statusEl.textContent = 'Укажите причину списания';
                return;
            }

            submitBtn.disabled = true;
            closeBtn.disabled = true;
            statusEl.style.color = 'var(--mantine-color-dimmed)';

            performDebit(clientId, clientData.walletId, amount, clientData.bonus, comment, function (msg) {
                statusEl.textContent = msg;
                submitLabelEl.textContent = msg;
            }).then(function (result) {
                submitLabelEl.textContent = 'Готово ✓';
                submitBtn.style.setProperty('--button-bg', '#166534');
                statusEl.style.color = '#166534';
                statusEl.textContent = 'Списано ' + result.amount + ' ₽ через ПК ' + result.pc;
                setTimeout(function () {
                    overlay.remove();
                    window.location.reload();
                }, 1800);
            }).catch(function (err) {
                submitBtn.disabled = false;
                closeBtn.disabled = false;
                submitLabelEl.textContent = 'Списать';
                statusEl.style.color = 'var(--mantine-color-red-filled)';
                statusEl.textContent = '❌ ' + (err.message || 'Неизвестная ошибка');
            });
        });

        body.appendChild(amountLabel);
        body.appendChild(commentLabel);
        body.appendChild(statusEl);
        body.appendChild(submitBtn);

        modal.appendChild(header);
        modal.appendChild(balInfo);
        modal.appendChild(warnEl);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        setTimeout(function () { amountInput.focus(); }, 50);
    }

    // ── Кнопка на странице клиента ────────────────────────────
    async function injectButton() {
        if (document.getElementById('godji-debit-btn')) return;

        var clientId = getClientId();
        if (!clientId) return;

        var allBtns = document.querySelectorAll('button');
        var anchorBtn = null;
        allBtns.forEach(function (b) {
            if (b.textContent.trim() === 'Пополнить наличными') anchorBtn = b;
        });
        if (!anchorBtn) return;

        var btn = document.createElement('button');
        btn.id = 'godji-debit-btn';
        btn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        btn.setAttribute('data-variant', 'light');
        btn.setAttribute('data-size', 'xs');
        btn.setAttribute('data-with-left-section', 'true');
        btn.setAttribute('type', 'button');
        btn.style.cssText = '--button-justify:flex-start;--button-height:var(--button-height-xs);--button-padding-x:var(--button-padding-x-xs);--button-fz:var(--mantine-font-size-xs);--button-bg:var(--mantine-color-red-light);--button-hover:var(--mantine-color-red-light-hover);--button-color:var(--mantine-color-red-light-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;flex:1 1 100%;width:100%;';

        var inner = document.createElement('span');
        inner.className = 'm_80f1301b mantine-Button-inner';
        var section = document.createElement('span');
        section.className = 'm_a74036a mantine-Button-section';
        section.setAttribute('data-position', 'left');
        section.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1 -3.5 3.5h-1a3.5 3.5 0 0 1 -3.5 -3.5a1.5 1.5 0 0 1 1.5 -1.5"/><path d="M12.5 21h-4.5a4 4 0 0 1 -4 -4v-1a8 8 0 0 1 14 -5.5"/><path d="M16 19h-6"/></svg>';
        var labelEl = document.createElement('span');
        labelEl.className = 'm_811560b9 mantine-Button-label';
        labelEl.textContent = 'Списать с рублёвого баланса';
        inner.appendChild(section);
        inner.appendChild(labelEl);
        btn.appendChild(inner);

        btn.addEventListener('click', async function () {
            labelEl.textContent = 'Загрузка…';
            btn.disabled = true;
            var data = await getClientData(clientId).catch(function () { return null; });
            btn.disabled = false;
            labelEl.textContent = 'Списать с рублёвого баланса';
            if (!data) {
                alert('Не удалось получить данные кошелька. Дождитесь загрузки страницы.');
                return;
            }
            if (data.balance <= 0) {
                alert('У клиента нет рублей на балансе.');
                return;
            }
            showModal(data);
        });

        // Вставляем после строки со "Списать бонусы"
        var chargeBtn = null;
        document.querySelectorAll('button').forEach(function (b) {
            if (b.textContent.trim() === 'Списать бонусы') chargeBtn = b;
        });
        var targetRow = chargeBtn ? chargeBtn.parentNode : anchorBtn.parentNode;
        var targetParent = targetRow ? targetRow.parentNode : null;
        if (targetParent) {
            var newRow = document.createElement('div');
            newRow.className = targetRow.className;
            newRow.style.cssText = targetRow.style.cssText;
            btn.style.setProperty('flex', '1 1 100%', 'important');
            newRow.appendChild(btn);
            targetParent.insertBefore(newRow, targetRow.nextSibling);
        } else {
            anchorBtn.parentNode.insertBefore(btn, anchorBtn.nextSibling);
        }
    }

    var _obs = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiDebitTimer);
                window._godjiDebitTimer = setTimeout(injectButton, 300);
                break;
            }
        }
    });

    if (document.body) {
        _obs.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            _obs.observe(document.body, { childList: true, subtree: true });
        });
    }

    setTimeout(injectButton, 1500);
    setTimeout(injectButton, 3000);

})();

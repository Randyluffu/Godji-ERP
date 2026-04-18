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
    // VIP зоны по названию zone (из API)
    var VIP_ZONE_NAMES = ['VIP','Vip','vip'];

    function getFreePCs() {
        return gql(
            'query GetDashboardFree($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { id name status protected zone { id name } } } }',
            { clubId: CLUB_ID },
            'GetDashboardFree'
        ).then(function (data) {
            var devices = data.data && data.data.getDashboardDevices && data.data.getDashboardDevices.devices;
            if (!devices) return [];
            console.log('[debit] all devices:', devices.map(function(d){return d.name+':'+d.id+':'+(d.zone&&d.zone.name||'?');}));
            // Только VIP зона, свободные, незащищённые
            var free = devices.filter(function (d) {
                var zoneName = d.zone && d.zone.name || '';
                var zn = zoneName.toLowerCase();
                // Только чистый VIP, не VIP Plus (у VIP+ другая схема тарифов)
                return d.status === 'available' && !d.protected &&
                       (zn === 'vip' || zn === 'vip ');
            });
            console.log('[debit] free VIP PCs:', free.map(function(d){return d.name+':'+d.id+':'+(d.zone&&d.zone.name);}));
            if (!free.length) {
                // Fallback — любой свободный незащищённый
                free = devices.filter(function(d){ return d.status === 'available' && !d.protected; });
                console.log('[debit] fallback free PCs:', free.map(function(d){return d.name+':'+d.id;}));
            }
            return free;
        });
    }

    // ── Запустить сеанс (посадить клиента за ПК) ─────────────
    function startSession(clientId, deviceId, tariffId, minutes) {
        var now = new Date();
        var end = new Date(now.getTime() + minutes * 60000);
        // isDirect:true позволяет сажать без проверки расписания
        // Пробуем сначала с isDirect, при ошибке — без него
        var vars = { clubId: CLUB_ID, deviceId: deviceId, tariffId: tariffId,
              sessionStart: now.toISOString(), sessionEnd: end.toISOString(),
              userId: clientId, isDirect: true };
        return gql(
            'mutation CreateBooking($clubId: Int!, $deviceId: Int!, $tariffId: Int!, $sessionStart: timestamptz!, $sessionEnd: timestamptz!, $userId: String!, $isDirect: Boolean) { userReservationCreate(params: {clubId: $clubId, deviceId: $deviceId, tariffId: $tariffId, sessionStart: $sessionStart, sessionEnd: $sessionEnd, userId: $userId, isDirect: $isDirect}) { __typename } }',
            vars, 'CreateBooking'
        ).then(function(r) {
            if(r && r.errors && r.errors.length) {
                console.warn('[debit] CreateBooking with isDirect failed:', r.errors[0].message, '— retrying without isDirect');
                var vars2 = { clubId: CLUB_ID, deviceId: deviceId, tariffId: tariffId,
                    sessionStart: now.toISOString(), sessionEnd: end.toISOString(),
                    userId: clientId };
                return gql(
                    'mutation CreateBooking2($clubId: Int!, $deviceId: Int!, $tariffId: Int!, $sessionStart: timestamptz!, $sessionEnd: timestamptz!, $userId: String!) { userReservationCreate(params: {clubId: $clubId, deviceId: $deviceId, tariffId: $tariffId, sessionStart: $sessionStart, sessionEnd: $sessionEnd, userId: $userId}) { __typename } }',
                    vars2, 'CreateBooking2'
                );
            }
            return r;
        });
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
    // Получить активный сеанс клиента
    function getActiveSession(clientId) {
        // Запрос через таблицу reservations напрямую
        return gql(
            'query GetActiveSession($userId: String!, $clubId: Int!) { reservations(where: {user_id: {_eq: $userId}, club_id: {_eq: $clubId}, status: {_nin: ["finished","canceled"]}}, order_by: {id: desc}, limit: 5) { id status user_id tariff_id reservations_club_device { name } } }',
            { userId: clientId, clubId: CLUB_ID }, 'GetActiveSession'
        ).then(function(d) {
            console.log('[debit] getActiveSession FULL:', JSON.stringify(d));
            var r = d.data && d.data.reservations;
            if(r && r.length) {
                console.log('[debit] found active session:', r[0].id, 'status:', r[0].status, 'user_id:', r[0].user_id);
            } else {
                console.log('[debit] no active sessions found for user', clientId);
            }
            return r && r.length ? r[0] : null;
        });
    }

    // Продлить сеанс
    function prolongSession(sessionId, tariffId, minutes) {
        return gql(
            'mutation Prolong($sessionId: Int!, $tariffId: Int!, $minutes: Int) { userReservationProlongate(params: {sessionId: $sessionId, tariffId: $tariffId, minutes: $minutes}) { success __typename } }',
            { sessionId: sessionId, tariffId: tariffId, minutes: minutes }, 'Prolong'
        );
    }

    async function performDebit(clientId, walletId, amount, bonus, comment, statusCallback) {
        // Шаг 1: получить тариф из кэша
        statusCallback('Получаем тариф…');
        var cachedTariff = getTariffFromCache();
        if (!cachedTariff || !cachedTariff.costPerMin || cachedTariff.costPerMin <= 0) {
            throw new Error('Тариф не определён. Откройте скрипт "Бесплатное время" для любого клиента — кэш обновится.');
        }

        // Шаг 2: проверить есть ли активный сеанс у клиента
        statusCallback('Проверяем сеанс клиента…');
        var activeSession = await getActiveSession(clientId);

        var totalAmount = amount + (bonus || 0);
        var minutes = calcMinutes(totalAmount, cachedTariff.costPerMin);
        if (!minutes) throw new Error('Ошибка расчёта минут');

        var sessionId = null;
        var pcName = '?';

        if (activeSession) {
            // Клиент уже сидит — продлеваем его текущий сеанс
            sessionId = activeSession.id;
            pcName = activeSession.reservations_club_device && activeSession.reservations_club_device.name || '?';
            var tariffId = activeSession.tariff_id || cachedTariff.tariffId;
            statusCallback('Продлеваем сеанс (' + minutes + ' мин) на ПК ' + pcName + '…');
            // Получаем актуальные тарифы для этого сеанса
            var availTariffs = await gql(
                'query GetTariffs($sessionId: Int!) { getAvailableTariffsForProlongation(params: {minutes: 1, sessionId: $sessionId}) { tariffs { id name durationMin cost } } }',
                { sessionId: sessionId }, 'GetTariffs'
            ).then(function(d) {
                return d.data && d.data.getAvailableTariffsForProlongation && d.data.getAvailableTariffsForProlongation.tariffs;
            }).catch(function(){ return null; });

            if (availTariffs && availTariffs.length) {
                // Берём самый дешёвый тариф и пересчитываем
                var sorted = availTariffs.slice().sort(function(a,b){ return a.durationMin-b.durationMin; });
                var bestTariff = sorted[0];
                tariffId = bestTariff.id;
                var cpm = bestTariff.cost / bestTariff.durationMin;
                minutes = calcMinutes(totalAmount, cpm);
                console.log('[debit] using tariff from API:', bestTariff.name, 'id:', tariffId, 'mins:', minutes);
            }

            var prolongResult = await prolongSession(sessionId, tariffId, minutes);
            console.log('[debit] prolongSession result:', JSON.stringify(prolongResult));
            if (!prolongResult || prolongResult.errors) {
                var e1 = prolongResult && prolongResult.errors ? prolongResult.errors[0].message : 'unknown';
                throw new Error('Не удалось продлить сеанс: ' + e1);
            }
            // Продление не финишируем — клиент продолжает сидеть
            // Бонусы зачислятся, мы их сразу спишем
            await new Promise(function(resolve){ setTimeout(resolve, 500); });
        } else {
            // Клиент не сидит — ищем свободный ПК
            statusCallback('Ищем свободный ПК…');
            var freePCs = await getFreePCs();
            if (!freePCs || freePCs.length === 0) {
                throw new Error('Нет свободных ПК и нет активного сеанса. Попробуйте позже.');
            }
            var chosenPC = freePCs[0];
            pcName = chosenPC.name;
            statusCallback('Запускаем сеанс на ПК ' + pcName + ' (' + minutes + ' мин)…');
            var startResult = await startSession(clientId, chosenPC.id, cachedTariff.tariffId, minutes);
            console.log('[debit] startSession result:', JSON.stringify(startResult));
            if (!startResult || startResult.errors) {
                var e2 = startResult && startResult.errors ? startResult.errors[0].message : 'unknown';
                throw new Error('Не удалось запустить сеанс: ' + e2);
            }
            // Получаем ID только что созданного сеанса — ищем самый свежий без фильтра статуса
            await new Promise(function(resolve){ setTimeout(resolve, 800); });
            var freshData = await gql(
                'query GetFreshSession($userId: String!, $clubId: Int!) { reservations(where: {user_id: {_eq: $userId}, club_id: {_eq: $clubId}}, order_by: {id: desc}, limit: 1) { id status } }',
                { userId: clientId, clubId: CLUB_ID }, 'GetFreshSession'
            );
            console.log('[debit] fresh session lookup:', JSON.stringify(freshData));
            var freshRes = freshData.data && freshData.data.reservations;
            sessionId = freshRes && freshRes.length ? freshRes[0].id : null;
            if (!sessionId) throw new Error('Сеанс создан, но не найден ID (проверьте консоль)');
            // Завершаем
            statusCallback('Завершаем сеанс…');
            await finishSession(sessionId);
            await new Promise(function(resolve){ setTimeout(resolve, 800); });
        }

        // Шаг финальный: списать нужное кол-во бонусов (=amount ₽)
        statusCallback('Списываем ' + amount + ' ₽ с баланса…');
        var debitResult = await withdrawBonus(walletId, amount, comment);
        console.log('[debit] withdrawBonus result:', JSON.stringify(debitResult));
        if (!debitResult || debitResult.errors) {
            var e3 = debitResult && debitResult.errors ? debitResult.errors[0].message : 'unknown';
            throw new Error('Списание бонусов не прошло: ' + e3);
        }

        document.dispatchEvent(new CustomEvent('__godji_debit__', {
            detail: { amount: amount, comment: comment, ts: Date.now() }
        }));

        return { amount: amount, pc: pcName };
    }

    // ── Модальное окно ────────────────────────────────────────
    function showModal(clientData, overrideClientId) {
        if (document.getElementById('godji-debit-overlay')) return;

        var clientId = overrideClientId || getClientId();
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
        section.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-moneybag-minus"><path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1 -3.5 3.5h-1a3.5 3.5 0 0 1 -3.5 -3.5a1.5 1.5 0 0 1 1.5 -1.5"></path><path d="M12.5 21h-4.5a4 4 0 0 1 -4 -4v-1a8 8 0 0 1 15.943 -.958"></path><path d="M16 19h6"></path></svg>';
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

    // Глобальный API для вызова из других скриптов (client_search)
    window.__godjiOpenDebit = function(clientId, walletData) {
        if(!walletData) {
            // Загружаем данные если не переданы
            getClientData(clientId).then(function(data) {
                if(!data) { alert('Не удалось получить данные кошелька.'); return; }
                if(data.balance <= 0) { alert('У клиента нет рублей на балансе.'); return; }
                showModal(data, clientId);
            });
            return;
        }
        var data = {
            walletId: walletData.id,
            balance: walletData.balance_amount,
            bonus: walletData.balance_bonus || 0
        };
        if(data.balance <= 0) { alert('У клиента нет рублей на балансе.'); return; }
        showModal(data, clientId);
    };

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

// ==UserScript==
// @name         Godji — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Перезапускает пакетный сеанс на почасовой с сохранением остатка времени
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_restart.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_restart.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var BUTTON_ID   = 'godji-restart-btn';
    var MODAL_ID    = 'godji-restart-modal';
    var API_URL     = 'https://hasura.godji.cloud/v1/graphql';
    var CLUB_ID     = 14;

    // Хранит данные сессий по имени ПК
    var sessionsData = {};
    var lastContextPc = null;
    var authToken = null;
    var hasuraRole = 'club_admin';

    // Признак «поминутного» тарифа — если тариф содержит одно из этих слов,
    // он уже почасовой и бонусы начислять не нужно.
    var HOURLY_MARKERS = ['1 час', '2 час', '3 час', '4 час', 'час', 'мин', 'минут', 'поминут'];

    function isHourlyTariff(tariffName) {
        if (!tariffName) return false;
        var n = tariffName.toLowerCase();
        for (var i = 0; i < HOURLY_MARKERS.length; i++) {
            if (n.indexOf(HOURLY_MARKERS[i].toLowerCase()) !== -1) return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Fetch-хук — перехватываем GetDashboardTable, делаем параллельный запрос
    // за деталями сессий (sessionId, walletId, tariffId, tariffName, remainSec)
    // -------------------------------------------------------------------------
    function installFetchHook() {
        var origFetch = window.fetch;
        if (!origFetch) return;

        window.fetch = function (url, opts) {
            try {
                var body = (opts && opts.body) ? opts.body : '';

                // Сохраняем заголовки авторизации
                if (opts && opts.headers && opts.headers.authorization) {
                    authToken = opts.headers.authorization;
                    window._godjiAuthToken = authToken;
                    if (opts.headers['x-hasura-role']) {
                        hasuraRole = opts.headers['x-hasura-role'];
                        window._godjiHasuraRole = hasuraRole;
                    }
                }

                // Параллельный запрос при GetDashboardTable
                if (
                    authToken && hasuraRole &&
                    typeof body === 'string' &&
                    body.indexOf('GetDashboardTable') !== -1 &&
                    !window._godjiRestartPending
                ) {
                    window._godjiRestartPending = true;
                    setTimeout(function () { window._godjiRestartPending = false; }, 3000);

                    var vars;
                    try { vars = JSON.parse(body).variables; } catch (e) { vars = { clubId: CLUB_ID }; }

                    origFetch.call(window, API_URL, {
                        method: 'POST',
                        headers: {
                            'accept': '*/*',
                            'content-type': 'application/json',
                            'authorization': authToken,
                            'x-hasura-role': hasuraRole
                        },
                        body: JSON.stringify({
                            operationName: 'GetDashboardDevicesForRestart',
                            variables: vars,
                            query: 'query GetDashboardDevicesForRestart($clubId: Int!) {' +
                                   '  getDashboardDevices(params: {clubId: $clubId}) {' +
                                   '    devices {' +
                                   '      name' +
                                   '      sessions {' +
                                   '        id' +
                                   '        status' +
                                   '        remainSeconds' +
                                   '        tariff { id name }' +
                                   '        user { nickname wallet { id balance bonusBalance } }' +
                                   '      }' +
                                   '    }' +
                                   '  }' +
                                   '}'
                        })
                    })
                    .then(function (res) { return res.json(); })
                    .then(function (json) {
                        window._godjiRestartPending = false;
                        if (!json || !json.data || !json.data.getDashboardDevices) return;
                        json.data.getDashboardDevices.devices.forEach(function (d) {
                            if (!d.sessions || d.sessions.length === 0) {
                                delete sessionsData[d.name];
                                return;
                            }
                            var s = d.sessions[0];
                            if (!s || !s.user || !s.user.wallet) return;
                            sessionsData[d.name] = {
                                sessionId:    s.id,
                                status:       s.status,
                                remainSec:    s.remainSeconds || 0,
                                tariffId:     s.tariff ? s.tariff.id   : null,
                                tariffName:   s.tariff ? s.tariff.name : '',
                                walletId:     s.user.wallet.id,
                                bonusBalance: s.user.wallet.bonusBalance || 0,
                                nickname:     s.user.nickname || '',
                                pcName:       d.name
                            };
                            window._godjiSessionsData = sessionsData;
                        });
                    })
                    .catch(function () { window._godjiRestartPending = false; });
                }
            } catch (e) {}

            return origFetch.call(this, url, opts);
        };

        window.fetch._godjiRestartHooked = true;
    }

    installFetchHook();
    setInterval(function () {
        if (window.fetch && !window.fetch._godjiRestartHooked) installFetchHook();
    }, 500);

    // -------------------------------------------------------------------------
    // GraphQL-хелпер
    // -------------------------------------------------------------------------
    function gql(query, variables) {
        return fetch(API_URL, {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'authorization': authToken || '',
                'x-hasura-role': hasuraRole
            },
            body: JSON.stringify({ query: query, variables: variables })
        }).then(function (r) { return r.json(); });
    }

    // -------------------------------------------------------------------------
    // Получить поминутный тариф для сессии
    // -------------------------------------------------------------------------
    function getHourlyTariff(sessionId) {
        function tryFetch(mins) {
            return gql(
                'query availableTariffsForProlongation($minutes: Int, $sessionId: Int!) {' +
                '  getAvailableTariffsForProlongation(params: {minutes: $minutes, sessionId: $sessionId}) {' +
                '    tariffs { id name durationMin cost }' +
                '  }' +
                '}',
                { sessionId: sessionId, minutes: mins }
            ).then(function (r) {
                return r.data &&
                       r.data.getAvailableTariffsForProlongation &&
                       r.data.getAvailableTariffsForProlongation.tariffs;
            });
        }

        return tryFetch(1)
            .then(function (t) { return (!t || !t.length) ? tryFetch(60) : t; })
            .then(function (t) { return (!t || !t.length) ? tryFetch(30) : t; })
            .then(function (tariffs) {
                if (!tariffs || !tariffs.length) return null;
                // Берём тариф с минимальной длительностью — это поминутный
                var sorted = tariffs.slice().sort(function (a, b) { return a.durationMin - b.durationMin; });
                var t = sorted[0];
                return {
                    tariffId:    t.id,
                    tariffName:  t.name,
                    costPerMin:  t.cost / t.durationMin
                };
            });
    }

    // -------------------------------------------------------------------------
    // Начислить бонусы
    // -------------------------------------------------------------------------
    function depositBonus(walletId, amount, comment) {
        return gql(
            'mutation DepositBalanceWithBonus($amount: Float!, $walletId: Int!, $comment: String) {' +
            '  walletDepositWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) {' +
            '    operationId __typename' +
            '  }' +
            '}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    // -------------------------------------------------------------------------
    // Списать бонусы
    // -------------------------------------------------------------------------
    function withdrawBonus(walletId, amount, comment) {
        return gql(
            'mutation WithdrawBonus($amount: Float!, $walletId: Int!, $comment: String) {' +
            '  walletWithdrawWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) {' +
            '    operationId __typename' +
            '  }' +
            '}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    // -------------------------------------------------------------------------
    // Продлить сеанс (= посадить на почасовой)
    // -------------------------------------------------------------------------
    function prolongSession(sessionId, tariffId, minutes) {
        return gql(
            'mutation prolongateSession($sessionId: Int!, $tariffId: Int!, $minutes: Int) {' +
            '  userReservationProlongate(params: {sessionId: $sessionId, tariffId: $tariffId, minutes: $minutes}) {' +
            '    success __typename' +
            '  }' +
            '}',
            { sessionId: sessionId, tariffId: tariffId, minutes: minutes }
        );
    }

    // -------------------------------------------------------------------------
    // Запросить текущий бонусный баланс кошелька
    // -------------------------------------------------------------------------
    function getBonusBalance(walletId) {
        return gql(
            'query GetWalletBalance($walletId: Int!) {' +
            '  wallets_by_pk(id: $walletId) { bonusBalance }' +
            '}',
            { walletId: walletId }
        ).then(function (r) {
            return r.data && r.data.wallets_by_pk ? r.data.wallets_by_pk.bonusBalance : null;
        });
    }

    // -------------------------------------------------------------------------
    // Мониторинг возврата бонусов после завершения пакетного сеанса
    // Опрашиваем баланс каждые 3 секунды в течение 3 минут.
    // Если баланс вырос — списываем разницу.
    // -------------------------------------------------------------------------
    function watchForBonusReturn(walletId, balanceBefore, label) {
        var attempts = 0;
        var maxAttempts = 60; // 3 минуты
        var intervalMs = 3000;

        var timer = setInterval(function () {
            attempts++;
            if (attempts > maxAttempts) {
                clearInterval(timer);
                return;
            }

            getBonusBalance(walletId).then(function (balanceNow) {
                if (balanceNow === null) return;
                var diff = Math.round((balanceNow - balanceBefore) * 100) / 100;
                if (diff > 0) {
                    clearInterval(timer);
                    var comment = 'Вернулся остаток времени с пакета' + (label ? ' (' + label + ')' : '');
                    withdrawBonus(walletId, diff, comment).catch(function () {});
                }
            }).catch(function () {});
        }, intervalMs);
    }

    // -------------------------------------------------------------------------
    // Модальное окно
    // -------------------------------------------------------------------------
    function showModal(pcName) {
        var session = sessionsData[pcName];
        if (!session) {
            alert('Нет данных о сессии для ПК ' + pcName + '. Подождите обновления таблицы.');
            return;
        }
        if (!session.walletId) {
            alert('Не удалось получить walletId клиента.');
            return;
        }

        var remainMin = Math.ceil(session.remainSec / 60);
        var alreadyHourly = isHourlyTariff(session.tariffName);

        // Удаляем старый модал
        closeModal();

        // Оверлей
        var overlay = document.createElement('div');
        overlay.id = MODAL_ID + '-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;background:rgba(0,0,0,0.55);';
        overlay.addEventListener('click', closeModal);
        document.body.appendChild(overlay);

        // Модал
        var modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.style.cssText = [
            'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
            'z-index:99998;width:440px;max-width:95vw;',
            'background:#1a1a2e;border-radius:12px;',
            'box-shadow:0 8px 32px rgba(0,0,0,0.45);',
            'font-family:inherit;overflow:hidden;',
            'border:1px solid rgba(255,255,255,0.08);',
            'animation:godjiRestartSlide 0.18s ease;'
        ].join('');
        modal.addEventListener('click', function (e) { e.stopPropagation(); });

        // Анимация
        if (!document.getElementById('godji-restart-style')) {
            var sty = document.createElement('style');
            sty.id = 'godji-restart-style';
            sty.textContent = '@keyframes godjiRestartSlide{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}';
            document.head.appendChild(sty);
        }

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0;';

        var titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

        var titleIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        titleIcon.setAttribute('width', '20'); titleIcon.setAttribute('height', '20');
        titleIcon.setAttribute('viewBox', '0 0 24 24'); titleIcon.setAttribute('fill', 'none');
        titleIcon.setAttribute('stroke', '#cc0001'); titleIcon.setAttribute('stroke-width', '2');
        titleIcon.setAttribute('stroke-linecap', 'round'); titleIcon.setAttribute('stroke-linejoin', 'round');
        titleIcon.innerHTML = '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>';

        var titleText = document.createElement('div');
        titleText.style.cssText = 'font-size:17px;font-weight:600;color:#fff;';
        titleText.textContent = 'Перезапуск сеанса — ПК ' + pcName;

        titleWrap.appendChild(titleIcon);
        titleWrap.appendChild(titleText);

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;padding:0;line-height:1;transition:color 0.15s;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('mouseenter', function () { closeBtn.style.color = '#fff'; });
        closeBtn.addEventListener('mouseleave', function () { closeBtn.style.color = 'rgba(255,255,255,0.4)'; });
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        // Инфо-строка
        var infoBar = document.createElement('div');
        infoBar.style.cssText = 'margin:12px 24px 0;padding:10px 14px;background:rgba(255,255,255,0.05);border-radius:8px;display:flex;gap:18px;flex-wrap:wrap;';

        function infoItem(label, value) {
            var wrap = document.createElement('div');
            var lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);display:block;margin-bottom:2px;';
            lbl.textContent = label;
            var val = document.createElement('span');
            val.style.cssText = 'font-size:13px;font-weight:600;color:#fff;';
            val.textContent = value;
            wrap.appendChild(lbl);
            wrap.appendChild(val);
            return wrap;
        }

        infoBar.appendChild(infoItem('Клиент', session.nickname || '—'));
        infoBar.appendChild(infoItem('Тариф', session.tariffName || '—'));
        infoBar.appendChild(infoItem('Остаток', remainMin + ' мин'));

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:16px 24px 24px;';

        // Блок статуса/расчёта
        var statusBlock = document.createElement('div');
        statusBlock.style.cssText = 'padding:12px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;min-height:44px;display:flex;align-items:center;';

        var statusText = document.createElement('span');
        statusText.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.5);';

        if (alreadyHourly) {
            statusText.innerHTML = 'Клиент уже на <strong style="color:#fff;">почасовом тарифе</strong> — бонусы начислять не нужно. Остаток вернётся автоматически при завершении.';
        } else {
            statusText.textContent = 'Рассчитываем стоимость…';
        }
        statusBlock.appendChild(statusText);

        // Кнопки
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:16px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'flex:1;padding:11px;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;transition:background 0.15s;';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('mouseenter', function () { cancelBtn.style.background = 'rgba(255,255,255,0.12)'; });
        cancelBtn.addEventListener('mouseleave', function () { cancelBtn.style.background = 'rgba(255,255,255,0.07)'; });
        cancelBtn.addEventListener('click', closeModal);

        var confirmBtn = document.createElement('button');
        confirmBtn.style.cssText = 'flex:2;padding:11px;background:#e0e0e0;color:#999;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:not-allowed;font-family:inherit;transition:background 0.2s,color 0.2s;';
        confirmBtn.textContent = 'Перезапустить';
        confirmBtn.disabled = true;

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);

        body.appendChild(statusBlock);
        body.appendChild(btnRow);

        modal.appendChild(header);
        modal.appendChild(infoBar);
        modal.appendChild(body);
        document.body.appendChild(modal);

        // -----------------------------------------------------------------
        // Логика: уже почасовой — только продлить без начисления бонусов
        // -----------------------------------------------------------------
        if (alreadyHourly) {
            // Разблокируем кнопку сразу
            confirmBtn.disabled = false;
            confirmBtn.style.background = '#cc0001';
            confirmBtn.style.color = '#fff';
            confirmBtn.style.cursor = 'pointer';

            confirmBtn.addEventListener('click', function () {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Выполняем…';
                confirmBtn.style.opacity = '0.8';

                getHourlyTariff(session.sessionId).then(function (tariffInfo) {
                    if (!tariffInfo) throw new Error('Не удалось получить поминутный тариф');
                    return prolongSession(session.sessionId, tariffInfo.tariffId, remainMin);
                }).then(function (res) {
                    var ok = res && res.data && res.data.userReservationProlongate && res.data.userReservationProlongate.success;
                    if (!ok) throw new Error('Продление не прошло');
                    confirmBtn.textContent = 'Готово!';
                    confirmBtn.style.background = '#2e7d32';
                    setTimeout(closeModal, 1200);
                }).catch(function (err) {
                    confirmBtn.disabled = false;
                    confirmBtn.style.background = '#cc0001';
                    confirmBtn.style.color = '#fff';
                    confirmBtn.style.opacity = '1';
                    confirmBtn.textContent = 'Перезапустить';
                    statusText.textContent = 'Ошибка: ' + (err.message || 'попробуйте ещё раз');
                    statusText.style.color = '#cc0001';
                });
            });

            return; // дальше не идём
        }

        // -----------------------------------------------------------------
        // Логика: пакетный тариф — считаем стоимость, начисляем, продлеваем
        // -----------------------------------------------------------------
        var calcData = null; // { tariffId, tariffName, costPerMin, bonusCost }

        getHourlyTariff(session.sessionId).then(function (tariffInfo) {
            if (!tariffInfo) {
                statusText.textContent = 'Не удалось получить поминутный тариф';
                statusText.style.color = '#cc0001';
                return;
            }

            calcData = tariffInfo;
            var bonusCost = Math.round(tariffInfo.costPerMin * remainMin * 100) / 100;
            calcData.bonusCost = bonusCost;

            statusText.innerHTML =
                'Будет начислено <strong style="color:#fff;">' + bonusCost + ' бонусов</strong> ' +
                'и добавлено <strong style="color:#fff;">' + remainMin + ' мин</strong> ' +
                '<span style="color:rgba(255,255,255,0.35);font-size:11px;">(' + tariffInfo.tariffName.trim() + ')</span>';
            statusText.style.color = 'rgba(255,255,255,0.75)';

            confirmBtn.disabled = false;
            confirmBtn.style.background = '#cc0001';
            confirmBtn.style.color = '#fff';
            confirmBtn.style.cursor = 'pointer';
        }).catch(function () {
            statusText.textContent = 'Ошибка при расчёте тарифа';
            statusText.style.color = '#cc0001';
        });

        confirmBtn.addEventListener('click', function () {
            if (!calcData) return;

            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Выполняем…';
            confirmBtn.style.opacity = '0.8';

            var bonusCost   = calcData.bonusCost;
            var walletId    = session.walletId;
            var comment     = 'Перезапуск сеанса (остаток ' + remainMin + ' мин)';

            // 1. Сохраняем бонусный баланс ДО начисления — нужен для отслеживания возврата
            var balanceBefore = session.bonusBalance;

            // 2. Начисляем бонусы
            depositBonus(walletId, bonusCost, comment)
                .then(function () {
                    // 3. Продлеваем сеанс
                    return prolongSession(session.sessionId, calcData.tariffId, remainMin);
                })
                .then(function (res) {
                    var ok = res && res.data && res.data.userReservationProlongate && res.data.userReservationProlongate.success;
                    if (!ok) throw new Error('Продление не прошло');

                    confirmBtn.textContent = 'Готово!';
                    confirmBtn.style.background = '#2e7d32';
                    confirmBtn.style.opacity = '1';

                    // 4. Запускаем мониторинг возврата бонусов с пакетного тарифа.
                    // balanceAfterDeposit = balanceBefore + bonusCost — именно от этой базы считаем прирост.
                    var balanceAfterDeposit = Math.round((balanceBefore + bonusCost) * 100) / 100;
                    var remainLabel = remainMin + ' мин, ' + (session.tariffName || '');
                    watchForBonusReturn(walletId, balanceAfterDeposit, remainLabel);

                    setTimeout(closeModal, 1200);
                })
                .catch(function (err) {
                    confirmBtn.disabled = false;
                    confirmBtn.style.background = '#cc0001';
                    confirmBtn.style.color = '#fff';
                    confirmBtn.style.opacity = '1';
                    confirmBtn.textContent = 'Перезапустить';
                    statusText.textContent = 'Ошибка: ' + (err.message || 'попробуйте ещё раз');
                    statusText.style.color = '#cc0001';
                });
        });
    }

    function closeModal() {
        var m = document.getElementById(MODAL_ID);
        var o = document.getElementById(MODAL_ID + '-overlay');
        if (m) m.remove();
        if (o) o.remove();
    }

    // -------------------------------------------------------------------------
    // Кнопка в контекстном меню ПК
    // -------------------------------------------------------------------------
    function removeMenuButton() {
        var b = document.getElementById(BUTTON_ID);
        if (b) b.remove();
    }

    function injectMenuButton(pcName) {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');
        if (!menuEl || !pcName) return;

        // Уже есть в этом меню
        var existing = document.getElementById(BUTTON_ID);
        if (existing && menuEl.contains(existing)) return;

        removeMenuButton();

        // Кнопка видна только если есть активная сессия.
        // Признак активности — наличие «Пополнить бонусами» в меню (аналогично free_time).
        var items = menuEl.querySelectorAll('[role="menuitem"]');
        var afterItem = null;
        for (var i = 0; i < items.length; i++) {
            var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
            if (lbl && lbl.textContent.trim() === 'Пополнить бонусами') {
                afterItem = items[i];
                break;
            }
        }
        if (!afterItem) return; // Нет активной сессии

        var btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.className = 'mantine-focus-auto m_99ac2aa1 mantine-Menu-item m_87cf2631 mantine-UnstyledButton-root';
        btn.setAttribute('type', 'button');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-menu-item', 'true');
        btn.setAttribute('data-mantine-stop-propagation', 'true');
        btn.style.cssText = 'color:rgb(204,0,1);background-color:rgba(204,0,1,0.07);--menu-item-color:rgb(204,0,1);--menu-item-hover:rgba(204,0,1,0.12);';
        btn.innerHTML =
            '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">' +
            '<div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/>' +
            '<path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/>' +
            '<path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>' +
            '</svg></div></div>' +
            '<div class="m_5476e0d3 mantine-Menu-itemLabel">Перезапустить сеанс</div>';

        btn.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            document.body.click(); // закрываем меню
            setTimeout(function () { showModal(pcName); }, 50);
        });

        afterItem.parentNode.insertBefore(btn, afterItem.nextSibling);
    }

    // -------------------------------------------------------------------------
    // Отслеживаем, на какой ПК навели / открыли меню
    // -------------------------------------------------------------------------
    document.addEventListener('mouseover', function (e) {
        var row = e.target.closest('tr.mantine-Table-tr');
        if (row) {
            var nc = row.querySelector('td[data-index="0"]') ||
                     row.querySelector('td[style*="col-deviceName-size"]');
            if (nc) {
                lastContextPc = nc.textContent.trim();
                window._godjiLastContextPc = lastContextPc;
            }
            return;
        }
        var card = e.target.closest('.DeviceItem_deviceBox__pzNUf');
        if (card) {
            var ne = card.querySelector('.DeviceItem_deviceName__yC1tT');
            if (ne) {
                lastContextPc = ne.textContent.trim();
                window._godjiLastContextPc = lastContextPc;
            }
        }
    });

    // -------------------------------------------------------------------------
    // MutationObserver для меню (subtree:false — только прямые дети body)
    // -------------------------------------------------------------------------
    var _menuInjectTimer = null;
    var _lastMenuEl = null;

    var menuObserver = new MutationObserver(function () {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');

        if (!menuEl) {
            _lastMenuEl = null;
            return;
        }

        if (menuEl === _lastMenuEl) {
            if (!document.getElementById(BUTTON_ID) && lastContextPc) {
                clearTimeout(_menuInjectTimer);
                _menuInjectTimer = setTimeout(function () {
                    injectMenuButton(lastContextPc);
                }, 50);
            }
            return;
        }

        _lastMenuEl = menuEl;
        clearTimeout(_menuInjectTimer);
        _menuInjectTimer = setTimeout(function () {
            if (lastContextPc) injectMenuButton(lastContextPc);
        }, 50);
    });

    menuObserver.observe(document.body, { childList: true, subtree: false });

})();

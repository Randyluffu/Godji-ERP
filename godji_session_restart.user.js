// ==UserScript==
// @name         Godji — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      3.2
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

    var BUTTON_ID = 'godji-restart-btn';
    var MODAL_ID  = 'godji-restart-modal';
    var API_URL   = 'https://hasura.godji.cloud/v1/graphql';
    var CLUB_ID   = 14;

    var sessionsData  = {};
    var lastContextPc = null;
    var authToken     = null;
    var hasuraRole    = 'club_admin';

    // Тариф считается почасовым — бонусы начислять не нужно
    var HOURLY_MARKERS = ['1 час', '2 час', '3 час', '4 час', 'час', 'мин', 'минут'];
    function isHourlyTariff(name) {
        if (!name) return false;
        var n = name.toLowerCase();
        for (var i = 0; i < HOURLY_MARKERS.length; i++) {
            if (n.indexOf(HOURLY_MARKERS[i].toLowerCase()) !== -1) return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // Fetch-хук
    // -------------------------------------------------------------------------
    var _inRestartFetch = false; // защита от рекурсии
    var _origFetch = null;       // сохраняем самый первый fetch

    function installFetchHook() {
        if (window.fetch && window.fetch._godjiRestartHooked) return;
        _origFetch = window.fetch;
        if (!_origFetch) return;

        window.fetch = function (url, opts) {
            // Наши собственные запросы — пропускаем мимо хука
            if (_inRestartFetch) return _origFetch.call(this, url, opts);
            try {
                var body = (opts && opts.body) ? opts.body : '';

                if (opts && opts.headers && opts.headers.authorization) {
                    authToken = opts.headers.authorization;
                    window._godjiAuthToken = authToken;
                    if (opts.headers['x-hasura-role']) {
                        hasuraRole = opts.headers['x-hasura-role'];
                        window._godjiHasuraRole = hasuraRole;
                    }
                }

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

                    // Шаг 1: базовые данные сессий (XHR — минует fetch-хуки)
                    var xhr1 = new XMLHttpRequest();
                    xhr1.open('POST', API_URL, true);
                    xhr1.setRequestHeader('accept', '*/*');
                    xhr1.setRequestHeader('content-type', 'application/json');
                    xhr1.setRequestHeader('authorization', authToken);
                    xhr1.setRequestHeader('x-hasura-role', hasuraRole);
                    xhr1.onload = function () {
                        try {
                            window._godjiRestartPending = false;
                            var json = JSON.parse(xhr1.responseText);
                            if (!json || !json.data || !json.data.getDashboardDevices) return;

                            var devices   = json.data.getDashboardDevices.devices;
                            var activeIds = [];

                            devices.forEach(function (d) {
                                if (!d.sessions || d.sessions.length === 0) {
                                    delete sessionsData[d.name];
                                    return;
                                }
                                var s = d.sessions[0];
                                if (!s || !s.user || !s.user.wallet) return;
                                sessionsData[d.name] = {
                                    sessionId:  s.id,
                                    status:     s.status,
                                    tariffId:   s.tariff ? s.tariff.id   : null,
                                    tariffName: s.tariff ? s.tariff.name : '',
                                    walletId:   s.user.wallet.id,
                                    nickname:   s.user.nickname || '',
                                    pcName:     d.name,
                                    timeTo:     null
                                };
                                activeIds.push({ pc: d.name, sessionId: s.id });
                            });
                            window._godjiSessionsData = sessionsData;

                            if (!activeIds.length) return;

                            // Шаг 2: time_to из reservations (XHR)
                            var ids = activeIds.map(function (x) { return x.sessionId; });
                            var xhr2 = new XMLHttpRequest();
                            xhr2.open('POST', API_URL, true);
                            xhr2.setRequestHeader('accept', '*/*');
                            xhr2.setRequestHeader('content-type', 'application/json');
                            xhr2.setRequestHeader('authorization', authToken);
                            xhr2.setRequestHeader('x-hasura-role', hasuraRole);
                            xhr2.onload = function () {
                                try {
                                    var json2 = JSON.parse(xhr2.responseText);
                                    if (!json2 || !json2.data || !json2.data.reservations) return;
                                    var timeMap = {};
                                    json2.data.reservations.forEach(function (r) { timeMap[r.id] = r.time_to; });
                                    activeIds.forEach(function (x) {
                                        if (sessionsData[x.pc] && timeMap[x.sessionId]) {
                                            sessionsData[x.pc].timeTo = timeMap[x.sessionId];
                                        }
                                    });
                                    window._godjiSessionsData = sessionsData;
                                } catch (e) {}
                            };
                            xhr2.send(JSON.stringify({
                                query: 'query($ids:[Int!]!) { reservations(where:{id:{_in:$ids}}) { id time_to } }',
                                variables: { ids: ids }
                            }));
                        } catch (e) { window._godjiRestartPending = false; }
                    };
                    xhr1.onerror = function () { window._godjiRestartPending = false; };
                    xhr1.send(JSON.stringify({
                        operationName: 'GetDashboardDevicesForRestart',
                        variables: vars,
                        query: 'query GetDashboardDevicesForRestart($clubId: Int!) {' +
                               '  getDashboardDevices(params: {clubId: $clubId}) {' +
                               '    devices { name sessions {' +
                               '      id status' +
                               '      tariff { id name }' +
                               '      user { nickname wallet { id } }' +
                               '    } }' +
                               '  }' +
                               '}'
                    }));
                }
            } catch (e) {}
            return _origFetch.call(this, url, opts);
        };
        window.fetch._godjiRestartHooked = true;
    }

    installFetchHook();

    // -------------------------------------------------------------------------
    // GraphQL-хелпер
    // -------------------------------------------------------------------------
    // Используем XHR напрямую — не затронут цепочкой fetch-хуков других скриптов
    function gql(query, variables) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', API_URL, true);
            xhr.setRequestHeader('accept', '*/*');
            xhr.setRequestHeader('content-type', 'application/json');
            xhr.setRequestHeader('authorization', authToken || '');
            xhr.setRequestHeader('x-hasura-role', hasuraRole);
            xhr.onload = function () {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (e) { reject(e); }
            };
            xhr.onerror = function () { reject(new Error('XHR error')); };
            xhr.send(JSON.stringify({ query: query, variables: variables || {} }));
        });
    }

    // -------------------------------------------------------------------------
    // Получить поминутный тариф
    // -------------------------------------------------------------------------
    function getHourlyTariff(sessionId) {
        function tryFetch(mins) {
            return gql(
                'query($minutes:Int,$sessionId:Int!){getAvailableTariffsForProlongation(params:{minutes:$minutes,sessionId:$sessionId}){tariffs{id name durationMin cost}}}',
                { sessionId: sessionId, minutes: mins }
            ).then(function (r) {
                return r.data && r.data.getAvailableTariffsForProlongation && r.data.getAvailableTariffsForProlongation.tariffs;
            });
        }
        return tryFetch(1)
            .then(function (t) { return (!t || !t.length) ? tryFetch(60) : t; })
            .then(function (t) { return (!t || !t.length) ? tryFetch(30) : t; })
            .then(function (tariffs) {
                if (!tariffs || !tariffs.length) return null;
                var sorted = tariffs.slice().sort(function (a, b) { return a.durationMin - b.durationMin; });
                var t = sorted[0];
                return { tariffId: t.id, tariffName: t.name, costPerMin: t.cost / t.durationMin };
            });
    }

    // -------------------------------------------------------------------------
    // Начислить бонусы
    // -------------------------------------------------------------------------
    function depositBonus(walletId, amount, comment) {
        return gql(
            'mutation($amount:Float!,$walletId:Int!,$comment:String){walletDepositWithBonus(params:{amount:$amount,walletId:$walletId,description:$comment}){operationId __typename}}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    // -------------------------------------------------------------------------
    // Списать бонусы
    // -------------------------------------------------------------------------
    function withdrawBonus(walletId, amount, comment) {
        return gql(
            'mutation($amount:Float!,$walletId:Int!,$comment:String){walletWithdrawWithBonus(params:{amount:$amount,walletId:$walletId,description:$comment}){operationId __typename}}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    // -------------------------------------------------------------------------
    // Продлить сеанс
    // -------------------------------------------------------------------------
    function prolongSession(sessionId, tariffId, minutes) {
        return gql(
            'mutation($sessionId:Int!,$tariffId:Int!,$minutes:Int){userReservationProlongate(params:{sessionId:$sessionId,tariffId:$tariffId,minutes:$minutes}){success __typename}}',
            { sessionId: sessionId, tariffId: tariffId, minutes: minutes }
        );
    }

    // -------------------------------------------------------------------------
    // Получить последний id операции кошелька — фиксируем точку отсчёта
    // -------------------------------------------------------------------------
    function getLastOpId(walletId) {
        return gql(
            'query($wid:Int!){wallet_operations(where:{wallet_id:{_eq:$wid}},order_by:{id:desc},limit:1){id}}',
            { wid: walletId }
        ).then(function (r) {
            var ops = r && r.data && r.data.wallet_operations;
            return (ops && ops.length) ? ops[0].id : 0;
        });
    }

    // -------------------------------------------------------------------------
    // Мониторинг возврата бонусов от ERP после завершения пакетного сеанса.
    // ERP зачисляет операцию с digest.name="Возврат бонусов" и digest.reservation_id=oldSessionId.
    // Как только такая операция появится — списываем ту же сумму.
    // -------------------------------------------------------------------------
    function watchForBonusReturn(walletId, oldSessionId, lastOpIdBefore) {
        var attempts  = 0;
        var maxChecks = 80; // ~4 минуты
        var timer = setInterval(function () {
            attempts++;
            if (attempts > maxChecks) { clearInterval(timer); return; }

            gql(
                'query($wid:Int!,$afterId:Int!){' +
                '  wallet_operations(' +
                '    where:{wallet_id:{_eq:$wid}, id:{_gt:$afterId}, amount_type:{_eq:"bonus"}, operation_type:{_eq:"deposit"}},' +
                '    order_by:{id:desc},' +
                '    limit:5' +
                '  ){' +
                '    id amount' +
                '    wallet_operation_digest { name reservation_id }' +
                '  }' +
                '}',
                { wid: walletId, afterId: lastOpIdBefore }
            ).then(function (r) {
                var ops = r && r.data && r.data.wallet_operations;
                if (!ops || !ops.length) return;

                ops.forEach(function (op) {
                    var digest = op.wallet_operation_digest;
                    if (
                        digest &&
                        digest.name === 'Возврат бонусов' &&
                        digest.reservation_id === oldSessionId
                    ) {
                        clearInterval(timer);
                        var comment = 'Вернулся остаток времени с пакета (сеанс ' + oldSessionId + ')';
                        withdrawBonus(walletId, op.amount, comment).catch(function () {});
                    }
                });
            }).catch(function () {});
        }, 3000);
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

        var remainMin = 0;
        if (session.timeTo) {
            var msLeft = new Date(session.timeTo).getTime() - Date.now();
            remainMin = Math.max(1, Math.ceil(msLeft / 60000));
        }

        var alreadyHourly = isHourlyTariff(session.tariffName);

        closeModal();

        if (!document.getElementById('godji-restart-style')) {
            var sty = document.createElement('style');
            sty.id = 'godji-restart-style';
            sty.textContent = '@keyframes godjiRSlide{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}';
            document.head.appendChild(sty);
        }

        var overlay = document.createElement('div');
        overlay.id = MODAL_ID + '-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;background:rgba(0,0,0,0.55);';
        overlay.addEventListener('click', closeModal);
        document.body.appendChild(overlay);

        var modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.style.cssText = [
            'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
            'z-index:99998;width:440px;max-width:95vw;',
            'background:#1a1a2e;border-radius:12px;',
            'box-shadow:0 8px 32px rgba(0,0,0,0.45);',
            'font-family:inherit;overflow:hidden;',
            'border:1px solid rgba(255,255,255,0.08);',
            'animation:godjiRSlide 0.18s ease;'
        ].join('');
        modal.addEventListener('click', function (e) { e.stopPropagation(); });

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0;';

        var titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

        var svgNS = 'http://www.w3.org/2000/svg';
        var ico = document.createElementNS(svgNS, 'svg');
        ico.setAttribute('width','20'); ico.setAttribute('height','20');
        ico.setAttribute('viewBox','0 0 24 24'); ico.setAttribute('fill','none');
        ico.setAttribute('stroke','#cc0001'); ico.setAttribute('stroke-width','2');
        ico.setAttribute('stroke-linecap','round'); ico.setAttribute('stroke-linejoin','round');
        ico.innerHTML = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>';

        var titleText = document.createElement('div');
        titleText.style.cssText = 'font-size:17px;font-weight:600;color:#fff;';
        titleText.textContent = 'Перезапуск сеанса — ПК ' + pcName;

        titleWrap.appendChild(ico);
        titleWrap.appendChild(titleText);

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;padding:0;line-height:1;transition:color 0.15s;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('mouseenter', function () { closeBtn.style.color = '#fff'; });
        closeBtn.addEventListener('mouseleave', function () { closeBtn.style.color = 'rgba(255,255,255,0.4)'; });
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        // Инфо-панель
        var infoBar = document.createElement('div');
        infoBar.style.cssText = 'margin:14px 24px 0;padding:10px 14px;background:rgba(255,255,255,0.05);border-radius:8px;display:flex;gap:20px;flex-wrap:wrap;';

        function mkInfo(label, value) {
            var w = document.createElement('div');
            var l = document.createElement('span');
            l.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);display:block;margin-bottom:2px;';
            l.textContent = label;
            var v = document.createElement('span');
            v.style.cssText = 'font-size:13px;font-weight:600;color:#fff;';
            v.textContent = value;
            w.appendChild(l); w.appendChild(v);
            return w;
        }

        infoBar.appendChild(mkInfo('Клиент', session.nickname || '—'));
        infoBar.appendChild(mkInfo('Тариф', session.tariffName || '—'));
        infoBar.appendChild(mkInfo('Остаток', remainMin > 0 ? remainMin + ' мин' : '—'));

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:14px 24px 24px;';

        var statusBlock = document.createElement('div');
        statusBlock.style.cssText = 'padding:12px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;min-height:44px;display:flex;align-items:center;';

        var statusText = document.createElement('span');
        statusText.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.5);line-height:1.5;';
        statusBlock.appendChild(statusText);

        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:14px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'flex:1;padding:11px;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;transition:background 0.15s;';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('mouseenter', function () { cancelBtn.style.background = 'rgba(255,255,255,0.12)'; });
        cancelBtn.addEventListener('mouseleave', function () { cancelBtn.style.background = 'rgba(255,255,255,0.07)'; });
        cancelBtn.addEventListener('click', closeModal);

        var confirmBtn = document.createElement('button');
        confirmBtn.style.cssText = 'flex:2;padding:11px;background:#444;color:#888;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:not-allowed;font-family:inherit;transition:background 0.2s,color 0.2s;';
        confirmBtn.textContent = 'Перезапустить';
        confirmBtn.disabled = true;

        function enableConfirm() {
            confirmBtn.disabled = false;
            confirmBtn.style.background = '#cc0001';
            confirmBtn.style.color = '#fff';
            confirmBtn.style.cursor = 'pointer';
        }

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);
        body.appendChild(statusBlock);
        body.appendChild(btnRow);
        modal.appendChild(header);
        modal.appendChild(infoBar);
        modal.appendChild(body);
        document.body.appendChild(modal);

        // -----------------------------------------------------------------
        // Сценарий А: уже почасовой — просто продлеваем, возврат придёт сам
        // и мониторить не нужно (п.5)
        // -----------------------------------------------------------------
        if (alreadyHourly) {
            if (remainMin > 0) {
                statusText.innerHTML =
                    'Клиент уже на <strong style="color:#fff;">почасовом тарифе</strong>. ' +
                    'Бонусы начислять не нужно — остаток вернётся автоматически. ' +
                    'Продлим сеанс на <strong style="color:#fff;">' + remainMin + ' мин</strong>.';
                enableConfirm();
            } else {
                statusText.textContent = 'Не удалось определить остаток времени. Подождите обновления данных.';
            }

            confirmBtn.addEventListener('click', function () {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Выполняем…';
                confirmBtn.style.opacity = '0.8';

                getHourlyTariff(session.sessionId).then(function (info) {
                    if (!info) throw new Error('Не удалось получить поминутный тариф');
                    return prolongSession(session.sessionId, info.tariffId, remainMin);
                }).then(function (res) {
                    if (!res || !res.data || !res.data.userReservationProlongate || !res.data.userReservationProlongate.success) {
                        throw new Error('Продление не прошло');
                    }
                    confirmBtn.textContent = 'Готово!';
                    confirmBtn.style.background = '#2e7d32';
                    confirmBtn.style.opacity = '1';
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
            return;
        }

        // -----------------------------------------------------------------
        // Сценарий Б: пакетный тариф
        // 1. Начисляем бонусы = стоимость остатка по поминутному тарифу
        // 2. Продлеваем сеанс на поминутном тарифе
        // 3. Мониторим: когда ERP вернёт бонусы за недоигранный пакет
        //    (digest.name="Возврат бонусов", digest.reservation_id=oldSessionId)
        //    — списываем эту сумму
        // -----------------------------------------------------------------
        if (remainMin <= 0) {
            statusText.textContent = 'Не удалось определить остаток времени. Подождите обновления данных.';
            return;
        }

        var calcData = null;
        statusText.textContent = 'Рассчитываем стоимость…';

        getHourlyTariff(session.sessionId).then(function (info) {
            if (!info) {
                statusText.textContent = 'Не удалось получить поминутный тариф. Попробуйте позже.';
                statusText.style.color = '#cc0001';
                return;
            }
            var bonusCost = Math.round(info.costPerMin * remainMin * 100) / 100;
            calcData = { tariffId: info.tariffId, tariffName: info.tariffName, bonusCost: bonusCost };

            statusText.innerHTML =
                'Будет начислено <strong style="color:#fff;">' + bonusCost + ' бонусов</strong> ' +
                'и добавлено <strong style="color:#fff;">' + remainMin + ' мин</strong> ' +
                '<span style="color:rgba(255,255,255,0.35);font-size:11px;">' +
                '(' + info.tariffName.trim() + ', ' + info.costPerMin.toFixed(2) + ' б/мин)</span>';
            statusText.style.color = 'rgba(255,255,255,0.75)';
            enableConfirm();
        }).catch(function () {
            statusText.textContent = 'Ошибка при получении тарифа.';
            statusText.style.color = '#cc0001';
        });

        confirmBtn.addEventListener('click', function () {
            if (!calcData) return;
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Выполняем…';
            confirmBtn.style.opacity = '0.8';

            var walletId    = session.walletId;
            var oldSessionId = session.sessionId;
            var bonusCost   = calcData.bonusCost;
            var comment     = 'Перезапуск сеанса (остаток ' + remainMin + ' мин)';

            // Фиксируем последний id операции ДО наших изменений
            getLastOpId(walletId)
            .then(function (lastOpId) {
                // 1. Начисляем бонусы
                return depositBonus(walletId, bonusCost, comment)
                .then(function () {
                    // 2. Продлеваем сеанс
                    return prolongSession(oldSessionId, calcData.tariffId, remainMin);
                })
                .then(function (res) {
                    if (!res || !res.data || !res.data.userReservationProlongate || !res.data.userReservationProlongate.success) {
                        throw new Error('Продление не прошло');
                    }
                    confirmBtn.textContent = 'Готово!';
                    confirmBtn.style.background = '#2e7d32';
                    confirmBtn.style.opacity = '1';

                    // 3. Мониторим возврат бонусов от ERP за пакетный сеанс
                    watchForBonusReturn(walletId, oldSessionId, lastOpId);

                    setTimeout(closeModal, 1200);
                });
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

        var existing = document.getElementById(BUTTON_ID);
        if (existing && menuEl.contains(existing)) return;
        removeMenuButton();

        // Только при активной сессии — признак: наличие «Пополнить бонусами»
        var items = menuEl.querySelectorAll('[role="menuitem"]');
        var afterItem = null;
        for (var i = 0; i < items.length; i++) {
            var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
            if (lbl && lbl.textContent.trim() === 'Пополнить бонусами') {
                afterItem = items[i];
                break;
            }
        }
        if (!afterItem) return;

        var btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.className = 'mantine-focus-auto m_99ac2aa1 mantine-Menu-item m_87cf2631 mantine-UnstyledButton-root';
        btn.setAttribute('type', 'button');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-menu-item', 'true');
        btn.setAttribute('data-mantine-stop-propagation', 'true');
        btn.style.cssText = 'color:rgb(204,0,1);--menu-item-color:rgb(204,0,1);--menu-item-hover:rgba(204,0,1,0.08);';
        btn.innerHTML =
            '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">' +
            '<div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"' +
            ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
            '<path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>' +
            '</svg></div></div>' +
            '<div class="m_5476e0d3 mantine-Menu-itemLabel">Перезапустить сеанс</div>';

        btn.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            document.body.click();
            setTimeout(function () { showModal(pcName); }, 50);
        });

        afterItem.parentNode.insertBefore(btn, afterItem.nextSibling);
    }

    // -------------------------------------------------------------------------
    // Отслеживаем ПК под курсором
    // -------------------------------------------------------------------------
    document.addEventListener('mouseover', function (e) {
        var row = e.target.closest('tr.mantine-Table-tr');
        if (row) {
            var nc = row.querySelector('td[data-index="0"]') ||
                     row.querySelector('td[style*="col-deviceName-size"]');
            if (nc) { lastContextPc = nc.textContent.trim(); window._godjiLastContextPc = lastContextPc; }
            return;
        }
        var card = e.target.closest('.DeviceItem_deviceBox__pzNUf');
        if (card) {
            var ne = card.querySelector('.DeviceItem_deviceName__yC1tT');
            if (ne) { lastContextPc = ne.textContent.trim(); window._godjiLastContextPc = lastContextPc; }
        }
    });

    // -------------------------------------------------------------------------
    // MutationObserver для меню — subtree:false
    // -------------------------------------------------------------------------
    var _menuInjectTimer = null;
    var _lastMenuEl = null;

    var menuObserver = new MutationObserver(function () {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');
        if (!menuEl) { _lastMenuEl = null; return; }

        if (menuEl === _lastMenuEl) {
            if (!document.getElementById(BUTTON_ID) && lastContextPc) {
                clearTimeout(_menuInjectTimer);
                _menuInjectTimer = setTimeout(function () { injectMenuButton(lastContextPc); }, 50);
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

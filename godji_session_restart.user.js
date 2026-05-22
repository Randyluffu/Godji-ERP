// ==UserScript==
// @name         Godji — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Перезапускает сеанс с сохранением остатка времени на почасовом тарифе
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
    var API_URL   = 'https://hasura.godji.cloud/v1/graphql';
    var CLUB_ID   = 14;

    var sessionsData  = {};
    var lastContextPc = null;
    var authToken     = null;
    var hasuraRole    = 'club_admin';

    // Пакетные тарифы — содержат эти слова (почасовые их не содержат)
    var PACKAGE_MARKERS = ['ночь', 'сутки', 'день', 'пакет', 'безлимит'];

    function isPackageTariff(name) {
        if (!name) return false;
        var n = name.toLowerCase();
        for (var i = 0; i < PACKAGE_MARKERS.length; i++) {
            if (n.indexOf(PACKAGE_MARKERS[i]) !== -1) return true;
        }
        return false;
    }

    // -------------------------------------------------------------------------
    // XHR-хелпер — обходит цепочку fetch-хуков других скриптов
    // -------------------------------------------------------------------------
    function xhrGql(query, variables) {
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
    // Fetch-хук — только для перехвата токена и триггера обновления данных
    // -------------------------------------------------------------------------
    function installFetchHook() {
        if (window.fetch && window.fetch._godjiRestartHooked) return;
        var origFetch = window.fetch;
        if (!origFetch) return;

        window.fetch = function (url, opts) {
            try {
                if (opts && opts.headers && opts.headers.authorization) {
                    authToken = opts.headers.authorization;
                    window._godjiAuthToken = authToken;
                    if (opts.headers['x-hasura-role']) {
                        hasuraRole = opts.headers['x-hasura-role'];
                        window._godjiHasuraRole = hasuraRole;
                    }
                }

                var body = (opts && opts.body) ? opts.body : '';
                if (
                    authToken &&
                    typeof body === 'string' &&
                    body.indexOf('GetDashboardTable') !== -1 &&
                    !window._godjiRestartPending
                ) {
                    window._godjiRestartPending = true;
                    setTimeout(function () { window._godjiRestartPending = false; }, 3000);

                    var vars;
                    try { vars = JSON.parse(body).variables; } catch (e) { vars = { clubId: CLUB_ID }; }
                    fetchSessionsData(vars);
                }
            } catch (e) {}
            return origFetch.call(this, url, opts);
        };
        window.fetch._godjiRestartHooked = true;
    }

    installFetchHook();

    // -------------------------------------------------------------------------
    // Загрузка данных сессий через XHR (два запроса)
    // -------------------------------------------------------------------------
    function fetchSessionsData(vars) {
        xhrGql(
            'query GetDashboardDevicesForRestart($clubId: Int!) {' +
            '  getDashboardDevices(params: {clubId: $clubId}) {' +
            '    devices { name sessions {' +
            '      id status' +
            '      tariff { id name }' +
            '      user { nickname wallet { id } }' +
            '    } }' +
            '  }' +
            '}',
            vars
        ).then(function (json) {
            window._godjiRestartPending = false;
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

            // Шаг 2: time_to
            var ids = activeIds.map(function (x) { return x.sessionId; });
            xhrGql(
                'query($ids:[Int!]!) { reservations(where:{id:{_in:$ids}}) { id time_to } }',
                { ids: ids }
            ).then(function (json2) {
                if (!json2 || !json2.data || !json2.data.reservations) return;
                var timeMap = {};
                json2.data.reservations.forEach(function (r) { timeMap[r.id] = r.time_to; });
                activeIds.forEach(function (x) {
                    if (sessionsData[x.pc] && timeMap[x.sessionId]) {
                        sessionsData[x.pc].timeTo = timeMap[x.sessionId];
                    }
                });
                window._godjiSessionsData = sessionsData;
            }).catch(function () {});
        }).catch(function () { window._godjiRestartPending = false; });
    }

    // -------------------------------------------------------------------------
    // API-вызовы
    // -------------------------------------------------------------------------
    function cancelSession(sessionId) {
        return xhrGql(
            'mutation($sessionId:Int!){userReservationCancel(params:{sessionId:$sessionId}){success __typename}}',
            { sessionId: sessionId }
        );
    }

    function getHourlyTariff(sessionId) {
        function tryFetch(mins) {
            return xhrGql(
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

    function getLastOpId(walletId) {
        return xhrGql(
            'query($wid:Int!){wallet_operations(where:{wallet_id:{_eq:$wid}},order_by:{id:desc},limit:1){id}}',
            { wid: walletId }
        ).then(function (r) {
            var ops = r && r.data && r.data.wallet_operations;
            return (ops && ops.length) ? ops[0].id : 0;
        });
    }

    function depositBonus(walletId, amount, comment) {
        return xhrGql(
            'mutation($amount:Float!,$walletId:Int!,$comment:String){walletDepositWithBonus(params:{amount:$amount,walletId:$walletId,description:$comment}){operationId __typename}}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    function withdrawBonus(walletId, amount, comment) {
        return xhrGql(
            'mutation($amount:Float!,$walletId:Int!,$comment:String){walletWithdrawWithBonus(params:{amount:$amount,walletId:$walletId,description:$comment}){operationId __typename}}',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    function createSession(deviceId, walletId, tariffId, minutes) {
        return xhrGql(
            'mutation CreateBooking($deviceId:Int!,$walletId:Int!,$tariffId:Int!,$minutes:Int){' +
            '  userReservationCreate(params:{deviceId:$deviceId,walletId:$walletId,tariffId:$tariffId,minutes:$minutes,isDirect:true}){' +
            '    id __typename' +
            '  }' +
            '}',
            { deviceId: deviceId, walletId: walletId, tariffId: tariffId, minutes: minutes }
        ).then(function (r) {
            if (r && r.errors) {
                // Retry без isDirect
                return xhrGql(
                    'mutation CreateBooking($deviceId:Int!,$walletId:Int!,$tariffId:Int!,$minutes:Int){' +
                    '  userReservationCreate(params:{deviceId:$deviceId,walletId:$walletId,tariffId:$tariffId,minutes:$minutes}){' +
                    '    id __typename' +
                    '  }' +
                    '}',
                    { deviceId: deviceId, walletId: walletId, tariffId: tariffId, minutes: minutes }
                );
            }
            return r;
        });
    }

    // Получить deviceId по имени ПК
    function getDeviceId(pcName) {
        return xhrGql(
            'query($clubId:Int!){getDashboardDevices(params:{clubId:$clubId}){devices{name deviceId}}}',
            { clubId: CLUB_ID }
        ).then(function (r) {
            if (!r || !r.data || !r.data.getDashboardDevices) return null;
            var dev = r.data.getDashboardDevices.devices.find(function (d) { return d.name === pcName; });
            return dev ? dev.deviceId : null;
        });
    }

    // -------------------------------------------------------------------------
    // Мониторинг возврата бонусов от ERP
    // -------------------------------------------------------------------------
    function watchForBonusReturn(walletId, oldSessionId, lastOpIdBefore, comment) {
        var attempts = 0;
        var timer = setInterval(function () {
            attempts++;
            if (attempts > 80) { clearInterval(timer); return; }

            xhrGql(
                'query($wid:Int!,$afterId:Int!){' +
                '  wallet_operations(where:{wallet_id:{_eq:$wid},id:{_gt:$afterId},amount_type:{_eq:"bonus"},operation_type:{_eq:"deposit"}},order_by:{id:desc},limit:5){' +
                '    id amount wallet_operation_digest{name reservation_id}' +
                '  }' +
                '}',
                { wid: walletId, afterId: lastOpIdBefore }
            ).then(function (r) {
                var ops = r && r.data && r.data.wallet_operations;
                if (!ops || !ops.length) return;
                ops.forEach(function (op) {
                    var d = op.wallet_operation_digest;
                    if (d && d.name === 'Возврат бонусов' && d.reservation_id === oldSessionId) {
                        clearInterval(timer);
                        withdrawBonus(walletId, op.amount, comment).catch(function () {});
                    }
                });
            }).catch(function () {});
        }, 3000);
    }

    // -------------------------------------------------------------------------
    // Уведомление вместо модалки
    // -------------------------------------------------------------------------
    function notify(msg, type) {
        // type: 'info' | 'ok' | 'err'
        var el = document.createElement('div');
        var colors = { ok: '#2e7d32', err: '#cc0001', info: '#1a1a2e' };
        el.style.cssText = [
            'position:fixed;bottom:24px;right:24px;z-index:99999;',
            'background:' + (colors[type] || colors.info) + ';',
            'color:#fff;font-family:inherit;font-size:13px;font-weight:500;',
            'padding:12px 18px;border-radius:8px;max-width:340px;line-height:1.5;',
            'box-shadow:0 4px 16px rgba(0,0,0,0.4);',
            'border:1px solid rgba(255,255,255,0.1);',
            'animation:godjiNotifyIn 0.2s ease;'
        ].join('');
        el.textContent = msg;

        if (!document.getElementById('godji-restart-style')) {
            var sty = document.createElement('style');
            sty.id = 'godji-restart-style';
            sty.textContent = '@keyframes godjiNotifyIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
            document.head.appendChild(sty);
        }

        document.body.appendChild(el);
        setTimeout(function () {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
        }, type === 'err' ? 5000 : 3000);
    }

    // -------------------------------------------------------------------------
    // Основная логика перезапуска
    // -------------------------------------------------------------------------
    function doRestart(pcName) {
        var session = sessionsData[pcName];
        if (!session) { notify('Нет данных о сессии ПК ' + pcName + '. Подождите обновления.', 'err'); return; }
        if (!session.walletId) { notify('Не удалось получить кошелёк клиента.', 'err'); return; }
        if (!session.timeTo) { notify('Нет данных об остатке времени. Подождите обновления.', 'err'); return; }

        var msLeft    = new Date(session.timeTo).getTime() - Date.now();
        var remainMin = Math.max(1, Math.ceil(msLeft / 60000));
        var walletId  = session.walletId;
        var oldSessionId = session.sessionId;
        var wasPackage   = isPackageTariff(session.tariffName);

        notify('Перезапуск сеанса ПК ' + pcName + '… (' + remainMin + ' мин)', 'info');

        // Шаг 1: фиксируем lastOpId ДО всех действий
        getLastOpId(walletId)
        .then(function (lastOpId) {

            // Шаг 2: получаем поминутный тариф для этого сеанса
            return getHourlyTariff(oldSessionId)
            .then(function (tariffInfo) {
                if (!tariffInfo) throw new Error('Не удалось получить поминутный тариф');

                var bonusCost = Math.round(tariffInfo.costPerMin * remainMin * 100) / 100;

                // Шаг 3: завершаем текущий сеанс
                return cancelSession(oldSessionId)
                .then(function (res) {
                    if (!res || !res.data || !res.data.userReservationCancel || !res.data.userReservationCancel.success) {
                        throw new Error('Не удалось завершить сеанс');
                    }

                    // Шаг 4: если был пакетный — мониторим возврат бонусов от ERP
                    if (wasPackage) {
                        watchForBonusReturn(
                            walletId,
                            oldSessionId,
                            lastOpId,
                            'Вернулся остаток времени с пакета (сеанс ' + oldSessionId + ')'
                        );
                    }

                    // Шаг 5: начисляем бонусы для нового сеанса
                    var comment = 'Перезапуск сеанса (остаток ' + remainMin + ' мин)';
                    return depositBonus(walletId, bonusCost, comment);
                })
                .then(function () {
                    // Шаг 6: получаем deviceId и сажаем на почасовой
                    return getDeviceId(pcName)
                    .then(function (deviceId) {
                        if (!deviceId) throw new Error('Не удалось получить deviceId ПК ' + pcName);
                        return createSession(deviceId, walletId, tariffInfo.tariffId, remainMin);
                    });
                })
                .then(function (res) {
                    if (res && res.errors) {
                        throw new Error(JSON.stringify(res.errors[0].message || res.errors));
                    }
                    notify('ПК ' + pcName + ': сеанс перезапущен на ' + remainMin + ' мин', 'ok');
                });
            });
        })
        .catch(function (err) {
            notify('ПК ' + pcName + ': ошибка — ' + (err.message || err), 'err');
        });
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
            var pc = lastContextPc;
            document.body.click();
            setTimeout(function () { doRestart(pc); }, 50);
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

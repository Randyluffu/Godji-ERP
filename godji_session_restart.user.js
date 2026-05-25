// ==UserScript==
// @name         Godji — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Перезапускает сеанс с сохранением остатка времени и типа тарифа
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

    // Определяем тип тарифа по полю type из API
    // wasPackage = true если оригинальный тариф был пакетным
    var PACKAGE_MARKERS = ['ночь', 'сутки', 'день', 'пакет', 'безлимит'];
    function isPackageTariffName(name) {
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
    // Загрузка данных сессий (два XHR-запроса)
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

    // Получить все доступные тарифы для ПК на заданное окно времени
    function getBookingTariffs(deviceId, fromMs, durationMin) {
        var from = new Date(fromMs).toISOString();
        var to   = new Date(fromMs + durationMin * 60000).toISOString();
        return xhrGql(
            'query($clubId:Int!,$deviceId:Int!,$from:timestamptz!,$to:timestamptz!){' +
            '  getBookingTariffs(params:{clubId:$clubId,deviceId:$deviceId,timeline:{from:$from,to:$to}}){' +
            '    tariffs{id name type durationMin cost sessionEnd}' +
            '  }' +
            '}',
            { clubId: CLUB_ID, deviceId: deviceId, from: from, to: to }
        ).then(function (r) {
            return r && r.data && r.data.getBookingTariffs && r.data.getBookingTariffs.tariffs || [];
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

    function createSession(deviceId, userId, tariffId, fromMs, toMs) {
        var sessionStart = new Date(fromMs).toISOString();
        var sessionEnd   = new Date(toMs).toISOString();
        var vars = { clubId: CLUB_ID, deviceId: deviceId, tariffId: tariffId,
                     sessionStart: sessionStart, sessionEnd: sessionEnd, userId: userId, isDirect: true };
        var q = 'mutation CreateBooking($clubId:Int!,$deviceId:Int!,$tariffId:Int!,$sessionStart:timestamptz!,$sessionEnd:timestamptz!,$userId:String!,$isDirect:Boolean){' +
                '  userReservationCreate(params:{clubId:$clubId,deviceId:$deviceId,tariffId:$tariffId,sessionStart:$sessionStart,sessionEnd:$sessionEnd,userId:$userId,isDirect:$isDirect}){' +
                '    reservationId __typename' +
                '  }' +
                '}';
        return xhrGql(q, vars).then(function (r) {
            if (r && r.errors) {
                var vars2 = { clubId: CLUB_ID, deviceId: deviceId, tariffId: tariffId,
                              sessionStart: sessionStart, sessionEnd: sessionEnd, userId: userId };
                return xhrGql(q.replace(',$isDirect:Boolean', '').replace(',isDirect:$isDirect', ''), vars2);
            }
            return r;
        });
    }

    function prolongSession(sessionId, tariffId, fromMs, toMs) {
        var sessionStart = new Date(fromMs).toISOString();
        var sessionEnd   = new Date(toMs).toISOString();
        return xhrGql(
            'mutation ProlongSession($sessionId:Int!,$tariffId:Int!,$sessionStart:timestamptz!,$sessionEnd:timestamptz!){' +
            '  userReservationProlongate(params:{sessionId:$sessionId,tariffId:$tariffId,sessionStart:$sessionStart,sessionEnd:$sessionEnd}){' +
            '    success __typename' +
            '  }' +
            '}',
            { sessionId: sessionId, tariffId: tariffId, sessionStart: sessionStart, sessionEnd: sessionEnd }
        );
    }

    function getDeviceAndUser(pcName, walletId) {
        return xhrGql(
            'query($clubId:Int!,$name:String!){club_devices(where:{club_id:{_eq:$clubId},name:{_eq:$name}}){id}}',
            { clubId: CLUB_ID, name: pcName }
        ).then(function (r) {
            if (!r || !r.data || !r.data.club_devices || !r.data.club_devices.length) {
                throw new Error('Не удалось получить deviceId ПК ' + pcName);
            }
            var deviceId = r.data.club_devices[0].id;
            return xhrGql(
                'query($wid:Int!){wallets_by_pk(id:$wid){user_id}}',
                { wid: walletId }
            ).then(function (r2) {
                if (!r2 || !r2.data || !r2.data.wallets_by_pk || !r2.data.wallets_by_pk.user_id) {
                    throw new Error('Не удалось получить userId клиента');
                }
                return { deviceId: deviceId, userId: r2.data.wallets_by_pk.user_id };
            });
        });
    }

    // Ждём возврата бонусов от ERP (для почасового тарифа)
    function waitForBonusReturn(walletId, oldSessionId, lastOpIdBefore) {
        return new Promise(function (resolve, reject) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (attempts > 40) {
                    clearInterval(timer);
                    reject(new Error('ERP не вернул бонусы в течение 2 минут'));
                    return;
                }
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
                            resolve(op.amount);
                        }
                    });
                }).catch(function () {});
            }, 3000);
        });
    }

    // -------------------------------------------------------------------------
    // Подбор комбинации тарифов для пакетного перезапуска
    //
    // Задача: набрать ровно remainMin минут, итоговый тип — пакетный.
    // Стратегия: берём наибольший пакет ≤ remainMin, остаток добираем почасовым СНАЧАЛА.
    // Пример: remainMin=252, пакеты [180, 300] → берём 180, hourlyMin=72
    //   → сначала почасовой 72 мин, потом пакет 3ч. Итого 252 мин, тип пакетный.
    //
    // Стоимость почасового добора берётся отдельным запросом getBookingTariffs
    // на окно [now, now+hourlyMin] — API сам учтёт смену прайса внутри окна.
    // -------------------------------------------------------------------------
    function buildPackagePlan(tariffs, remainMin) {
        var packetTariffs = tariffs.filter(function (t) { return t.type === 'packet'; });
        var minuteTariff  = tariffs.filter(function (t) { return t.type === 'minute'; })[0];

        if (!packetTariffs.length) return null;

        // Сортируем пакеты по длительности по убыванию
        packetTariffs.sort(function (a, b) { return b.durationMin - a.durationMin; });

        // Ищем наибольший пакет ≤ remainMin
        var bestPacket = null;
        for (var i = 0; i < packetTariffs.length; i++) {
            if (packetTariffs[i].durationMin <= remainMin) {
                bestPacket = packetTariffs[i];
                break;
            }
        }

        if (!bestPacket) {
            // Все пакеты больше remainMin — берём наименьший пакет, hourlyMin=0
            packetTariffs.sort(function (a, b) { return a.durationMin - b.durationMin; });
            bestPacket = packetTariffs[0];
        }

        var hourlyMin = remainMin - bestPacket.durationMin;

        return {
            packet:      bestPacket,
            minuteTariff: hourlyMin > 0 ? minuteTariff : null,
            hourlyMin:   Math.max(0, hourlyMin)
            // totalCost считается после отдельного запроса стоимости почасового добора
        };
    }

    // -------------------------------------------------------------------------
    // Уведомление
    // -------------------------------------------------------------------------
    function notify(msg, type) {
        var el = document.createElement('div');
        var colors = { ok: '#2e7d32', err: '#b71c1c', info: '#1a1a2e' };
        el.style.cssText = [
            'position:fixed;bottom:24px;right:24px;z-index:99999;',
            'background:' + (colors[type] || colors.info) + ';',
            'color:#fff;font-family:inherit;font-size:13px;font-weight:500;',
            'padding:12px 18px;border-radius:8px;max-width:360px;line-height:1.5;',
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
        if (!session)        { notify('Нет данных о сессии ПК ' + pcName + '. Подождите обновления.', 'err'); return; }
        if (!session.walletId) { notify('Не удалось получить кошелёк клиента.', 'err'); return; }
        if (!session.timeTo)   { notify('Нет данных об остатке времени. Подождите обновления.', 'err'); return; }

        var msLeft       = new Date(session.timeTo).getTime() - Date.now();
        var remainMin    = Math.max(1, Math.ceil(msLeft / 60000));
        var walletId     = session.walletId;
        var oldSessionId = session.sessionId;
        var wasPackage   = isPackageTariffName(session.tariffName);

        notify('Перезапуск сеанса ПК ' + pcName + '… (' + remainMin + ' мин)', 'info');

        Promise.all([
            getLastOpId(walletId),
            getDeviceAndUser(pcName, walletId)
        ])
        .then(function (res0) {
            var lastOpId = res0[0];
            var devInfo  = res0[1];
            var deviceId = devInfo.deviceId;
            var userId   = devInfo.userId;

            // Получаем тарифы для нужного окна времени
            return getBookingTariffs(deviceId, Date.now(), remainMin)
            .then(function (tariffs) {
                if (!tariffs || !tariffs.length) throw new Error('Нет доступных тарифов для ПК ' + pcName);

                var minuteTariff = tariffs.filter(function (t) { return t.type === 'minute'; })[0];
                if (!minuteTariff) throw new Error('Поминутный тариф недоступен');

                // Завершаем текущий сеанс
                return cancelSession(oldSessionId)
                .then(function (cr) {
                    if (!cr || !cr.data || !cr.data.userReservationCancel || !cr.data.userReservationCancel.success) {
                        throw new Error('Не удалось завершить сеанс');
                    }

                    if (!wasPackage) {
                        // -------------------------------------------------------
                        // ПОЧАСОВОЙ → ПОЧАСОВОЙ
                        // Ждём возврата бонусов от ERP, затем сажаем на почасовой
                        // -------------------------------------------------------
                        return waitForBonusReturn(walletId, oldSessionId, lastOpId)
                        .then(function () {
                            var now = Date.now();
                            return createSession(deviceId, userId, minuteTariff.id, now, now + remainMin * 60000);
                        });

                    } else {
                        // -------------------------------------------------------
                        // ПАКЕТНЫЙ → ПАКЕТНЫЙ
                        // Подбираем комбинацию, начисляем бонусы, сажаем
                        // -------------------------------------------------------
                        var plan = buildPackagePlan(tariffs, remainMin);
                        if (!plan) throw new Error('Не найден подходящий пакетный тариф для ' + remainMin + ' мин');

                        // Получаем точную стоимость почасового добора отдельным запросом
                        var hourlyPricePromise;
                        if (plan.hourlyMin > 0) {
                            hourlyPricePromise = getBookingTariffs(deviceId, Date.now(), plan.hourlyMin)
                            .then(function (t2) {
                                var mt = t2.filter(function (t) { return t.type === 'minute'; })[0];
                                return mt ? mt.cost : 0;
                            });
                        } else {
                            hourlyPricePromise = Promise.resolve(0);
                        }

                        return hourlyPricePromise.then(function (hourlyCost) {
                            var totalCost = Math.round((plan.packet.cost + hourlyCost) * 100) / 100;
                            var comment   = 'Перезапуск сеанса (остаток ' + remainMin + ' мин)';

                            return depositBonus(walletId, totalCost, comment)
                            .then(function () {
                                var now = Date.now();

                                if (plan.hourlyMin > 0) {
                                    // Сначала почасовой на hourlyMin, потом продление пакетом
                                    var hourlyStart = now;
                                    var hourlyEnd   = now + plan.hourlyMin * 60000;
                                    var packetEnd   = hourlyEnd + plan.packet.durationMin * 60000;

                                    return createSession(deviceId, userId, plan.minuteTariff.id, hourlyStart, hourlyEnd)
                                    .then(function (cr2) {
                                        if (cr2 && cr2.errors) throw new Error(cr2.errors[0] && cr2.errors[0].message || 'Ошибка создания почасового сеанса');
                                        var newSessionId = cr2 && cr2.data && cr2.data.userReservationCreate && cr2.data.userReservationCreate.reservationId;
                                        if (!newSessionId) throw new Error('Не получен id нового сеанса');
                                        return prolongSession(newSessionId, plan.packet.id, hourlyEnd, packetEnd);
                                    });
                                } else {
                                    // Просто пакет
                                    var pEnd = now + plan.packet.durationMin * 60000;
                                    return createSession(deviceId, userId, plan.packet.id, now, pEnd);
                                }
                            });
                        });
                    }
                });
            })
            .then(function (finalRes) {
                if (finalRes && finalRes.errors) {
                    throw new Error(finalRes.errors[0] && finalRes.errors[0].message ? finalRes.errors[0].message : JSON.stringify(finalRes.errors));
                }
                notify('ПК ' + pcName + ': сеанс перезапущен на ' + remainMin + ' мин', 'ok');
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

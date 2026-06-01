// ==UserScript==
// @name         Godji — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      5.27
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

    // clubId определяется из cookie/localStorage — работает на любом филиале
    function CLUB_ID() { return (typeof window._godjiClubId === 'function') ? window._godjiClubId() : 14; }

    var BUTTON_ID = 'godji-restart-btn';
    var API_URL   = 'https://hasura.godji.cloud/v1/graphql';
    
    var sessionsData  = {};
    var lastContextPc = null;
    var authToken     = null;
    var hasuraRole    = 'club_admin';

    // Определяем тип тарифа по названию.
    // Почасовой (minute) = содержит "1 час" (ровно один час).
    // Всё остальное — пакетный: "3 часа", "5 часов", "Ночь", "Сутки" и т.д.
    // Дополнительно: если getBookingTariffs вернул tariffType — используем его.
    function isPackageTariff(tariffName, tariffType) {
        // Приоритет — поле type из API если есть
        if (tariffType === 'packet') return true;
        if (tariffType === 'minute') return false;
        // Fallback по названию — "1 час" или "Standart" в начале = поминутный
        if (!tariffName) return false;
        var n = tariffName.toLowerCase();
        if (/^1\s*час/.test(n)) return false;
        if (/standart|стандарт/i.test(n)) return false;
        // Всё остальное — пакет
        return true;
    }

    // -------------------------------------------------------------------------
    // XHR-хелпер — обходит цепочку fetch-хуков других скриптов
    // -------------------------------------------------------------------------
    function xhrGql(query, variables) {
        return new Promise(function (resolve, reject) {
            var tok = authToken || window._godjiAuthToken || '';
            var role = hasuraRole || window._godjiHasuraRole || 'club_admin';
            var xhr = new XMLHttpRequest();
            xhr.open('POST', API_URL, true);
            xhr.setRequestHeader('accept', '*/*');
            xhr.setRequestHeader('content-type', 'application/json');
            xhr.setRequestHeader('authorization', tok);
            xhr.setRequestHeader('x-hasura-role', role);
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
                    (body.indexOf('GetDashboardTable') !== -1 ||
                     body.indexOf('GetDashboardDevices') !== -1 ||
                     body.indexOf('getDashboardDevices') !== -1) &&
                    !window._godjiRestartPending
                ) {
                    window._godjiRestartPending = true;
                    setTimeout(function () { window._godjiRestartPending = false; }, 3000);
                    var vars;
                    try { vars = JSON.parse(body).variables; } catch (e) { vars = { clubId: (typeof CLUB_ID==='function'?CLUB_ID():CLUB_ID) }; }
                    fetchSessionsData(vars);
                }
            } catch (e) {}
            return origFetch.call(this, url, opts);
        };
        window.fetch._godjiRestartHooked = true;
    }

    installFetchHook();

    // Самостоятельный поллинг данных — каждые 10 секунд, не зависит от перехвата чужих запросов
    function startPolling() {
        // Первый запрос сразу после получения токена
        var _pollTimer = null;
        var _pollStarted = false;

        function tryPoll() {
            if (!authToken) return;
            if (!_pollStarted) {
                _pollStarted = true;
                fetchSessionsData({ clubId: typeof CLUB_ID === 'function' ? CLUB_ID() : CLUB_ID });
                _pollTimer = setInterval(function() {
                    fetchSessionsData({ clubId: typeof CLUB_ID === 'function' ? CLUB_ID() : CLUB_ID });
                }, 10000);
            }
        }

        // Ждём токен — берём из своего хука или из глобального (установленного другими скриптами)
        var _tokenWait = setInterval(function() {
            if (!authToken && window._godjiAuthToken) {
                authToken = window._godjiAuthToken;
                hasuraRole = window._godjiHasuraRole || 'club_admin';
            }
            if (authToken) { clearInterval(_tokenWait); tryPoll(); }
        }, 500);
    }
    startPolling();

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
                // Нормализуем имя: "01" → "1", "TV 1" остаётся как есть
                var domName = d.name.replace(/^0+(\d)/, '$1');
                if (!d.sessions || d.sessions.length === 0) {
                    delete sessionsData[domName];
                    return;
                }
                var s = d.sessions[0];
                if (!s || !s.user || !s.user.wallet) return;
                sessionsData[domName] = {
                    sessionId:  s.id,
                    status:     s.status,
                    tariffId:   s.tariff ? s.tariff.id   : null,
                    tariffName: s.tariff ? s.tariff.name : '',
                    walletId:   s.user.wallet.id,
                    nickname:   s.user.nickname || '',
                    pcName:     domName,
                    timeTo:     null
                };
                activeIds.push({ pc: domName, sessionId: s.id });
            });
            window._godjiSessionsData = sessionsData;

            if (!activeIds.length) return;

            var ids = activeIds.map(function (x) { return parseInt(x.sessionId, 10); });
            // Шаг 2: time_to из reservations
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
            { clubId: (typeof CLUB_ID==='function'?CLUB_ID():CLUB_ID), deviceId: deviceId, from: from, to: to }
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
        var vars = { clubId: (typeof CLUB_ID==='function'?CLUB_ID():CLUB_ID), deviceId: deviceId, tariffId: tariffId,
                     sessionStart: sessionStart, sessionEnd: sessionEnd, userId: userId, isDirect: true };
        console.log('[restart] createSession vars:', JSON.stringify(vars));
        var q = 'mutation CreateBooking($clubId:Int!,$deviceId:Int!,$tariffId:Int!,$sessionStart:timestamptz!,$sessionEnd:timestamptz!,$userId:String!,$isDirect:Boolean){' +
                '  userReservationCreate(params:{clubId:$clubId,deviceId:$deviceId,tariffId:$tariffId,sessionStart:$sessionStart,sessionEnd:$sessionEnd,userId:$userId,isDirect:$isDirect}){' +
                '    reservationId __typename' +
                '  }' +
                '}';
        return xhrGql(q, vars).then(function (r) {
            console.log('[restart] createSession result:', JSON.stringify(r));
            if (r && r.errors) {
                var vars2 = { clubId: (typeof CLUB_ID==='function'?CLUB_ID():CLUB_ID), deviceId: deviceId, tariffId: tariffId,
                              sessionStart: sessionStart, sessionEnd: sessionEnd, userId: userId };
                return xhrGql(q.replace(',$isDirect:Boolean', '').replace(',isDirect:$isDirect', ''), vars2)
                .then(function(r2) {
                    console.log('[restart] createSession retry result:', JSON.stringify(r2));
                    return r2;
                });
            }
            return r;
        });
    }

    // Ждём пока сеанс станет активным (session_acting)
    function waitForSessionActive(sessionId) {
        return new Promise(function (resolve, reject) {
            var attempts = 0;
            var timer = setInterval(function () {
                attempts++;
                if (attempts > 20) {
                    clearInterval(timer);
                    reject(new Error('Сеанс не активировался за 60 секунд'));
                    return;
                }
                xhrGql(
                    'query($id:Int!){reservations(where:{id:{_eq:$id}}){id status}}',
                    { id: sessionId }
                ).then(function (r) {
                    var res = r && r.data && r.data.reservations && r.data.reservations[0];
                    if (res && res.status === 'session_acting') {
                        clearInterval(timer);
                        resolve();
                    }
                }).catch(function () {});
            }, 3000);
        });
    }

    function prolongSession(sessionId, tariffId, minutes) {
        // Для пакетных тарифов minutes не передаём — API сам знает длительность пакета
        var vars = { sessionId: sessionId, tariffId: tariffId };
        if (minutes !== null && minutes !== undefined) vars.minutes = minutes;
        return xhrGql(
            'mutation prolongateSession($sessionId:Int!,$tariffId:Int!,$minutes:Int){' +
            '  userReservationProlongate(params:{sessionId:$sessionId,tariffId:$tariffId,minutes:$minutes}){' +
            '    success __typename' +
            '  }' +
            '}',
            vars
        );
    }

    function getDeviceAndUser(pcName, walletId) {
        var names = [pcName];
        if (/^\d$/.test(pcName)) names.push('0' + pcName);
        var q = 'query($clubId:Int!,$names:[String!]!){club_devices(where:{club_id:{_eq:$clubId},name:{_in:$names}}){id name}}';
        var clubId = typeof CLUB_ID === 'function' ? CLUB_ID() : CLUB_ID;
        console.log('[restart] getDeviceAndUser pcName='+pcName+' names='+JSON.stringify(names)+' clubId='+clubId);
        return xhrGql(q, { clubId: clubId, names: names })
        .then(function (r) {
            console.log('[restart] club_devices result:', JSON.stringify(r));
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

    // Ждём возврата бонусов от ERP — сравниваем баланс до и после отмены
    function waitForBonusReturn(walletId, oldSessionId, lastOpIdBefore) {
        return new Promise(function (resolve) {
            xhrGql('query($wid:Int!){wallets_by_pk(id:$wid){balance_bonus}}', { wid: walletId })
            .then(function(r0) {
                var bonusBefore = r0 && r0.data && r0.data.wallets_by_pk ? r0.data.wallets_by_pk.balance_bonus : 0;
                var attempts = 0;
                var timer = setInterval(function () {
                    attempts++;
                    if (attempts > 40) { clearInterval(timer); resolve(0); return; }
                    xhrGql('query($wid:Int!){wallets_by_pk(id:$wid){balance_bonus}}', { wid: walletId })
                    .then(function (r) {
                        var bonusNow = r && r.data && r.data.wallets_by_pk ? r.data.wallets_by_pk.balance_bonus : bonusBefore;
                        if (bonusNow > bonusBefore) { clearInterval(timer); resolve(bonusNow - bonusBefore); }
                    }).catch(function () {});
                }, 3000);
            }).catch(function() { resolve(0); });
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
    // Попап подтверждения — точно по структуре ERP modal
    function showConfirm(title, text, confirmLabel, onConfirm) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';

        var section = document.createElement('section');
        section.className = 'm_fd1ab0aa m_54c44539 mantine-Modal-content m_1b7284a3 mantine-Paper-root';
        section.setAttribute('role','dialog'); section.setAttribute('tabindex','-1');
        section.style.cssText = 'opacity:1;transform:translateY(0px);min-width:calc(25rem * var(--mantine-scale));max-width:90vw;';

        var header = document.createElement('header');
        header.className = 'm_b5489c3c m_d0e2b9cd mantine-Modal-header';
        var h2 = document.createElement('h2');
        h2.className = 'm_615af6c9 mantine-Modal-title'; h2.textContent = title;
        var xBtn = document.createElement('button');
        xBtn.className = 'mantine-focus-auto mantine-active m_220c80f2 m_606cb269 mantine-Modal-close m_86a44da5 mantine-CloseButton-root m_87cf2631 mantine-UnstyledButton-root';
        xBtn.setAttribute('data-variant','subtle'); xBtn.setAttribute('type','button');
        xBtn.innerHTML = '<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:70%;height:70%;"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>';
        xBtn.addEventListener('click', function(){ overlay.remove(); });
        header.appendChild(h2); header.appendChild(xBtn);

        var body = document.createElement('div');
        body.className = 'm_5df29311 mantine-Modal-body';
        var stack = document.createElement('div');
        stack.className = 'm_6d731127 mantine-Stack-root';
        stack.style.cssText = '--stack-gap:var(--mantine-spacing-lg);--stack-align:stretch;--stack-justify:flex-start;';
        var p = document.createElement('p');
        p.className = 'mantine-focus-auto m_b6d8b162 mantine-Text-root'; p.innerHTML = text;
        stack.appendChild(p);

        var flex = document.createElement('div');
        flex.className = 'm_8bffd616 mantine-Flex-root';
        flex.style.cssText = 'width:100%;justify-content:flex-end;align-items:center;gap:calc(0.25rem * var(--mantine-scale));margin-top:var(--mantine-spacing-lg);';

        var okBtn = document.createElement('button');
        okBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        okBtn.setAttribute('data-variant','filled'); okBtn.setAttribute('type','button');
        okBtn.style.cssText = '--button-bg:var(--mantine-color-red-filled);--button-hover:var(--mantine-color-red-filled-hover);--button-color:var(--mantine-color-white);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;margin-top:calc(2rem * var(--mantine-scale));';
        okBtn.innerHTML = '<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">'+confirmLabel+'</span></span>';
        okBtn.addEventListener('click', function(){ overlay.remove(); onConfirm(); });

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        cancelBtn.setAttribute('data-variant','default'); cancelBtn.setAttribute('type','button');
        cancelBtn.style.cssText = '--button-bg:var(--mantine-color-default);--button-hover:var(--mantine-color-default-hover);--button-color:var(--mantine-color-default-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-default-border);margin-top:calc(2rem * var(--mantine-scale));';
        cancelBtn.innerHTML = '<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Отмена</span></span>';
        cancelBtn.addEventListener('click', function(){ overlay.remove(); });

        // Строим дерево до вставки в DOM
        flex.appendChild(okBtn); flex.appendChild(cancelBtn);
        body.appendChild(stack); body.appendChild(flex);
        section.appendChild(header); section.appendChild(body);
        overlay.appendChild(section);

        overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    }
    function doRestart(pcName) {
        var session = sessionsData[pcName];
        if (!session)        { notify('Нет данных о сессии ПК ' + pcName + '. Подождите обновления.', 'err'); return; }
        if (!session.walletId) { notify('Не удалось получить кошелёк клиента.', 'err'); return; }

        // Берём актуальный time_to — ищем активный сеанс на конкретном ПК, не по sessionId из кэша
        // (кэш может содержать устаревший sessionId от предыдущей неудачной попытки)
        // Берём актуальный time_to по sessionId из кэша
        var timeToPromise = xhrGql(
            'query($id:Int!){reservations(where:{id:{_eq:$id}}){id status time_to}}',
            { id: parseInt(session.sessionId, 10) }
        ).then(function(r) {
            var res = r && r.data && r.data.reservations && r.data.reservations[0];
            if (!res) throw new Error('Сеанс не найден');
            if (res.time_to && new Date(res.time_to).getTime() < Date.now()) {
                throw new Error('Сеанс на ПК ' + pcName + ' уже завершён');
            }
            if (!res.time_to) throw new Error('Нет данных об окончании сеанса');
            session.timeTo = res.time_to;
            return res.time_to;
        });

        timeToPromise.then(function(timeTo) {
        var msLeft       = new Date(timeTo).getTime() - Date.now();
        var remainMin    = Math.max(1, Math.ceil(msLeft / 60000));
        var walletId     = session.walletId;
        var oldSessionId = session.sessionId;
        var wasPackage = isPackageTariff(session.tariffName, session.tariffType);

        notify('Перезапуск сеанса ПК ' + pcName + '… (' + remainMin + ' мин)', 'info');
        console.log('[restart] timeTo='+timeTo+' msLeft='+msLeft+' remainMin='+remainMin);

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

                // Уточняем тип тарифа текущего сеанса
                // Сначала ищем в доступных тарифах нового ПК
                var currentTariff = tariffs.filter(function (t) { return t.id === session.tariffId; })[0];
                if (currentTariff) {
                    wasPackage = currentTariff.type === 'packet';
                }
                // currentTariff может отсутствовать если ПК из другой зоны —
                // в этом случае wasPackage уже определён через isPackageTariff по названию выше

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

                                    return createSession(deviceId, userId, plan.minuteTariff.id, hourlyStart, hourlyEnd)
                                    .then(function (cr2) {
                                        if (cr2 && cr2.errors) throw new Error(cr2.errors[0] && cr2.errors[0].message || 'Ошибка создания почасового сеанса');
                                        var newSessionId = cr2 && cr2.data && cr2.data.userReservationCreate && cr2.data.userReservationCreate.reservationId;
                                        if (!newSessionId) throw new Error('Не получен id нового сеанса');
                                        // Ждём активации сеанса перед продлением
                                        return waitForSessionActive(newSessionId)
                                        .then(function () {
                                            return prolongSession(newSessionId, plan.packet.id, null);
                                        });
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
        }).catch(function(err) {
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
        btn.style.cssText = 'color:rgb(204,0,1);background-color:rgba(204,0,1,0.07);--menu-item-color:rgb(204,0,1);--menu-item-hover:rgba(204,0,1,0.12);';
        btn.innerHTML = '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left"><div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="stroke:rgb(204,0,1);"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg></div></div><div class="m_5476e0d3 mantine-Menu-itemLabel">Перезапустить сеанс</div>';

        btn.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var pc = lastContextPc;
            document.body.click();
            setTimeout(function () {
                var session = sessionsData[pc] || {};
                var remainMin = 0;
                if (session.timeTo) remainMin = Math.max(1, Math.ceil((new Date(session.timeTo).getTime() - Date.now()) / 60000));
                var txt = 'Перезапустить сеанс на ПК <strong>' + pc + '</strong>?';
                if (session.nickname) txt += '<br><span style="color:var(--mantine-color-dimmed);font-size:0.85em;">' + session.nickname + (remainMin ? ', остаток ' + remainMin + ' мин' : '') + '</span>';
                showConfirm('Перезапустить сеанс', txt, 'Перезапустить', function() { doRestart(pc); });
            }, 50);
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

    // Экспортируем doRestart для использования из других скриптов (multi_select)
    window._godjiRestartPc = function(pcName) {
        return new Promise(function(resolve) {
            // Перехватываем notify чтобы получить результат
            var origNotify = window._godjiRestartNotify;
            doRestart(pcName);
            // Ждём завершения — даём 90 сек
            setTimeout(resolve, 90000);
        });
    };

})();

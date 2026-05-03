// ==UserScript==
// @name         Годжи — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  Перезапускает сеанс: завершает и запускает заново на почасовом тарифе
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_restart_session.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_restart_session.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function () {
'use strict';

var CLUB_ID = 14;
var API_URL = 'https://hasura.godji.cloud/v1/graphql';
var COMMENT = 'Перезапуск сеанса';

// Почасовые тарифы по зонам (type=minute)
// При перезапуске всегда используем почасовой тариф нужной зоны
// Ключ — id тарифа исходного сеанса (или зона), значение — id почасового тарифа
// minute-тарифы: 103/104 VIP, 110/111 VIP+, 117/118 DUO, 124/125 SOLO, 131/132 TV
// Логика: если тариф уже minute — используем его же
// Если packet — находим minute-тариф той же зоны по времени суток

var ZONE_MINUTE_TARIFFS = {
    // VIP (103=до13, 104=после13, пакеты 106-109)
    103: {before13: 103, after13: 104},
    104: {before13: 103, after13: 104},
    106: {before13: 103, after13: 104},
    107: {before13: 103, after13: 104},
    108: {before13: 103, after13: 104},
    109: {before13: 103, after13: 104},
    // VIP+ (110=до13, 111=после13, пакеты 112-116)
    110: {before13: 110, after13: 111},
    111: {before13: 110, after13: 111},
    112: {before13: 110, after13: 111},
    113: {before13: 110, after13: 111},
    114: {before13: 110, after13: 111},
    115: {before13: 110, after13: 111},
    116: {before13: 110, after13: 111},
    // DUO (117=до13, 118=после13, пакеты 119-123)
    117: {before13: 117, after13: 118},
    118: {before13: 117, after13: 118},
    119: {before13: 117, after13: 118},
    120: {before13: 117, after13: 118},
    121: {before13: 117, after13: 118},
    122: {before13: 117, after13: 118},
    123: {before13: 117, after13: 118},
    // SOLO (124=до13, 125=после13, пакеты 126-130)
    124: {before13: 124, after13: 125},
    125: {before13: 124, after13: 125},
    126: {before13: 124, after13: 125},
    127: {before13: 124, after13: 125},
    128: {before13: 124, after13: 125},
    129: {before13: 124, after13: 125},
    130: {before13: 124, after13: 125},
    // TV Rental (131=до13, 132=после13, пакеты 152-153)
    131: {before13: 131, after13: 132},
    132: {before13: 131, after13: 132},
    152: {before13: 131, after13: 132},
    153: {before13: 131, after13: 132},
};

// Тарифы с type=minute
var MINUTE_TARIFF_IDS = [103,104,110,111,117,118,124,125,131,132];

function getMinuteTariffId(originalTariffId) {
    var map = ZONE_MINUTE_TARIFFS[originalTariffId];
    if (!map) return originalTariffId; // неизвестный тариф — оставляем как есть
    var hour = new Date().getHours();
    return hour < 13 ? map.before13 : map.after13;
}

function isMinuteTariff(tariffId) {
    return MINUTE_TARIFF_IDS.indexOf(parseInt(tariffId)) !== -1;
}

// ── Авторизация ───────────────────────────────────────────
function getAuth() { return window._godjiAuthToken || null; }
function getRole() { return window._godjiHasuraRole || 'club_admin'; }

function gql(operationName, query, variables) {
    var auth = getAuth();
    if (!auth) return Promise.reject(new Error('Нет токена авторизации'));
    return fetch(API_URL, {
        method: 'POST',
        headers: { 'authorization': auth, 'content-type': 'application/json', 'x-hasura-role': getRole() },
        body: JSON.stringify({ operationName: operationName, variables: variables, query: query })
    }).then(function(r){ return r.json(); }).then(function(d){
        if (d.errors && d.errors.length) throw new Error(d.errors[0].message);
        return d.data;
    });
}

// ── API вызовы ────────────────────────────────────────────
function cancelSession(sessionId) {
    return gql('CancelSession',
        'mutation CancelSession($sessionId: Int!) { userReservationCancel(params: {sessionId: $sessionId}) { success } }',
        { sessionId: sessionId }
    );
}

function depositBonus(walletId, amount, comment) {
    return gql('DepositBonus',
        'mutation DepositBonus($walletId: Int!, $amount: Float!, $description: String) { walletDepositWithBonus(params: {walletId: $walletId, amount: $amount, description: $description}) { operationId } }',
        { walletId: walletId, amount: amount, description: comment }
    );
}

function createSession(userId, deviceId, tariffId, minutes) {
    var now = new Date();
    var end = new Date(now.getTime() + minutes * 60000);
    function iso(d) { return d.toISOString().replace('Z', '+00:00'); }
    return gql('CreateSession',
        'mutation CreateSession($userId: String!, $deviceId: Int!, $tariffId: Int!, $clubId: Int!, $sessionStart: timestamptz!, $sessionEnd: timestamptz!) { userReservationCreate(params: {userId: $userId, deviceId: $deviceId, tariffId: $tariffId, clubId: $clubId, sessionStart: $sessionStart, sessionEnd: $sessionEnd, isDirect: true}) { reservationId } }',
        { userId: userId, deviceId: deviceId, tariffId: tariffId, clubId: CLUB_ID, sessionStart: iso(now), sessionEnd: iso(end) }
    );
}

function fetchSessionData(pcName) {
    return gql('GetSessionForRestart',
        'query GetSessionForRestart($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name id sessions { id status endAt tariff { id name } user { id nickname wallet { id } } } } } }',
        { clubId: CLUB_ID }
    ).then(function(data) {
        var devs = data && data.getDashboardDevices && data.getDashboardDevices.devices;
        if (!devs) return null;
        var dev = devs.find(function(d) { return d.name === pcName; });
        if (!dev) return null;
        // Сохраняем deviceId сразу
        window._godjiDeviceIds = window._godjiDeviceIds || {};
        window._godjiDeviceIds[pcName] = dev.id;
        var sessions = dev.sessions || [];
        var active = sessions.find(function(s){ return s.status === 'active' || s.status === 'playing'; });
        if (!active && sessions.length) active = sessions[0];
        if (!active) return null;
        return {
            sessionId: active.id,
            endAt:     active.endAt,
            tariffId:  active.tariff && active.tariff.id,
            tariffType:active.tariff && active.tariff.type,
            userId:    active.user && active.user.id,
            walletId:  active.user && active.user.wallet && active.user.wallet.id,
            nickname:  active.user && active.user.nickname,
            deviceId:  dev.id,
        };
    });
}

function getDeviceId(pcName, sess) {
    // Приоритет: данные из fetchSessionData → кэш → DOM → API
    if (sess && sess.deviceId) return Promise.resolve(sess.deviceId);
    if (window._godjiDeviceIds && window._godjiDeviceIds[pcName])
        return Promise.resolve(window._godjiDeviceIds[pcName]);
    if (typeof window._godjiGetDeviceId === 'function')
        return Promise.resolve(window._godjiGetDeviceId(pcName));
    return gql('GetDeviceId',
        'query GetDeviceId($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name id } } }',
        { clubId: CLUB_ID }
    ).then(function(data) {
        var devs = data && data.getDashboardDevices && data.getDashboardDevices.devices;
        if (!devs) return null;
        var dev = devs.find(function(d) { return d.name === pcName; });
        return dev ? dev.id : null;
    });
}

// ── Основная логика перезапуска ───────────────────────────
async function restartSession(pcName, onProgress) {
    onProgress('Получение данных сессии ' + pcName + '...');

    // 1. Данные сессии — с сервера (актуальные данные включая userId и tariffType)
    var sess = await fetchSessionData(pcName);

    // Если сервер не нашёл — пробуем из кэша (pcName может отличаться)
    if (!sess) {
        var cached = window._godjiSessionsData && window._godjiSessionsData[pcName];
        if (cached && cached.sessionId && cached.tariffId && cached.walletId) {
            // Нужен userId — запрашиваем отдельно по walletId
            try {
                var uidData = await gql('GetUserByWallet',
                    'query GetUserByWallet($wid:Int!){users_wallets(where:{id:{_eq:$wid}},limit:1){user_id}}',
                    {wid: parseInt(cached.walletId)}
                );
                var wallets2 = uidData && uidData.users_wallets;
                var uid2 = wallets2 && wallets2[0] && wallets2[0].user_id;
                sess = {
                    sessionId: cached.sessionId,
                    tariffId:  cached.tariffId,
                    walletId:  cached.walletId,
                    userId:    uid2,
                    nickname:  cached.nickname,
                    endAt:     cached.endAt || cached.timeTo,
                    deviceId:  null,
                };
            } catch(e) {}
        }
    }

    if (!sess || !sess.sessionId) throw new Error('ПК ' + pcName + ': нет активного сеанса');
    if (!sess.userId || !sess.walletId) throw new Error('ПК ' + pcName + ': нет данных клиента');
    if (!sess.tariffId) throw new Error('ПК ' + pcName + ': нет данных тарифа');

    // 2. Оставшееся время
    var now = new Date();
    var remainMs = new Date(sess.endAt) - now;
    if (remainMs <= 0) throw new Error('ПК ' + pcName + ': время сеанса уже истекло');
    var remainMin = Math.ceil(remainMs / 60000);

    // 3. Определяем нужно ли начислять бонусы
    // minute-тариф → ERP вернёт деньги сам → не начисляем
    // packet-тариф → ERP не вернёт → начисляем бонусами
    // Определяем по ZONE_MINUTE_TARIFFS и MINUTE_TARIFF_IDS — tariffType недоступен через API
    var origIsMinute = isMinuteTariff(sess.tariffId);
    var needBonus = !origIsMinute;
    var bonusAmount = 0;

    // 4. Тариф для нового сеанса — всегда minute соответствующей зоны
    var newTariffId = getMinuteTariffId(parseInt(sess.tariffId));

    onProgress('ПК ' + pcName + ': ' + remainMin + ' мин, тариф #' + newTariffId + '. Завершаем...');

    // 5. Записываем маркер перезапуска ДО завершения — чтобы история сеансов и операций знала
    var restartMarkerKey = 'godji_opjournal_restarts';
    var restartTs = Date.now();
    var restartGid = 'restart_' + (sess.userId||sess.walletId) + '_' + restartTs;
    try {
        var rMarkers = JSON.parse(localStorage.getItem(restartMarkerKey)||'{}');
        rMarkers[restartGid] = {
            userId: sess.userId || '',
            walletId: sess.walletId,
            pc: pcName,
            nick: sess.nickname || '',
            ts: restartTs,
            opIds: [],
            closed: false
        };
        localStorage.setItem(restartMarkerKey, JSON.stringify(rMarkers));
    } catch(e) {}

    // 6. Завершаем сеанс
    await cancelSession(parseInt(sess.sessionId));

    // 6. Начисляем бонусы только для пакетных тарифов
    if (needBonus) {
        onProgress('ПК ' + pcName + ': считаем стоимость ' + remainMin + ' мин...');
        var bonusAmount = remainMin;
        try {
            bonusAmount = await getCostForRemaining(parseInt(sess.sessionId), remainMin);
        } catch(e) {
            bonusAmount = remainMin; // fallback
        }
        onProgress('ПК ' + pcName + ': начисляем ' + bonusAmount + ' бонусов (пакетный)...');
        await depositBonus(parseInt(sess.walletId), bonusAmount, COMMENT);
    } else {
        onProgress('ПК ' + pcName + ': почасовой — ERP вернёт деньги автоматически');
        // Небольшая пауза чтобы ERP успел провести возврат
        await new Promise(function(r){ setTimeout(r, 800); });
    }

    onProgress('ПК ' + pcName + ': запускаем новый сеанс...');

    // 7. deviceId
    var deviceId = await getDeviceId(pcName, sess);
    if (!deviceId) throw new Error('ПК ' + pcName + ': не удалось получить deviceId');

    // 8. Новый сеанс на почасовом тарифе
    await createSession(sess.userId, parseInt(deviceId), newTariffId, remainMin);

    // 9. Закрываем группу перезапуска
    try {
        var rClose = JSON.parse(localStorage.getItem('godji_opjournal_restarts')||'{}');
        if(rClose[restartGid]) { rClose[restartGid].closed = true; }
        localStorage.setItem('godji_opjournal_restarts', JSON.stringify(rClose));
    } catch(e) {}

    return { mins: remainMin, bonus: needBonus, bonusAmount: bonusAmount || 0, newTariffId: newTariffId };
}

// ── Toast ─────────────────────────────────────────────────
var _toastEl = null;
function showToast(msg, ok, duration) {
    if (_toastEl && _toastEl.parentNode) _toastEl.parentNode.removeChild(_toastEl);
    var t = document.createElement('div');
    _toastEl = t;
    t.textContent = msg;
    t.style.cssText = [
        'position:fixed','bottom:70px','left:50%','transform:translateX(-50%)',
        'padding:10px 20px','border-radius:10px','font-size:13px','font-weight:500',
        'font-family:inherit','z-index:999999','pointer-events:none','white-space:nowrap',
        'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
        ok === false
            ? 'background:#7f1d1d;color:#fecaca;border:1px solid rgba(254,202,202,.3);'
            : ok === true
                ? 'background:#166534;color:#bbf7d0;border:1px solid rgba(187,247,208,.3);'
                : 'background:rgba(20,20,30,0.92);color:#fff;border:1px solid rgba(255,255,255,0.12);'
    ].join(';');
    document.body.appendChild(t);
    clearTimeout(t._hide);
    t._hide = setTimeout(function() {
        if (t.parentNode) { t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 300); }
    }, duration || 3000);
}

// ── Вставка кнопки в контекстное меню ────────────────────
function tryInjectSingleMenu() {
    var menu = document.querySelector('.mantine-Menu-dropdown');
    if (!menu || menu.getAttribute('data-godji-restart')) return;
    menu.setAttribute('data-godji-restart', '1');

    var pcName = window._godjiLastContextPc || null;
    var items = menu.querySelectorAll('[role="menuitem"]');

    // Проверяем наличие сеанса — ищем пункты связанные с сеансом
    var anchorBtn = null;
    var hasSession = false;
    var SESSION_LABELS = ['Продлить сеанс','Продлить','Продление сеанса','Завершить сессию','Завершить сеанс'];
    for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
        if (!lbl) continue;
        var txt = lbl.textContent.trim();
        if (SESSION_LABELS.indexOf(txt) !== -1) {
            if (!anchorBtn) anchorBtn = items[i]; // первый найденный — якорь
            hasSession = true;
        }
    }
    // Вставляем после последнего session-пункта перед системными
    // Ищем "Завершить" как финальный якорь для вставки после него
    for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
        if (!lbl) continue;
        var txt = lbl.textContent.trim();
        if (txt === 'Завершить сессию' || txt === 'Завершить сеанс') {
            anchorBtn = items[i];
        }
    }

    // Кнопка только если есть сеанс
    if (!hasSession || !anchorBtn) return;

    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('data-menu-item', 'true');
    btn.setAttribute('data-mantine-stop-propagation', 'true');
    btn.className = anchorBtn.className;
    btn.style.cssText = 'color:#bf360c;background-color:rgba(191,54,12,0.12);--menu-item-color:#bf360c;--menu-item-hover:rgba(191,54,12,0.18);';
    btn.innerHTML =
        '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">' +
        '<div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bf360c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' +
        '</svg></div></div>' +
        '<div class="m_5476e0d3 mantine-Menu-itemLabel">Перезапустить сеанс</div>';

    btn.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation();
        document.body.click();
        if (!pcName) { showToast('Не удалось определить ПК', false); return; }
        showToast('Перезапуск ' + pcName + '...', null, 15000);
        restartSession(pcName, function(msg){ showToast(msg, null, 8000); })
            .then(function(res) {
                var msg = '✓ ' + pcName + ': перезапущен на ' + res.mins + ' мин';
                if (res.bonus) msg += ', +' + res.mins + ' бонусов';
                showToast(msg, true, 5000);
            })
            .catch(function(err){ showToast('✗ ' + pcName + ': ' + err.message, false, 6000); });
    });

    // Вставляем после "Продление сеанса" / "Продлить сеанс"
    var insertAfter = null;
    var PROLONG_LABELS = ['Продлить сеанс','Продлить','Продление сеанса'];
    for (var pi = 0; pi < items.length; pi++) {
        var plbl = items[pi].querySelector('.mantine-Menu-itemLabel');
        if (plbl && PROLONG_LABELS.indexOf(plbl.textContent.trim()) !== -1) {
            insertAfter = items[pi]; break;
        }
    }
    if (!insertAfter) insertAfter = anchorBtn;
    insertAfter.parentNode.insertBefore(btn, insertAfter.nextSibling || null);
}

// ── Перехват contextmenu ──────────────────────────────────
document.addEventListener('contextmenu', function(e) {
    var target = e.target;
    // Карточка карты — ищем data-pc в самом элементе и его родителях
    // Карточка карты — DeviceItem структура
    var card = target.closest('[data-pc]') || target.closest('[data-device-name]');
    if (card) {
        window._godjiLastContextPc = card.getAttribute('data-pc') || card.getAttribute('data-device-name');
        if (window._godjiLastContextPc) return;
    }
    // Ищем DeviceItem_deviceName — span с номером ПК
    var devName = target.closest('[class*="DeviceItem"]');
    if (devName) {
        var nameSpan = devName.querySelector('[class*="deviceName"]') ||
                       devName.querySelector('[class*="deviceBox"]');
        if (nameSpan) { window._godjiLastContextPc = nameSpan.textContent.trim(); return; }
        window._godjiLastContextPc = devName.textContent.trim().split(/\s/)[0];
        return;
    }
    // Если сам target — span с именем
    if (target.className && target.className.indexOf('deviceName') !== -1) {
        window._godjiLastContextPc = target.textContent.trim();
        return;
    }
    if (target.className && target.className.indexOf('DeviceItem') !== -1) {
        var ns = target.querySelector('[class*="deviceName"]');
        if (ns) { window._godjiLastContextPc = ns.textContent.trim(); return; }
    }
    // Строка таблицы
    var row = target.closest('tr');
    if (row) {
        var cell = row.querySelector('td[data-index="0"]') || row.querySelector('td:first-child');
        if (cell) window._godjiLastContextPc = cell.textContent.trim();
    }
}, true);

// ── MutationObserver — следим за меню ────────────────────
var _menuObs = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains('mantine-Menu-dropdown'))
                setTimeout(tryInjectSingleMenu, 30);
            else if (n.querySelector && n.querySelector('.mantine-Menu-dropdown'))
                setTimeout(tryInjectSingleMenu, 30);
        }
    }
});

if (document.body) {
    _menuObs.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', function() {
        _menuObs.observe(document.body, { childList: true, subtree: true });
    });
}

// ── Мультивыбор ───────────────────────────────────────────
window._godjiRestartSessionAction = async function(selectedPcs) {
    var pcNames = Object.values(selectedPcs);
    if (!pcNames.length) return;
    showToast('Перезапуск ' + pcNames.length + ' ПК...', null, 60000);
    var ok = 0, fail = 0, errors = [];
    for (var i = 0; i < pcNames.length; i++) {
        try {
            var res = await restartSession(pcNames[i], function(msg){ showToast(msg, null, 6000); });
            ok++;
            var msg = '✓ ' + pcNames[i] + ': ' + res.mins + ' мин';
            if (res.bonus) msg += ', +' + res.mins + ' G';
            showToast(msg, true, 3000);
        } catch(e) {
            fail++;
            errors.push(pcNames[i] + ': ' + e.message);
        }
        if (i < pcNames.length - 1) await new Promise(function(r){ setTimeout(r, 500); });
    }
    if (fail === 0) showToast('✓ Перезапуск завершён: ' + ok + ' ПК', true, 5000);
    else showToast('Перезапуск: ' + ok + ' ок, ' + fail + ' ошибок. ' + (errors[0]||''), false, 7000);
};

// ── Хук мультиселекта ─────────────────────────────────────
if (!window._godjiMultiMenuHooks) window._godjiMultiMenuHooks = [];
window._godjiMultiMenuHooks.push(function(menu, makeMenuItem, makeDivider, getColor, getBg) {
    menu.appendChild(makeDivider());
    window._godjiMultiMenuHooks._restartAdded = true;
    menu.appendChild(makeMenuItem(
        'Перезапустить сеансы',
        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
        getColor('Перезапустить сеансы', '#bf360c'),
        function() {
            var sel = window._godjiSelected || {};
            if (!Object.keys(sel).length) { showToast('Нет выбранных ПК', false); return; }
            window._godjiRestartSessionAction(sel);
        },
        getBg('Перезапустить сеансы', 'rgba(191,54,12,0.12)'),
        getBg('Перезапустить сеансы', 'rgba(191,54,12,0.20)')
    ));
});

// Fallback для мультиселекта через DOM
var _multiObs = new MutationObserver(function() {
    var menu = document.getElementById('godji-multi-menu');
    if (!menu || menu.querySelector('[data-godji-restart-multi]')) return;
    var items = menu.querySelectorAll('[role="menuitem"]');
    var anchorBtn = null;
    var SESSION_LABELS2 = ['Продлить сеанс','Продлить','Продление сеанса','Завершить сессию','Завершить сеанс'];
    for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
        if (!lbl) continue;
        if (SESSION_LABELS2.indexOf(lbl.textContent.trim()) !== -1) anchorBtn = items[i];
    }
    if (!anchorBtn) return;

    var mi = anchorBtn.cloneNode(true);
    mi.setAttribute('data-godji-restart-multi', '1');
    mi.style.cssText = 'color:#bf360c;background-color:rgba(191,54,12,0.12);--menu-item-color:#bf360c;';
    var miLbl = mi.querySelector('.mantine-Menu-itemLabel');
    if (miLbl) miLbl.textContent = 'Перезапустить сеансы';
    var miIco = mi.querySelector('svg');
    if (miIco) miIco.innerHTML = '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>';
    mi.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation();
        document.body.click();
        var sel = window._godjiSelected || {};
        if (!Object.keys(sel).length) { showToast('Нет выбранных ПК', false); return; }
        window._godjiRestartSessionAction(sel);
    });
    anchorBtn.parentNode.insertBefore(mi, anchorBtn.nextSibling || null);
});

if (document.body) {
    _multiObs.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', function() {
        _multiObs.observe(document.body, { childList: true, subtree: true });
    });
}

})();

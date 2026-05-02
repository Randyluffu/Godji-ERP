// ==UserScript==
// @name         Годжи — Перезапуск сеанса
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Перезапускает сеанс: завершает, зачисляет оставшееся время бонусами, запускает заново
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

// ── Авторизация ───────────────────────────────────────────
function getAuth() {
    return window._godjiAuthToken || null;
}
function getRole() {
    return window._godjiHasuraRole || 'club_admin';
}

function gql(operationName, query, variables) {
    var auth = getAuth();
    if (!auth) return Promise.reject(new Error('Нет токена авторизации'));
    return fetch(API_URL, {
        method: 'POST',
        headers: {
            'authorization': auth,
            'content-type': 'application/json',
            'x-hasura-role': getRole()
        },
        body: JSON.stringify({ operationName: operationName, variables: variables, query: query })
    }).then(function (r) { return r.json(); }).then(function (d) {
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

// Получаем актуальные данные сессии с сервера (на случай если кэш устарел)
function fetchSessionData(pcName) {
    return gql('GetSessionForRestart',
        'query GetSessionForRestart($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name sessions { id status endAt tariff { id name } user { id nickname wallet { id } } } } } }',
        { clubId: CLUB_ID }
    ).then(function (data) {
        var devs = data && data.getDashboardDevices && data.getDashboardDevices.devices;
        if (!devs) return null;
        var dev = devs.find(function (d) { return d.name === pcName; });
        if (!dev || !dev.sessions || !dev.sessions.length) return null;
        var active = dev.sessions.find(function (s) { return s.status === 'active' || s.status === 'playing'; });
        if (!active) active = dev.sessions[0];
        return {
            sessionId:  active.id,
            endAt:      active.endAt,
            tariffId:   active.tariff && active.tariff.id,
            userId:     active.user && active.user.id,
            walletId:   active.user && active.user.wallet && active.user.wallet.id,
            nickname:   active.user && active.user.nickname,
        };
    });
}

function getDeviceId(pcName) {
    // Ищем deviceId в таблице через multi_select helper или DOM
    if (typeof window._godjiGetDeviceId === 'function') {
        return Promise.resolve(window._godjiGetDeviceId(pcName));
    }
    // Fallback: ищем по таблице
    var rows = document.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
        var cell = rows[i].querySelector('td[data-index="0"]');
        if (cell && cell.textContent.trim() === pcName) {
            // deviceId может быть в data-атрибуте строки или рядом
            var dataId = rows[i].getAttribute('data-device-id') || rows[i].getAttribute('data-id');
            if (dataId) return Promise.resolve(parseInt(dataId));
        }
    }
    // Если не нашли в DOM — запрашиваем с сервера
    return gql('GetDeviceId',
        'query GetDeviceId($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name id } } }',
        { clubId: CLUB_ID }
    ).then(function (data) {
        var devs = data && data.getDashboardDevices && data.getDashboardDevices.devices;
        if (!devs) return null;
        var dev = devs.find(function (d) { return d.name === pcName; });
        return dev ? dev.id : null;
    });
}

// ── Основная логика перезапуска ───────────────────────────
async function restartSession(pcName, onProgress) {
    onProgress('Получение данных сессии ' + pcName + '...');

    // 1. Получаем данные сессии
    var sess = null;

    // Сначала из кэша
    var cached = window._godjiSessionsData && window._godjiSessionsData[pcName];
    if (cached && cached.sessionId) {
        // Нужно ещё endAt/timeTo и userId — их может не быть в кэше
        if ((cached.endAt || cached.timeTo) && cached.userId) {
            sess = cached;
        }
    }

    // Если в кэше нет полных данных — запрашиваем с сервера
    if (!sess) {
        sess = await fetchSessionData(pcName);
    }

    if (!sess || !sess.sessionId) {
        throw new Error('ПК ' + pcName + ': нет активного сеанса');
    }
    if (!sess.userId || !sess.walletId) {
        throw new Error('ПК ' + pcName + ': нет данных клиента');
    }
    if (!sess.tariffId) {
        throw new Error('ПК ' + pcName + ': нет данных тарифа');
    }

    // 2. Вычисляем оставшееся время в минутах
    var now = new Date();
    var timeTo = new Date(sess.endAt);
    var remainMs = timeTo - now;
    if (remainMs <= 0) {
        throw new Error('ПК ' + pcName + ': время сеанса уже истекло');
    }
    var remainMin = Math.ceil(remainMs / 60000);

    onProgress('ПК ' + pcName + ': осталось ' + remainMin + ' мин. Завершаем сеанс...');

    // 3. Завершаем сеанс
    await cancelSession(parseInt(sess.sessionId));

    onProgress('ПК ' + pcName + ': проверяем возврат бонусов...');

    // 4. Ждём возможный возврат бонусов от сервера (300ms)
    await new Promise(function(r){ setTimeout(r, 600); });

    // Проверяем — не вернул ли сервер уже бонусы при завершении
    var refundedBonus = 0;
    try {
        var refundData = await gql('GetRecentRefund',
            'query GetRecentRefund($clubId:Int!){wallet_operations(where:{club_id:{_eq:$clubId}},order_by:{id:desc},limit:10){id amount money_type operation_type created_at wallet_operation_digest{name description}}}',
            { clubId: CLUB_ID }
        );
        var recentOps = refundData && refundData.wallet_operations || [];
        var cutoffTs = Date.now() - 10000; // последние 10 сек
        recentOps.forEach(function(op){
            var opTs = new Date(op.created_at).getTime();
            if(opTs < cutoffTs) return;
            var name = (op.wallet_operation_digest && op.wallet_operation_digest.name)||'';
            // Возврат бонусов при завершении
            if(op.operation_type === 'deposit' && op.money_type === 'non_cash' &&
               (name.indexOf('возврат') !== -1 || name.indexOf('Возврат') !== -1)){
                refundedBonus += Math.abs(op.amount||0);
            }
        });
    } catch(e) {}

    var bonusToAdd = remainMin - Math.round(refundedBonus);
    if(bonusToAdd <= 0){
        onProgress('ПК ' + pcName + ': бонусы уже возвращены сервером (' + Math.round(refundedBonus) + ' G)');
    } else {
        onProgress('ПК ' + pcName + ': начисляем ' + bonusToAdd + ' бонусов (возврат: ' + Math.round(refundedBonus) + ')...');
        // 4. Начисляем только разницу
        await depositBonus(parseInt(sess.walletId), bonusToAdd, COMMENT);
    }

    onProgress('ПК ' + pcName + ': запускаем новый сеанс...');

    // 5. Получаем deviceId
    var deviceId = await getDeviceId(pcName);
    if (!deviceId) {
        throw new Error('ПК ' + pcName + ': не удалось получить deviceId');
    }

    // 6. Создаём новый сеанс на то же время
    await createSession(sess.userId, parseInt(deviceId), parseInt(sess.tariffId), remainMin);

    return remainMin;
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
    t._hide = setTimeout(function () {
        if (t.parentNode) { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); }, 300); }
    }, duration || 3000);
}

// ── Вставка кнопки в одиночное контекстное меню ──────────
function tryInjectSingleMenu() {
    var menu = document.querySelector('.mantine-Menu-dropdown');
    if (!menu || menu.getAttribute('data-godji-restart')) return;
    menu.setAttribute('data-godji-restart', '1');

    // Ищем текущий PC из заголовка меню или из данных
    // Используем последний ПКМ-объект который сохраняет godji_multi_select или menu_colors
    var pcName = window._godjiLastContextPc || null;

    // Ищем в items меню «Перезагрузить» как эталон стиля
    var items = menu.querySelectorAll('[role="menuitem"]');
    var rebootBtn = null;
    for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
        if (lbl && lbl.textContent.trim() === 'Перезагрузить') {
            rebootBtn = items[i];
            break;
        }
    }
    // Показываем кнопку всегда (даже если ПК выключен) — ищем любой пункт как якорь
    if (!rebootBtn) {
        // Ищем "Продлить сеанс" как якорь
        for (var i = 0; i < items.length; i++) {
            var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
            if (lbl && (lbl.textContent.trim() === 'Продлить сеанс' || lbl.textContent.trim() === 'Продлить')) {
                rebootBtn = items[i];
                break;
            }
        }
        if (!rebootBtn) return;
    }

    // Создаём кнопку в точно таком же стиле
    var btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('data-menu-item', 'true');
    btn.setAttribute('data-mantine-stop-propagation', 'true');
    btn.className = rebootBtn.className;
    // Цвет как у "Перезагрузить" (#bf360c) — оранжево-красный
    btn.style.cssText = 'color:#bf360c;background-color:rgba(191,54,12,0.12);--menu-item-color:#bf360c;--menu-item-hover:rgba(191,54,12,0.18);';

    btn.innerHTML =
        '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">' +
        '<div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bf360c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
        '<path d="M3 3v5h5"/>' +
        '</svg></div></div>' +
        '<div class="m_5476e0d3 mantine-Menu-itemLabel">Перезапустить сеанс</div>';

    btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();

        // Закрываем меню
        document.body.click();

        var target = pcName;
        if (!target) {
            showToast('Не удалось определить ПК', false);
            return;
        }

        showToast('Перезапуск ' + target + '...', null, 10000);

        restartSession(target, function (msg) { showToast(msg, null, 8000); })
            .then(function (mins) {
                showToast('✓ ' + target + ': перезапущен, зачислено ' + mins + ' бонусов', true, 4000);
            })
            .catch(function (err) {
                showToast('✗ ' + target + ': ' + err.message, false, 6000);
            });
    });

    // Вставляем сразу после "Перезагрузить"
    var next = rebootBtn.nextSibling;
    var container = rebootBtn.parentNode;
    if (next) container.insertBefore(btn, next);
    else container.appendChild(btn);
}

// ── Перехват contextmenu — запоминаем имя ПК ─────────────
document.addEventListener('contextmenu', function (e) {
    // Ищем имя ПК в строке таблицы или карточке карты
    var target = e.target;
    // Из карточки карты
    var card = target.closest('[data-pc]');
    if (card) { window._godjiLastContextPc = card.getAttribute('data-pc'); return; }
    // Из строки таблицы
    var row = target.closest('tr');
    if (row) {
        var cell = row.querySelector('td[data-index="0"]') || row.querySelector('td:first-child');
        if (cell) { window._godjiLastContextPc = cell.textContent.trim(); }
    }
}, true);

// ── MutationObserver — следим за появлением меню ─────────
var _menuObs = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains('mantine-Menu-dropdown')) {
                setTimeout(tryInjectSingleMenu, 30);
            } else if (n.querySelector) {
                var found = n.querySelector('.mantine-Menu-dropdown');
                if (found) setTimeout(tryInjectSingleMenu, 30);
            }
        }
    }
});

if (document.body) {
    _menuObs.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', function () {
        _menuObs.observe(document.body, { childList: true, subtree: true });
    });
}

// ── Поддержка мультивыбора ────────────────────────────────
// Регистрируем действие в multi_select через глобальный хук
window._godjiRestartSessionAction = async function (selectedPcs) {
    // selectedPcs: { deviceId: pcName, ... }
    var pcNames = Object.values(selectedPcs);
    if (!pcNames.length) return;

    showToast('Перезапуск ' + pcNames.length + ' ПК...', null, 30000);

    var ok = 0, fail = 0, errors = [];
    for (var i = 0; i < pcNames.length; i++) {
        try {
            var mins = await restartSession(pcNames[i], function (msg) { showToast(msg, null, 6000); });
            ok++;
            showToast('✓ ' + pcNames[i] + ': ' + mins + ' бонусов', true, 3000);
        } catch (e) {
            fail++;
            errors.push(pcNames[i] + ': ' + e.message);
        }
        if (i < pcNames.length - 1) await new Promise(function (r) { setTimeout(r, 300); });
    }

    if (fail === 0) {
        showToast('✓ Перезапуск завершён для ' + ok + ' ПК', true, 5000);
    } else {
        showToast('Перезапуск: ' + ok + ' ок, ' + fail + ' ошибок. ' + errors[0], false, 7000);
    }
};

// ── Интеграция с мультиселектом ─────────────────────────
// multi_select при построении меню вызывает window._godjiMultiMenuHooks
// Регистрируем хук который добавит пункт меню
if (!window._godjiMultiMenuHooks) window._godjiMultiMenuHooks = [];
window._godjiMultiMenuHooks.push(function(menu, makeMenuItem, makeDivider, getColor, getBg) {
    menu.appendChild(makeDivider());
    var lblSess = document.createElement('div');
    lblSess.className = 'm_9bfac126 mantine-Menu-label';
    lblSess.textContent = 'Сеансы';
    menu.appendChild(lblSess);
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

// Fallback: если хуки не поддерживаются — следим за DOM
var _multiObs = new MutationObserver(function() {
    var menu = document.getElementById('godji-multi-menu');
    if (!menu || menu.querySelector('[data-godji-restart-multi]')) return;
    // Ищем кнопку "Перезагрузить" как место вставки
    var items = menu.querySelectorAll('[role="menuitem"]');
    var rebootBtn = null;
    for (var i = 0; i < items.length; i++) {
        var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
        if (lbl && lbl.textContent.trim() === 'Перезагрузить') { rebootBtn = items[i]; break; }
    }
    // Показываем кнопку всегда (даже если ПК выключен) — ищем любой пункт как якорь
    if (!rebootBtn) {
        // Ищем "Продлить сеанс" как якорь
        for (var i = 0; i < items.length; i++) {
            var lbl = items[i].querySelector('.mantine-Menu-itemLabel');
            if (lbl && (lbl.textContent.trim() === 'Продлить сеанс' || lbl.textContent.trim() === 'Продлить')) {
                rebootBtn = items[i];
                break;
            }
        }
        if (!rebootBtn) return;
    }

    var mi = rebootBtn.cloneNode(true);
    mi.setAttribute('data-godji-restart-multi', '1');
    mi.style.cssText = 'color:#bf360c;background-color:rgba(191,54,12,0.12);--menu-item-color:#bf360c;--menu-item-hover:rgba(191,54,12,0.20);';
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

    var next = rebootBtn.nextSibling;
    rebootBtn.parentNode.insertBefore(mi, next || null);
});

if (document.body) {
    _multiObs.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener('DOMContentLoaded', function() {
        _multiObs.observe(document.body, { childList: true, subtree: true });
    });
}

})();

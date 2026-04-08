// ==UserScript==
// @name         Годжи — Программа новичка
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Кнопка быстрой активации программы новичка на странице клиента
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
'use strict';

var CLUB_ID = 14;
var BTN_ID  = 'godji-beginner-btn';

// ── Получаем userId из URL ────────────────────────────────
function getUserIdFromUrl() {
    var m = window.location.pathname.match(/\/clients\/([a-f0-9\-]{36})/i);
    return m ? m[1] : null;
}

// ── Токен ─────────────────────────────────────────────────
function getAuth() {
    return window._godjiAuthToken || null;
}

// ── Мутация активации ─────────────────────────────────────
function activateBeginnerProgram(userId, btn) {
    var auth = getAuth();
    if (!auth) {
        showToast('Нет токена авторизации — перезагрузите страницу', false);
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Активация...';

    fetch('https://hasura.godji.cloud/v1/graphql', {
        method: 'POST',
        headers: {
            'authorization': auth,
            'content-type': 'application/json',
            'x-hasura-role': 'club_admin'
        },
        body: JSON.stringify({
            operationName: 'BeginnerProgramStart',
            variables: { params: { userId: userId, clubId: CLUB_ID } },
            query: 'mutation BeginnerProgramStart($params: BeginnerProgramStartInput!) { beginnerProgramStart(params: $params) { success } }'
        })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        var ok = data && data.data && data.data.beginnerProgramStart && data.data.beginnerProgramStart.success;
        if (ok) {
            showToast('✓ Программа новичка активирована', true);
            btn.textContent = '✓ Активирована';
            btn.style.background = '#166534';
            btn.disabled = true;
        } else {
            var msg = (data.errors && data.errors[0] && data.errors[0].message) || 'Ошибка активации';
            showToast('✗ ' + msg, false);
            resetBtn(btn);
        }
    })
    .catch(function (e) {
        showToast('✗ Ошибка сети: ' + e.message, false);
        resetBtn(btn);
    });
}

function resetBtn(btn) {
    btn.disabled = false;
    btn.textContent = '▶ Активировать программу новичка';
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, ok) {
    var old = document.getElementById('godji-bp-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'godji-bp-toast';
    t.textContent = msg;
    t.style.cssText = [
        'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
        'padding:10px 22px', 'border-radius:10px', 'font-size:13px',
        'font-family:var(--mantine-font-family,sans-serif)', 'font-weight:500',
        'z-index:999999', 'pointer-events:none', 'white-space:nowrap',
        'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
        ok  ? 'background:#166534;color:#bbf7d0;border:1px solid rgba(187,247,208,.3);'
            : 'background:#7f1d1d;color:#fecaca;border:1px solid rgba(254,202,202,.3);'
    ].join(';');
    document.body.appendChild(t);
    setTimeout(function () {
        t.style.transition = 'opacity .3s';
        t.style.opacity = '0';
        setTimeout(function () { if (t.parentNode) t.remove(); }, 300);
    }, 3000);
}

// ── Проверка статуса программы ────────────────────────────
function getBeginnerStatus(userId, cb) {
    var auth = getAuth();
    if (!auth) { cb(null); return; }

    fetch('https://hasura.godji.cloud/v1/graphql', {
        method: 'POST',
        headers: {
            'authorization': auth,
            'content-type': 'application/json',
            'x-hasura-role': 'club_admin'
        },
        body: JSON.stringify({
            operationName: 'GetBeginnerStatus',
            variables: { userId: userId },
            query: 'query GetBeginnerStatus($userId:String!){users_by_pk(id:$userId){beginner_program_status}}'
        })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        var status = data && data.data && data.data.users_by_pk && data.data.users_by_pk.beginner_program_status;
        cb(status);
    })
    .catch(function () { cb(null); });
}

// ── Вставка кнопки ────────────────────────────────────────
function injectButton() {
    if (document.getElementById(BTN_ID)) return;

    var userId = getUserIdFromUrl();
    if (!userId) return;

    // Ждём появления страницы клиента — ищем блок с аватаром/профилем
    var target = document.querySelector('.mantine-Avatar-root, [class*="ClientCard"], [class*="Profile"], [class*="client"]');
    if (!target) return;

    // Создаём кнопку
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = '▶ Активировать программу новичка';
    btn.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px',
        'padding:7px 16px', 'border-radius:8px', 'border:none',
        'background:#1565c0', 'color:#fff', 'font-size:13px',
        'font-weight:600', 'cursor:pointer', 'font-family:inherit',
        'transition:background .15s', 'white-space:nowrap',
        'margin-top:8px',
    ].join(';');
    btn.addEventListener('mouseenter', function () {
        if (!btn.disabled) btn.style.background = '#1976d2';
    });
    btn.addEventListener('mouseleave', function () {
        if (!btn.disabled) btn.style.background = '#1565c0';
    });

    // Проверяем статус — если уже активирована, показываем иначе
    getBeginnerStatus(userId, function (status) {
        if (status === 'active' || status === 'completed') {
            btn.textContent = '✓ Программа новичка активна';
            btn.style.background = '#166534';
            btn.disabled = true;
        } else if (status === 'finished') {
            btn.textContent = '✓ Программа новичка завершена';
            btn.style.background = '#374151';
            btn.disabled = true;
        } else {
            btn.addEventListener('click', function () {
                activateBeginnerProgram(userId, btn);
            });
        }
    });

    // Вставляем рядом с профилем — ищем кнопки действий на странице клиента
    var actionsRow = document.querySelector('[class*="actions"], [class*="Actions"], .mantine-Group-root');
    if (actionsRow) {
        actionsRow.appendChild(btn);
    } else {
        // Fallback — вставляем после аватара
        target.parentElement && target.parentElement.appendChild(btn);
    }
}

// ── Наблюдатель за роутингом ──────────────────────────────
function tryInject() {
    if (!getUserIdFromUrl()) return;
    injectButton();
}

var _lastPath = '';
function onNav() {
    var p = window.location.pathname;
    if (p === _lastPath) return;
    _lastPath = p;
    // Убираем старую кнопку при переходе
    var old = document.getElementById(BTN_ID);
    if (old) old.remove();
    // Ждём рендера новой страницы
    setTimeout(tryInject, 800);
    setTimeout(tryInject, 2000);
}

// Перехват pushState/replaceState для SPA навигации
var _origPush = history.pushState;
history.pushState = function () {
    _origPush.apply(this, arguments);
    onNav();
};
var _origReplace = history.replaceState;
history.replaceState = function () {
    _origReplace.apply(this, arguments);
    onNav();
};
window.addEventListener('popstate', onNav);

// MutationObserver для подстраховки
new MutationObserver(function () {
    if (getUserIdFromUrl() && !document.getElementById(BTN_ID)) {
        tryInject();
    }
}).observe(document.body || document.documentElement, { childList: true, subtree: true });

setTimeout(tryInject, 1000);
setTimeout(tryInject, 3000);

})();

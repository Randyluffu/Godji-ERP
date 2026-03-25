// ==UserScript==
// @name         Годжи — GG500
// @namespace    http://tampermonkey.net/
// @version      2.6
// @match        https://godji.cloud/clients/*
// @match        https://*.godji.cloud/clients/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_gg500.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_gg500.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var _authToken = null;
    var _hasuraRole = 'club_admin';
    var _origFetch = window.fetch;

    // Перехватываем fetch для поимки токена — не ломаем цепочку
    window.fetch = function(url, options) {
        if (options && options.headers && options.headers.authorization) {
            _authToken = options.headers.authorization;
            _hasuraRole = options.headers['x-hasura-role'] || 'club_admin';
        }
        return _origFetch.apply(this, arguments);
    };
    window.fetch._godjiGG500Hooked = true;

    function getClientId() {
        var match = window.location.pathname.match(/\/clients\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    }

    function getCookieClubId() {
        var match = document.cookie.match(/clubId=(\d+)/);
        return match ? parseInt(match[1]) : 14;
    }

    function getHeaders() {
        if (!_authToken) return null;
        return {
            'authorization': _authToken,
            'content-type': 'application/json',
            'x-hasura-role': _hasuraRole,
        };
    }

    async function fetchWalletId() {
        var headers = getHeaders();
        if (!headers) return null;
        var clientId = getClientId();
        if (!clientId) return null;
        var clubId = getCookieClubId();

        try {
            var res = await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    operationName: 'GetClient',
                    variables: { userId: clientId, clubId: clubId },
                    query: 'query GetClient($userId: String!, $clubId: Int!) { users_by_pk(id: $userId) { users_wallets(where: {club_id: {_eq: $clubId}}, limit: 1) { id } } }',
                }),
            });
            var data = await res.json();
            var wallets = data.data.users_by_pk.users_wallets;
            return wallets && wallets.length > 0 ? wallets[0].id : null;
        } catch(e) { return null; }
    }

    async function doGG500() {
        var btn = document.getElementById('godji-gg500-btn');
        var label = document.getElementById('godji-gg500-label');
        var originalText = label ? label.textContent : '';
        if (btn) btn.disabled = true;
        if (label) label.textContent = 'Загрузка...';

        var headers = getHeaders();
        if (!headers) {
            if (btn) btn.disabled = false;
            if (label) label.textContent = originalText;
            alert('Нет авторизации. Перезагрузите страницу.');
            return;
        }

        var walletId = await fetchWalletId();
        if (!walletId) {
            if (btn) btn.disabled = false;
            if (label) label.textContent = originalText;
            alert('Не удалось получить кошелёк клиента.');
            return;
        }

        try {
            var res = await _origFetch('https://hasura.godji.cloud/v1/graphql', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    operationName: 'DepositBalanceWithBonus',
                    variables: { amount: 500, walletId: walletId, comment: 'GG500' },
                    query: 'mutation DepositBalanceWithBonus($walletId: Int!, $amount: Float!, $comment: String) { walletDepositWithBonus(walletId: $walletId, amount: $amount, comment: $comment) { id __typename } }',
                }),
            });
            var data = await res.json();
            if (data.errors) {
                if (btn) btn.disabled = false;
                if (label) label.textContent = originalText;
                alert('Ошибка: ' + data.errors[0].message);
            } else {
                // Закрываем модалку
                var closeBtn = document.querySelector('[data-modal-content] button.mantine-Modal-close');
                if (closeBtn) closeBtn.click();
                showToast('500 бонусов GG500 начислены ✓');
            }
        } catch(e) {
            if (btn) btn.disabled = false;
            if (label) label.textContent = originalText;
            alert('Ошибка: ' + e.message);
        }
    }

    function showToast(msg) {
        var toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = [
            'position:fixed',
            'bottom:24px',
            'left:50%',
            'transform:translateX(-50%)',
            'background:var(--mantine-color-green-filled)',
            'color:#fff',
            'padding:10px 20px',
            'border-radius:var(--mantine-radius-sm)',
            'font-size:14px',
            'font-family:inherit',
            'font-weight:500',
            'z-index:99999',
            'box-shadow:0 4px 12px rgba(0,0,0,0.2)',
            'transition:opacity 0.3s',
        ].join(';');
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '0'; }, 2000);
        setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 2400);
    }

    function injectButton() {
        var modal = document.querySelector('[data-modal-content]');
        if (!modal) return;

        // Ищем заголовок среди всех p в модалке
        var allP = modal.querySelectorAll('p');
        var isPromo = false;
        for (var i = 0; i < allP.length; i++) {
            if (allP[i].textContent.trim() === 'Активировать промокод') { isPromo = true; break; }
        }
        if (!isPromo) return;
        if (modal.querySelector('#godji-gg500-btn')) return;

        var modalBody = modal.querySelector('.mantine-Modal-body');
        if (!modalBody) return;

        // Кнопка в стиле остальных кнопок карточки — outlined с иконкой
        var btn = document.createElement('button');
        btn.id = 'godji-gg500-btn';
        btn.style.cssText = [
            'width:100%',
            'height:36px',
            'padding:0 14px',
            'background:var(--mantine-color-green-light)',
            'color:var(--mantine-color-green-light-color)',
            'border:calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-green-light-color)',
            'border-radius:var(--mantine-radius-default)',
            'font-size:var(--mantine-font-size-sm)',
            'font-family:inherit',
            'font-weight:500',
            'cursor:pointer',
            'transition:background 0.15s',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'gap:8px',
            'margin-top:8px',
        ].join(';');

        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l0 14"></path><path d="M5 12l14 0"></path></svg>'
                      + '<span id="godji-gg500-label">GG500 — начислить 500 бонусов</span>';

        btn.addEventListener('mouseenter', function() { btn.style.background = 'var(--mantine-color-green-light-hover)'; });
        btn.addEventListener('mouseleave', function() { btn.style.background = 'var(--mantine-color-green-light)'; });
        btn.addEventListener('click', doGG500);

        modalBody.appendChild(btn);
    }

    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiGG500Timer);
                // Несколько попыток с разными задержками
                window._godjiGG500Timer = setTimeout(injectButton, 100);
                setTimeout(injectButton, 300);
                setTimeout(injectButton, 600);
                break;
            }
        }
    });

    document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.body, { childList: true, subtree: true });
    });

    // На случай если DOMContentLoaded уже прошёл
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }

})();

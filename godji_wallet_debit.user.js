// ==UserScript==
// @name         Годжи — Списание с баланса
// @namespace    http://tampermonkey.net/
// @version      2.1
// @match        https://godji.cloud/clients/*
// @match        https://*.godji.cloud/clients/*
// @include      https://godji.cloud/clients/*
// @include      https://*.godji.cloud/clients/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_wallet_debit.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_wallet_debit.user.js
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

    window.fetch = function(url, options) {
        if (options && options.headers && options.headers.authorization) {
            _authToken = options.headers.authorization;
            _hasuraRole = options.headers['x-hasura-role'] || 'club_admin';
        }
        return _origFetch.apply(this, arguments);
    };

    function getHeaders() {
        var t = _authToken || window._godjiAuthToken;
        if (!t) return null;
        return { 'authorization': t, 'content-type': 'application/json', 'x-hasura-role': _hasuraRole || 'club_admin' };
    }

    function getClientId() {
        var m = window.location.pathname.match(/\/clients\/([a-f0-9-]{36})/);
        return m ? m[1] : null;
    }

    async function getWalletId(clientId) {
        var h = getHeaders();
        if (!h) return null;
        try {
            var res = await _origFetch(API_URL, {
                method: 'POST', headers: h,
                body: JSON.stringify({
                    operationName: 'GetClientWallet',
                    variables: { userId: clientId, clubId: CLUB_ID },
                    query: 'query GetClientWallet($userId: String!, $clubId: Int!) { users_by_pk(id: $userId) { users_wallets(where: {club_id: {_eq: $clubId}}, limit: 1) { id balance_amount } } }',
                }),
            });
            var data = await res.json();
            var wallets = data.data && data.data.users_by_pk && data.data.users_by_pk.users_wallets;
            if (!wallets || !wallets.length) return null;
            return { id: wallets[0].id, balance: wallets[0].balance_amount };
        } catch(e) { return null; }
    }


    async function debitWallet(walletId, amount) {
        var h = getHeaders();
        if (!h) return null;
        try {
            var exactAmount = parseFloat((-Math.abs(amount)).toFixed(2));
            var res = await _origFetch(API_URL, {
                method: 'POST', headers: h,
                body: JSON.stringify({
                    operationName: 'DepositBalanceWithCash',
                    variables: { amount: exactAmount, walletId: walletId, isCash: true },
                    query: 'mutation DepositBalanceWithCash($amount: Float!, $walletId: Int!, $isCash: Boolean!) { walletDepositWithCash(params: {amount: $amount, walletId: $walletId, isCash: $isCash}) { operationId } }',
                }),
            });
            return await res.json();
        } catch(e) { return { errors: [{ message: e.message }] }; }
    }

    function showModal(walletId, balance) {
        if (document.getElementById('godji-debit-overlay')) return;

        var overlay = document.createElement('div');
        overlay.id = 'godji-debit-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.remove();
        });

        var modal = document.createElement('div');
        modal.style.cssText = 'background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md);width:100%;max-width:360px;font-family:inherit;box-shadow:var(--mantine-shadow-xl);overflow:hidden;';
        modal.addEventListener('click', function(e) { e.stopPropagation(); });

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:1px solid var(--mantine-color-default-border);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:15px;font-weight:700;color:var(--mantine-color-text);';
        title.textContent = 'Списание с баланса';

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed);font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() { overlay.remove(); });

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Баланс
        var balanceInfo = document.createElement('div');
        balanceInfo.style.cssText = 'padding:12px 20px 0;font-size:12px;color:var(--mantine-color-dimmed);';
        balanceInfo.textContent = 'Текущий баланс: ' + balance.toFixed(2) + ' ₽';

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:12px 20px 20px;display:flex;flex-direction:column;gap:12px;';

        // Сумма
        var amountLabel = document.createElement('label');
        amountLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text);display:flex;flex-direction:column;gap:6px;';
        amountLabel.textContent = 'Сумма (₽)';

        var amountInput = document.createElement('input');
        amountInput.type = 'number';
        amountInput.min = '0.01';
        amountInput.step = '0.01';
        amountInput.placeholder = '0.00';
        amountInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm);font-size:14px;font-family:inherit;background:var(--mantine-color-default);color:var(--mantine-color-text);box-sizing:border-box;outline:none;';
        amountInput.addEventListener('focus', function() { amountInput.style.borderColor = 'var(--mantine-color-blue-filled)'; });
        amountInput.addEventListener('blur', function() { amountInput.style.borderColor = 'var(--mantine-color-default-border)'; });
        amountLabel.appendChild(amountInput);

        // Комментарий
        var commentLabel = document.createElement('label');
        commentLabel.style.cssText = 'font-size:13px;font-weight:600;color:var(--mantine-color-text);display:flex;flex-direction:column;gap:6px;';
        commentLabel.textContent = 'Причина';

        var commentInput = document.createElement('input');
        commentInput.type = 'text';
        commentInput.placeholder = 'Укажите причину списания...';
        commentInput.style.cssText = 'width:100%;padding:8px 12px;border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm);font-size:14px;font-family:inherit;background:var(--mantine-color-default);color:var(--mantine-color-text);box-sizing:border-box;outline:none;';
        commentInput.addEventListener('focus', function() { commentInput.style.borderColor = 'var(--mantine-color-blue-filled)'; });
        commentInput.addEventListener('blur', function() { commentInput.style.borderColor = 'var(--mantine-color-default-border)'; });
        commentLabel.appendChild(commentInput);

        // Ошибка
        var errorEl = document.createElement('div');
        errorEl.style.cssText = 'font-size:12px;color:var(--mantine-color-red-filled);display:none;';

        // Кнопка
        var submitBtn = document.createElement('button');
        submitBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        submitBtn.setAttribute('data-variant', 'filled');
        submitBtn.style.cssText = '--button-bg:var(--mantine-color-red-filled);--button-hover:var(--mantine-color-red-filled-hover);--button-color:#fff;--button-bd:none;width:100%;margin-top:4px;';

        var submitInner = document.createElement('span');
        submitInner.className = 'm_80f1301b mantine-Button-inner';
        var submitLabel = document.createElement('span');
        submitLabel.className = 'm_811560b9 mantine-Button-label';
        submitLabel.textContent = 'Списать';
        submitInner.appendChild(submitLabel);
        submitBtn.appendChild(submitInner);

        submitBtn.addEventListener('click', async function() {
            var amount = parseFloat(parseFloat(amountInput.value).toFixed(2));
            var comment = commentInput.value.trim();

            errorEl.style.display = 'none';

            if (!amount || amount <= 0) {
                errorEl.textContent = 'Введите корректную сумму';
                errorEl.style.display = 'block';
                return;
            }
            if (amount > balance) {
                errorEl.textContent = 'Сумма превышает баланс (' + balance.toFixed(2) + ' ₽)';
                errorEl.style.display = 'block';
                return;
            }
            if (!comment) {
                errorEl.textContent = 'Укажите причину списания';
                errorEl.style.display = 'block';
                return;
            }

            submitBtn.disabled = true;
            submitLabel.textContent = 'Выполняется...';

            var result = await debitWallet(walletId, amount);

            if (!result || result.errors) {
                errorEl.textContent = 'Ошибка: ' + (result && result.errors ? result.errors[0].message : 'неизвестная ошибка');
                errorEl.style.display = 'block';
                submitBtn.disabled = false;
                submitLabel.textContent = 'Списать';
                return;
            }

            overlay.remove();
            // Показываем тост и перезагружаем через 1.5 сек
            var toast = document.createElement('div');
            toast.textContent = 'Списано ' + Math.abs(amount).toFixed(2) + ' ₽ ✓';
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.92);color:#fff;padding:8px 18px;border-radius:var(--mantine-radius-sm);font-size:13px;font-family:inherit;font-weight:500;z-index:99999;white-space:nowrap;';
            document.body.appendChild(toast);
            setTimeout(function() { window.location.reload(); }, 1500);
        });

        body.appendChild(amountLabel);
        body.appendChild(commentLabel);
        body.appendChild(errorEl);
        body.appendChild(submitBtn);

        modal.appendChild(header);
        modal.appendChild(balanceInfo);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        setTimeout(function() { amountInput.focus(); }, 50);
    }

    async function injectButton() {
        if (document.getElementById('godji-debit-btn')) return;

        var clientId = getClientId();
        if (!clientId) return;

        // Ищем кнопку "Пополнить наличными" как anchor
        var allBtns = document.querySelectorAll('button');
        var anchorBtn = null;
        allBtns.forEach(function(b) {
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
        btn.setAttribute('justify', 'flex-start');
        btn.style.cssText = '--button-justify:flex-start;--button-height:var(--button-height-xs);--button-padding-x:var(--button-padding-x-xs);--button-fz:var(--mantine-font-size-xs);--button-bg:var(--mantine-color-red-light);--button-hover:var(--mantine-color-red-light-hover);--button-color:var(--mantine-color-red-light-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;flex:1 1 100%;width:100%;';

        var inner = document.createElement('span');
        inner.className = 'm_80f1301b mantine-Button-inner';

        var section = document.createElement('span');
        section.className = 'm_a74036a mantine-Button-section';
        section.setAttribute('data-position', 'left');
        section.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1 -3.5 3.5h-1a3.5 3.5 0 0 1 -3.5 -3.5a1.5 1.5 0 0 1 1.5 -1.5"></path><path d="M12.5 21h-4.5a4 4 0 0 1 -4 -4v-1a8 8 0 0 1 14 -5.5"></path><path d="M16 19h-6"></path></svg>';

        var label = document.createElement('span');
        label.className = 'm_811560b9 mantine-Button-label';
        label.textContent = 'Списать с рублёвого баланса';

        inner.appendChild(section);
        inner.appendChild(label);
        btn.appendChild(inner);

        btn.addEventListener('click', async function() {
            var wallet = await getWalletId(clientId);
            if (!wallet) {
                alert('Не удалось получить данные кошелька');
                return;
            }
            showModal(wallet.id, wallet.balance);
        });

        // Вставляем в отдельную строку после строки со "Списать бонусы"
        var chargeBtn = null;
        document.querySelectorAll('button').forEach(function(b) {
            if (b.textContent.trim() === 'Списать бонусы') chargeBtn = b;
        });

        var targetRow = chargeBtn ? chargeBtn.parentNode : anchorBtn.parentNode;
        var targetParent = targetRow ? targetRow.parentNode : null;

        if (targetParent) {
            // Создаём отдельную строку для нашей кнопки
            var newRow = document.createElement('div');
            newRow.className = targetRow.className;
            newRow.style.cssText = targetRow.style.cssText;
            // Растягиваем кнопку на всю ширину
            btn.style.setProperty('flex', '1 1 100%', 'important');
            newRow.appendChild(btn);
            targetParent.insertBefore(newRow, targetRow.nextSibling);
        } else {
            anchorBtn.parentNode.insertBefore(btn, anchorBtn.nextSibling);
        }
    }

    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiDebitTimer);
                window._godjiDebitTimer = setTimeout(injectButton, 300);
                break;
            }
        }
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    setTimeout(injectButton, 1500);
    setTimeout(injectButton, 3000);

})();

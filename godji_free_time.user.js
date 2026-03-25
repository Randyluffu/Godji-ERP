// ==UserScript==
// @name         Godji CRM - Free Time
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Добавляет бесплатное время клиентам через контекстное меню
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_free_time.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_free_time.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var BUTTON_ID = 'godji-free-time-btn';
    var MODAL_ID = 'godji-free-time-modal';
    var API_URL = 'https://hasura.godji.cloud/v1/graphql';

    // Данные сессий перехваченные из API
    var sessionsData = {};
    var lastContextPc = null;
    var authToken = null;
    var hasuraRole = 'club_admin';

    // --- Перехватываем API-ответы для получения sessionId, walletId, tariffId ---
    function installFetchHook() {
        var origFetch = window.fetch;
        if (!origFetch) return;
        window.fetch = function(url, opts) {
            try {
                var body = opts && opts.body ? opts.body : '';

                // Сохраняем заголовки авторизации
                if (opts && opts.headers && opts.headers.authorization) {
                    authToken = opts.headers.authorization;
                    window._godjiAuthToken = authToken;
                    window._godjiHasuraRole = opts.headers['x-hasura-role'] || 'club_admin';
                    if (opts.headers['x-hasura-role']) {
                        hasuraRole = opts.headers['x-hasura-role'];
                    }
                }

                // Перехватываем GetDashboardTable — делаем свой параллельный запрос
                if (authToken && hasuraRole && typeof body === 'string' && body.indexOf('GetDashboardTable') !== -1 && !window._godjiPending) {
                    window._godjiPending = true;
                    setTimeout(function() { window._godjiPending = false; }, 3000);

                    origFetch.call(window, 'https://hasura.godji.cloud/v1/graphql', {
                        method: 'POST',
                        headers: {
                            'accept': '*/*',
                            'content-type': 'application/json',
                            'authorization': authToken,
                            'x-hasura-role': hasuraRole
                        },
                        body: JSON.stringify({
                            operationName: 'GetDashboardDevicesForScript',
                            variables: JSON.parse(body).variables,
                            query: 'query GetDashboardDevicesForScript($clubId: Int!) { getDashboardDevices(params: {clubId: $clubId}) { devices { name sessions { id status tariff { id name } user { nickname wallet { id } } } } } }'
                        })
                    }).then(function(res) { return res.json(); }).then(function(json) {
                        window._godjiPending = false;
                        if (!json || !json.data || !json.data.getDashboardDevices) return;
                        var devices = json.data.getDashboardDevices.devices;
                        devices.forEach(function(d) {
                            if (d.sessions && d.sessions.length > 0) {
                                d.sessions.forEach(function(s) {
                                    if (s && s.user && s.user.wallet && s.id) {
                                        sessionsData[d.name] = {
                                            sessionId: s.id,
                                            tariffId: s.tariff ? s.tariff.id : null,
                                            walletId: s.user.wallet.id,
                                            nickname: s.user.nickname || '',
                                            pcName: d.name
                                        };
                                        window._godjiSessionsData = sessionsData;
                                    }
                                });
                            }
                        });
                    }).catch(function() { window._godjiPending = false; });
                }
            } catch(e) {}
            return origFetch.call(this, url, opts);
        };
        window.fetch._godjiHooked = true;
    }

    installFetchHook();
    var hookInterval = setInterval(function() {
        if (window.fetch && !window.fetch._godjiHooked) {
            installFetchHook();
        }
    }, 500);

    // --- GraphQL запрос ---
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
        }).then(function(r) { return r.json(); });
    }

    // --- Получить поминутный тариф и рассчитать стоимость ---
    function getCostAndTariff(sessionId, minutes) {
        return gql(
            'query availableTariffsForProlongation($minutes: Int, $sessionId: Int!) { getAvailableTariffsForProlongation(params: {minutes: $minutes, sessionId: $sessionId}) { tariffs { id name durationMin cost } } }',
            { sessionId: sessionId, minutes: 1 }
        ).then(function(r) {
            var tariffs = r.data && r.data.getAvailableTariffsForProlongation && r.data.getAvailableTariffsForProlongation.tariffs;
            if (!tariffs || tariffs.length === 0) return null;
            // Берём тариф с наименьшим durationMin — это поминутный
            var sorted = tariffs.slice().sort(function(a, b) { return a.durationMin - b.durationMin; });
            var minTariff = sorted[0];
            var costPerMin = minTariff.cost / minTariff.durationMin;
            var totalCost = Math.round(costPerMin * minutes * 100) / 100;
            return {
                tariffId: minTariff.id,
                tariffName: minTariff.name,
                cost: totalCost,
                costPerMin: costPerMin
            };
        });
    }

    // --- Пополнить бонусы ---
    function depositBonus(walletId, amount, comment) {
        return gql(
            'mutation DepositBalanceWithBonus($amount: Float!, $walletId: Int!, $comment: String) { walletDepositWithBonus(params: {amount: $amount, walletId: $walletId, description: $comment}) { operationId __typename } }',
            { amount: amount, walletId: walletId, comment: comment }
        );
    }

    // --- Продлить сеанс ---
    function prolongSession(sessionId, tariffId, minutes) {
        return gql(
            'mutation prolongateSession($sessionId: Int!, $tariffId: Int!, $minutes: Int) { userReservationProlongate(params: {sessionId: $sessionId, tariffId: $tariffId, minutes: $minutes}) { success __typename } }',
            { sessionId: sessionId, tariffId: tariffId, minutes: minutes }
        );
    }

    // --- Модальное окно ---
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

        // Удаляем старый модал
        var old = document.getElementById(MODAL_ID);
        if (old) old.remove();
        var oldOv = document.getElementById(MODAL_ID + '-overlay');
        if (oldOv) oldOv.remove();

        // Оверлей
        var overlay = document.createElement('div');
        overlay.id = MODAL_ID + '-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;background:rgba(0,0,0,0.5);';
        overlay.addEventListener('click', closeModal);
        document.body.appendChild(overlay);

        // Модал в стиле CRM (светлый)
        var modal = document.createElement('div');
        modal.id = MODAL_ID;
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:420px;max-width:95vw;background:#ffffff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-family:inherit;overflow:hidden;';
        modal.addEventListener('click', function(e) { e.stopPropagation(); });

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:20px 24px 4px;';

        var title = document.createElement('div');
        title.style.cssText = 'font-size:18px;font-weight:600;color:#1a1a1a;';
        title.textContent = 'Бесплатное время — ПК ' + pcName;

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#999;font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', closeModal);

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Подзаголовок
        var subtitle = document.createElement('div');
        subtitle.style.cssText = 'padding:2px 24px 16px;font-size:13px;color:#666;';
        subtitle.textContent = 'Бонусы будут начислены автоматически по поминутному тарифу';

        // Тело
        var body = document.createElement('div');
        body.style.cssText = 'padding:0 24px 24px;';

        // Поле минут
        var minutesLabel = document.createElement('div');
        minutesLabel.style.cssText = 'font-size:13px;font-weight:500;color:#1a1a1a;margin-bottom:6px;';
        minutesLabel.innerHTML = 'Количество минут <span style="color:#cc0001;">*</span>';

        var minutesInput = document.createElement('input');
        minutesInput.type = 'number';
        minutesInput.min = '1';
        minutesInput.max = '480';
        minutesInput.value = '15';
        minutesInput.style.cssText = 'width:100%;padding:10px 12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;color:#1a1a1a;font-size:15px;font-family:inherit;box-sizing:border-box;outline:none;transition:border-color 0.2s;';
        minutesInput.addEventListener('focus', function() { minutesInput.style.borderColor = '#cc0001'; });
        minutesInput.addEventListener('blur', function() { minutesInput.style.borderColor = '#e0e0e0'; });

        // Блок стоимости
        var costBlock = document.createElement('div');
        costBlock.style.cssText = 'margin-top:10px;padding:10px 12px;background:#f9f9f9;border:1px solid #efefef;border-radius:8px;min-height:40px;display:flex;align-items:center;';

        var costText = document.createElement('span');
        costText.style.cssText = 'color:#999;font-size:13px;';
        costText.textContent = 'Введите минуты для расчёта…';
        costBlock.appendChild(costText);

        // Поле комментария
        var commentLabel = document.createElement('div');
        commentLabel.style.cssText = 'font-size:13px;font-weight:500;color:#1a1a1a;margin-top:14px;margin-bottom:6px;';
        commentLabel.textContent = 'Комментарий';

        var commentInput = document.createElement('textarea');
        commentInput.placeholder = '';
        commentInput.style.cssText = 'width:100%;padding:10px 12px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;color:#1a1a1a;font-size:13px;font-family:inherit;box-sizing:border-box;outline:none;resize:vertical;min-height:70px;transition:border-color 0.2s;';
        commentInput.addEventListener('focus', function() { commentInput.style.borderColor = '#cc0001'; });
        commentInput.addEventListener('blur', function() { commentInput.style.borderColor = '#e0e0e0'; });

        // Кнопки внизу
        var btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px;';

        var cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = 'flex:1;padding:11px;background:#fff;color:#1a1a1a;border:1px solid #e0e0e0;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;transition:background 0.15s;';
        cancelBtn.textContent = 'Отмена';
        cancelBtn.addEventListener('mouseenter', function() { cancelBtn.style.background = '#f5f5f5'; });
        cancelBtn.addEventListener('mouseleave', function() { cancelBtn.style.background = '#fff'; });
        cancelBtn.addEventListener('click', closeModal);

        // Кнопка подтверждения
        var confirmBtn = document.createElement('button');
        confirmBtn.style.cssText = 'flex:1;padding:11px;background:#e0e0e0;color:#999;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:not-allowed;font-family:inherit;transition:background 0.2s,color 0.2s;';
        confirmBtn.textContent = 'Начислить';
        confirmBtn.disabled = true;

        // Таймер для debounce расчёта стоимости
        var costTimer = null;
        var currentCost = null;
        var currentTariffId = null;

        function recalcCost() {
            var mins = parseInt(minutesInput.value);
            if (!mins || mins < 1) {
                costText.textContent = '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043c\u0438\u043d\u0443\u0442\u044b \u0434\u043b\u044f \u0440\u0430\u0441\u0447\u0451\u0442\u0430\u2026';
                costText.style.color = 'rgba(255,255,255,0.5)';
                currentCost = null;
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.5';
                return;
            }

            costText.textContent = '\u0420\u0430\u0441\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u043c\u2026';
            costText.style.color = 'rgba(255,255,255,0.5)';
            confirmBtn.disabled = true;
            confirmBtn.style.background = '#e0e0e0';
            confirmBtn.style.color = '#999';
            confirmBtn.style.cursor = 'not-allowed';

            clearTimeout(costTimer);
            costTimer = setTimeout(function() {
                getCostAndTariff(session.sessionId, mins).then(function(result) {
                    if (result !== null) {
                        currentCost = result.cost;
                        currentTariffId = result.tariffId;
                        costText.innerHTML = '\u0411\u0443\u0434\u0435\u0442 \u043d\u0430\u0447\u0438\u0441\u043b\u0435\u043d\u043e <strong style="color:#1a1a1a;font-size:15px;">' + result.cost + ' \u0431\u043e\u043d\u0443\u0441\u043e\u0432</strong> \u0438 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e <strong style="color:#1a1a1a;font-size:15px;">' + mins + ' \u043c\u0438\u043d</strong> <span style="color:rgba(255,255,255,0.4);font-size:11px;">(' + result.tariffName.trim() + ')</span>';
                        costText.style.color = '#1a1a1a';
                        confirmBtn.disabled = false;
                        confirmBtn.style.background = '#cc0001';
                        confirmBtn.style.color = '#fff';
                        confirmBtn.style.cursor = 'pointer';
                    } else {
                        costText.textContent = '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0441\u0442\u043e\u0438\u043c\u043e\u0441\u0442\u044c';
                        costText.style.color = '#cc0001';
                    }
                }).catch(function() {
                    costText.textContent = '\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0440\u0430\u0441\u0447\u0451\u0442\u0435';
                    costText.style.color = '#cc0001';
                });
            }, 600);
        }

        minutesInput.addEventListener('input', recalcCost);

        // Подтверждение
        confirmBtn.addEventListener('click', function() {
            var mins = parseInt(minutesInput.value);
            var comment = commentInput.value.trim() || '\u0411\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u043e\u0435 \u0432\u0440\u0435\u043c\u044f';
            if (!mins || currentCost === null) return;

            confirmBtn.disabled = true;
            confirmBtn.textContent = '\u0412\u044b\u043f\u043e\u043b\u043d\u044f\u0435\u043c\u2026';
            confirmBtn.style.opacity = '0.8';

            // 1. Пополняем бонусы
            depositBonus(session.walletId, currentCost, comment)
                .then(function() {
                    // 2. Продлеваем сеанс
                    return prolongSession(session.sessionId, currentTariffId || session.tariffId, mins);
                })
                .then(function() {
                    confirmBtn.textContent = '\u0413\u043e\u0442\u043e\u0432\u043e! \u0417\u0430\u043a\u0440\u044b\u0432\u0430\u0435\u043c\u2026';
                    confirmBtn.style.background = '#2e7d32'; confirmBtn.style.color = '#fff';
                    setTimeout(closeModal, 1200);
                })
                .catch(function(err) {
                    confirmBtn.disabled = false;
                    confirmBtn.style.background = '#cc0001';
                    confirmBtn.style.color = '#fff';
                    confirmBtn.textContent = '\u041d\u0430\u0447\u0438\u0441\u043b\u0438\u0442\u044c';
                    costText.textContent = '\u041e\u0448\u0438\u0431\u043a\u0430: ' + (err.message || '\u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437');
                    costText.style.color = '#cc0001';
                });
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(confirmBtn);

        body.appendChild(minutesLabel);
        body.appendChild(minutesInput);
        body.appendChild(costBlock);
        body.appendChild(commentLabel);
        body.appendChild(commentInput);
        body.appendChild(btnRow);

        modal.appendChild(header);
        modal.appendChild(subtitle);
        modal.appendChild(body);
        document.body.appendChild(modal);

        minutesInput.focus();
        recalcCost();
    }

    function closeModal() {
        var m = document.getElementById(MODAL_ID);
        var o = document.getElementById(MODAL_ID + '-overlay');
        if (m) m.remove();
        if (o) o.remove();
    }

    // --- Кнопка в контекстном меню ---
    function removeMenuButton() {
        var b = document.getElementById(BUTTON_ID);
        if (b) b.remove();
    }

    function injectMenuButton(pcName) {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');
        if (!menuEl || !pcName) return;

        // Если кнопка уже есть в этом меню — не перевставляем
        var existing = document.getElementById(BUTTON_ID);
        if (existing && menuEl.contains(existing)) return;

        // Удаляем кнопку если она в другом меню
        removeMenuButton();

        // Проверяем что у этого ПК есть активная сессия
        if (!sessionsData[pcName]) return;

        // Ищем кнопку "Пополнить бонусами" — вставляем после неё
        var items = menuEl.querySelectorAll('[role="menuitem"]');
        var afterItem = null;
        for (var i = 0; i < items.length; i++) {
            var label = items[i].querySelector('.mantine-Menu-itemLabel');
            if (label && label.textContent.trim() === '\u041f\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u0431\u043e\u043d\u0443\u0441\u0430\u043c\u0438') {
                afterItem = items[i];
                break;
            }
        }
        if (!afterItem) return; // Нет кнопки "Пополнить бонусами" — значит сеанс неактивный

        var btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.className = 'mantine-focus-auto m_99ac2aa1 mantine-Menu-item m_87cf2631 mantine-UnstyledButton-root';
        btn.setAttribute('type', 'button');
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-menu-item', 'true');
        btn.setAttribute('data-mantine-stop-propagation', 'true');
        btn.style.cssText = 'color:rgb(46,125,50);background-color:rgb(232,245,233);--menu-item-color:#2e7d32;--menu-item-hover:#e8f5e9;';
        btn.innerHTML = '<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left"><div style="align-items:center;justify-content:center;width:calc(1.25rem * var(--mantine-scale));display:flex;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="stroke:rgb(46,125,50);"><path d="M20.942 13.021a9 9 0 1 0 -9.909 7.954"></path><path d="M12 7v5l3 3"></path><path d="M16 19h6"></path><path d="M19 16v6"></path></svg></div></div><div class="m_5476e0d3 mantine-Menu-itemLabel">\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u043e\u0435 \u0432\u0440\u0435\u043c\u044f</div>';

        btn.addEventListener('mousedown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            document.body.click(); // закрываем меню
            setTimeout(function() { showModal(pcName); }, 50);
        });

        afterItem.parentNode.insertBefore(btn, afterItem.nextSibling);
    }

    // --- Отслеживаем наведение ---
    document.addEventListener('mouseover', function(e) {
        var row = e.target.closest('tr.mantine-Table-tr');
        if (row) {
            // Пробуем найти имя ПК — data-index="0" это первая колонка
            var nc = row.querySelector('td[data-index="0"]');
            if (!nc) nc = row.querySelector('td[style*="col-deviceName-size"]');
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

    // --- MutationObserver для меню ---
    var _menuInjectTimer = null;
    var _lastMenuEl = null;
    var menuObserver = new MutationObserver(function(mutations) {
        var menuEl = document.querySelector('[data-menu-dropdown="true"]');

        // Меню закрылось
        if (!menuEl) {
            _lastMenuEl = null;
            return;
        }

        // Новое меню открылось (не то же самое)
        if (menuEl === _lastMenuEl) {
            // То же меню — проверяем только если кнопки нет
            if (!document.getElementById(BUTTON_ID) && lastContextPc) {
                clearTimeout(_menuInjectTimer);
                _menuInjectTimer = setTimeout(function() {
                    injectMenuButton(lastContextPc);
                }, 50);
            }
            return;
        }

        // Новое меню
        _lastMenuEl = menuEl;
        clearTimeout(_menuInjectTimer);
        _menuInjectTimer = setTimeout(function() {
            if (lastContextPc) injectMenuButton(lastContextPc);
        }, 50);
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });

})();

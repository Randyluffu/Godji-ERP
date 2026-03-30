// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Журнал всех операций: пополнения, сеансы, продления, пересадки, бесплатное время и т.д.
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    var STORAGE_KEY = 'godji_operations_journal';
    var MAX_HOURS = 168; // 7 дней
    var API_URL = 'https://hasura.godji.cloud/v1/graphql';
    var CLUB_ID = 14;

    var _authToken = null;
    var _hasuraRole = 'club_admin';
    var _origFetch = window.fetch;

    // ─────────────────────────────────────────────
    // Перехват fetch — берём токен + ловим ответы
    // ─────────────────────────────────────────────
    window.fetch = function (url, options) {
        if (options && options.headers) {
            if (options.headers.authorization) {
                _authToken = options.headers.authorization;
                window._godjiAuthToken = _authToken;
            }
            if (options.headers['x-hasura-role']) {
                _hasuraRole = options.headers['x-hasura-role'];
                window._godjiHasuraRole = _hasuraRole;
            }
        }

        var origPromise = _origFetch.apply(this, arguments);

        // Перехватываем GraphQL ответы
        if (url && typeof url === 'string' && url.indexOf('hasura.godji.cloud') !== -1) {
            var reqBody = '';
            try { reqBody = (options && options.body) ? options.body : ''; } catch (e) {}

            origPromise = origPromise.then(function (response) {
                var clone = response.clone();
                clone.json().then(function (data) {
                    try { processApiResponse(reqBody, data); } catch (e) {}
                }).catch(function () {});
                return response;
            });
        }

        return origPromise;
    };

    // ─────────────────────────────────────────────
    // localStorage
    // ─────────────────────────────────────────────
    function loadJournal() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            var cutoff = Date.now() - MAX_HOURS * 3600000;
            return raw.filter(function (r) { return r.ts > cutoff; });
        } catch (e) { return []; }
    }

    function saveJournal(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }

    function addEntry(entry) {
        var journal = loadJournal();
        // Защита от дублей за последние 5 секунд по типу + subject
        var now = Date.now();
        var isDup = journal.some(function (r) {
            return r.type === entry.type && r.subject === entry.subject && now - r.ts < 5000;
        });
        if (isDup) return;
        entry.ts = now;
        journal.unshift(entry);
        // Чистим старые
        var cutoff = now - MAX_HOURS * 3600000;
        journal = journal.filter(function (r) { return r.ts > cutoff; });
        saveJournal(journal);
        updateModalIfVisible();
    }

    // ─────────────────────────────────────────────
    // Разбор GraphQL запросов/ответов
    // ─────────────────────────────────────────────
    function processApiResponse(reqBody, data) {
        if (!data || !data.data) return;
        var body = {};
        try { body = JSON.parse(reqBody); } catch (e) { return; }
        var query = body.query || body.operationName || '';
        var vars = body.variables || {};
        var d = data.data;

        // Пополнение наличными
        if (d.walletDepositWithCash) {
            var opId = d.walletDepositWithCash.operationId || '';
            addEntry({
                type: 'deposit_cash',
                icon: '💵',
                label: 'Пополнение наличными',
                subject: String(opId),
                amount: formatAmount(vars.amount),
                comment: vars.comment || vars.description || '',
                extra: opId ? 'ОП #' + opId : ''
            });
        }

        // Пополнение бонусами
        if (d.walletDepositWithBonus) {
            var opId2 = d.walletDepositWithBonus.operationId || d.walletDepositWithBonus.id || '';
            addEntry({
                type: 'deposit_bonus',
                icon: '🎁',
                label: 'Начисление бонусов',
                subject: String(opId2),
                amount: formatAmount(vars.amount),
                comment: vars.comment || vars.description || '',
                extra: opId2 ? 'ОП #' + opId2 : ''
            });
        }

        // Запуск сеанса (userReservationCreate / createReservation)
        if (d.userReservationCreate || d.createReservation) {
            var res = d.userReservationCreate || d.createReservation;
            var sessId = (res && res.id) || (res && res.sessionId) || '';
            addEntry({
                type: 'session_start',
                icon: '▶️',
                label: 'Запуск сеанса',
                subject: String(sessId),
                amount: '',
                comment: vars.comment || '',
                extra: sessId ? 'Сеанс #' + sessId : ''
            });
        }

        // Завершение сеанса (userReservationFinish / finishReservation)
        if (d.userReservationFinish || d.finishReservation) {
            var res2 = d.userReservationFinish || d.finishReservation;
            var sessId2 = (res2 && res2.id) || vars.sessionId || '';
            addEntry({
                type: 'session_finish',
                icon: '⏹️',
                label: 'Завершение сеанса',
                subject: String(sessId2),
                amount: '',
                comment: vars.comment || '',
                extra: sessId2 ? 'Сеанс #' + sessId2 : ''
            });
        }

        // Продление сеанса (userReservationProlongate / prolongateReservation)
        if (d.userReservationProlongate || d.prolongateReservation) {
            var res3 = d.userReservationProlongate || d.prolongateReservation;
            var sessId3 = vars.sessionId || '';
            var mins = vars.minutes ? vars.minutes + ' мин' : '';
            addEntry({
                type: 'session_prolong',
                icon: '⏩',
                label: 'Продление сеанса',
                subject: String(sessId3),
                amount: mins,
                comment: vars.comment || '',
                extra: sessId3 ? 'Сеанс #' + sessId3 : ''
            });
        }

        // Продление вручную (userReservationUpdate)
        if (d.userReservationUpdate || d.updateReservation) {
            var res4 = d.userReservationUpdate || d.updateReservation;
            var sessId4 = vars.sessionId || vars.id || '';
            addEntry({
                type: 'session_update',
                icon: '✏️',
                label: 'Изменение сеанса вручную',
                subject: String(sessId4),
                amount: '',
                comment: vars.comment || '',
                extra: sessId4 ? 'Сеанс #' + sessId4 : ''
            });
        }

        // Пересадка клиента (userReservationTransfer / transferReservation / moveDevice)
        if (d.userReservationTransfer || d.transferReservation || d.moveDevice) {
            var res5 = d.userReservationTransfer || d.transferReservation || d.moveDevice;
            var sessId5 = vars.sessionId || vars.reservationId || '';
            var fromTo = '';
            if (vars.fromDeviceId || vars.toDeviceId) fromTo = (vars.fromDeviceId || '?') + ' → ' + (vars.toDeviceId || '?');
            if (vars.fromDevice || vars.toDevice) fromTo = (vars.fromDevice || '?') + ' → ' + (vars.toDevice || '?');
            addEntry({
                type: 'session_transfer',
                icon: '🔀',
                label: 'Пересадка клиента',
                subject: String(sessId5),
                amount: fromTo,
                comment: vars.comment || '',
                extra: sessId5 ? 'Сеанс #' + sessId5 : ''
            });
        }

        // Переход в ожидание (userReservationWait / pauseReservation / reservationWaiting)
        if (d.userReservationWait || d.pauseReservation || d.reservationWaiting) {
            var sessId6 = vars.sessionId || vars.reservationId || '';
            addEntry({
                type: 'session_wait',
                icon: '⏸️',
                label: 'Переход в ожидание',
                subject: String(sessId6),
                amount: '',
                comment: vars.comment || '',
                extra: sessId6 ? 'Сеанс #' + sessId6 : ''
            });
        }

        // Продление клиентом самостоятельно (clientProlongate / selfProlong)
        if (d.clientProlongate || d.selfProlong || d.clientReservationProlongate) {
            var sessId7 = vars.sessionId || '';
            var mins2 = vars.minutes ? vars.minutes + ' мин' : '';
            addEntry({
                type: 'session_self_prolong',
                icon: '👤',
                label: 'Самостоятельное продление клиентом',
                subject: String(sessId7),
                amount: mins2,
                comment: vars.comment || '',
                extra: sessId7 ? 'Сеанс #' + sessId7 : ''
            });
        }

        // Добавление бесплатного времени (addFreeTime / freeTime)
        if (d.addFreeTime || d.freeTime || d.walletDepositFreeTime) {
            var res6 = d.addFreeTime || d.freeTime || d.walletDepositFreeTime;
            var sessId8 = vars.sessionId || '';
            var mins3 = vars.minutes ? vars.minutes + ' мин' : '';
            addEntry({
                type: 'free_time',
                icon: '⌛',
                label: 'Бесплатное время',
                subject: String(sessId8 || (res6 && res6.operationId) || ''),
                amount: mins3,
                comment: vars.comment || vars.description || '',
                extra: sessId8 ? 'Сеанс #' + sessId8 : ''
            });
        }

        // Списание с баланса (отрицательный депозит через walletDepositWithCash с отрицательной суммой — обрабатывается выше)
        // Дополнительно: явное списание
        if (d.walletDebit || d.walletWithdraw || d.debitWallet) {
            var opId3 = (d.walletDebit || d.walletWithdraw || d.debitWallet || {}).operationId || '';
            addEntry({
                type: 'debit',
                icon: '➖',
                label: 'Списание с баланса',
                subject: String(opId3),
                amount: formatAmount(vars.amount),
                comment: vars.comment || vars.description || '',
                extra: opId3 ? 'ОП #' + opId3 : ''
            });
        }

        // Перехватываем мутации по имени операции (для операций без известного имени поля)
        detectByOperationName(query, vars, d);
    }

    function detectByOperationName(query, vars, d) {
        var q = query.toLowerCase();

        // Если в мутации есть ключевые слова — логируем как "Неизвестная операция"
        var knownHandled = [
            'walletdepositwithcash', 'walletdepositwithbonus',
            'userreservationcreate', 'userreservationfinish',
            'userreservationprolongate', 'userreservationupdate',
            'userreservationtransfer', 'userreservationwait',
            'addfree', 'freetime', 'walletdebit', 'walletwithdraw'
        ];
        for (var i = 0; i < knownHandled.length; i++) {
            if (q.indexOf(knownHandled[i]) !== -1) return;
        }

        // Ловим остальные мутации (не query)
        if (q.indexOf('mutation') !== -1) {
            // Пытаемся извлечь имя мутации
            var match = query.match(/mutation\s+(\w+)/i);
            var opName = match ? match[1] : 'Операция';
            var sessId = vars.sessionId || vars.reservationId || '';
            addEntry({
                type: 'unknown_mutation',
                icon: '🔧',
                label: opName,
                subject: String(sessId || JSON.stringify(vars).slice(0, 40)),
                amount: vars.amount ? formatAmount(vars.amount) : '',
                comment: vars.comment || vars.description || '',
                extra: sessId ? 'Сеанс #' + sessId : ''
            });
        }
    }

    function formatAmount(amount) {
        if (amount === undefined || amount === null) return '';
        var n = parseFloat(amount);
        if (isNaN(n)) return '';
        return (n >= 0 ? '+' : '') + n.toFixed(0) + ' ₸';
    }

    // ─────────────────────────────────────────────
    // Форматирование времени
    // ─────────────────────────────────────────────
    function formatDate(ts) {
        var d = new Date(ts);
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var hh = String(d.getHours()).padStart(2, '0');
        var min = String(d.getMinutes()).padStart(2, '0');
        return dd + '.' + mm + ' ' + hh + ':' + min;
    }

    // ─────────────────────────────────────────────
    // Типы операций и их цвета
    // ─────────────────────────────────────────────
    var TYPE_COLORS = {
        'deposit_cash':       { bg: '#e6f9ee', text: '#1a9944' },
        'deposit_bonus':      { bg: '#fff4e0', text: '#c87800' },
        'session_start':      { bg: '#e0f0ff', text: '#0066cc' },
        'session_finish':     { bg: '#fde8e8', text: '#cc2200' },
        'session_prolong':    { bg: '#e8f0ff', text: '#3355cc' },
        'session_update':     { bg: '#f5f0ff', text: '#6633cc' },
        'session_transfer':   { bg: '#fff0e0', text: '#cc6600' },
        'session_wait':       { bg: '#f0f0f0', text: '#666666' },
        'session_self_prolong': { bg: '#e0f8f0', text: '#007755' },
        'free_time':          { bg: '#e8f8ff', text: '#007799' },
        'debit':              { bg: '#ffe8e8', text: '#cc0000' },
        'unknown_mutation':   { bg: '#f5f5f5', text: '#555555' }
    };

    // ─────────────────────────────────────────────
    // Модальное окно
    // ─────────────────────────────────────────────
    var modal = null;
    var modalVisible = false;
    var filterType = '';
    var filterText = '';

    function createModal() {
        modal = document.createElement('div');
        modal.id = 'godji-opjournal-modal';
        modal.style.cssText = [
            'position:fixed', 'top:50%', 'left:50%',
            'transform:translate(-50%,-50%)', 'z-index:99998',
            'width:820px', 'max-width:96vw', 'max-height:82vh',
            'background:#ffffff', 'border-radius:14px',
            'box-shadow:0 8px 40px rgba(0,0,0,0.22)',
            'display:none', 'flex-direction:column',
            'font-family:inherit', 'overflow:hidden'
        ].join(';');

        // Header
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';

        var titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

        var titleIcon = document.createElement('div');
        titleIcon.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;';
        titleIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';

        var titleText = document.createElement('span');
        titleText.style.cssText = 'font-size:16px;font-weight:700;color:#1a1a1a;';
        titleText.textContent = 'История операций (7 дней)';

        titleWrap.appendChild(titleIcon);
        titleWrap.appendChild(titleText);

        var headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex;align-items:center;gap:8px;';

        // Кнопка очистки
        var clearBtn = document.createElement('button');
        clearBtn.style.cssText = 'background:#fff0f0;border:none;color:#cc2200;font-size:12px;cursor:pointer;padding:4px 10px;border-radius:6px;font-family:inherit;font-weight:600;';
        clearBtn.textContent = 'Очистить';
        clearBtn.addEventListener('click', function () {
            if (confirm('Очистить всю историю операций?')) {
                localStorage.removeItem(STORAGE_KEY);
                updateModal();
            }
        });

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:0;line-height:1;margin-left:4px;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', hideModal);

        headerRight.appendChild(clearBtn);
        headerRight.appendChild(closeBtn);
        header.appendChild(titleWrap);
        header.appendChild(headerRight);

        // Панель фильтров
        var filterBar = document.createElement('div');
        filterBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;flex-wrap:wrap;';

        var filterLabel = document.createElement('span');
        filterLabel.style.cssText = 'font-size:12px;color:#888;font-weight:600;';
        filterLabel.textContent = 'Фильтр:';

        // Тип операции
        var typeSelect = document.createElement('select');
        typeSelect.style.cssText = 'background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:inherit;outline:none;';
        var typeOptions = [
            ['', 'Все операции'],
            ['deposit_cash', '💵 Пополнение наличными'],
            ['deposit_bonus', '🎁 Начисление бонусов'],
            ['session_start', '▶️ Запуск сеанса'],
            ['session_finish', '⏹️ Завершение сеанса'],
            ['session_prolong', '⏩ Продление сеанса'],
            ['session_update', '✏️ Изменение вручную'],
            ['session_transfer', '🔀 Пересадка'],
            ['session_wait', '⏸️ Ожидание'],
            ['session_self_prolong', '👤 Продление клиентом'],
            ['free_time', '⌛ Бесплатное время'],
            ['debit', '➖ Списание'],
            ['unknown_mutation', '🔧 Прочее']
        ];
        typeOptions.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = o[0];
            opt.textContent = o[1];
            typeSelect.appendChild(opt);
        });
        typeSelect.addEventListener('change', function () { filterType = this.value; updateModal(); });

        // Текстовый поиск
        var searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Поиск по комментарию / ID...';
        searchInput.style.cssText = 'background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;outline:none;width:200px;';
        searchInput.addEventListener('input', function () { filterText = this.value.toLowerCase(); updateModal(); });

        filterBar.appendChild(filterLabel);
        filterBar.appendChild(typeSelect);
        filterBar.appendChild(searchInput);

        // Таблица
        var tableWrap = document.createElement('div');
        tableWrap.id = 'godji-opjournal-table-wrap';
        tableWrap.style.cssText = 'overflow-y:auto;flex:1;';

        modal.appendChild(header);
        modal.appendChild(filterBar);
        modal.appendChild(tableWrap);
        document.body.appendChild(modal);

        // Overlay
        var overlay = document.createElement('div');
        overlay.id = 'godji-opjournal-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;display:none;background:rgba(0,0,0,0.45);';
        overlay.addEventListener('click', hideModal);
        document.body.appendChild(overlay);
    }

    function updateModal() {
        if (!modal) return;
        var wrap = document.getElementById('godji-opjournal-table-wrap');
        if (!wrap) return;

        var journal = loadJournal();

        // Применяем фильтры
        if (filterType) journal = journal.filter(function (r) { return r.type === filterType; });
        if (filterText) journal = journal.filter(function (r) {
            var haystack = [r.label, r.comment, r.extra, r.subject, r.amount].join(' ').toLowerCase();
            return haystack.indexOf(filterText) !== -1;
        });

        if (journal.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:#aaa;padding:50px;font-size:14px;">Нет операций за последние 7 дней</div>';
            return;
        }

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

        // Thead
        var thead = document.createElement('thead');
        thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
        var hrow = document.createElement('tr');
        var cols = ['Дата и время', 'Тип операции', 'ID / Сеанс', 'Сумма / Время', 'Комментарий'];
        var colWidths = ['130px', '220px', '110px', '100px', 'auto'];
        cols.forEach(function (c, i) {
            var th = document.createElement('th');
            th.style.cssText = 'padding:10px 14px;text-align:left;color:#888;font-weight:600;font-size:12px;border-bottom:2px solid #efefef;white-space:nowrap;width:' + colWidths[i] + ';';
            th.textContent = c;
            hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        // Tbody
        var tbody = document.createElement('tbody');
        journal.forEach(function (rec) {
            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
            tr.addEventListener('mouseenter', function () { tr.style.background = '#f7f9ff'; });
            tr.addEventListener('mouseleave', function () { tr.style.background = ''; });

            // Дата
            var tdDate = document.createElement('td');
            tdDate.style.cssText = 'padding:10px 14px;color:#888;white-space:nowrap;font-size:12px;';
            tdDate.textContent = formatDate(rec.ts);

            // Тип
            var tdType = document.createElement('td');
            tdType.style.cssText = 'padding:10px 14px;';
            var colors = TYPE_COLORS[rec.type] || { bg: '#f5f5f5', text: '#555' };
            var badge = document.createElement('span');
            badge.style.cssText = 'background:' + colors.bg + ';color:' + colors.text + ';border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;';
            badge.textContent = (rec.icon || '') + ' ' + (rec.label || rec.type);
            tdType.appendChild(badge);

            // ID / Сеанс
            var tdExtra = document.createElement('td');
            tdExtra.style.cssText = 'padding:10px 14px;color:#555;font-size:12px;white-space:nowrap;';
            tdExtra.textContent = rec.extra || '—';

            // Сумма / Время
            var tdAmount = document.createElement('td');
            tdAmount.style.cssText = 'padding:10px 14px;white-space:nowrap;font-weight:600;';
            if (rec.amount) {
                var positive = rec.amount.indexOf('+') === 0;
                var negative = rec.amount.indexOf('-') === 0;
                tdAmount.style.color = positive ? '#1a9944' : negative ? '#cc2200' : '#555';
                tdAmount.textContent = rec.amount;
            } else {
                tdAmount.style.color = '#bbb';
                tdAmount.textContent = '—';
            }

            // Комментарий
            var tdComment = document.createElement('td');
            tdComment.style.cssText = 'padding:10px 14px;color:#555;font-size:12px;max-width:220px;word-break:break-word;';
            tdComment.textContent = rec.comment || '—';
            if (!rec.comment) tdComment.style.color = '#ccc';

            tr.appendChild(tdDate);
            tr.appendChild(tdType);
            tr.appendChild(tdExtra);
            tr.appendChild(tdAmount);
            tr.appendChild(tdComment);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrap.innerHTML = '';
        wrap.appendChild(table);
    }

    function showModal() {
        if (!modal) createModal();
        updateModal();
        modal.style.display = 'flex';
        document.getElementById('godji-opjournal-overlay').style.display = 'block';
        modalVisible = true;
        var btn = document.getElementById('godji-opjournal-btn');
        if (btn) btn.setAttribute('data-active', '');
    }

    function hideModal() {
        if (!modal) return;
        modal.style.display = 'none';
        document.getElementById('godji-opjournal-overlay').style.display = 'none';
        modalVisible = false;
        var btn = document.getElementById('godji-opjournal-btn');
        if (btn) btn.removeAttribute('data-active');
    }

    function updateModalIfVisible() {
        if (modalVisible) updateModal();
    }

    // ─────────────────────────────────────────────
    // Кнопка в сайдбаре
    // ─────────────────────────────────────────────
    function createSidebarButton() {
        if (document.getElementById('godji-opjournal-btn')) return;

        var wrap = document.createElement('a');
        wrap.id = 'godji-opjournal-btn';
        wrap.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        wrap.href = 'javascript:void(0)';
        wrap.style.cssText = [
            'position:fixed',
            'top:428px',  // На 48px ниже кнопки "История сеансов" (которая на 380px)
            'left:0',
            'z-index:150',
            'display:flex',
            'align-items:center',
            'gap:12px',
            'width:280px',
            'height:46px',
            'padding:8px 12px 8px 18px',
            'cursor:pointer',
            'user-select:none',
            'font-family:inherit',
            'box-sizing:border-box',
            'text-decoration:none'
        ].join(';');

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = [
            'width:32px',
            'height:32px',
            'border-radius:8px',
            'background:#1a1a2e',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'flex-shrink:0',
            'color:#ffffff'
        ].join(';');
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';

        var label = document.createElement('span');
        label.textContent = 'История операций';
        label.style.cssText = [
            'font-size:14px',
            'font-weight:600',
            'color:#ffffff',
            'white-space:nowrap',
            'letter-spacing:0.1px'
        ].join(';');

        // Счётчик новых операций
        var badge = document.createElement('span');
        badge.id = 'godji-opjournal-badge';
        badge.style.cssText = [
            'background:#cc0001',
            'color:#fff',
            'font-size:11px',
            'font-weight:700',
            'border-radius:10px',
            'padding:1px 6px',
            'margin-left:auto',
            'margin-right:8px',
            'display:none'
        ].join(';');

        wrap.appendChild(iconWrap);
        wrap.appendChild(label);
        wrap.appendChild(badge);
        document.body.appendChild(wrap);

        wrap.addEventListener('click', function (e) {
            e.preventDefault();
            if (modalVisible) hideModal(); else showModal();
        });

        // Обновляем счётчик каждые 10 секунд
        setInterval(updateBadge, 10000);
    }

    var _lastSeenCount = 0;

    function updateBadge() {
        var badge = document.getElementById('godji-opjournal-badge');
        if (!badge) return;
        var journal = loadJournal();
        var count = journal.length;
        if (count > _lastSeenCount && !modalVisible) {
            badge.textContent = '+' + (count - _lastSeenCount);
            badge.style.display = '';
        } else if (modalVisible) {
            _lastSeenCount = count;
            badge.style.display = 'none';
        }
    }

    // ─────────────────────────────────────────────
    // Запуск
    // ─────────────────────────────────────────────
    setTimeout(createSidebarButton, 800);

})();

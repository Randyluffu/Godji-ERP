// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Журнал всех операций смены с подсветкой подозрительных
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
'use strict';

var STORAGE_KEY  = 'godji_opjournal';
var SAFE_KEY     = 'godji_opjournal_safe';
var MAX_DAYS     = 7;

// ── Перехват через событие кассы (__gcb__) ───────────────
// godji_cashbox уже перехватывает fetch правильно и стреляет __gcb__
// Мы просто слушаем то же событие — не нужен дублирующий перехват

// ── localStorage ──────────────────────────────────────────
function loadJournal() {
    try {
        var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        var cutoff = Date.now() - MAX_DAYS * 86400000;
        return raw.filter(function(r) { return r.ts > cutoff; });
    } catch(e) { return []; }
}
function saveJournal(j) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(j)); } catch(e) {}
}
function loadSafeIds() {
    try { return JSON.parse(localStorage.getItem(SAFE_KEY) || '[]'); } catch(e) { return []; }
}
function saveSafeIds(ids) {
    try { localStorage.setItem(SAFE_KEY, JSON.stringify(ids)); } catch(e) {}
}
function markSafe(entryId) {
    var ids = loadSafeIds();
    if (ids.indexOf(entryId) === -1) { ids.push(entryId); saveSafeIds(ids); }
}

// ── Добавить запись ───────────────────────────────────────
var _entryCounter = Date.now();
function addEntry(entry) {
    var journal = loadJournal();
    entry.id = String(++_entryCounter);
    entry.ts = entry.ts || Date.now();
    // Дедуп: тот же тип + subject за последние 3 сек
    var now = Date.now();
    var dup = journal.some(function(r) {
        return r.type === entry.type && r.subject === entry.subject && now - r.ts < 3000;
    });
    if (dup) return;
    journal.unshift(entry);
    var cutoff = now - MAX_DAYS * 86400000;
    journal = journal.filter(function(r) { return r.ts > cutoff; });
    saveJournal(journal);
    updateModalIfVisible();
    updateBadge();
}

// ── Типы операций ─────────────────────────────────────────
var TYPES = {
    deposit_cash:         { icon: '💵', label: 'Пополнение наличными',        color: '#166534', bg: '#dcfce7' },
    deposit_card:         { icon: '💳', label: 'Пополнение картой',            color: '#1d4ed8', bg: '#dbeafe' },
    deposit_bonus:        { icon: '🎁', label: 'Начисление бонусов',           color: '#c87800', bg: '#fff4e0' },
    session_start:        { icon: '▶️',  label: 'Запуск сеанса',               color: '#0066cc', bg: '#e0f0ff' },
    session_start_client: { icon: '👤▶️',label: 'Запуск сеанса клиентом',      color: '#0066cc', bg: '#e0f0ff' },
    session_finish:       { icon: '⏹️',  label: 'Завершение сеанса',           color: '#cc2200', bg: '#fde8e8' },
    session_finish_client:{ icon: '👤⏹️',label: 'Завершение клиентом',         color: '#cc2200', bg: '#fde8e8' },
    session_prolong:      { icon: '⏩',  label: 'Продление сеанса',            color: '#3355cc', bg: '#e8f0ff' },
    session_prolong_client:{ icon:'👤⏩', label: 'Продление клиентом',          color: '#3355cc', bg: '#e8f0ff' },
    free_time:            { icon: '⌛',  label: 'Бесплатное время',            color: '#007799', bg: '#e8f8ff' },
    session_transfer:     { icon: '🔀',  label: 'Пересадка клиента',           color: '#cc6600', bg: '#fff0e0' },
    session_wait:         { icon: '⏸️',  label: 'Переход в ожидание',          color: '#666666', bg: '#f0f0f0' },
    debit_money:          { icon: '➖💵', label: 'Списание с баланса',          color: '#991b1b', bg: '#fee2e2' },
    debit_bonus:          { icon: '➖🎁', label: 'Списание бонусов',            color: '#7c3aed', bg: '#ede9fe' },
    suspicious:           { icon: '⚠️',  label: 'Подозрительная операция',     color: '#b45309', bg: '#fef3c7' },
};

// ── Детектор подозрительных ───────────────────────────────
var _recentOps = [];

function detectSuspicious(d, vars) {
    var amount = vars.amount;
    var walletId = vars.walletId;
    if (!amount || !walletId || amount <= 0) return;

    var isDeposit = !!(d.walletDepositWithCash || d.walletDepositWithBonus);
    if (!isDeposit) return;

    var now = Date.now();
    _recentOps = _recentOps.filter(function(o) { return now - o.ts < 10000; });

    var dups = _recentOps.filter(function(o) {
        return o.walletId === walletId && Math.abs(o.amount - amount) < 0.01;
    });

    if (dups.length >= 1) {
        addEntry({
            type: 'suspicious',
            subject: 'w' + walletId + '_' + Math.round(amount) + '_' + now,
            amount: formatAmt(amount),
            comment: 'Повторная операция: кошелёк #' + walletId + ', сумма ' + formatAmt(amount) + ' (×' + (dups.length + 1) + ')',
            extra: '',
            suspicious: true
        });
        showSuspiciousToast();
    }

    _recentOps.push({ ts: now, walletId: walletId, amount: amount });
}

function showSuspiciousToast() {
    if (document.getElementById('goj-sus-toast')) return;
    var toast = document.createElement('div');
    toast.id = 'goj-sus-toast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#b45309;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:999999;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:inherit;max-width:300px;line-height:1.4;';
    toast.innerHTML = '⚠️ Подозрительная операция!<br><span style="font-weight:400;font-size:12px;">Нажмите для проверки в «История операций»</span>';
    toast.addEventListener('click', function() {
        toast.remove();
        _filterType = 'suspicious';
        showModal();
    });
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 8000);
}

// ── Обработка API ─────────────────────────────────────────
document.addEventListener('__gcb__', function(e) {
    try {
        var detail = e.detail;
        var body = {};
        try { body = JSON.parse(detail.req); } catch(ex) { return; }
        var d = detail.res && detail.res.data;
        if (!d) return;
        var op = body.operationName || '';
        var vars = body.variables || {};

        // Пополнение наличными / картой / списание старым методом
        if (d.walletDepositWithCash) {
            var opId = (d.walletDepositWithCash.operationId || '');
            if (vars.amount < 0) {
                addEntry({ type: 'debit_money', subject: String(opId),
                    amount: formatAmt(vars.amount), comment: vars.comment || vars.description || '',
                    extra: opId ? 'ОП #' + opId : '' });
            } else {
                var isCash = vars.isCash !== false;
                addEntry({ type: isCash ? 'deposit_cash' : 'deposit_card', subject: String(opId),
                    amount: formatAmt(vars.amount), comment: vars.comment || vars.description || '',
                    extra: opId ? 'ОП #' + opId : '' });
                detectSuspicious(d, vars);
            }
        }

        // Начисление бонусов — различаем бесплатное время по комментарию
        if (d.walletDepositWithBonus) {
            var opId2 = d.walletDepositWithBonus.operationId || d.walletDepositWithBonus.id || '';
            var cmt2  = vars.comment || vars.description || '';
            var isFree = cmt2.toLowerCase().indexOf('бесплатн') !== -1 ||
                         cmt2.toLowerCase().indexOf('free') !== -1 ||
                         op.toLowerCase().indexOf('free') !== -1;
            addEntry({ type: isFree ? 'free_time' : 'deposit_bonus', subject: String(opId2),
                amount: formatAmt(vars.amount), comment: cmt2,
                extra: opId2 ? 'ОП #' + opId2 : '' });
            if (!isFree) detectSuspicious(d, vars);
        }

        // Списание бонусов
        if (d.walletWithdrawWithBonus) {
            var opId3 = d.walletWithdrawWithBonus.operationId || '';
            addEntry({ type: 'debit_bonus', subject: String(opId3),
                amount: formatAmt(-Math.abs(vars.amount || 0)),
                comment: vars.comment || vars.description || '',
                extra: opId3 ? 'ОП #' + opId3 : '' });
        }

        // Запуск сеанса
        if (d.userReservationCreate) {
            var sessId = (d.userReservationCreate.id || '');
            var isClientStart = op.toLowerCase().indexOf('client') !== -1;
            addEntry({ type: isClientStart ? 'session_start_client' : 'session_start',
                subject: String(sessId), amount: '', comment: vars.comment || '',
                extra: sessId ? 'Сеанс #' + sessId : '' });
        }

        // Завершение сеанса
        if (d.userReservationFinish) {
            var sessId2 = String(vars.sessionId || '');
            var isClientFinish = op.toLowerCase().indexOf('client') !== -1;
            addEntry({ type: isClientFinish ? 'session_finish_client' : 'session_finish',
                subject: sessId2, amount: '', comment: vars.comment || '',
                extra: sessId2 ? 'Сеанс #' + sessId2 : '' });
        }

        // Продление сеанса
        if (d.userReservationProlongate) {
            var sessId3 = String(vars.sessionId || '');
            var mins = vars.minutes ? vars.minutes + ' мин' : '';
            var isClientProlong = op.toLowerCase().indexOf('client') !== -1;
            addEntry({ type: isClientProlong ? 'session_prolong_client' : 'session_prolong',
                subject: sessId3, amount: mins, comment: vars.comment || '',
                extra: sessId3 ? 'Сеанс #' + sessId3 : '' });
        }

        // Пересадка
        if (d.userReservationTransfer || d.moveDevice) {
            var sessId4 = String(vars.sessionId || vars.reservationId || '');
            var fromTo = '';
            if (vars.fromDevice || vars.toDevice) fromTo = (vars.fromDevice||'?') + ' → ' + (vars.toDevice||'?');
            if (vars.fromDeviceName || vars.toDeviceName) fromTo = (vars.fromDeviceName||'?') + ' → ' + (vars.toDeviceName||'?');
            addEntry({ type: 'session_transfer', subject: sessId4,
                amount: fromTo, comment: vars.comment || '',
                extra: sessId4 ? 'Сеанс #' + sessId4 : '' });
        }

        // Ожидание
        if (d.userReservationWait || d.pauseReservation) {
            var sessId5 = String(vars.sessionId || '');
            addEntry({ type: 'session_wait', subject: sessId5,
                amount: '', comment: vars.comment || '',
                extra: sessId5 ? 'Сеанс #' + sessId5 : '' });
        }

    } catch(err) {}
});

// Слушаем списания от godji_wallet_debit
document.addEventListener('__godji_debit__', function(ev) {
    var dd = ev.detail;
    if (!dd) return;
    addEntry({ type: 'debit_money', subject: String(dd.ts),
        amount: formatAmt(-Math.abs(dd.amount)),
        comment: dd.comment || '', extra: '' });
});

// ── Форматирование ────────────────────────────────────────
function formatAmt(n) {
    if (n === undefined || n === null || n === '') return '';
    var v = parseFloat(n);
    if (isNaN(v)) return '';
    return (v >= 0 ? '+' : '') + Math.round(v) + ' ₽';
}
function fmtDate(ts) {
    var d = new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── Модальное окно ────────────────────────────────────────
var _modal = null, _overlay = null, _visible = false;
var _filterType = '', _filterText = '';

function buildModal() {
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click', hideModal);
    document.body.appendChild(_overlay);
    _modal = document.createElement('div');
    _modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:880px;max-width:96vw;max-height:85vh;background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && _visible) hideModal(); });
}

function renderModal() {
    if (!_modal) return;
    _modal.innerHTML = '';

    var journal = loadJournal();
    var safeIds = loadSafeIds();
    var suspCount = journal.filter(function(r) { return r.suspicious && safeIds.indexOf(r.id) === -1; }).length;

    // ── Шапка ──
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var hLeft = document.createElement('div');
    hLeft.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    var hIco = document.createElement('div');
    hIco.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    hIco.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    var hTitle = document.createElement('span');
    hTitle.style.cssText = 'font-size:15px;font-weight:700;color:#1a1a1a;';
    hTitle.textContent = 'История операций (7 дней)';
    hLeft.appendChild(hIco); hLeft.appendChild(hTitle);
    if (suspCount > 0) {
        var sBadge = document.createElement('span');
        sBadge.style.cssText = 'background:#b45309;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;cursor:pointer;';
        sBadge.textContent = '⚠️ ' + suspCount + ' подозрительных';
        sBadge.addEventListener('click', function() { _filterType = 'suspicious'; renderModal(); });
        hLeft.appendChild(sBadge);
    }
    var hRight = document.createElement('div');
    hRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var clearBtn = document.createElement('button');
    clearBtn.style.cssText = 'background:#fff0f0;border:none;color:#cc2200;font-size:12px;cursor:pointer;padding:4px 10px;border-radius:6px;font-family:inherit;font-weight:600;';
    clearBtn.textContent = 'Очистить';
    clearBtn.addEventListener('click', function() {
        if (!confirm('Очистить всю историю операций?')) return;
        localStorage.removeItem(STORAGE_KEY);
        renderModal(); updateBadge();
    });
    var xBtn = document.createElement('button');
    xBtn.style.cssText = 'background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:0;line-height:1;';
    xBtn.textContent = '×';
    xBtn.addEventListener('click', hideModal);
    hRight.appendChild(clearBtn); hRight.appendChild(xBtn);
    hdr.appendChild(hLeft); hdr.appendChild(hRight);
    _modal.appendChild(hdr);

    // ── Фильтры ──
    var fBar = document.createElement('div');
    fBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;flex-wrap:wrap;';
    var typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;';
    var typeOpts = [['', 'Все операции'], ['suspicious', '⚠️ Подозрительные']].concat(
        Object.keys(TYPES).map(function(k) { return [k, TYPES[k].icon + ' ' + TYPES[k].label]; })
    );
    typeOpts.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        if (o[0] === _filterType) opt.selected = true;
        typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', function() { _filterType = this.value; renderModal(); });
    var searchInp = document.createElement('input');
    searchInp.type = 'text'; searchInp.placeholder = 'Поиск…'; searchInp.value = _filterText;
    searchInp.style.cssText = 'background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;outline:none;width:190px;';
    searchInp.addEventListener('input', function() { _filterText = this.value.toLowerCase(); renderModal(); });
    fBar.appendChild(typeSelect); fBar.appendChild(searchInp);
    _modal.appendChild(fBar);

    // ── Таблица ──
    var body = document.createElement('div');
    body.style.cssText = 'overflow-y:auto;flex:1;';
    _modal.appendChild(body);

    var filtered = journal.slice();
    if (_filterType === 'suspicious') {
        filtered = filtered.filter(function(r) { return r.suspicious && safeIds.indexOf(r.id) === -1; });
    } else if (_filterType) {
        filtered = filtered.filter(function(r) { return r.type === _filterType; });
    }
    if (_filterText) {
        filtered = filtered.filter(function(r) {
            return [r.comment||'', r.extra||'', r.amount||'', r.subject||''].join(' ').toLowerCase().indexOf(_filterText) !== -1;
        });
    }

    if (!filtered.length) {
        body.innerHTML = '<div style="text-align:center;color:#aaa;padding:50px;font-size:14px;">Нет операций</div>';
        return;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
    var thead = document.createElement('thead');
    thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr = document.createElement('tr');
    [['Время','110px'],['Тип','220px'],['ID / Сеанс','110px'],['Сумма','90px'],['Комментарий','auto']].forEach(function(c) {
        var th = document.createElement('th');
        th.style.cssText = 'padding:9px 14px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #efefef;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent = c[0]; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);

    var tbody = document.createElement('tbody');
    filtered.forEach(function(rec) {
        var isSafe = safeIds.indexOf(rec.id) !== -1;
        var isSusp = rec.suspicious && !isSafe;
        var ti = TYPES[rec.type] || { icon:'•', label: rec.type, color:'#555', bg:'#f5f5f5' };

        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid #f5f5f5;transition:background 0.1s;' + (isSusp ? 'background:#fffbeb;' : '');
        tr.addEventListener('mouseenter', function() { tr.style.background = isSusp ? '#fef3c7' : '#f7f9ff'; });
        tr.addEventListener('mouseleave', function() { tr.style.background = isSusp ? '#fffbeb' : ''; });

        var tdDate = document.createElement('td');
        tdDate.style.cssText = 'padding:9px 14px;color:#888;white-space:nowrap;font-size:12px;';
        tdDate.textContent = fmtDate(rec.ts);

        var tdType = document.createElement('td');
        tdType.style.cssText = 'padding:9px 14px;';
        var badge = document.createElement('span');
        badge.style.cssText = 'background:'+ti.bg+';color:'+ti.color+';border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;';
        badge.textContent = ti.icon + ' ' + ti.label;
        tdType.appendChild(badge);

        var tdExtra = document.createElement('td');
        tdExtra.style.cssText = 'padding:9px 14px;color:#555;font-size:12px;white-space:nowrap;';
        tdExtra.textContent = rec.extra || '—';

        var tdAmt = document.createElement('td');
        tdAmt.style.cssText = 'padding:9px 14px;white-space:nowrap;font-weight:600;';
        if (rec.amount) {
            tdAmt.style.color = rec.amount.charAt(0)==='+' ? '#166534' : rec.amount.charAt(0)==='-' ? '#991b1b' : '#555';
            tdAmt.textContent = rec.amount;
        } else { tdAmt.style.color='#bbb'; tdAmt.textContent='—'; }

        var tdCmt = document.createElement('td');
        tdCmt.style.cssText = 'padding:9px 14px;font-size:12px;max-width:200px;word-break:break-word;';
        var cmtSpan = document.createElement('span');
        cmtSpan.style.color = rec.comment ? '#555' : '#ccc';
        cmtSpan.textContent = rec.comment || '—';
        tdCmt.appendChild(cmtSpan);

        if (isSusp) {
            var safeBtn = document.createElement('button');
            safeBtn.style.cssText = 'margin-left:8px;background:#dcfce7;border:none;color:#166534;font-size:11px;cursor:pointer;padding:2px 7px;border-radius:4px;font-family:inherit;font-weight:600;';
            safeBtn.textContent = '✓ Безопасно';
            safeBtn.addEventListener('click', function(ev) {
                ev.stopPropagation(); markSafe(rec.id); renderModal(); updateBadge();
            });
            tdCmt.appendChild(safeBtn);
        } else if (isSafe && rec.suspicious) {
            var safeTag = document.createElement('span');
            safeTag.style.cssText = 'margin-left:8px;color:#166534;font-size:11px;font-weight:600;';
            safeTag.textContent = '✓ Безопасно';
            tdCmt.appendChild(safeTag);
        }

        tr.appendChild(tdDate); tr.appendChild(tdType); tr.appendChild(tdExtra);
        tr.appendChild(tdAmt); tr.appendChild(tdCmt);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody); body.appendChild(table);
}

function showModal() {
    if (!_modal) buildModal();
    renderModal();
    _modal.style.display = 'flex';
    _overlay.style.display = 'block';
    _visible = true;
    _lastSeenCount = loadJournal().length;
    updateBadge();
}
function hideModal() {
    if (!_modal) return;
    _modal.style.display = 'none';
    _overlay.style.display = 'none';
    _visible = false;
}
function updateModalIfVisible() { if (_visible) renderModal(); }

// ── Бейдж ─────────────────────────────────────────────────
var _lastSeenCount = 0;
function updateBadge() {
    var badge = document.getElementById('goj-sidebar-badge');
    if (!badge) return;
    var journal = loadJournal();
    var safeIds = loadSafeIds();
    var suspCount = journal.filter(function(r) { return r.suspicious && safeIds.indexOf(r.id) === -1; }).length;
    var newCount = journal.length - _lastSeenCount;
    if (suspCount > 0) {
        badge.textContent = '⚠️ ' + suspCount;
        badge.style.background = '#b45309';
        badge.style.display = '';
    } else if (newCount > 0 && !_visible) {
        badge.textContent = '+' + newCount;
        badge.style.background = '#cc0001';
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ── Предупреждение при закрытии смены ────────────────────
function watchCashboxCloseBtn() {
    new MutationObserver(function() {
        document.querySelectorAll('#godji-cashbox-modal button').forEach(function(b) {
            if (b._gojWatched || b.textContent.trim() !== 'Закрыть смену') return;
            b._gojWatched = true;
            b.addEventListener('click', function(e) {
                var journal = loadJournal();
                var safeIds = loadSafeIds();
                var suspCount = journal.filter(function(r) { return r.suspicious && safeIds.indexOf(r.id) === -1; }).length;
                if (!suspCount) return;
                e.stopImmediatePropagation();
                var go = confirm(
                    '\u26a0\ufe0f Перед закрытием смены: ' + suspCount + ' подозрительных операций!\n\n' +
                    'OK — проверить в «История операций»\n' +
                    'Отмена — закрыть смену без проверки'
                );
                if (go) {
                    showModal(); _filterType = 'suspicious'; renderModal();
                } else {
                    b._gojWatched = false; b.click(); b._gojWatched = true;
                }
            }, true);
        });
    }).observe(document.body, { childList: true, subtree: true });
}

// ── Кнопка в сайдбаре ────────────────────────────────────
function createSidebarBtn() {
    if (document.getElementById('godji-opj-btn')) return;
    var sb = document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb) return;

    var btn = document.createElement('a');
    btn.id = 'godji-opj-btn';
    btn.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href = 'javascript:void(0)';
    btn.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 16px 8px 12px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    var ico = document.createElement('div');
    ico.className = 'LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant', 'filled');
    ico.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

    var bodyDiv = document.createElement('div');
    bodyDiv.className = 'm_f07af9d2 mantine-NavLink-body';
    var lbl = document.createElement('span');
    lbl.className = 'm_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText = 'font-size:14px;font-weight:600;color:var(--mantine-color-white,#fff);white-space:nowrap;';
    lbl.textContent = 'История операций';

    var badge = document.createElement('span');
    badge.id = 'goj-sidebar-badge';
    badge.style.cssText = 'margin-left:auto;background:#cc0001;color:#fff;font-size:11px;font-weight:700;border-radius:10px;padding:1px 6px;display:none;';

    bodyDiv.appendChild(lbl);
    btn.appendChild(ico); btn.appendChild(bodyDiv); btn.appendChild(badge);
    btn.addEventListener('mouseenter', function() { btn.style.background='rgba(255,255,255,0.05)'; });
    btn.addEventListener('mouseleave', function() { btn.style.background=''; });
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (_visible) hideModal(); else showModal();
    });

    // Вставляем в linksInner после последнего нативного NavLink
    // (история сеансов встанет перед нами — она ищет #godji-opj-btn)
    var nativeLinks = Array.from(sb.querySelectorAll('a.mantine-NavLink-root:not([id^="godji"])'));
    var last = nativeLinks[nativeLinks.length - 1];
    if(last && last.nextSibling) sb.insertBefore(btn, last.nextSibling);
    else sb.appendChild(btn);
    updateBadge();
}

function tryCreateSidebarBtn() {
    if (document.getElementById('godji-opj-btn')) return;
    var sb = document.querySelector('.Sidebar_linksInner__oTy_4');
    if (!sb) {
        setTimeout(tryCreateSidebarBtn, 500);
        return;
    }
    createSidebarBtn();
}

// ── Init ──────────────────────────────────────────────────
var _obs = new MutationObserver(function() {
    if (!document.getElementById('godji-opj-btn')) tryCreateSidebarBtn();
});

if (document.body) {
    _obs.observe(document.body, { childList: true, subtree: false });
    setTimeout(tryCreateSidebarBtn, 1200);
    setTimeout(watchCashboxCloseBtn, 2000);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        _obs.observe(document.body, { childList: true, subtree: false });
        setTimeout(tryCreateSidebarBtn, 1200);
        setTimeout(watchCashboxCloseBtn, 2000);
    });
}

setInterval(updateBadge, 10000);

})();

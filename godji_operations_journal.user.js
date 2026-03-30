// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      2.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_operations_journal.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_operations_journal.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_operations_journal';
var MAX_HOURS   = 168; // 7 дней

// ──────────────────────────────────────────────
// Перехват fetch — токен + разбор ответов
// ──────────────────────────────────────────────
var _origFetch = window.fetch;
window.fetch = function(url, options){
    if(options && options.headers){
        if(options.headers.authorization){
            window._godjiAuthToken = options.headers.authorization;
        }
        if(options.headers['x-hasura-role']){
            window._godjiHasuraRole = options.headers['x-hasura-role'];
        }
    }
    var promise = _origFetch.apply(this, arguments);
    if(url && typeof url === 'string' && url.indexOf('hasura.godji.cloud') !== -1){
        var reqBody = '';
        try{ reqBody = (options && options.body) ? options.body : ''; }catch(e){}
        promise = promise.then(function(response){
            var clone = response.clone();
            clone.json().then(function(data){
                try{ processResponse(reqBody, data); }catch(e){}
            }).catch(function(){});
            return response;
        });
    }
    return promise;
};

// ──────────────────────────────────────────────
// localStorage
// ──────────────────────────────────────────────
function loadJournal(){
    try{
        var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        var cutoff = Date.now() - MAX_HOURS * 3600000;
        return raw.filter(function(r){ return r.ts > cutoff; });
    }catch(e){ return []; }
}
function saveJournal(data){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){}
}
function addEntry(entry){
    var journal = loadJournal();
    var now = Date.now();
    // Защита от дублей за 5 сек
    var isDup = journal.some(function(r){
        return r.type === entry.type && r.subject === entry.subject && now - r.ts < 5000;
    });
    if(isDup) return;
    entry.ts = now;
    journal.unshift(entry);
    saveJournal(journal.filter(function(r){ return r.ts > now - MAX_HOURS * 3600000; }));
    updateModalIfOpen();
}

// ──────────────────────────────────────────────
// Кэш сессий — для обогащения записей ником/ПК
// ──────────────────────────────────────────────
var _sessCache = {}; // sessionId -> {nick, pc, walletId}

function enrichFromSessions(data){
    // getDashboardDevices — главный источник данных сессий
    var dd = data && data.getDashboardDevices && data.getDashboardDevices.devices;
    if(!dd) return;
    dd.forEach(function(dev){
        if(!dev.sessions) return;
        dev.sessions.forEach(function(s){
            _sessCache[String(s.id)] = {
                nick: (s.user && (s.user.nickname || s.user.login)) || '',
                pc:   dev.name || '',
                walletId: (s.user && s.user.wallet && s.user.wallet.id) || null,
            };
        });
    });
}

function getSessionInfo(sessId){
    return _sessCache[String(sessId)] || {nick:'', pc:'', walletId:null};
}

// ──────────────────────────────────────────────
// Разбор GraphQL ответов
// ──────────────────────────────────────────────
function processResponse(reqBody, data){
    if(!data) return;

    // Обогащаем кэш сессий
    if(data.data) enrichFromSessions(data.data);

    if(!data.data) return;
    var d = data.data;
    var body = {};
    try{ body = JSON.parse(reqBody); }catch(e){ return; }
    var query = body.query || '';
    var op    = body.operationName || '';
    var vars  = body.variables || {};

    // ── Пополнение наличными ────────────────────
    if(d.walletDepositWithCash){
        var opId = d.walletDepositWithCash.operationId || '';
        var amt  = vars.amount;
        // Отрицательная сумма = списание
        if(amt < 0){
            addEntry({type:'debit', label:'Списание с баланса',
                subject: String(opId),
                amount: fmtAmt(amt), comment: fmtComment(vars), extra: opId ? 'ОП #'+opId : ''});
        } else {
            addEntry({type:'deposit_cash', label:'Пополнение наличными',
                subject: String(opId),
                amount: fmtAmt(amt), comment: fmtComment(vars), extra: opId ? 'ОП #'+opId : ''});
        }
    }

    // ── Пополнение / бонусы ─────────────────────
    if(d.walletDepositWithBonus){
        var opId2 = d.walletDepositWithBonus.operationId || d.walletDepositWithBonus.id || '';
        // Если это начисление в рамках бесплатного времени — не дублируем
        addEntry({type:'deposit_bonus', label:'Начисление бонусов',
            subject: String(opId2),
            amount: fmtAmt(vars.amount), comment: fmtComment(vars), extra: opId2 ? 'ОП #'+opId2 : ''});
    }

    // ── Запуск сеанса ───────────────────────────
    var resCreate = d.userReservationCreate || d.createReservation;
    if(resCreate){
        var sessId = (resCreate && resCreate.id) || '';
        var info = getSessionInfo(sessId);
        addEntry({type:'session_start', label:'Запуск сеанса',
            subject: String(sessId),
            amount: '', comment: fmtComment(vars),
            extra: sessId ? 'Сеанс #'+sessId : '',
            nick: info.nick, pc: info.pc});
    }

    // ── Завершение сеанса ───────────────────────
    var resFinish = d.userReservationFinish || d.finishReservation;
    if(resFinish){
        var sessId2 = (resFinish && resFinish.id) || vars.sessionId || '';
        var info2 = getSessionInfo(sessId2);
        addEntry({type:'session_finish', label:'Завершение сеанса',
            subject: String(sessId2),
            amount: '', comment: fmtComment(vars),
            extra: sessId2 ? 'Сеанс #'+sessId2 : '',
            nick: info2.nick, pc: info2.pc});
    }

    // ── Отмена сеанса ────────────────────────────
    var resCancel = d.userReservationCancel;
    if(resCancel && (resCancel.success !== undefined)){
        var sessId2b = vars.sessionId || '';
        var info2b = getSessionInfo(sessId2b);
        addEntry({type:'session_cancel', label:'Отмена сеанса',
            subject: String(sessId2b),
            amount: '', comment: fmtComment(vars),
            extra: sessId2b ? 'Сеанс #'+sessId2b : '',
            nick: info2b.nick, pc: info2b.pc});
    }

    // ── Продление сеанса ────────────────────────
    var resProlong = d.userReservationProlongate;
    if(resProlong){
        var sessId3 = vars.sessionId || '';
        var info3 = getSessionInfo(sessId3);
        var mins = vars.minutes ? vars.minutes+' мин' : '';
        // Если комментарий содержит "бесплатн" — это бесплатное время
        var isFree = (fmtComment(vars).toLowerCase().indexOf('бесплат') !== -1) ||
                     (fmtComment(vars).toLowerCase().indexOf('free') !== -1);
        if(isFree){
            addEntry({type:'free_time', label:'Бесплатное время',
                subject: String(sessId3),
                amount: mins, comment: fmtComment(vars),
                extra: sessId3 ? 'Сеанс #'+sessId3 : '',
                nick: info3.nick, pc: info3.pc});
        } else {
            addEntry({type:'session_prolong', label:'Продление сеанса',
                subject: String(sessId3),
                amount: mins, comment: fmtComment(vars),
                extra: sessId3 ? 'Сеанс #'+sessId3 : '',
                nick: info3.nick, pc: info3.pc});
        }
    }

    // ── Изменение сеанса вручную ────────────────
    var resUpdate = d.userReservationUpdate || d.updateReservation;
    if(resUpdate){
        var sessId4 = vars.sessionId || vars.id || '';
        var info4 = getSessionInfo(sessId4);
        addEntry({type:'session_update', label:'Изменение сеанса вручную',
            subject: String(sessId4),
            amount: '', comment: fmtComment(vars),
            extra: sessId4 ? 'Сеанс #'+sessId4 : '',
            nick: info4.nick, pc: info4.pc});
    }

    // ── Пересадка клиента ───────────────────────
    // Godji использует deviceRelocation или deviceTransfer
    var resTransfer = d.deviceRelocation || d.userReservationTransfer ||
                      d.transferReservation || d.moveDevice || d.relocateDevice;
    if(resTransfer){
        var sessId5 = vars.sessionId || vars.reservationId || '';
        var info5 = getSessionInfo(sessId5);
        // Пробуем получить имена ПК из vars
        var fromPc = vars.fromDeviceName || vars.fromDevice || vars.deviceFromName || '';
        var toPc   = vars.toDeviceName   || vars.toDevice   || vars.deviceToName   || '';
        if(!fromPc && !toPc && info5.pc) fromPc = info5.pc;
        var fromTo = (fromPc && toPc) ? fromPc+' → '+toPc : (fromPc || toPc || '');
        addEntry({type:'session_transfer', label:'Пересадка клиента',
            subject: String(sessId5 || Date.now()),
            amount: fromTo, comment: fmtComment(vars),
            extra: sessId5 ? 'Сеанс #'+sessId5 : '',
            nick: info5.nick, pc: info5.pc});
    }

    // ── Переход в ожидание ──────────────────────
    var resWait = d.userReservationWait || d.pauseReservation || d.reservationWaiting;
    if(resWait){
        var sessId6 = vars.sessionId || vars.reservationId || '';
        var info6 = getSessionInfo(sessId6);
        addEntry({type:'session_wait', label:'Переход в ожидание',
            subject: String(sessId6),
            amount: '', comment: fmtComment(vars),
            extra: sessId6 ? 'Сеанс #'+sessId6 : '',
            nick: info6.nick, pc: info6.pc});
    }

    // ── Самостоятельное продление клиентом ─────
    // ERP логирует это как userReservationProlongate с ролью user
    // Дополнительно проверяем operationName
    var isSelfProlong = (op === 'SelfProlongation' || op === 'ClientProlongate' ||
        query.indexOf('clientProlongate') !== -1 || query.indexOf('selfProlong') !== -1);
    if(isSelfProlong || d.clientProlongate || d.selfProlong || d.clientReservationProlongate){
        var sessId7 = vars.sessionId || '';
        var info7 = getSessionInfo(sessId7);
        addEntry({type:'session_self_prolong', label:'Продление клиентом',
            subject: String(sessId7),
            amount: vars.minutes ? vars.minutes+' мин' : '', comment: fmtComment(vars),
            extra: sessId7 ? 'Сеанс #'+sessId7 : '',
            nick: info7.nick, pc: info7.pc});
    }

    // ── Явное бесплатное время ──────────────────
    if(d.addFreeTime || d.freeTime || d.walletDepositFreeTime){
        var res6 = d.addFreeTime || d.freeTime || d.walletDepositFreeTime;
        var sessId8 = vars.sessionId || '';
        var info8 = getSessionInfo(sessId8);
        addEntry({type:'free_time', label:'Бесплатное время',
            subject: String(sessId8 || (res6 && res6.operationId) || ''),
            amount: vars.minutes ? vars.minutes+' мин' : '', comment: fmtComment(vars),
            extra: sessId8 ? 'Сеанс #'+sessId8 : '',
            nick: info8.nick, pc: info8.pc});
    }

    // ── Списание (явное) ────────────────────────
    if(d.walletDebit || d.walletWithdraw || d.debitWallet){
        var opId3 = (d.walletDebit || d.walletWithdraw || d.debitWallet || {}).operationId || '';
        addEntry({type:'debit', label:'Списание с баланса',
            subject: String(opId3),
            amount: fmtAmt(vars.amount), comment: fmtComment(vars),
            extra: opId3 ? 'ОП #'+opId3 : ''});
    }

    // ── Ловим всё остальное по operationName ────
    catchUnknown(query, op, vars, d);
}

function catchUnknown(query, op, vars, d){
    var known = [
        'walletdepositwithcash','walletdepositwithbonus',
        'userreservationcreate','createreservation',
        'userreservationfinish','finishreservation',
        'userreservationcancel',
        'userreservationprolongate',
        'userreservationupdate','updatereservation',
        'devicerelocation','userreservationtransfer','transferreservation','movedevice','relocatedevice',
        'userreservationwait','pausereservation',
        'clientprolongate','selfprolong',
        'addfree','freetime','walletdepositfreetime',
        'walletdebit','walletwithdraw','debitwallet',
        // Не-операционные
        'getdashboard','getavailable','query','getclub','getclient',
        'devicepoweron','devicepoweroff','deviceprotection','devicereboot',
    ];
    var q = (query + ' ' + op).toLowerCase();
    var isKnown = known.some(function(k){ return q.indexOf(k) !== -1; });
    if(isKnown) return;
    if(q.indexOf('mutation') === -1 && !op) return;

    // Это неизвестная мутация — логируем
    var opName = op || (query.match(/mutation\s+(\w+)/i) || ['','Операция'])[1];
    var sessId = vars.sessionId || vars.reservationId || '';
    var info = getSessionInfo(sessId);
    addEntry({type:'unknown_op', label: opName,
        subject: String(sessId || JSON.stringify(vars).slice(0,30)),
        amount: vars.amount ? fmtAmt(vars.amount) : '',
        comment: fmtComment(vars),
        extra: sessId ? 'Сеанс #'+sessId : '',
        nick: info.nick, pc: info.pc});
}

// Helpers
function fmtAmt(amount){
    if(amount === undefined || amount === null) return '';
    var n = parseFloat(amount);
    if(isNaN(n)) return '';
    return (n >= 0 ? '+' : '') + n.toFixed(0) + ' ₽';
}
function fmtComment(vars){
    return vars.comment || vars.description || vars.reason || '';
}
function fmtDate(ts){
    var d = new Date(ts);
    return String(d.getDate()).padStart(2,'0') + '.' +
           String(d.getMonth()+1).padStart(2,'0') + ' ' +
           String(d.getHours()).padStart(2,'0') + ':' +
           String(d.getMinutes()).padStart(2,'0');
}

// ──────────────────────────────────────────────
// Типы операций
// ──────────────────────────────────────────────
var TYPES = {
    'deposit_cash':       {color:'#1a9944', bg:'#e6f9ee', icon:'cash'},
    'deposit_bonus':      {color:'#c87800', bg:'#fff4e0', icon:'gift'},
    'session_start':      {color:'#0066cc', bg:'#e0f0ff', icon:'play'},
    'session_finish':     {color:'#cc2200', bg:'#fde8e8', icon:'stop'},
    'session_cancel':     {color:'#991100', bg:'#ffe0e0', icon:'x'},
    'session_prolong':    {color:'#3355cc', bg:'#e8f0ff', icon:'clock-plus'},
    'session_update':     {color:'#6633cc', bg:'#f5f0ff', icon:'edit'},
    'session_transfer':   {color:'#cc6600', bg:'#fff0e0', icon:'arrow-right'},
    'session_wait':       {color:'#666666', bg:'#f0f0f0', icon:'pause'},
    'session_self_prolong':{color:'#007755', bg:'#e0f8f0', icon:'user-clock'},
    'free_time':          {color:'#007799', bg:'#e8f8ff', icon:'hourglass'},
    'debit':              {color:'#cc0000', bg:'#ffe8e8', icon:'minus'},
    'unknown_op':         {color:'#555555', bg:'#f5f5f5', icon:'tool'},
};

// SVG иконки (tabler-style)
var ICONS = {
    'cash':       '<path d="M6 6h15M6 12h15M6 18h15"/><path d="M3 6l.01 0"/><path d="M3 12l.01 0"/><path d="M3 18l.01 0"/>',
    'gift':       '<path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8z"/><path d="M12 7v13"/><path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/><path d="M9 7c0-1.5 1-3 3-3s3 1.5 3 3"/><path d="M9 7c0-1.5-.5-3-3-3c0 1.5 1 3 3 3"/><path d="M15 7c0-1.5.5-3 3-3c0 1.5-1 3-3 3"/>',
    'play':       '<path d="M7 4v16l13-8z"/>',
    'stop':       '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    'x':          '<path d="M18 6L6 18M6 6l12 12"/>',
    'clock-plus': '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/><path d="M18 20v-6M15 17h6"/>',
    'edit':       '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'arrow-right':'<path d="M5 12h14M12 5l7 7-7 7"/>',
    'pause':      '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    'user-clock': '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4"/><circle cx="17" cy="17" r="4"/><path d="M17 14v3l2 1"/>',
    'hourglass':  '<path d="M6.5 6.5a8 8 0 0 1 11 0"/><path d="M6.5 17.5a8 8 0 0 0 11 0"/><path d="M5 3h14"/><path d="M5 21h14"/><path d="M5 3a7 7 0 0 0 14 0"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    'minus':      '<path d="M5 12h14"/>',
    'tool':       '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    // Иконка для кнопки сайдбара
    'journal':    '<path d="M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
};

function svgIcon(key, size, color){
    size = size || 16;
    color = color || 'currentColor';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[key]||ICONS['tool']) + '</svg>';
}

// ──────────────────────────────────────────────
// Модальное окно
// ──────────────────────────────────────────────
var _modal = null, _overlay = null, _isOpen = false;
var _filterType = '', _filterText = '';

function buildModal(){
    _modal = document.createElement('div');
    _modal.id = 'godji-opj-modal';
    _modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:860px;max-width:96vw;max-height:84vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';

    // Header
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';

    var titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

    var titleIco = document.createElement('div');
    titleIco.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    titleIco.innerHTML = svgIcon('journal', 16, '#fff');

    var titleTxt = document.createElement('span');
    titleTxt.style.cssText = 'font-size:15px;font-weight:700;color:#1a1a1a;';
    titleTxt.textContent = 'История операций (7 дней)';

    titleWrap.appendChild(titleIco); titleWrap.appendChild(titleTxt);

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', hideModal);

    hdr.appendChild(titleWrap); hdr.appendChild(closeBtn);

    // Filters
    var filterBar = document.createElement('div');
    filterBar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;flex-wrap:wrap;';

    var selLabel = document.createElement('span');
    selLabel.style.cssText = 'font-size:12px;color:#888;font-weight:600;';
    selLabel.textContent = 'Фильтр:';

    var sel = document.createElement('select');
    sel.style.cssText = 'border:1px solid #e0e0e0;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;';
    var selOpts = [
        ['', 'Все операции'],
        ['deposit_cash',        'Пополнение наличными'],
        ['deposit_bonus',       'Начисление бонусов'],
        ['session_start',       'Запуск сеанса'],
        ['session_finish',      'Завершение сеанса'],
        ['session_cancel',      'Отмена сеанса'],
        ['session_prolong',     'Продление сеанса'],
        ['session_update',      'Изменение вручную'],
        ['session_transfer',    'Пересадка клиента'],
        ['session_wait',        'Переход в ожидание'],
        ['session_self_prolong','Продление клиентом'],
        ['free_time',           'Бесплатное время'],
        ['debit',               'Списание'],
        ['unknown_op',          'Прочее'],
    ];
    selOpts.forEach(function(o){
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        sel.appendChild(opt);
    });
    sel.addEventListener('change', function(){ _filterType = this.value; renderTable(); });

    var searchInp = document.createElement('input');
    searchInp.type = 'text';
    searchInp.placeholder = 'Поиск: ник, ПК, комментарий...';
    searchInp.style.cssText = 'border:1px solid #e0e0e0;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;width:210px;';
    searchInp.addEventListener('input', function(){ _filterText = this.value.toLowerCase(); renderTable(); });

    filterBar.appendChild(selLabel); filterBar.appendChild(sel); filterBar.appendChild(searchInp);

    // Table wrap
    var tableWrap = document.createElement('div');
    tableWrap.id = 'godji-opj-table';
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';

    _modal.appendChild(hdr);
    _modal.appendChild(filterBar);
    _modal.appendChild(tableWrap);

    // Overlay
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click', hideModal);

    document.body.appendChild(_overlay);
    document.body.appendChild(_modal);

    document.addEventListener('keydown', function(e){
        if(e.key === 'Escape' && _isOpen) hideModal();
    });
}

function renderTable(){
    if(!_modal) return;
    var wrap = document.getElementById('godji-opj-table');
    if(!wrap) return;

    var journal = loadJournal();
    if(_filterType) journal = journal.filter(function(r){ return r.type === _filterType; });
    if(_filterText){
        journal = journal.filter(function(r){
            var hay = [r.label, r.comment, r.extra, r.nick, r.pc, r.amount, r.subject].join(' ').toLowerCase();
            return hay.indexOf(_filterText) !== -1;
        });
    }

    if(journal.length === 0){
        wrap.innerHTML = '<div style="text-align:center;color:#aaa;padding:48px;font-size:14px;">Нет операций за последние 7 дней</div>';
        return;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

    var thead = document.createElement('thead');
    thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hrow = document.createElement('tr');
    [['Время','100px'],['Тип операции','200px'],['ПК / Ник','130px'],['ID сеанса','100px'],['Сумма / Длит.','100px'],['Комментарий','auto']].forEach(function(col){
        var th = document.createElement('th');
        th.style.cssText = 'padding:9px 14px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eeeeee;white-space:nowrap;width:'+col[1]+';letter-spacing:0.3px;text-transform:uppercase;';
        th.textContent = col[0];
        hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    journal.forEach(function(rec){
        var cfg = TYPES[rec.type] || TYPES['unknown_op'];
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
        tr.addEventListener('mouseenter', function(){ tr.style.background = '#f7f9ff'; });
        tr.addEventListener('mouseleave', function(){ tr.style.background = ''; });

        // Время
        var tdT = document.createElement('td');
        tdT.style.cssText = 'padding:9px 14px;color:#999;font-size:12px;white-space:nowrap;';
        tdT.textContent = fmtDate(rec.ts);

        // Тип
        var tdType = document.createElement('td');
        tdType.style.cssText = 'padding:9px 14px;';
        var badge = document.createElement('span');
        badge.style.cssText = 'background:'+cfg.bg+';color:'+cfg.color+';border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;';
        badge.innerHTML = svgIcon(cfg.icon, 12, cfg.color) + '<span>' + escH(rec.label || rec.type) + '</span>';
        tdType.appendChild(badge);

        // ПК / Ник
        var tdPc = document.createElement('td');
        tdPc.style.cssText = 'padding:9px 14px;font-size:12px;white-space:nowrap;';
        if(rec.pc || rec.nick){
            if(rec.pc){
                var pcBadge = document.createElement('span');
                pcBadge.style.cssText = 'background:rgba(0,175,255,0.15);color:#0066aa;border-radius:4px;padding:1px 6px;font-weight:700;font-size:11px;margin-right:4px;';
                pcBadge.textContent = rec.pc;
                tdPc.appendChild(pcBadge);
            }
            if(rec.nick){
                var nickSpan = document.createElement('span');
                nickSpan.style.cssText = 'color:#666;font-size:12px;';
                nickSpan.textContent = '@'+rec.nick;
                tdPc.appendChild(nickSpan);
            }
        } else {
            tdPc.style.color = '#ccc';
            tdPc.textContent = '—';
        }

        // ID
        var tdExtra = document.createElement('td');
        tdExtra.style.cssText = 'padding:9px 14px;color:#888;font-size:12px;white-space:nowrap;';
        tdExtra.textContent = rec.extra || '—';

        // Сумма
        var tdAmt = document.createElement('td');
        tdAmt.style.cssText = 'padding:9px 14px;white-space:nowrap;font-weight:600;font-size:13px;';
        if(rec.amount){
            var pos = rec.amount.indexOf('+') === 0;
            var neg = rec.amount.indexOf('-') === 0;
            tdAmt.style.color = pos ? '#1a9944' : neg ? '#cc2200' : '#555';
            tdAmt.textContent = rec.amount;
        } else {
            tdAmt.style.color = '#ccc'; tdAmt.textContent = '—';
        }

        // Комментарий
        var tdCom = document.createElement('td');
        tdCom.style.cssText = 'padding:9px 14px;color:#555;font-size:12px;max-width:220px;word-break:break-word;';
        if(rec.comment){ tdCom.textContent = rec.comment; }
        else { tdCom.style.color = '#ccc'; tdCom.textContent = '—'; }

        tr.appendChild(tdT); tr.appendChild(tdType); tr.appendChild(tdPc);
        tr.appendChild(tdExtra); tr.appendChild(tdAmt); tr.appendChild(tdCom);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.innerHTML = '';
    wrap.appendChild(table);
}

function showModal(){
    if(!_modal) buildModal();
    renderTable();
    _modal.style.display = 'flex';
    _overlay.style.display = 'block';
    _isOpen = true;
}
function hideModal(){
    if(!_modal) return;
    _modal.style.display = 'none';
    _overlay.style.display = 'none';
    _isOpen = false;
}
function updateModalIfOpen(){
    if(_isOpen) renderTable();
}

function escH(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ──────────────────────────────────────────────
// Кнопка в сайдбаре — на месте удалённого Changelog (bottom:360px)
// ──────────────────────────────────────────────
function createBtn(){
    if(document.getElementById('godji-opj-btn')) return;

    var btn = document.createElement('a');
    btn.id = 'godji-opj-btn';
    btn.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href = 'javascript:void(0)';
    btn.style.cssText = 'position:fixed;bottom:360px;left:0;z-index:150;display:flex;align-items:center;gap:12px;width:280px;height:46px;padding:8px 12px 8px 18px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    var ico = document.createElement('div');
    ico.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;';
    ico.innerHTML = svgIcon('journal', 16, '#fff');

    var lbl = document.createElement('span');
    lbl.className = 'm_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText = 'font-size:14px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.1px;';
    lbl.textContent = 'История операций';

    btn.appendChild(ico); btn.appendChild(lbl);
    document.body.appendChild(btn);

    btn.addEventListener('click', function(e){
        e.preventDefault();
        if(_isOpen) hideModal(); else showModal();
    });
}

new MutationObserver(function(){
    if(!document.getElementById('godji-opj-btn')) createBtn();
}).observe(document.body||document.documentElement, {childList:true, subtree:false});

setTimeout(createBtn, 800);
setTimeout(createBtn, 2500);

})();

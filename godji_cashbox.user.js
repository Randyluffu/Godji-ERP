// ==UserScript==
// @name         Годжи — Касса смены
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cashbox.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cashbox.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_cashbox';
var SHIFTS_KEY  = 'godji_shifts';

// ── Структура хранилища ───────────────────────────────────
// currentShift: { id, openedAt, openedBy, cash, card, bonus, debit, entries:[] }
// shifts: [ ...завершённые смены ]

function loadCurrent(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); }catch(e){return null;} }
function saveCurrent(s){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){} }
function loadShifts(){ try{ return JSON.parse(localStorage.getItem(SHIFTS_KEY)||'[]'); }catch(e){return[];} }
function saveShifts(s){ try{ localStorage.setItem(SHIFTS_KEY, JSON.stringify(s)); }catch(e){} }

function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear()+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}
function fmtAmt(n){ if(!n)return'0 ₽'; return(n>0?'+':'')+Math.round(n)+' ₽'; }
function fmtAmtAbs(n){ return Math.round(n||0)+' ₽'; }

// ── Перехват fetch + XHR ──────────────────────────────────
var _origFetch = window.fetch;
window.fetch = function(url, options){
    if(options&&options.headers){
        if(options.headers.authorization) window._godjiAuthToken = options.headers.authorization;
        if(options.headers['x-hasura-role']) window._godjiHasuraRole = options.headers['x-hasura-role'];
    }
    var p = _origFetch.apply(this, arguments);
    if(url && typeof url==='string' && url.indexOf('hasura.godji.cloud')!==-1){
        var reqBody=''; try{ reqBody=(options&&options.body)||''; }catch(e){}
        p = p.then(function(resp){
            var clone=resp.clone();
            clone.json().then(function(data){ try{onApi(reqBody,data);}catch(e){} }).catch(function(){});
            return resp;
        });
    }
    return p;
};

var _origXHROpen = XMLHttpRequest.prototype.open;
var _origXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(m,url){ this._gUrl=url; return _origXHROpen.apply(this,arguments); };
XMLHttpRequest.prototype.send = function(body){
    var self=this;
    if(self._gUrl && self._gUrl.indexOf('hasura.godji.cloud')!==-1){
        self.addEventListener('load',function(){
            try{ onApi(body||'', JSON.parse(self.responseText)); }catch(e){}
        });
    }
    return _origXHRSend.apply(this,arguments);
};

// ── Разбор ответов ────────────────────────────────────────
function onApi(reqBody, data){
    if(!data||!data.data) return;
    var d = data.data;
    var body={}, vars={};
    try{ body=JSON.parse(reqBody); vars=body.variables||{}; }catch(e){ return; }

    var shift = loadCurrent();

    // Открытие смены — ERP мутация
    if(d.openShift || d.createShift || d.startShift){
        var s = d.openShift || d.createShift || d.startShift;
        var newShift = {
            id: (s&&s.id) || ('s_'+Date.now()),
            openedAt: Date.now(),
            openedBy: vars.adminName || vars.name || '',
            cash: 0, card: 0, bonus: 0, debit: 0,
            entries: []
        };
        saveCurrent(newShift);
        updateBtnBadge();
        updateModalIfOpen();
        return;
    }

    // Закрытие смены — ERP мутация
    if(d.closeShift || d.finishShift || d.endShift){
        if(shift){ closeShift(shift, 'erp'); }
        return;
    }

    // Нет активной смены — дальше не обрабатываем
    if(!shift) return;

    // Пополнение наличными
    if(d.walletDepositWithCash){
        var amt = vars.amount;
        if(typeof amt !== 'number') return;
        var nick = getNick(vars);
        if(amt > 0){
            // Определяем карта или наличные по paymentType / метке в vars
            var isCard = vars.paymentType==='card' ||
                         vars.paymentType==='CARD' ||
                         vars.method==='card' ||
                         (vars.comment&&vars.comment.toLowerCase().indexOf('карт')!==-1);
            addEntry(shift, isCard ? 'card' : 'cash', amt, nick, vars.comment||'');
        } else if(amt < 0){
            addEntry(shift, 'debit', amt, nick, vars.comment||'');
        }
    }

    // Пополнение по карте (отдельная мутация если есть)
    if(d.walletDepositWithCard || d.depositWithCard || d.payByCard){
        var amt2 = vars.amount;
        if(typeof amt2==='number' && amt2>0){
            addEntry(shift, 'card', amt2, getNick(vars), vars.comment||'');
        }
    }

    // Бонусы
    if(d.walletDepositWithBonus){
        var amt3 = vars.amount;
        if(typeof amt3==='number' && amt3>0){
            addEntry(shift, 'bonus', amt3, getNick(vars), vars.comment||'');
        }
    }

    // Явное списание
    if(d.walletDebit || d.walletWithdraw || d.debitWallet){
        var amt4 = vars.amount;
        if(typeof amt4==='number'){
            addEntry(shift, 'debit', -Math.abs(amt4), getNick(vars), vars.comment||'');
        }
    }
}

function getNick(vars){
    return vars.nickname || vars.login || '';
}

// Кэш ников из getDashboardDevices
var _nickCache = {}; // walletId → nick
(function(){
    var _of = window.fetch;
    // Уже перехвачено выше — enrichment через отдельный слушатель ниже
})();

function addEntry(shift, type, amount, nick, comment){
    var entry = { ts: Date.now(), type: type, amount: amount, nick: nick, comment: comment };
    shift.entries = shift.entries || [];
    shift.entries.unshift(entry);
    if(type==='cash')  shift.cash  = (shift.cash||0)  + amount;
    if(type==='card')  shift.card  = (shift.card||0)  + amount;
    if(type==='bonus') shift.bonus = (shift.bonus||0) + amount;
    if(type==='debit') shift.debit = (shift.debit||0) + amount;
    saveCurrent(shift);
    updateBtnBadge();
    updateModalIfOpen();
}

function closeShift(shift, source){
    shift.closedAt = Date.now();
    shift.closedBy = source || 'manual';
    var shifts = loadShifts();
    shifts.unshift(shift);
    // Храним последние 90 смен
    if(shifts.length > 90) shifts = shifts.slice(0,90);
    saveShifts(shifts);
    saveCurrent(null);
    updateBtnBadge();
    updateModalIfOpen();
}

function openShiftManual(){
    if(loadCurrent()){
        alert('Смена уже открыта');
        return;
    }
    var shift = {
        id: 's_'+Date.now(),
        openedAt: Date.now(),
        openedBy: 'manual',
        cash:0, card:0, bonus:0, debit:0,
        entries: []
    };
    saveCurrent(shift);
    updateBtnBadge();
    updateModalIfOpen();
}

// ── Модалка ───────────────────────────────────────────────
var _modal = null, _overlay = null, _isOpen = false;
var _tab = 'current'; // 'current' | 'history'

function buildModal(){
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click', hideModal);
    document.body.appendChild(_overlay);

    _modal = document.createElement('div');
    _modal.id = 'godji-cashbox-modal';
    _modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:720px;max-width:96vw;max-height:88vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);

    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&_isOpen) hideModal(); });
}

function renderModal(){
    if(!_modal) return;
    _modal.innerHTML = '';

    var shift = loadCurrent();

    // ── Шапка ──
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';
    var tw = document.createElement('div'); tw.style.cssText = 'display:flex;align-items:center;gap:10px;';
    var tIco = document.createElement('div');
    tIco.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#1a7a3c;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    tIco.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>';
    var tTxt = document.createElement('span'); tTxt.style.cssText = 'font-size:15px;font-weight:700;color:#1a1a1a;'; tTxt.textContent = 'Касса смены';
    tw.appendChild(tIco); tw.appendChild(tTxt);

    // Статус смены
    var badge = document.createElement('span');
    badge.style.cssText = shift
        ? 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#e6f9ee;color:#1a7a3c;'
        : 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#fde8e8;color:#cc2200;';
    badge.textContent = shift ? '● Смена открыта' : '○ Смена закрыта';
    tw.appendChild(badge);

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    closeBtn.innerHTML = '&times;'; closeBtn.addEventListener('click', hideModal);
    hdr.appendChild(tw); hdr.appendChild(closeBtn);
    _modal.appendChild(hdr);

    // ── Табы ──
    var tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;padding:0 20px;gap:4px;';
    [['current','Текущая смена'],['history','Журнал смен']].forEach(function(t){
        var tb = document.createElement('button');
        tb.style.cssText = 'border:none;background:none;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s;color:#999;font-family:inherit;';
        tb.textContent = t[1];
        if(_tab === t[0]){ tb.style.color='#1a7a3c'; tb.style.borderBottomColor='#1a7a3c'; }
        tb.addEventListener('click', function(){ _tab=t[0]; renderModal(); });
        tabs.appendChild(tb);
    });
    _modal.appendChild(tabs);

    // ── Контент ──
    var body = document.createElement('div');
    body.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    _modal.appendChild(body);

    if(_tab === 'current'){
        renderCurrentTab(body, shift);
    } else {
        renderHistoryTab(body);
    }
}

function renderCurrentTab(body, shift){
    if(!shift){
        // Смена закрыта — показываем кнопку открытия
        var empty = document.createElement('div');
        empty.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;';
        var msg = document.createElement('div'); msg.style.cssText = 'font-size:15px;color:#aaa;'; msg.textContent = 'Нет активной смены';
        var openBtn = document.createElement('button');
        openBtn.style.cssText = 'padding:10px 24px;background:#1a7a3c;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
        openBtn.textContent = 'Открыть смену вручную';
        openBtn.addEventListener('click', function(){ openShiftManual(); renderModal(); });
        empty.appendChild(msg); empty.appendChild(openBtn);
        body.appendChild(empty);
        return;
    }

    // ── Итоговые карточки ──
    var cards = document.createElement('div');
    cards.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;flex-shrink:0;';

    function mkCard(label, value, color, bg, ico){
        var c = document.createElement('div');
        c.style.cssText = 'background:'+bg+';border-radius:10px;padding:14px 16px;';
        var top = document.createElement('div'); top.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        var i = document.createElement('div');
        i.style.cssText = 'width:28px;height:28px;border-radius:6px;background:'+color+';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        i.innerHTML = ico;
        var lbl = document.createElement('span'); lbl.style.cssText = 'font-size:11px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:0.5px;'; lbl.textContent = label;
        top.appendChild(i); top.appendChild(lbl);
        var val = document.createElement('div'); val.style.cssText = 'font-size:22px;font-weight:800;color:#1a1a1a;'; val.textContent = value;
        c.appendChild(top); c.appendChild(val);
        return c;
    }

    var cashIco = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>';
    var cardIco = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
    var bonusIco = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    var debitIco = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

    cards.appendChild(mkCard('Наличные', fmtAmtAbs(shift.cash), '#1a7a3c', '#e6f9ee', cashIco));
    cards.appendChild(mkCard('Карта', fmtAmtAbs(shift.card), '#0066cc', '#e0f0ff', cardIco));
    cards.appendChild(mkCard('Бонусы', fmtAmtAbs(shift.bonus), '#c87800', '#fff4e0', bonusIco));
    cards.appendChild(mkCard('Списания', fmtAmtAbs(Math.abs(shift.debit)), '#cc2200', '#fde8e8', debitIco));
    body.appendChild(cards);

    // Инфо о смене
    var info = document.createElement('div');
    info.style.cssText = 'display:flex;align-items:center;gap:20px;padding:0 20px 12px;font-size:12px;color:#999;border-bottom:1px solid #f5f5f5;flex-wrap:wrap;';
    info.innerHTML =
        '<span>Открыта: <b style="color:#555">'+fmtDate(shift.openedAt)+'</b></span>'+
        (shift.openedBy ? '<span>Кем: <b style="color:#555">'+shift.openedBy+'</b></span>' : '')+
        '<span>Итого приход: <b style="color:#1a7a3c">'+fmtAmtAbs((shift.cash||0)+(shift.card||0))+'</b></span>';
    body.appendChild(info);

    // Кнопки действий
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;padding:12px 20px;flex-shrink:0;border-bottom:1px solid #f5f5f5;';

    var closeShiftBtn = document.createElement('button');
    closeShiftBtn.style.cssText = 'padding:8px 18px;background:#cc2200;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;';
    closeShiftBtn.textContent = 'Закрыть смену';
    closeShiftBtn.addEventListener('click',function(){
        if(!confirm('Закрыть смену? Данные сохранятся в журнал.')) return;
        closeShift(loadCurrent(), 'manual');
        renderModal();
    });
    actions.appendChild(closeShiftBtn);
    body.appendChild(actions);

    // Лог операций
    var entries = shift.entries || [];
    if(!entries.length){
        var noEnt = document.createElement('div');
        noEnt.style.cssText = 'text-align:center;color:#ccc;padding:40px;font-size:13px;';
        noEnt.textContent = 'Операций ещё нет';
        body.appendChild(noEnt);
        return;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
    var thead = document.createElement('thead');
    thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr = document.createElement('tr');
    [['Время','90px'],['Тип','130px'],['Ник','130px'],['Сумма','90px'],['Комментарий','auto']].forEach(function(c){
        var th = document.createElement('th');
        th.style.cssText = 'padding:8px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent = c[0]; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);

    var TYPE_CFG = {
        cash:  {label:'Наличные',  color:'#1a7a3c', bg:'#e6f9ee'},
        card:  {label:'Карта',     color:'#0066cc', bg:'#e0f0ff'},
        bonus: {label:'Бонусы',    color:'#c87800', bg:'#fff4e0'},
        debit: {label:'Списание',  color:'#cc2200', bg:'#fde8e8'},
    };

    var tbody = document.createElement('tbody');
    entries.forEach(function(e){
        var cfg = TYPE_CFG[e.type] || {label:e.type, color:'#555', bg:'#f5f5f5'};
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid #f5f5f5;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});

        var td0 = document.createElement('td'); td0.style.cssText = 'padding:8px 12px;color:#999;font-size:12px;white-space:nowrap;'; td0.textContent = fmtDate(e.ts);
        var td1 = document.createElement('td'); td1.style.cssText = 'padding:8px 12px;';
        var badge = document.createElement('span'); badge.style.cssText = 'background:'+cfg.bg+';color:'+cfg.color+';border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;'; badge.textContent = cfg.label; td1.appendChild(badge);
        var td2 = document.createElement('td'); td2.style.cssText = 'padding:8px 12px;font-size:12px;color:#555;'; td2.textContent = e.nick ? '@'+e.nick : '—';
        var td3 = document.createElement('td'); td3.style.cssText = 'padding:8px 12px;font-weight:700;font-size:13px;white-space:nowrap;color:'+(e.amount>=0?'#1a7a3c':'#cc2200')+';'; td3.textContent = fmtAmt(e.amount);
        var td4 = document.createElement('td'); td4.style.cssText = 'padding:8px 12px;font-size:12px;color:#888;'; td4.textContent = e.comment||'—';

        [td0,td1,td2,td3,td4].forEach(function(td){tr.appendChild(td);});
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
}

function renderHistoryTab(body){
    var shifts = loadShifts();

    if(!shifts.length){
        body.innerHTML = '<div style="text-align:center;color:#ccc;padding:60px;font-size:14px;">Нет завершённых смен</div>';
        return;
    }

    var table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
    var thead = document.createElement('thead');
    thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr = document.createElement('tr');
    [['Открыта','130px'],['Закрыта','130px'],['Нал.','80px'],['Карта','80px'],['Бонусы','80px'],['Списания','80px'],['Итого приход','110px'],['Опер.','60px']].forEach(function(c){
        var th = document.createElement('th');
        th.style.cssText = 'padding:9px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent = c[0]; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);

    var tbody = document.createElement('tbody');
    shifts.forEach(function(s, idx){
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid #f5f5f5;cursor:pointer;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});
        tr.addEventListener('click',function(){ showShiftDetail(s); });

        var total = (s.cash||0) + (s.card||0);
        var td0 = mkTd(fmtDate(s.openedAt), 'padding:9px 12px;font-size:12px;color:#555;white-space:nowrap;');
        var td1 = mkTd(s.closedAt ? fmtDate(s.closedAt) : '—', 'padding:9px 12px;font-size:12px;color:#888;white-space:nowrap;');
        var td2 = mkTd(fmtAmtAbs(s.cash), 'padding:9px 12px;color:#1a7a3c;font-weight:600;');
        var td3 = mkTd(fmtAmtAbs(s.card), 'padding:9px 12px;color:#0066cc;font-weight:600;');
        var td4 = mkTd(fmtAmtAbs(s.bonus), 'padding:9px 12px;color:#c87800;font-weight:600;');
        var td5 = mkTd(fmtAmtAbs(Math.abs(s.debit||0)), 'padding:9px 12px;color:#cc2200;font-weight:600;');
        var td6 = mkTd(fmtAmtAbs(total), 'padding:9px 12px;font-weight:800;color:#1a1a1a;');
        var td7 = mkTd(String((s.entries||[]).length), 'padding:9px 12px;color:#aaa;font-size:12px;');

        [td0,td1,td2,td3,td4,td5,td6,td7].forEach(function(td){tr.appendChild(td);});
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
}

function mkTd(text, css){
    var td = document.createElement('td');
    td.style.cssText = css;
    td.textContent = text;
    return td;
}

function showShiftDetail(shift){
    // Открываем текущую вкладку с данными этой смены
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    document.body.appendChild(ov);

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;width:680px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.3);';

    var hdr2 = document.createElement('div');
    hdr2.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    hdr2.innerHTML = '<span style="font-size:14px;font-weight:700;color:#1a1a1a;">Смена от '+fmtDate(shift.openedAt)+'</span>';
    var cls2 = document.createElement('button'); cls2.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;'; cls2.textContent='×'; cls2.addEventListener('click',function(){ov.remove();});
    hdr2.appendChild(cls2);
    box.appendChild(hdr2);

    // Мини-итоги
    var sumRow = document.createElement('div');
    sumRow.style.cssText = 'display:flex;gap:16px;padding:12px 20px;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;';
    [['Наличные', fmtAmtAbs(shift.cash), '#1a7a3c'],['Карта', fmtAmtAbs(shift.card), '#0066cc'],
     ['Бонусы', fmtAmtAbs(shift.bonus), '#c87800'],['Списания', fmtAmtAbs(Math.abs(shift.debit||0)), '#cc2200'],
     ['Итого', fmtAmtAbs((shift.cash||0)+(shift.card||0)), '#1a1a1a']].forEach(function(r){
        var s2 = document.createElement('div');
        s2.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
        s2.innerHTML = '<span style="font-size:10px;color:#aaa;font-weight:700;text-transform:uppercase;">'+r[0]+'</span>'+
                       '<span style="font-size:16px;font-weight:800;color:'+r[2]+';">'+r[1]+'</span>';
        sumRow.appendChild(s2);
    });
    box.appendChild(sumRow);

    // Таблица операций
    var tw2 = document.createElement('div'); tw2.style.cssText = 'overflow-y:auto;flex:1;min-height:0;';
    var fakeBody = document.createElement('div');
    renderCurrentTab(fakeBody, shift);
    // Берём только таблицу (последний дочерний элемент)
    var tbl = fakeBody.querySelector('table');
    if(tbl){ tw2.appendChild(tbl); } else { tw2.innerHTML='<div style="padding:32px;text-align:center;color:#ccc;">Нет операций</div>'; }
    box.appendChild(tw2);

    ov.appendChild(box);
    document.addEventListener('keydown',function eh(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);}});
}

function showModal(){
    if(!_modal) buildModal();
    renderModal();
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
function updateModalIfOpen(){ if(_isOpen) renderModal(); }

// ── Кнопка в footer рядом с "Гоголя Админ" ───────────────
function updateBtnBadge(){
    var btn = document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var shift = loadCurrent();
    var dot = btn.querySelector('.gcb-dot');
    if(dot) dot.style.background = shift ? '#1a7a3c' : '#cc2200';
    var sum = btn.querySelector('.gcb-sum');
    if(sum){
        if(shift){
            var total = (shift.cash||0)+(shift.card||0);
            sum.textContent = total > 0 ? fmtAmtAbs(total) : 'Открыта';
        } else {
            sum.textContent = 'Закрыта';
        }
    }
}

function createBtn(){
    if(document.getElementById('godji-cashbox-btn')) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;

    var btn = document.createElement('button');
    btn.id = 'godji-cashbox-btn';
    btn.type = 'button';
    btn.title = 'Касса смены';
    btn.style.cssText = 'position:absolute;left:10px;top:50%;transform:translateY(-50%);height:30px;border-radius:7px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;gap:6px;cursor:pointer;color:rgba(255,255,255,0.7);transition:background 0.15s;z-index:200;padding:0 8px;font-family:inherit;flex-shrink:0;max-width:120px;overflow:hidden;';

    var dot = document.createElement('span');
    dot.className = 'gcb-dot';
    dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#cc2200;';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    var sum = document.createElement('span');
    sum.className = 'gcb-sum';
    sum.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.45);white-space:nowrap;';

    btn.appendChild(dot); btn.appendChild(sum);
    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.13)';});
    btn.addEventListener('mouseleave',function(){btn.style.background='rgba(255,255,255,0.07)';});
    btn.addEventListener('click',function(e){ e.stopPropagation(); if(_isOpen) hideModal(); else showModal(); });

    footer.style.position = 'relative';
    footer.appendChild(btn);
    updateBtnBadge();
}

// ── Автоопределение открытия смены через ERP кнопку ───────
// ERP кнопка "Открыть смену" делает мутацию которую мы перехватим выше.
// Дополнительно следим за текстом кнопки в header (синяя плашка).
function watchErpShiftBtn(){
    var hdr = document.querySelector('.Sidebar_header__dm6Ua');
    if(!hdr) return;
    var btns = hdr.querySelectorAll('button');
    btns.forEach(function(b){
        if(b._gcbWatched) return;
        b._gcbWatched = true;
        b.addEventListener('click', function(){
            var txt = b.textContent.toLowerCase();
            // Если это кнопка "Открыть смену" и смены нет — создадим через 1 сек
            // (ждём пока мутация отработает и мы её поймаем через перехват)
            if(txt.indexOf('открыт')!==-1 && txt.indexOf('смен')!==-1){
                setTimeout(function(){
                    if(!loadCurrent()){ openShiftManual(); }
                },1500);
            }
        });
    });
}

// ── MutationObserver ──────────────────────────────────────
var _obs = new MutationObserver(function(){
    if(!document.getElementById('godji-cashbox-btn')) createBtn();
    watchErpShiftBtn();
});

if(document.body){
    _obs.observe(document.body,{childList:true,subtree:false});
    setTimeout(createBtn,1200);
    setTimeout(createBtn,3000);
    setTimeout(watchErpShiftBtn,2000);
} else {
    document.addEventListener('DOMContentLoaded',function(){
        _obs.observe(document.body,{childList:true,subtree:false});
        setTimeout(createBtn,1200);
        setTimeout(watchErpShiftBtn,2000);
    });
}

})();

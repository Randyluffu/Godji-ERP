// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      3.6
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_operations_journal.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_operations_journal.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_opj';
var MAX_MS = 72 * 3600000;

// ── Кэш сессий: sessId→{nick,pc}, walletId→{nick} ────────
var _bySession = {};  // sessionId → {nick, pc, walletId}
var _byWallet  = {};  // walletId  → {nick, pc}

function updateCache(devices){
    if(!devices) return;
    devices.forEach(function(dev){
        (dev.sessions||[]).forEach(function(s){
            var nick = (s.user&&(s.user.nickname||s.user.login))||'';
            var walletId = (s.user&&s.user.wallet&&s.user.wallet.id)||null;
            var entry = {nick:nick, pc:dev.name||'', walletId:walletId};
            _bySession[String(s.id)] = entry;
            if(walletId) _byWallet[String(walletId)] = entry;
        });
    });
    // Ретроактивно обогащаем записи без ника
    enrichStoredEntries();
}

function enrichStoredEntries(){
    var journal = loadJournal();
    var changed = false;
    journal.forEach(function(r){
        if(r.nick && r.pc) return;
        var src = null;
        if(r._sessId) src = _bySession[String(r._sessId)];
        if(!src && r._walletId) src = _byWallet[String(r._walletId)];
        if(src){
            if(!r.nick && src.nick){ r.nick = src.nick; changed = true; }
            if(!r.pc && src.pc){ r.pc = src.pc; changed = true; }
        }
    });
    if(changed){ saveJournal(journal); updateModalIfOpen(); }
}

function nickBySession(sessId){
    return (_bySession[String(sessId)]||{nick:'',pc:''});
}
function nickByWallet(walletId){
    return (_byWallet[String(walletId)]||{nick:'',pc:''});
}

// ── Перехват fetch ────────────────────────────────────────
var _origFetch = window.fetch;
window.fetch = function(url, options){
    if(options&&options.headers){
        if(options.headers.authorization) window._godjiAuthToken = options.headers.authorization;
        if(options.headers['x-hasura-role']) window._godjiHasuraRole = options.headers['x-hasura-role'];
    }
    var p = _origFetch.apply(this, arguments);
    if(url && typeof url==='string' && url.indexOf('hasura.godji.cloud')!==-1){
        var reqBody='';
        try{ reqBody=(options&&options.body)||''; }catch(e){}
        p = p.then(function(resp){
            var clone = resp.clone();
            clone.json().then(function(data){
                try{ onApiResponse(reqBody, data); }catch(e){}
            }).catch(function(){});
            return resp;
        });
    }
    return p;
};

// Также перехватываем XHR (Apollo Client может использовать его)
var _origXHROpen  = XMLHttpRequest.prototype.open;
var _origXHRSend  = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url){
    this._gUrl = url;
    return _origXHROpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function(body){
    var self = this;
    if(self._gUrl && self._gUrl.indexOf('hasura.godji.cloud')!==-1){
        self.addEventListener('load', function(){
            try{
                var data = JSON.parse(self.responseText);
                onApiResponse(body||'', data);
            }catch(e){}
        });
    }
    return _origXHRSend.apply(this, arguments);
};

// ── Разбор ответов API ────────────────────────────────────
function onApiResponse(reqBody, data){
    if(!data) return;
    // Обновляем кэш сессий
    var dd = data.data&&data.data.getDashboardDevices&&data.data.getDashboardDevices.devices;
    if(dd) updateCache(dd);

    if(!data.data) return;
    var d = data.data;
    var body={};
    try{ body=JSON.parse(reqBody); }catch(e){ return; }
    var vars  = body.variables || {};
    var query = body.query || body.operationName || '';

    // ── Пополнение наличными ──────────────────
    if(d.walletDepositWithCash){
        var opId = d.walletDepositWithCash.operationId||'';
        var amt  = vars.amount;
        var inf  = nickByWallet(vars.walletId);
        if(typeof amt==='number' && amt<0){
            addEntry({type:'debit', label:'Списание с баланса',
                _walletId:vars.walletId, nick:inf.nick, pc:inf.pc,
                amount:fmtAmt(amt), comment:fmtCmt(vars),
                extra:opId?'ОП #'+opId:''});
        } else {
            addEntry({type:'deposit_cash', label:'Пополнение наличными',
                _walletId:vars.walletId, nick:inf.nick, pc:inf.pc,
                amount:fmtAmt(amt), comment:fmtCmt(vars),
                extra:opId?'ОП #'+opId:''});
        }
    }

    // ── Пополнение / бонусы ───────────────────
    if(d.walletDepositWithBonus){
        var opId2 = d.walletDepositWithBonus.operationId||d.walletDepositWithBonus.id||'';
        var inf2  = nickByWallet(vars.walletId);
        addEntry({type:'deposit_bonus', label:'Начисление бонусов',
            _walletId:vars.walletId, nick:inf2.nick, pc:inf2.pc,
            amount:fmtAmt(vars.amount), comment:fmtCmt(vars),
            extra:opId2?'ОП #'+opId2:''});
    }

    // ── Запуск сеанса ─────────────────────────
    var resCreate = d.userReservationCreate||d.createReservation;
    if(resCreate){
        var sId = (resCreate&&resCreate.id)||vars.sessionId||'';
        var inf3 = nickBySession(sId)||nickByWallet(vars.walletId);
        addEntry({type:'session_start', label:'Запуск сеанса',
            _sessId:sId, nick:inf3.nick, pc:inf3.pc,
            amount:'', comment:fmtCmt(vars),
            extra:sId?'Сеанс #'+sId:''});
    }

    // ── Завершение сеанса ─────────────────────
    var resFinish = d.userReservationFinish||d.finishReservation;
    if(resFinish){
        var sId2 = vars.sessionId||(resFinish&&resFinish.id)||'';
        var inf4 = nickBySession(sId2);
        addEntry({type:'session_finish', label:'Завершение сеанса',
            _sessId:sId2, nick:inf4.nick, pc:inf4.pc,
            amount:'', comment:fmtCmt(vars),
            extra:sId2?'Сеанс #'+sId2:''});
    }

    // ── Отмена сеанса ─────────────────────────
    if(d.userReservationCancel&&d.userReservationCancel.success!==undefined){
        var sId2b = vars.sessionId||'';
        var inf4b = nickBySession(sId2b);
        addEntry({type:'session_cancel', label:'Отмена сеанса',
            _sessId:sId2b, nick:inf4b.nick, pc:inf4b.pc,
            amount:'', comment:fmtCmt(vars),
            extra:sId2b?'Сеанс #'+sId2b:''});
    }

    // ── Продление сеанса ──────────────────────
    if(d.userReservationProlongate){
        var sId3 = vars.sessionId||'';
        var inf5 = nickBySession(sId3);
        var mins = vars.minutes?vars.minutes+' мин':'';
        var cmt  = fmtCmt(vars);
        var isFree = cmt.toLowerCase().indexOf('бесплат')!==-1||cmt.toLowerCase().indexOf('free')!==-1;
        addEntry({
            type: isFree?'free_time':'session_prolong',
            label: isFree?'Бесплатное время':'Продление сеанса',
            _sessId:sId3, nick:inf5.nick, pc:inf5.pc,
            amount:mins, comment:cmt,
            extra:sId3?'Сеанс #'+sId3:''});
    }

    // ── Изменение вручную ─────────────────────
    if(d.userReservationUpdate||d.updateReservation){
        var sId4 = vars.sessionId||vars.id||'';
        var inf6 = nickBySession(sId4);
        addEntry({type:'session_update', label:'Изменение вручную',
            _sessId:sId4, nick:inf6.nick, pc:inf6.pc,
            amount:'', comment:fmtCmt(vars),
            extra:sId4?'Сеанс #'+sId4:''});
    }

    // ── Пересадка ─────────────────────────────
    var resT = d.deviceRelocation||d.userReservationTransfer||
               d.transferReservation||d.moveDevice||d.relocateDevice;
    if(resT){
        var sId5 = vars.sessionId||vars.reservationId||'';
        var inf7 = nickBySession(sId5);
        var fromPc = vars.fromDeviceName||vars.fromDevice||vars.deviceFromName||'';
        var toPc   = vars.toDeviceName||vars.toDevice||vars.deviceToName||'';
        addEntry({type:'session_transfer', label:'Пересадка клиента',
            _sessId:sId5, nick:inf7.nick,
            pc:inf7.pc||fromPc,
            amount:(fromPc&&toPc)?fromPc+'→'+toPc:'',
            comment:fmtCmt(vars),
            extra:sId5?'Сеанс #'+sId5:''});
    }

    // ── Ожидание ──────────────────────────────
    if(d.userReservationWait||d.pauseReservation||d.reservationWaiting){
        var sId6 = vars.sessionId||vars.reservationId||'';
        var inf8 = nickBySession(sId6);
        addEntry({type:'session_wait', label:'Переход в ожидание',
            _sessId:sId6, nick:inf8.nick, pc:inf8.pc,
            amount:'', comment:fmtCmt(vars),
            extra:sId6?'Сеанс #'+sId6:''});
    }

    // ── Самостоятельное продление ─────────────
    if(d.clientProlongate||d.selfProlong||d.clientReservationProlongate||
       query.toLowerCase().indexOf('selfprolong')!==-1){
        var sId7 = vars.sessionId||'';
        var inf9 = nickBySession(sId7);
        addEntry({type:'session_self_prolong', label:'Продление клиентом',
            _sessId:sId7, nick:inf9.nick, pc:inf9.pc,
            amount:vars.minutes?vars.minutes+' мин':'', comment:fmtCmt(vars),
            extra:sId7?'Сеанс #'+sId7:''});
    }

    // ── Явное бесплатное время ────────────────
    if(d.addFreeTime||d.freeTime||d.walletDepositFreeTime){
        var r6 = d.addFreeTime||d.freeTime||d.walletDepositFreeTime;
        var sId8 = vars.sessionId||'';
        var inf10 = nickBySession(sId8);
        addEntry({type:'free_time', label:'Бесплатное время',
            _sessId:sId8, nick:inf10.nick, pc:inf10.pc,
            amount:vars.minutes?vars.minutes+' мин':'', comment:fmtCmt(vars),
            extra:sId8?'Сеанс #'+sId8:''});
    }

    // ── Явное списание ────────────────────────
    if(d.walletDebit||d.walletWithdraw||d.debitWallet){
        var r7 = d.walletDebit||d.walletWithdraw||d.debitWallet||{};
        var inf11 = nickByWallet(vars.walletId);
        addEntry({type:'debit', label:'Списание с баланса',
            _walletId:vars.walletId, nick:inf11.nick, pc:inf11.pc,
            amount:fmtAmt(vars.amount), comment:fmtCmt(vars),
            extra:(r7.operationId)?'ОП #'+r7.operationId:''});
    }
}

function fmtAmt(v){
    if(v===undefined||v===null)return'';
    var n=parseFloat(v);if(isNaN(n))return'';
    return(n>=0?'+':'')+n.toFixed(0)+' ₽';
}
function fmtCmt(vars){
    return vars.comment||vars.description||vars.reason||'';
}
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── localStorage ─────────────────────────────────────────
function loadJournal(){
    try{
        var raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
        var cut=Date.now()-MAX_MS;
        return raw.filter(function(r){return r.ts>cut;});
    }catch(e){return[];}
}
function saveJournal(data){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){}
}
function addEntry(entry){
    var journal=loadJournal();
    var now=Date.now();
    var isDup=journal.some(function(r){
        return r.type===entry.type&&r.extra===entry.extra&&now-r.ts<6000;
    });
    if(isDup)return;
    entry.ts=now;
    journal.unshift(entry);
    saveJournal(journal.filter(function(r){return r.ts>now-MAX_MS;}));
    updateModalIfOpen();
}

// ── Типы и иконки ─────────────────────────────────────────
var TYPES={
    'deposit_cash':       {color:'#1a9944',bg:'#e6f9ee'},
    'deposit_bonus':      {color:'#c87800',bg:'#fff4e0'},
    'session_start':      {color:'#0066cc',bg:'#e0f0ff'},
    'session_finish':     {color:'#cc2200',bg:'#fde8e8'},
    'session_cancel':     {color:'#991100',bg:'#ffe0e0'},
    'session_prolong':    {color:'#3355cc',bg:'#e8f0ff'},
    'session_update':     {color:'#6633cc',bg:'#f5f0ff'},
    'session_transfer':   {color:'#cc6600',bg:'#fff0e0'},
    'session_wait':       {color:'#666666',bg:'#f0f0f0'},
    'session_self_prolong':{color:'#007755',bg:'#e0f8f0'},
    'free_time':          {color:'#007799',bg:'#e8f8ff'},
    'debit':              {color:'#cc0000',bg:'#ffe8e8'},
    'unknown_op':         {color:'#555555',bg:'#f5f5f5'},
};

// ── Модалка ───────────────────────────────────────────────
var _modal=null,_overlay=null,_isOpen=false;
// Фильтры
var _fType='',_fText='',_fNick='',_fFrom=0,_fTo=0;

function buildModal(){
    // Overlay
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);

    _modal=document.createElement('div');
    _modal.id='godji-opj-modal';
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:900px;max-width:96vw;max-height:85vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';

    // ── Шапка ────────────────────────────────
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';

    var titleWrap=document.createElement('div');
    titleWrap.style.cssText='display:flex;align-items:center;gap:10px;';
    var tIco=document.createElement('div');
    tIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    tIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>';
    var tTxt=document.createElement('span');
    tTxt.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;';
    tTxt.textContent='История операций (72 ч)';
    titleWrap.appendChild(tIco);titleWrap.appendChild(tTxt);

    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    closeBtn.innerHTML='&times;';
    closeBtn.addEventListener('click',hideModal);
    hdr.appendChild(titleWrap);hdr.appendChild(closeBtn);

    // ── Панель фильтров (одна строка) ─────────
    var fb=document.createElement('div');
    fb.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;white-space:nowrap;overflow-x:auto;';

    function mkSel(opts, onChange){
        var s=document.createElement('select');
        s.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;';
        opts.forEach(function(o){
            var opt=document.createElement('option');
            opt.value=o[0];opt.textContent=o[1];s.appendChild(opt);
        });
        s.addEventListener('change',function(){onChange(this.value);renderTable();});
        return s;
    }
    function mkInput(placeholder, w, onInput){
        var i=document.createElement('input');
        i.type='text';i.placeholder=placeholder;
        i.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;width:'+w+';flex-shrink:0;';
        i.addEventListener('input',function(){onInput(this.value.toLowerCase());renderTable();});
        return i;
    }
    function mkDate(lbl, onChange){
        var wrap=document.createElement('span');
        wrap.style.cssText='display:flex;align-items:center;gap:4px;flex-shrink:0;';
        var l=document.createElement('span');
        l.style.cssText='font-size:11px;color:#999;font-weight:600;';
        l.textContent=lbl;
        var d=document.createElement('input');
        d.type='datetime-local';
        d.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:3px 5px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;flex-shrink:0;';
        d.addEventListener('change',function(){onChange(this.value?new Date(this.value).getTime():0);renderTable();});
        wrap.appendChild(l);wrap.appendChild(d);
        return wrap;
    }

    var typeSel=mkSel([
        ['','Все типы'],['deposit_cash','Пополнение'],['deposit_bonus','Бонусы'],
        ['session_start','Запуск'],['session_finish','Завершение'],['session_cancel','Отмена'],
        ['session_prolong','Продление'],['session_update','Изм. вручную'],
        ['session_transfer','Пересадка'],['session_wait','Ожидание'],
        ['session_self_prolong','Прод. клиентом'],['free_time','Бесплатно'],
        ['debit','Списание'],
    ], function(v){_fType=v;});

    // Ник из тех что есть — динамический select
    var nickSel=document.createElement('select');
    nickSel.id='godji-opj-nick-sel';
    nickSel.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;max-width:130px;';
    nickSel.addEventListener('change',function(){_fNick=this.value;renderTable();});

    var searchInp=mkInput('Поиск...','120px',function(v){_fText=v;});
    var dateFrom=mkDate('С:',function(v){_fFrom=v;});
    var dateTo=mkDate('По:',function(v){_fTo=v?v+86399999:0;});

    // Сброс фильтров
    var resetBtn=document.createElement('button');
    resetBtn.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;background:#fff;color:#888;outline:none;cursor:pointer;flex-shrink:0;white-space:nowrap;';
    resetBtn.textContent='Сбросить';
    resetBtn.addEventListener('click',function(){
        _fType='';_fNick='';_fText='';_fFrom=0;_fTo=0;
        fb.querySelectorAll('select').forEach(function(s){s.value='';});
        fb.querySelectorAll('input[type="text"]').forEach(function(i){i.value='';});
        fb.querySelectorAll('input[type="datetime-local"]').forEach(function(i){i.value='';});
        renderTable();
    });
    fb.appendChild(typeSel);fb.appendChild(nickSel);
    fb.appendChild(searchInp);fb.appendChild(dateFrom);fb.appendChild(dateTo);
    fb.appendChild(resetBtn);

    // Таблица
    var tw=document.createElement('div');
    tw.id='godji-opj-tw';
    tw.style.cssText='overflow-y:auto;flex:1;min-height:0;';

    _modal.appendChild(hdr);_modal.appendChild(fb);_modal.appendChild(tw);
    document.body.appendChild(_modal);

    document.addEventListener('keydown',function(e){
        if(e.key==='Escape'&&_isOpen)hideModal();
    });
}

function updateNickFilter(journal){
    var sel=document.getElementById('godji-opj-nick-sel');
    if(!sel)return;
    var cur=sel.value;
    var nicks=[''];
    journal.forEach(function(r){
        if(r.nick&&nicks.indexOf(r.nick)===-1)nicks.push(r.nick);
    });
    sel.innerHTML='';
    var opt0=document.createElement('option');opt0.value='';opt0.textContent='Все ники';sel.appendChild(opt0);
    nicks.slice(1).sort().forEach(function(n){
        var o=document.createElement('option');o.value=n;o.textContent='@'+n;
        if(n===cur)o.selected=true;
        sel.appendChild(o);
    });
}

function renderTable(){
    if(!_modal)return;
    var tw=document.getElementById('godji-opj-tw');
    if(!tw)return;

    var journal=loadJournal();

    // Сначала применяем только фильтр дат для ника-селектора
    var forNick=journal;
    if(_fFrom)forNick=forNick.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)forNick=forNick.filter(function(r){return r.ts<=_fTo;});
    updateNickFilter(forNick);

    // Применяем все фильтры
    if(_fType)journal=journal.filter(function(r){return r.type===_fType;});
    if(_fNick)journal=journal.filter(function(r){return (r.nick||'')===_fNick;});
    if(_fText){
        journal=journal.filter(function(r){
            var h=[r.label,r.comment,r.extra,r.nick,r.pc,r.amount].join(' ').toLowerCase();
            return h.indexOf(_fText)!==-1;
        });
    }
    if(_fFrom)journal=journal.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)journal=journal.filter(function(r){return r.ts<=_fTo;});

    if(!journal.length){
        tw.innerHTML='<div style="text-align:center;color:#aaa;padding:48px;font-size:14px;">Нет операций за 72 часа</div>';
        return;
    }

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Время','95px'],['Тип операции','185px'],['ПК','55px'],['Ник','120px'],['ID','95px'],['Сумма','85px'],['Комментарий','auto']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent=c[0];hr.appendChild(th);
    });
    thead.appendChild(hr);table.appendChild(thead);

    var tbody=document.createElement('tbody');
    journal.forEach(function(rec){
        var cfg=TYPES[rec.type]||TYPES['unknown_op'];
        var tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});

        // Время
        var td0=document.createElement('td');
        td0.style.cssText='padding:9px 12px;color:#999;font-size:12px;white-space:nowrap;';
        td0.textContent=fmtDate(rec.ts);

        // Тип
        var td1=document.createElement('td');
        td1.style.cssText='padding:9px 12px;';
        var badge=document.createElement('span');
        badge.style.cssText='background:'+cfg.bg+';color:'+cfg.color+';border-radius:5px;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;';
        badge.textContent=rec.label||rec.type;
        td1.appendChild(badge);

        // ПК
        var td2=document.createElement('td');
        td2.style.cssText='padding:9px 12px;';
        if(rec.pc){
            var pcB=document.createElement('span');
            pcB.style.cssText='background:rgba(0,160,230,0.12);color:#0066aa;border-radius:4px;padding:2px 6px;font-weight:700;font-size:12px;';
            pcB.textContent=rec.pc;td2.appendChild(pcB);
        } else { td2.style.color='#ccc'; td2.textContent='—'; }

        // Ник
        var td3=document.createElement('td');
        td3.style.cssText='padding:9px 12px;';
        if(rec.nick){
            var na=document.createElement('a');
            na.href='javascript:void(0)';
            na.style.cssText='color:#0066aa;font-size:12px;text-decoration:none;cursor:pointer;';
            na.textContent='@'+rec.nick;
            na.addEventListener('click',function(e){
                e.stopPropagation();
                var sb=document.getElementById('godji-search-btn');
                if(sb){ sb.click(); setTimeout(function(){
                    var inp=document.getElementById('godji-search-input');
                    if(inp){inp.value=rec.nick;inp.dispatchEvent(new Event('input'));}
                },100);
                } else { window.location.href='/clients?search='+encodeURIComponent(rec.nick); }
            });
            td3.appendChild(na);
        } else { td3.style.color='#ccc'; td3.textContent='—'; }

        // ID
        var td4=document.createElement('td');
        td4.style.cssText='padding:9px 12px;color:#888;font-size:12px;white-space:nowrap;';
        td4.textContent=rec.extra||'—';

        // Сумма
        var td5=document.createElement('td');
        td5.style.cssText='padding:9px 12px;white-space:nowrap;font-weight:700;font-size:13px;';
        if(rec.amount){
            td5.style.color=rec.amount[0]==='+'?'#1a9944':rec.amount[0]==='-'?'#cc2200':'#555';
            td5.textContent=rec.amount;
        } else { td5.style.color='#ccc'; td5.textContent='—'; }

        // Комментарий
        var td6=document.createElement('td');
        td6.style.cssText='padding:9px 12px;font-size:12px;max-width:180px;word-break:break-word;';
        if(rec.comment){ td6.style.color='#555'; td6.textContent=rec.comment; }
        else { td6.style.color='#ccc'; td6.textContent='—'; }

        [td0,td1,td2,td3,td4,td5,td6].forEach(function(td){tr.appendChild(td);});
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tw.innerHTML='';tw.appendChild(table);
}

function showModal(){
    if(!_modal)buildModal();
    renderTable();
    _modal.style.display='flex';
    _overlay.style.display='block';
    _isOpen=true;
}
function hideModal(){
    if(!_modal)return;
    _modal.style.display='none';
    _overlay.style.display='none';
    _isOpen=false;
}
function updateModalIfOpen(){
    if(_isOpen)renderTable();
}

// ── Кнопка сайдбара ──────────────────────────────────────
// ── Кнопка в сайдбаре ────────────────────────────────────
function hasSidebar(){
    return !!document.querySelector('.Sidebar_linksInner__oTy_4');
}

function createBtn(){
    if(!hasSidebar()) return;
    if(document.getElementById('godji-opj-btn')) return;
    var sb = document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb) return;

    var btn=document.createElement('a');
    btn.id='godji-opj-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 12px 8px 12px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>';

    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText='font-size:14px;font-weight:600;color:var(--mantine-color-white,#fff);white-space:nowrap;';
    lbl.textContent='История операций';

    btn.appendChild(ico); btn.appendChild(lbl);
    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.05)';});
    btn.addEventListener('mouseleave',function(){btn.style.background='';});
    btn.addEventListener('click',function(e){
        e.preventDefault();
        if(_isOpen)hideModal();else showModal();
    });

    // Вставляем после последнего нативного NavLink (не нашего)
    var nativeLinks = Array.from(sb.querySelectorAll('a.mantine-NavLink-root:not([id^="godji"])'));
    var last = nativeLinks[nativeLinks.length - 1];
    if(last && last.nextSibling) sb.insertBefore(btn, last.nextSibling);
    else sb.appendChild(btn);
}

var _sbObs2 = new MutationObserver(function(){
    if(!document.getElementById('godji-opj-btn')) createBtn();
});
if(document.body) _sbObs2.observe(document.body, {childList:true, subtree:false});
setTimeout(createBtn,1000);setTimeout(createBtn,2500);setTimeout(createBtn,5000);

})();

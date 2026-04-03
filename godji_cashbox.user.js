// ==UserScript==
// @name         Годжи — Касса смены
// @namespace    http://tampermonkey.net/
// @version      1.5
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

// Структура смены:
// { id, openedAt, openedBy, cash, card, manual, withdrawal,
//   manualEntries:[{ts, amount, comment, type:'in'|'out'}] }

function loadCurrent(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null'); }catch(e){return null;} }
function saveCurrent(s){ try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(s)); }catch(e){} }
function loadShifts(){ try{ return JSON.parse(localStorage.getItem(SHIFTS_KEY)||'[]'); }catch(e){return[];} }
function saveShifts(s){ try{ localStorage.setItem(SHIFTS_KEY,JSON.stringify(s)); }catch(e){} }
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear()+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}
function fmtAmtAbs(n){ return Math.round(n||0)+' ₽'; }

// ── Снапшот кошельков: walletId → amount ─────────────────
// ERP шлёт getDashboardDevices каждые ~30 сек через fetch.
// Наш скрипт подменяет window.fetch до загрузки ERP (document-start),
// поэтому getDashboardDevices мы ловим. Пополнения фиксируем через diff.
var _walletSnap = {}; // walletId → {amount, nick, pc}

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
            clone.json().then(function(data){
                try{ onDashboard(data); }catch(e){}
            }).catch(function(){});
            return resp;
        });
    }
    return p;
};

function onDashboard(data){
    if(!data||!data.data) return;
    var devices = (data.data.getDashboardDevices&&data.data.getDashboardDevices.devices) || [];
    if(!devices.length) return;

    var shift = loadCurrent();

    devices.forEach(function(dev){
        (dev.sessions||[]).forEach(function(s){
            if(!s.user||!s.user.wallet) return;
            var wid   = String(s.user.wallet.id);
            var amt   = s.user.wallet.amount||0;   // текущий баланс
            var nick  = s.user.nickname||s.user.name||'';
            var pc    = dev.name||'';

            if(_walletSnap[wid] !== undefined){
                var prev = _walletSnap[wid].amount;
                var diff = amt - prev;
                // Порог +1₽ чтобы не реагировать на флуктуации
                if(diff >= 1 && shift){
                    // isCash определяем из последнего перехваченного payload (см. ниже)
                    // Если есть кэш флага — используем, иначе считаем наличными
                    var isCard = (_lastDepositFlag[wid] === false); // isCash:false → карта
                    if(isCard){ shift.card = (shift.card||0) + diff; }
                    else       { shift.cash = (shift.cash||0) + diff; }
                    saveCurrent(shift);
                    updateBtnBadge();
                    updateModalIfOpen();
                    // Сбрасываем флаг
                    delete _lastDepositFlag[wid];
                }
            }
            _walletSnap[wid] = {amount: amt, nick: nick, pc: pc};
        });
    });
}

// ── Перехват isCash флага из DepositBalanceWithCash ───────
// Мутацию мы не ловим напрямую, но пробуем поймать через fetch
// на случай если ERP всё-таки пойдёт через наш перехват.
// Также вешаем XHR на случай если Apollo использует его.
var _lastDepositFlag = {}; // walletId → isCash boolean

function tryParseDeposit(reqBody){
    try{
        var b = typeof reqBody==='string' ? JSON.parse(reqBody) : reqBody;
        if(!b||!b.variables) return;
        var vars = b.variables;
        var op   = b.operationName||'';
        if(op==='DepositBalanceWithCash' || (b.query&&b.query.indexOf('walletDepositWithCash')!==-1)){
            var wid = String(vars.walletId||'');
            if(wid) _lastDepositFlag[wid] = (vars.isCash !== false);
        }
    }catch(e){}
}

// Пробуем поймать через XHR тоже
var _origXHROpen = XMLHttpRequest.prototype.open;
var _origXHRSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(m,url){
    this._gUrl=url; return _origXHROpen.apply(this,arguments);
};
XMLHttpRequest.prototype.send = function(body){
    var self=this;
    if(self._gUrl && self._gUrl.indexOf('hasura.godji.cloud')!==-1){
        tryParseDeposit(body||'');
    }
    return _origXHRSend.apply(this,arguments);
};

// ── Открытие/закрытие смены через ERP ────────────────────
// Ловим через fetch (GetDashboardTable содержит сессии,
// а shift-мутации идут через тот же fetch — пробуем)
var _origFetch2 = window.fetch; // уже наш перехват сверху — дополняем через onDashboard
// openShift/closeShift ловим отдельно в том же fetch перехвате:
var __realFetch = _origFetch; // сохранили до подмены
// Добавляем второй слой для shift-мутаций
(function(){
    var _prev = window.fetch;
    window.fetch = function(url, options){
        var p = _prev.apply(this, arguments);
        if(url && typeof url==='string' && url.indexOf('hasura.godji.cloud')!==-1){
            var reqBody=''; try{ reqBody=(options&&options.body)||''; }catch(e){}
            tryParseDeposit(reqBody);
            p = p.then(function(resp){
                var clone=resp.clone();
                clone.json().then(function(data){
                    try{ onShiftMutation(reqBody, data); }catch(e){}
                }).catch(function(){});
                return resp;
            });
        }
        return p;
    };
})();

function onShiftMutation(reqBody, data){
    if(!data||!data.data) return;
    var d=data.data;
    var body={};
    try{ body=typeof reqBody==='string'?JSON.parse(reqBody):reqBody; }catch(e){ return; }
    var op=body.operationName||'';

    if(d.openShift||d.createShift||d.startShift||op.indexOf('OpenShift')!==-1||op.indexOf('StartShift')!==-1){
        if(!loadCurrent()){
            var s2=d.openShift||d.createShift||d.startShift||{};
            saveCurrent({id:(s2.id)||('s_'+Date.now()),openedAt:Date.now(),openedBy:'erp',
                         cash:0,card:0,manual:0,withdrawal:0,manualEntries:[]});
            _walletSnap={};
            updateBtnBadge(); updateModalIfOpen();
        }
    }
    if(d.closeShift||d.finishShift||d.endShift||op.indexOf('CloseShift')!==-1||op.indexOf('EndShift')!==-1){
        var cur2=loadCurrent(); if(cur2) closeShift(cur2,'erp');
    }
}


// ── Ручное внесение / выемка ──────────────────────────────
function addManual(amount, comment){
    var shift=loadCurrent(); if(!shift) return;
    amount=parseFloat(amount)||0; if(!amount) return;
    shift.manual=(shift.manual||0)+amount;
    shift.manualEntries=shift.manualEntries||[];
    shift.manualEntries.unshift({ts:Date.now(),amount:amount,comment:comment||'',type:'in'});
    saveCurrent(shift); updateBtnBadge(); updateModalIfOpen();
}

function addWithdrawal(amount, comment){
    var shift=loadCurrent(); if(!shift) return;
    amount=parseFloat(amount)||0; if(!amount) return;
    shift.withdrawal=(shift.withdrawal||0)+amount;
    shift.manualEntries=shift.manualEntries||[];
    shift.manualEntries.unshift({ts:Date.now(),amount:amount,comment:comment||'',type:'out'});
    saveCurrent(shift); updateBtnBadge(); updateModalIfOpen();
}

function closeShift(shift, source){
    shift.closedAt=Date.now(); shift.closedBy=source||'manual';
    var shifts=loadShifts();
    shifts.unshift(shift);
    if(shifts.length>90) shifts=shifts.slice(0,90);
    saveShifts(shifts);
    saveCurrent(null);
    updateBtnBadge(); updateModalIfOpen();
}

function openShiftManual(){
    if(loadCurrent()) return;
    saveCurrent({id:'s_'+Date.now(),openedAt:Date.now(),openedBy:'manual',
                 cash:0,card:0,manual:0,withdrawal:0,manualEntries:[]});
    updateBtnBadge(); updateModalIfOpen();
}

// ── Модалка ───────────────────────────────────────────────
var _modal=null, _overlay=null, _isOpen=false, _tab='current';

function buildModal(){
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);

    _modal=document.createElement('div');
    _modal.id='godji-cashbox-modal';
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:640px;max-width:96vw;max-height:90vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);

    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&_isOpen) hideModal(); });
}

function renderModal(){
    if(!_modal) return;
    _modal.innerHTML='';
    var shift=loadCurrent();

    // ── Шапка ──
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var tw=document.createElement('div'); tw.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    var tIco=document.createElement('div');
    tIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#166534;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    tIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/></svg>';
    var tTxt=document.createElement('span');
    tTxt.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;';
    tTxt.textContent='Касса смены';
    var sBadge=document.createElement('span');
    sBadge.style.cssText=shift
        ?'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#dcfce7;color:#166534;'
        :'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#fee2e2;color:#991b1b;';
    sBadge.textContent=shift?'● Открыта':'○ Закрыта';
    tw.appendChild(tIco); tw.appendChild(tTxt); tw.appendChild(sBadge);
    if(shift){
        var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0);
        var tBadge=document.createElement('span');
        tBadge.style.cssText='font-size:18px;font-weight:800;color:#1a1a1a;margin-left:2px;';
        tBadge.textContent=fmtAmtAbs(total);
        tw.appendChild(tBadge);
    }
    var xBtn=document.createElement('button');
    xBtn.style.cssText='background:none;border:none;color:#bbb;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;';
    xBtn.innerHTML='&times;'; xBtn.addEventListener('click',hideModal);
    hdr.appendChild(tw); hdr.appendChild(xBtn);
    _modal.appendChild(hdr);

    // ── Табы ──
    var tabs=document.createElement('div');
    tabs.style.cssText='display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0;padding:0 20px;gap:2px;background:#fff;';
    [['current','Текущая смена'],['history','Журнал смен']].forEach(function(t){
        var tb=document.createElement('button');
        tb.style.cssText='border:none;background:none;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;color:#aaa;font-family:inherit;transition:all 0.15s;';
        tb.textContent=t[1];
        if(_tab===t[0]){ tb.style.color='#166534'; tb.style.borderBottomColor='#166534'; }
        tb.addEventListener('click',function(){ _tab=t[0]; renderModal(); });
        tabs.appendChild(tb);
    });
    _modal.appendChild(tabs);

    var body=document.createElement('div');
    body.style.cssText='overflow-y:auto;flex:1;min-height:0;';
    _modal.appendChild(body);

    if(_tab==='current') renderCurrentTab(body, shift);
    else renderHistoryTab(body);
}

// ── Текущая смена ─────────────────────────────────────────
function renderCurrentTab(body, shift){
    if(!shift){
        var empty=document.createElement('div');
        empty.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;';
        empty.innerHTML='<div style="font-size:15px;color:#aaa;">Нет активной смены</div>';
        var openBtn=document.createElement('button');
        openBtn.style.cssText='padding:10px 24px;background:#166534;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
        openBtn.textContent='Открыть смену вручную';
        openBtn.addEventListener('click',function(){ openShiftManual(); renderModal(); });
        empty.appendChild(openBtn);
        body.appendChild(empty);
        return;
    }

    // 4 карточки 2×2
    var cards=document.createElement('div');
    cards.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:16px 20px 12px;';

    function mkCard(label, value, color, bg, icoSvg){
        var c=document.createElement('div');
        c.style.cssText='background:'+bg+';border-radius:10px;padding:14px 16px;';
        var top=document.createElement('div');
        top.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        var i=document.createElement('div');
        i.style.cssText='width:26px;height:26px;border-radius:6px;background:'+color+';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        i.innerHTML=icoSvg;
        var lbl=document.createElement('span');
        lbl.style.cssText='font-size:10px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:0.5px;';
        lbl.textContent=label;
        top.appendChild(i); top.appendChild(lbl);
        var val=document.createElement('div');
        val.style.cssText='font-size:22px;font-weight:800;color:#1a1a1a;';
        val.textContent=value;
        c.appendChild(top); c.appendChild(val);
        return c;
    }

    var ICO={
        cash:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>',
        card:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        plus:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        out:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    };

    cards.appendChild(mkCard('Наличные',    fmtAmtAbs(shift.cash),       '#166534','#dcfce7', ICO.cash));
    cards.appendChild(mkCard('Карта',       fmtAmtAbs(shift.card),       '#1d4ed8','#dbeafe', ICO.card));
    cards.appendChild(mkCard('Внесение',    fmtAmtAbs(shift.manual),     '#7c3aed','#ede9fe', ICO.plus));
    cards.appendChild(mkCard('Выемка',      fmtAmtAbs(shift.withdrawal), '#b45309','#fef3c7', ICO.out));
    body.appendChild(cards);

    // Итого
    var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0);
    var infoRow=document.createElement('div');
    infoRow.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:0 20px 12px;border-bottom:1px solid #f0f0f0;';
    var infoL=document.createElement('div');
    infoL.style.cssText='font-size:12px;color:#aaa;';
    infoL.textContent='Открыта: '+fmtDate(shift.openedAt);
    var infoR=document.createElement('div');
    infoR.style.cssText='font-size:15px;font-weight:800;color:#1a1a1a;';
    infoR.textContent='В кассе: '+fmtAmtAbs(total);
    infoRow.appendChild(infoL); infoRow.appendChild(infoR);
    body.appendChild(infoRow);

    // Формы: внесение + выемка рядом
    var twoCol=document.createElement('div');
    twoCol.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 20px;';

    function mkForm(title, color, borderColor, bg, btnColor, btnTxt, onSubmit){
        var sec=document.createElement('div');
        sec.style.cssText='padding:12px 14px;background:'+bg+';border-radius:10px;border:1px solid '+borderColor+';';
        var ttl=document.createElement('div');
        ttl.style.cssText='font-size:11px;font-weight:700;color:'+color+';margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;';
        ttl.textContent=title;
        sec.appendChild(ttl);

        function mkInp(ph){
            var inp=document.createElement('input');
            inp.type=(ph==='Сумма, ₽')?'number':'text';
            if(ph==='Сумма, ₽') inp.min='0';
            inp.placeholder=ph;
            inp.style.cssText='width:100%;box-sizing:border-box;border:1px solid '+borderColor+';border-radius:6px;padding:7px 9px;font-size:13px;font-family:inherit;background:#fff;color:#1a1a1a;outline:none;margin-bottom:6px;';
            inp.addEventListener('focus',function(){inp.style.borderColor=color;});
            inp.addEventListener('blur',function(){inp.style.borderColor=borderColor;});
            return inp;
        }
        var amtI=mkInp('Сумма, ₽');
        var cmtI=mkInp('Комментарий');
        sec.appendChild(amtI); sec.appendChild(cmtI);

        var btn=document.createElement('button');
        btn.style.cssText='width:100%;padding:8px;background:'+btnColor+';color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;';
        btn.textContent=btnTxt;
        btn.addEventListener('click',function(){
            var v=parseFloat(amtI.value);
            if(!v||v<=0){ amtI.style.borderColor='#ef4444'; return; }
            onSubmit(v, cmtI.value.trim());
            amtI.value=''; cmtI.value='';
        });
        sec.appendChild(btn);
        return sec;
    }

    twoCol.appendChild(mkForm('Внесение в кассу','#7c3aed','#c4b5fd','#f5f3ff','#7c3aed','+ Внести',addManual));
    twoCol.appendChild(mkForm('Выемка из кассы', '#b45309','#fcd34d','#fffbeb','#b45309','− Выемка',addWithdrawal));
    body.appendChild(twoCol);

    // Лог ручных операций
    var entries=shift.manualEntries||[];
    if(entries.length){
        var logWrap=document.createElement('div');
        logWrap.style.cssText='margin:0 20px 12px;border-radius:8px;overflow:hidden;border:1px solid #f0f0f0;max-height:160px;overflow-y:auto;';
        entries.forEach(function(e){
            var isOut=e.type==='out';
            var row=document.createElement('div');
            row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid #f8f8f8;font-size:12px;';
            var lft=document.createElement('span');
            lft.style.cssText='color:#888;';
            lft.textContent=fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var rgt=document.createElement('span');
            rgt.style.cssText='font-weight:700;color:'+(isOut?'#b45309':'#7c3aed')+';';
            rgt.textContent=(isOut?'−':'+')+fmtAmtAbs(e.amount);
            row.appendChild(lft); row.appendChild(rgt);
            logWrap.appendChild(row);
        });
        body.appendChild(logWrap);
    }

    // Кнопка закрытия смены
    var actions=document.createElement('div');
    actions.style.cssText='padding:0 20px 20px;';
    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='padding:9px 20px;background:#dc2626;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;';
    closeBtn.textContent='Закрыть смену';
    closeBtn.addEventListener('click',function(){
        if(!confirm('Закрыть смену? Данные сохранятся в журнал.')) return;
        closeShift(loadCurrent(),'manual'); renderModal();
    });
    actions.appendChild(closeBtn);
    body.appendChild(actions);
}

// ── Журнал смен ───────────────────────────────────────────
function renderHistoryTab(body){
    var shifts=loadShifts();
    if(!shifts.length){
        body.innerHTML='<div style="text-align:center;color:#ccc;padding:60px;font-size:14px;">Нет завершённых смен</div>';
        return;
    }

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;';
    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Открыта','115px'],['Закрыта','115px'],['Нал.','75px'],['Карта','75px'],['Внес.','70px'],['Выем.','70px'],['В кассе','80px']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent=c[0]; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);

    var tbody=document.createElement('tbody');
    shifts.forEach(function(s){
        var tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid #f5f5f5;cursor:pointer;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});
        tr.addEventListener('click',function(){ showShiftDetail(s); });

        var total=(s.cash||0)+(s.card||0)+(s.manual||0)-(s.withdrawal||0);
        [
            [fmtDate(s.openedAt),                'color:#555;'],
            [s.closedAt?fmtDate(s.closedAt):'—', 'color:#999;'],
            [fmtAmtAbs(s.cash),                  'color:#166534;font-weight:600;'],
            [fmtAmtAbs(s.card),                  'color:#1d4ed8;font-weight:600;'],
            [fmtAmtAbs(s.manual),                'color:#7c3aed;font-weight:600;'],
            [fmtAmtAbs(s.withdrawal),            'color:#b45309;font-weight:600;'],
            [fmtAmtAbs(total),                   'font-weight:800;color:#1a1a1a;'],
        ].forEach(function(col){
            var td=document.createElement('td');
            td.style.cssText='padding:9px 12px;font-size:12px;white-space:nowrap;'+col[1];
            td.textContent=col[0]; tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
}

// ── Детальная карточка смены ──────────────────────────────
function showShiftDetail(s){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    document.body.appendChild(ov);

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:520px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.3);';

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var ht=document.createElement('span');
    ht.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;';
    ht.textContent='Смена: '+fmtDate(s.openedAt)+' → '+(s.closedAt?fmtDate(s.closedAt):'открыта');
    var hc=document.createElement('button');
    hc.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#bbb;';
    hc.textContent='×'; hc.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(ht); hdr.appendChild(hc);
    box.appendChild(hdr);

    var total=(s.cash||0)+(s.card||0)+(s.manual||0)-(s.withdrawal||0);
    var grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    [['Наличные',fmtAmtAbs(s.cash),'#166534','#dcfce7'],
     ['Карта',fmtAmtAbs(s.card),'#1d4ed8','#dbeafe'],
     ['Внесение',fmtAmtAbs(s.manual),'#7c3aed','#ede9fe'],
     ['Выемка',fmtAmtAbs(s.withdrawal),'#b45309','#fef3c7'],
     ['В кассе',fmtAmtAbs(total),'#1a1a1a','#f5f5f5']].forEach(function(r){
        var c=document.createElement('div');
        c.style.cssText='background:'+r[3]+';border-radius:8px;padding:10px 12px;';
        c.innerHTML='<div style="font-size:9px;color:'+r[2]+';font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">'+r[0]+'</div>'+
                    '<div style="font-size:16px;font-weight:800;color:#1a1a1a;">'+r[1]+'</div>';
        grid.appendChild(c);
    });
    box.appendChild(grid);

    var tw=document.createElement('div');
    tw.style.cssText='overflow-y:auto;flex:1;min-height:0;padding:12px 20px;';
    var entries=s.manualEntries||[];
    if(entries.length){
        var lt=document.createElement('div');
        lt.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
        lt.textContent='Ручные операции';
        tw.appendChild(lt);
        entries.forEach(function(e){
            var isOut=e.type==='out';
            var row=document.createElement('div');
            row.style.cssText='display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px;';
            var l=document.createElement('span'); l.style.cssText='color:#888;'; l.textContent=fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var r=document.createElement('span'); r.style.cssText='font-weight:700;color:'+(isOut?'#b45309':'#7c3aed')+';';
            r.textContent=(isOut?'−':'+')+fmtAmtAbs(e.amount);
            row.appendChild(l); row.appendChild(r); tw.appendChild(row);
        });
    } else {
        tw.innerHTML='<div style="color:#ccc;font-size:13px;text-align:center;padding:24px;">Ручных операций не было</div>';
    }
    box.appendChild(tw);
    ov.appendChild(box);

    document.addEventListener('keydown',function eh(e){
        if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);}
    });
}

// ── Диагностика ───────────────────────────────────────────
// ── Показ/скрытие модалки ────────────────────────────────
function showModal(){ if(!_modal)buildModal(); renderModal(); _modal.style.display='flex'; _overlay.style.display='block'; _isOpen=true; }
function hideModal(){ if(!_modal)return; _modal.style.display='none'; _overlay.style.display='none'; _isOpen=false; }
function updateModalIfOpen(){ if(_isOpen)renderModal(); }

// ── Кнопка (NavLink стиль, перед divider) ────────────────
function updateBtnBadge(){
    var btn=document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var shift=loadCurrent();
    var dot=btn.querySelector('.gcb-dot');
    if(dot) dot.style.background=shift?'#22c55e':'#ef4444';
    var sumEl=btn.querySelector('.gcb-sum');
    if(sumEl){
        if(shift){
            var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0);
            sumEl.textContent=fmtAmtAbs(total);
            sumEl.style.color=total>0?'rgba(134,239,172,0.9)':'rgba(255,255,255,0.35)';
        } else {
            sumEl.textContent='Закрыта';
            sumEl.style.color='rgba(255,255,255,0.3)';
        }
    }
}

function createBtn(){
    if(document.getElementById('godji-cashbox-btn')) return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;
    var divider=footer.querySelector('.mantine-Divider-root');
    if(!divider) return;

    var btn=document.createElement('a');
    btn.id='godji-cashbox-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 16px 8px 12px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    // ThemeIcon зелёный
    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='width:32px;height:32px;border-radius:8px;background:#166534;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/></svg>';

    // Статус-точка
    var dot=document.createElement('span');
    dot.className='gcb-dot';
    dot.style.cssText='position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;background:#ef4444;border:2px solid var(--mantine-color-body,#1a1b2e);';
    ico.appendChild(dot);

    // Текст + сумма
    var bodyDiv=document.createElement('div');
    bodyDiv.className='m_f07af9d2 mantine-NavLink-body';
    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText='font-size:14px;font-weight:600;color:var(--mantine-color-white,#fff);white-space:nowrap;';
    lbl.textContent='Касса смены';
    var sumEl=document.createElement('span');
    sumEl.className='gcb-sum m_57492dcc mantine-NavLink-description';
    sumEl.style.cssText='font-size:11px;white-space:nowrap;font-weight:500;';
    bodyDiv.appendChild(lbl); bodyDiv.appendChild(sumEl);

    btn.appendChild(ico); btn.appendChild(bodyDiv);
    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.05)';});
    btn.addEventListener('mouseleave',function(){btn.style.background='';});
    btn.addEventListener('click',function(e){ e.stopPropagation(); if(_isOpen)hideModal(); else showModal(); });

    // Вставляем ПЕРЕД divider
    footer.insertBefore(btn, divider);
    updateBtnBadge();
}

// ── Следим за кнопкой "Открыть смену" в ERP ──────────────
function watchErpShiftBtn(){
    var hdr=document.querySelector('.Sidebar_header__dm6Ua');
    if(!hdr) return;
    hdr.querySelectorAll('button').forEach(function(b){
        if(b._gcbWatched) return; b._gcbWatched=true;
        b.addEventListener('click',function(){
            var txt=b.textContent.toLowerCase();
            if(txt.indexOf('открыт')!==-1&&txt.indexOf('смен')!==-1){
                setTimeout(function(){ if(!loadCurrent()) openShiftManual(); },1500);
            }
        });
    });
}

// ── MutationObserver + init ───────────────────────────────
var _obs=new MutationObserver(function(){
    if(!document.getElementById('godji-cashbox-btn')) createBtn();
    watchErpShiftBtn();
});

if(document.body){
    _obs.observe(document.body,{childList:true,subtree:false});
    setTimeout(createBtn,1200); setTimeout(createBtn,3000);
    setTimeout(watchErpShiftBtn,2000);
} else {
    document.addEventListener('DOMContentLoaded',function(){
        _obs.observe(document.body,{childList:true,subtree:false});
        setTimeout(createBtn,1200);
        setTimeout(watchErpShiftBtn,2000);
    });
}

})();

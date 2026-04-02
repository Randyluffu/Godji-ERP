// ==UserScript==
// @name         Годжи — Касса смены
// @namespace    http://tampermonkey.net/
// @version      1.1
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
// { id, openedAt, openedBy, cash, card, manual, manualEntries:[{ts,amount,comment}] }
// manualEntries — ручные внесения, только для истории внутри смены

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

function onApi(reqBody, data){
    if(!data||!data.data) return;
    var d=data.data;
    var body={}, vars={};
    try{ body=JSON.parse(reqBody); vars=body.variables||{}; }catch(e){ return; }

    // Открытие смены через ERP
    if(d.openShift||d.createShift||d.startShift){
        var s=d.openShift||d.createShift||d.startShift;
        if(!loadCurrent()){
            saveCurrent({id:(s&&s.id)||('s_'+Date.now()),openedAt:Date.now(),openedBy:'erp',cash:0,card:0,manual:0,manualEntries:[]});
            updateBtnBadge(); updateModalIfOpen();
        }
        return;
    }

    // Закрытие смены через ERP
    if(d.closeShift||d.finishShift||d.endShift){
        var cur=loadCurrent(); if(cur) closeShift(cur,'erp');
        return;
    }

    var shift=loadCurrent();
    if(!shift) return;

    // Пополнение наличными
    if(d.walletDepositWithCash){
        var amt=vars.amount;
        if(typeof amt!=='number'||amt<=0) return;
        var isCard = vars.paymentType==='card'||vars.paymentType==='CARD'||vars.method==='card'||
                     (vars.comment&&vars.comment.toLowerCase().indexOf('карт')!==-1);
        if(isCard){ shift.card=(shift.card||0)+amt; }
        else       { shift.cash=(shift.cash||0)+amt; }
        saveCurrent(shift); updateBtnBadge(); updateModalIfOpen();
    }

    // Отдельная мутация по карте (если есть)
    if(d.walletDepositWithCard||d.depositWithCard||d.payByCard){
        var amt2=vars.amount;
        if(typeof amt2==='number'&&amt2>0){
            shift.card=(shift.card||0)+amt2;
            saveCurrent(shift); updateBtnBadge(); updateModalIfOpen();
        }
    }
}

// ── Ручное внесение (только касса, без API) ───────────────
function addManual(amount, comment){
    var shift=loadCurrent();
    if(!shift) return;
    amount=parseFloat(amount)||0;
    if(!amount) return;
    shift.manual=(shift.manual||0)+amount;
    shift.manualEntries=shift.manualEntries||[];
    shift.manualEntries.unshift({ts:Date.now(),amount:amount,comment:comment||''});
    saveCurrent(shift);
    updateBtnBadge();
    updateModalIfOpen();
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
    saveCurrent({id:'s_'+Date.now(),openedAt:Date.now(),openedBy:'manual',cash:0,card:0,manual:0,manualEntries:[]});
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
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:640px;max-width:96vw;max-height:88vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);

    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&_isOpen) hideModal(); });
}

function renderModal(){
    if(!_modal) return;
    _modal.innerHTML='';
    var shift=loadCurrent();

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var tw=document.createElement('div'); tw.style.cssText='display:flex;align-items:center;gap:10px;';
    var tIco=document.createElement('div');
    tIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#1a7a3c;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    tIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>';
    var tTxt=document.createElement('span'); tTxt.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;'; tTxt.textContent='Касса смены';
    var badge=document.createElement('span');
    badge.style.cssText=shift
        ?'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#e6f9ee;color:#1a7a3c;'
        :'font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:#fde8e8;color:#cc2200;';
    badge.textContent=shift?'● Смена открыта':'○ Смена закрыта';
    tw.appendChild(tIco); tw.appendChild(tTxt); tw.appendChild(badge);
    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    closeBtn.innerHTML='&times;'; closeBtn.addEventListener('click',hideModal);
    hdr.appendChild(tw); hdr.appendChild(closeBtn);
    _modal.appendChild(hdr);

    // Табы
    var tabs=document.createElement('div');
    tabs.style.cssText='display:flex;border-bottom:1px solid #f0f0f0;flex-shrink:0;padding:0 20px;gap:4px;';
    [['current','Текущая смена'],['history','Журнал смен']].forEach(function(t){
        var tb=document.createElement('button');
        tb.style.cssText='border:none;background:none;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;color:#999;font-family:inherit;';
        tb.textContent=t[1];
        if(_tab===t[0]){ tb.style.color='#1a7a3c'; tb.style.borderBottomColor='#1a7a3c'; }
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

function renderCurrentTab(body, shift){
    if(!shift){
        var empty=document.createElement('div');
        empty.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;';
        var msg=document.createElement('div'); msg.style.cssText='font-size:15px;color:#aaa;'; msg.textContent='Нет активной смены';
        var openBtn=document.createElement('button');
        openBtn.style.cssText='padding:10px 24px;background:#1a7a3c;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
        openBtn.textContent='Открыть смену вручную';
        openBtn.addEventListener('click',function(){ openShiftManual(); renderModal(); });
        empty.appendChild(msg); empty.appendChild(openBtn);
        body.appendChild(empty);
        return;
    }

    // ── Три карточки: Наличные / Карта / Ручное внесение ──
    var cards=document.createElement('div');
    cards.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px;';

    function mkCard(label, value, color, bg, icoSvg){
        var c=document.createElement('div');
        c.style.cssText='background:'+bg+';border-radius:10px;padding:16px;';
        var top=document.createElement('div'); top.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:10px;';
        var i=document.createElement('div');
        i.style.cssText='width:28px;height:28px;border-radius:6px;background:'+color+';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        i.innerHTML=icoSvg;
        var lbl=document.createElement('span'); lbl.style.cssText='font-size:11px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:0.5px;'; lbl.textContent=label;
        top.appendChild(i); top.appendChild(lbl);
        var val=document.createElement('div'); val.style.cssText='font-size:26px;font-weight:800;color:#1a1a1a;'; val.textContent=value;
        c.appendChild(top); c.appendChild(val);
        return c;
    }

    var cashIco='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>';
    var cardIco='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
    var manIco='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

    cards.appendChild(mkCard('Наличные', fmtAmtAbs(shift.cash), '#1a7a3c', '#e6f9ee', cashIco));
    cards.appendChild(mkCard('Карта', fmtAmtAbs(shift.card), '#0066cc', '#e0f0ff', cardIco));
    cards.appendChild(mkCard('Ручное внесение', fmtAmtAbs(shift.manual), '#6633cc', '#f0eaff', manIco));
    body.appendChild(cards);

    // Итого + инфо о смене
    var infoRow=document.createElement('div');
    infoRow.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:0 20px 14px;';
    var infoLeft=document.createElement('div');
    infoLeft.style.cssText='font-size:12px;color:#aaa;';
    infoLeft.textContent='Открыта: '+fmtDate(shift.openedAt);
    var infoRight=document.createElement('div');
    infoRight.style.cssText='font-size:14px;font-weight:800;color:#1a1a1a;';
    infoRight.textContent='Итого: '+fmtAmtAbs((shift.cash||0)+(shift.card||0)+(shift.manual||0));
    infoRow.appendChild(infoLeft); infoRow.appendChild(infoRight);
    body.appendChild(infoRow);

    // ── Форма ручного внесения ──
    var manSection=document.createElement('div');
    manSection.style.cssText='margin:0 20px 16px;padding:14px 16px;background:#f9f5ff;border-radius:10px;border:1px solid #e0d0ff;';
    var manTitle=document.createElement('div');
    manTitle.style.cssText='font-size:12px;font-weight:700;color:#6633cc;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;';
    manTitle.textContent='Ручное внесение в кассу';
    var manRow=document.createElement('div');
    manRow.style.cssText='display:flex;gap:8px;';

    var amtInp=document.createElement('input');
    amtInp.type='number'; amtInp.placeholder='Сумма, ₽'; amtInp.min='0';
    amtInp.style.cssText='flex:1;border:1px solid #d0bbff;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:#1a1a1a;outline:none;';
    amtInp.addEventListener('focus',function(){amtInp.style.borderColor='#6633cc';});
    amtInp.addEventListener('blur',function(){amtInp.style.borderColor='#d0bbff';});

    var cmtInp=document.createElement('input');
    cmtInp.type='text'; cmtInp.placeholder='Комментарий (необязательно)';
    cmtInp.style.cssText='flex:2;border:1px solid #d0bbff;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;background:#fff;color:#1a1a1a;outline:none;';
    cmtInp.addEventListener('focus',function(){cmtInp.style.borderColor='#6633cc';});
    cmtInp.addEventListener('blur',function(){cmtInp.style.borderColor='#d0bbff';});

    var addBtn=document.createElement('button');
    addBtn.style.cssText='padding:8px 16px;background:#6633cc;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;';
    addBtn.textContent='Внести';
    addBtn.addEventListener('click',function(){
        var v=parseFloat(amtInp.value);
        if(!v||v<=0){ amtInp.style.borderColor='#cc0000'; return; }
        addManual(v, cmtInp.value.trim());
        amtInp.value=''; cmtInp.value='';
    });

    manRow.appendChild(amtInp); manRow.appendChild(cmtInp); manRow.appendChild(addBtn);
    manSection.appendChild(manTitle); manSection.appendChild(manRow);

    // Мини-лог ручных внесений (если есть)
    var entries=shift.manualEntries||[];
    if(entries.length){
        var manLog=document.createElement('div');
        manLog.style.cssText='margin-top:10px;display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;';
        entries.forEach(function(e){
            var row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#555;padding:4px 2px;border-bottom:1px solid #ece4ff;';
            var lft=document.createElement('span'); lft.style.cssText='color:#999;'; lft.textContent=fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var rgt=document.createElement('span'); rgt.style.cssText='font-weight:700;color:#6633cc;'; rgt.textContent='+'+fmtAmtAbs(e.amount);
            row.appendChild(lft); row.appendChild(rgt);
            manLog.appendChild(row);
        });
        manSection.appendChild(manLog);
    }

    body.appendChild(manSection);

    // ── Кнопка закрытия смены ──
    var actions=document.createElement('div');
    actions.style.cssText='padding:0 20px 20px;';
    var closeShiftBtn=document.createElement('button');
    closeShiftBtn.style.cssText='padding:9px 20px;background:#cc2200;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;';
    closeShiftBtn.textContent='Закрыть смену';
    closeShiftBtn.addEventListener('click',function(){
        if(!confirm('Закрыть смену? Данные сохранятся в журнал.')) return;
        closeShift(loadCurrent(),'manual'); renderModal();
    });
    actions.appendChild(closeShiftBtn);
    body.appendChild(actions);
}

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
    [['Открыта','125px'],['Закрыта','125px'],['Наличные','90px'],['Карта','90px'],['Ручное','90px'],['Итого','90px']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 14px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
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

        var total=(s.cash||0)+(s.card||0)+(s.manual||0);
        [
            [fmtDate(s.openedAt),    'padding:9px 14px;font-size:12px;color:#555;white-space:nowrap;'],
            [s.closedAt?fmtDate(s.closedAt):'—', 'padding:9px 14px;font-size:12px;color:#888;white-space:nowrap;'],
            [fmtAmtAbs(s.cash),  'padding:9px 14px;color:#1a7a3c;font-weight:600;'],
            [fmtAmtAbs(s.card),  'padding:9px 14px;color:#0066cc;font-weight:600;'],
            [fmtAmtAbs(s.manual),'padding:9px 14px;color:#6633cc;font-weight:600;'],
            [fmtAmtAbs(total),   'padding:9px 14px;font-weight:800;color:#1a1a1a;'],
        ].forEach(function(col){
            var td=document.createElement('td'); td.style.cssText=col[1]; td.textContent=col[0]; tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
}

function showShiftDetail(s){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    document.body.appendChild(ov);

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:520px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.3);';

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var htxt=document.createElement('span'); htxt.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;';
    htxt.textContent='Смена: '+fmtDate(s.openedAt)+' → '+(s.closedAt?fmtDate(s.closedAt):'открыта');
    var hcls=document.createElement('button'); hcls.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#aaa;'; hcls.textContent='×'; hcls.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(htxt); hdr.appendChild(hcls);
    box.appendChild(hdr);

    // Итоги
    var sumRow=document.createElement('div');
    sumRow.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var total=(s.cash||0)+(s.card||0)+(s.manual||0);
    [['Наличные',fmtAmtAbs(s.cash),'#1a7a3c','#e6f9ee'],
     ['Карта',fmtAmtAbs(s.card),'#0066cc','#e0f0ff'],
     ['Ручное',fmtAmtAbs(s.manual),'#6633cc','#f0eaff'],
     ['Итого',fmtAmtAbs(total),'#1a1a1a','#f5f5f5']].forEach(function(r){
        var c=document.createElement('div');
        c.style.cssText='background:'+r[3]+';border-radius:8px;padding:10px 12px;';
        c.innerHTML='<div style="font-size:10px;color:'+r[2]+';font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">'+r[0]+'</div>'+
                    '<div style="font-size:18px;font-weight:800;color:#1a1a1a;">'+r[1]+'</div>';
        sumRow.appendChild(c);
    });
    box.appendChild(sumRow);

    // Лог ручных внесений
    var tw=document.createElement('div'); tw.style.cssText='overflow-y:auto;flex:1;min-height:0;padding:12px 20px;';
    var entries=s.manualEntries||[];
    if(entries.length){
        var ltitle=document.createElement('div');
        ltitle.style.cssText='font-size:11px;font-weight:700;color:#6633cc;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
        ltitle.textContent='Ручные внесения';
        tw.appendChild(ltitle);
        entries.forEach(function(e){
            var row=document.createElement('div');
            row.style.cssText='display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px;';
            var l=document.createElement('span'); l.style.cssText='color:#888;'; l.textContent=fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var r=document.createElement('span'); r.style.cssText='font-weight:700;color:#6633cc;'; r.textContent='+'+fmtAmtAbs(e.amount);
            row.appendChild(l); row.appendChild(r); tw.appendChild(row);
        });
    } else {
        tw.innerHTML='<div style="color:#ccc;font-size:13px;text-align:center;padding:20px;">Ручных внесений не было</div>';
    }
    box.appendChild(tw);

    ov.appendChild(box);
    document.addEventListener('keydown',function eh(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);}});
}

function showModal(){ if(!_modal)buildModal(); renderModal(); _modal.style.display='flex'; _overlay.style.display='block'; _isOpen=true; }
function hideModal(){ if(!_modal)return; _modal.style.display='none'; _overlay.style.display='none'; _isOpen=false; }
function updateModalIfOpen(){ if(_isOpen)renderModal(); }

// ── Кнопка в footer ───────────────────────────────────────
function updateBtnBadge(){
    var btn=document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var shift=loadCurrent();
    var dot=btn.querySelector('.gcb-dot');
    if(dot) dot.style.background=shift?'#1a7a3c':'#cc2200';
    var sum=btn.querySelector('.gcb-sum');
    if(sum){
        if(shift){
            var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0);
            sum.textContent=total>0?fmtAmtAbs(total):'Открыта';
        } else { sum.textContent='Закрыта'; }
    }
}

function createBtn(){
    if(document.getElementById('godji-cashbox-btn')) return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;

    var btn=document.createElement('button');
    btn.id='godji-cashbox-btn'; btn.type='button'; btn.title='Касса смены';
    btn.style.cssText='position:absolute;left:10px;top:50%;transform:translateY(-50%);height:30px;border-radius:7px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;gap:6px;cursor:pointer;color:rgba(255,255,255,0.7);transition:background 0.15s;z-index:200;padding:0 8px;font-family:inherit;max-width:130px;overflow:hidden;flex-shrink:0;';

    var dot=document.createElement('span');
    dot.className='gcb-dot';
    dot.style.cssText='width:7px;height:7px;border-radius:50%;flex-shrink:0;background:#cc2200;';

    var sum=document.createElement('span');
    sum.className='gcb-sum';
    sum.style.cssText='font-size:11px;font-weight:600;color:rgba(255,255,255,0.6);white-space:nowrap;';

    btn.appendChild(dot); btn.appendChild(sum);
    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.13)';});
    btn.addEventListener('mouseleave',function(){btn.style.background='rgba(255,255,255,0.07)';});
    btn.addEventListener('click',function(e){ e.stopPropagation(); if(_isOpen)hideModal(); else showModal(); });

    footer.style.position='relative';
    footer.appendChild(btn);
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

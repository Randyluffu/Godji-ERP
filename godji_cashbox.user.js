// ==UserScript==
// @name         Годжи — Касса смены
// @namespace    http://tampermonkey.net/
// @version      3.19
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cashbox.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_cashbox.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

// ── Блюр сумм ─────────────────────────────────────────────
var _valuesHidden = true;
// _blurDisabled сохраняется до закрытия смены (в localStorage), сбрасывается при открытии новой
var GCB_BLUR_KEY   = 'godji_cashbox_blur_off';
var GCB_ADMINS_KEY = 'godji_cashbox_admins';

function loadAdmins(){
    try{ var a=JSON.parse(localStorage.getItem(GCB_ADMINS_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(e){return [];}
}
function saveAdmins(arr){
    try{ localStorage.setItem(GCB_ADMINS_KEY, JSON.stringify(arr)); }catch(e){}
}
var _blurDisabled = (function(){ try{ return localStorage.getItem(GCB_BLUR_KEY)==='1'; }catch(e){return false;} })();

// Применяет/снимает блюр на все [data-cashval] внутри container.
// hidden=true  → блюр включён (hover снимает)
// hidden=false → блюр снят (hover не нужен)
// Если _blurDisabled=true — блюр не ставится совсем.
function applyModalBlur(container, hidden){
    if(!container) return;
    var effectiveHidden = !_blurDisabled && hidden;
    container.querySelectorAll('[data-cashval]').forEach(function(el){
        // Не клонируем — просто обновляем стили и флаг
        el.style.transition = 'filter 0.2s';
        if(effectiveHidden){
            el.style.filter = 'blur(5px)';
            el.style.userSelect = 'none';
            el.style.cursor = 'pointer';
            // Ставим флаг чтобы mouseenter/mouseleave читали актуальное состояние
            el._gcbBlurred = true;
        } else {
            el.style.filter = 'none';
            el.style.userSelect = '';
            el.style.cursor = '';
            el._gcbBlurred = false;
        }
    });
}

// Вешаем hover-обработчики один раз при создании элемента
function attachBlurHover(el){
    el.addEventListener('mouseenter', function(){
        if(el._gcbBlurred) el.style.filter='none';
    });
    el.addEventListener('mouseleave', function(){
        if(el._gcbBlurred) el.style.filter='blur(5px)';
    });
}

// Синхронизирует блюр суммы на кнопке в сайдбаре
function updateBtnBlurState(){
    var sumEl = document.querySelector('#godji-cashbox-btn .gcb-sum');
    if(!sumEl) return;
    if(_blurDisabled){
        sumEl.style.filter='none';
        sumEl.onmouseenter=null;
        sumEl.onmouseleave=null;
    } else {
        sumEl.style.filter='blur(4px)';
        sumEl.onmouseenter=function(){sumEl.style.filter='none';};
        sumEl.onmouseleave=function(){if(!_blurDisabled)sumEl.style.filter='blur(4px)';};
    }
}



var STORAGE_KEY = 'godji_cashbox';
var SHIFTS_KEY  = 'godji_shifts';

// Структура смены:
// { id, openedAt, openedBy, cash, card, manual, withdrawal, debit,
//   manualEntries:[{ts, amount, comment, type:'in'|'out'|'debit'}] }

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

// ── Перехват fetch через inline <script> + CustomEvent ────
// Используем нативный fetch напрямую через XMLHttpRequest-уровень
// чтобы избежать infinite loop при множественных fetch-обёртках
(function injectPageScript(){
    var code = [
        '(function(){',
        '  if(window.__gcbInjected) return; window.__gcbInjected=true;',
        '  // Сохраняем НАТИВНЫЙ fetch до любых оберток через XMLHttpRequest',
        '  // Используем guard флаг против рекурсии',
        '  var _f = window.fetch;',
        '  window.fetch = function(url, opts){',
        '    if(window.__gcbDepth>0) return _f.apply(this, arguments);',
        '    window.__gcbDepth=(window.__gcbDepth||0)+1;',
        '    var p = _f.apply(this, arguments);',
        '    window.__gcbDepth--;',
        '    if(url && typeof url==="string" && url.indexOf("hasura.godji.cloud")!==-1){',
        '      var b=""; try{b=(opts&&opts.body)||"";}catch(e){}',
        '      var hdrs={}; try{hdrs=(opts&&opts.headers)||{};}catch(e){}',
        '      p = p.then(function(r){',
        '        r.clone().json().then(function(d){',
        '          document.dispatchEvent(new CustomEvent("__gcb__",{detail:{req:b,res:d,auth:hdrs.authorization||"",role:hdrs["x-hasura-role"]||""}}));',
        '        }).catch(function(){});',
        '        return r;',
        '      });',
        '    }',
        '    return p;',
        '  };',
        '})();'
    ].join('\n');
    var s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
})();

var _authToken = null;
var _hasuraRole = 'club_admin';

// ── Синхронизация между вкладками ────────────────────────
// Когда в другой вкладке изменяется localStorage — сразу обновляем UI
window.addEventListener('storage', function(e){
    if(e.key === STORAGE_KEY || e.key === SHIFTS_KEY){
        updateBtnBadge();
        updateModalIfOpen();
    }
});

// ── Мьютекс для processWalletOps ─────────────────────────
var _processing = false;

// ── Детектор аномалий ─────────────────────────────────────
// Логика: дубль = та же сумма + тот же тип в течение 15 сек.
// 15 сек — потому что за это время два разных клиента вряд ли
// пополнят одинаково, а баг ERP обычно создаёт дубль мгновенно.
var _recentDeposits = []; // [{ts, amount, moneyType, opId}]
var DUP_WINDOW_MS = 15000;

function checkAnomaly(amount, moneyType, opId){
    var now = Date.now();
    _recentDeposits = _recentDeposits.filter(function(d){ return now - d.ts < DUP_WINDOW_MS; });

    // Ищем совпадение по сумме И типу в окне 15 сек
    var dup = null;
    for(var i = 0; i < _recentDeposits.length; i++){
        var d = _recentDeposits[i];
        if(d.amount === amount && d.moneyType === moneyType){
            dup = d; break;
        }
    }

    _recentDeposits.push({ ts: now, amount: amount, moneyType: moneyType, opId: opId });

    if(dup){
        var secAgo = Math.round((now - dup.ts) / 1000);
        showAnomalyAlert(
            'Возможный дубль: ' + amount + '₽ (' + (moneyType==='cash'?'нал':'карта') + ')'
            + ' — такое же пополнение было ' + secAgo + ' сек назад (оп #' + dup.opId + ')'
        );
    }
}

function showAnomalyAlert(msg){
    if(document.getElementById('gcb-anomaly-toast')) return;
    var t = document.createElement('div');
    t.id = 'gcb-anomaly-toast';
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:999999;'
        + 'background:#7c1a1a;border:1px solid #dc2626;border-radius:10px;'
        + 'padding:12px 18px;color:#fff;font-size:13px;font-weight:600;'
        + 'box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:inherit;'
        + 'display:flex;align-items:center;gap:10px;max-width:480px;cursor:default;';
    t.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
        + '<span>' + msg + '</span>'
        + '<button onclick="this.parentNode.remove()" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:18px;padding:0 0 0 10px;line-height:1;">×</button>';
    document.body.appendChild(t);
    setTimeout(function(){ if(t.parentNode) t.remove(); }, 10000);
}

document.addEventListener('__gcb__', function(e){
    try{
        var detail = e.detail;
        if(detail.auth) _authToken = detail.auth;
        if(detail.role) _hasuraRole = detail.role;
        onApi(detail.req, detail.res);
    }catch(err){}
});

// ── Слушаем списания от godji_wallet_debit ────────────────
document.addEventListener('__godji_debit__', function(e){
    try{
        var d = e.detail;
        if(!d || !d.amount) return;
        var shift = loadCurrent();
        if(!shift) return;
        shift.debit = (shift.debit || 0) + d.amount;
        shift.manualEntries = shift.manualEntries || [];
        shift.manualEntries.unshift({
            ts: d.ts || Date.now(),
            amount: d.amount,
            comment: d.comment || '',
            type: 'debit'
        });
        saveCurrent(shift);
        updateBtnBadge();
        updateModalIfOpen();
    }catch(err){}
});

// ── Обработка ответов API ─────────────────────────────────
function onApi(reqBody, data){
    if(!data || !data.data) return;
    var d = data.data;
    var body = {}, op = '';
    try{
        body = typeof reqBody === 'string' ? JSON.parse(reqBody) : (reqBody || {});
        op   = body.operationName || '';
    }catch(e){ return; }

    // wallet_operations — только из НАШЕГО запроса GCBOps, не из GetClientPurchases
    // Различаем по operationName
    if(op === 'GCBOps' && d.wallet_operations && Array.isArray(d.wallet_operations)){
        processWalletOps(d.wallet_operations);
    }

    // Мутация пополнения — триггерим немедленный запрос
    if(d.walletDepositWithCash || d.walletDeposit){
        setTimeout(fetchLatestOps, 400);
    }

    // Открытие смены
    if(d.openShift || d.createShift || d.startShift ||
       op.indexOf('OpenShift') !== -1 || op.indexOf('StartShift') !== -1){
        if(!loadCurrent()){
            var s2 = d.openShift || d.createShift || d.startShift || {};
            pickAdminAndOpen(function(nick){
                var newShift={id: s2.id||('s_'+Date.now()), openedAt:Date.now(), openedBy:'erp',
                             adminNick: nick,
                             cash:0, card:0, manual:0, withdrawal:0, manualEntries:[],
                             seenOpIds:[]};
                saveCurrent(newShift);
                initMaxId(newShift, function(){ saveCurrent(newShift); });
                updateBtnBadge(); updateModalIfOpen();
            });
        }
    }

    // Закрытие смены
    if(d.closeShift || d.finishShift || d.endShift ||
       op.indexOf('CloseShift') !== -1 || op.indexOf('EndShift') !== -1){
        var cur = loadCurrent(); if(cur) closeShift(cur, 'erp');
    }
}

// ── Запрос новых операций ─────────────────────────────────
// Запрос по ID — надёжнее чем по времени (нет пропусков)
var GQL_OPS = 'query GCBOps($sinceId:Int!,$clubId:Int!){wallet_operations(where:{id:{_gt:$sinceId},club_id:{_eq:$clubId},operation_type:{_eq:"deposit"},amount_type:{_eq:"money"}},order_by:{id:asc},limit:100){id money_type amount created_at wallet_operation_digest{name}}}';

// Инициализация — найти максимальный id на момент открытия смены
function initMaxId(shift, cb){
    if(!_authToken){ setTimeout(function(){ initMaxId(shift, cb); }, 1000); return; }
    // Берём максимальный id из seenOpIds если есть
    if(shift.seenOpIds && shift.seenOpIds.length > 0){
        shift._maxSeenId = Math.max.apply(null, shift.seenOpIds);
        cb(); return;
    }
    // Иначе запрашиваем последний id до момента открытия смены
    var openedAt = new Date(shift.openedAt).toISOString();
    window.fetch('https://hasura.godji.cloud/v1/graphql', {
        method: 'POST',
        headers: { 'authorization': _authToken, 'content-type': 'application/json', 'x-hasura-role': _hasuraRole },
        body: JSON.stringify({
            operationName: 'GCBInit',
            query: 'query GCBInit($clubId:Int!,$before:timestamptz!){wallet_operations(where:{club_id:{_eq:$clubId},created_at:{_lte:$before}},order_by:{id:desc},limit:1){id}}',
            variables: { clubId: 14, before: openedAt }
        })
    }).then(function(r){ return r.json(); }).then(function(data){
        var ops = data && data.data && data.data.wallet_operations;
        shift._maxSeenId = ops && ops.length > 0 ? ops[0].id : 0;
        cb();
    }).catch(function(){ shift._maxSeenId = 0; cb(); });
}

function fetchLatestOps(){
    if(!_authToken) return;
    var shift = loadCurrent();
    if(!shift) return;
    // Если maxSeenId ещё не инициализирован — ждём
    if(shift._maxSeenId === undefined){
        initMaxId(shift, function(){ saveCurrent(shift); fetchLatestOps(); });
        return;
    }
    window.fetch('https://hasura.godji.cloud/v1/graphql', {
        method: 'POST',
        headers: { 'authorization': _authToken, 'content-type': 'application/json', 'x-hasura-role': _hasuraRole },
        body: JSON.stringify({
            operationName: 'GCBOps',
            variables: { sinceId: shift._maxSeenId, clubId: 14 },
            query: GQL_OPS
        })
    }).then(function(r){ return r.json(); })
    .then(function(data){
        if(data && data.data && data.data.wallet_operations){
            processWalletOps(data.data.wallet_operations);
        }
    }).catch(function(){});
}

// Polling каждые 10 сек
setInterval(fetchLatestOps, 10000);

// Возвраты которые ERP делает автоматически — не считаем как пополнения кассы
var REFUND_KEYWORDS = ['возврат', 'refund', 'return'];
function isSystemRefund(op){
    var name = (op.wallet_operation_digest && op.wallet_operation_digest.name) || '';
    var nl = name.toLowerCase();
    for(var i=0; i<REFUND_KEYWORDS.length; i++){
        if(nl.indexOf(REFUND_KEYWORDS[i]) !== -1) return true;
    }
    return false;
}

function processWalletOps(ops){
    if(_processing) return;
    _processing = true;
    try{
        var shift = loadCurrent();
        if(!shift){ _processing = false; return; }
        shift.seenOpIds = shift.seenOpIds || [];
        shift._maxSeenId = shift._maxSeenId || 0;
        var seenSet = {};
        shift.seenOpIds.forEach(function(id){ seenSet[id] = true; });
        var changed = false;

        ops.forEach(function(op){
            if(op.id > shift._maxSeenId) shift._maxSeenId = op.id;

            if(op.amount <= 0) return;
            if(seenSet[op.id]) return;

            if(isSystemRefund(op)){
                seenSet[op.id] = true;
                shift.seenOpIds.push(op.id);
                changed = true;
                return;
            }

            seenSet[op.id] = true;
            shift.seenOpIds.push(op.id);

            // Округляем до копеек чтобы избежать float drift
            var amt = Math.round(op.amount * 100) / 100;

            // Проверяем аномалию
            checkAnomaly(amt, op.money_type, op.id);

            if(op.money_type === 'cash'){
                shift.cash = Math.round(((shift.cash||0) + amt) * 100) / 100;
            } else {
                shift.card = Math.round(((shift.card||0) + amt) * 100) / 100;
            }
            changed = true;
        });

        if(changed){
            saveCurrent(shift);
            updateBtnBadge();
            updateModalIfOpen();
        }
    }finally{
        _processing = false;
    }
}

// ── Напоминание о закрытии смены (21:00 и 09:00) ─────────
var _reminderActive = false;
var _reminderInterval = null;
var _shiftPopupShown = false;

function checkShiftReminder(){
    var h = new Date().getHours();
    var m = new Date().getMinutes();
    var isReminderTime = (h === 21 && m === 0) || (h === 9 && m === 0);
    var shift = loadCurrent();

    if(isReminderTime && shift && !_reminderActive){
        _reminderActive = true;
        startBtnPulse();
    } else if(!isReminderTime && _reminderActive){
        _reminderActive = false;
        stopBtnPulse();
    }

    // Всплывашка если смена не открыта в рабочее время
    var isWorkTime = (h >= 9 && h <= 20) || (h >= 21 || h <= 8);
    if(!shift && isWorkTime && !_shiftPopupShown){
        _shiftPopupShown = true;
        showShiftOpenPopup();
    }
    if(shift && _shiftPopupShown) _shiftPopupShown = false;
}

function showShiftOpenPopup(){
    if(document.getElementById('gcb-open-popup')) return;
    var pop = document.createElement('div');
    pop.id = 'gcb-open-popup';
    pop.style.cssText = 'position:fixed;bottom:80px;left:290px;z-index:99999;background:#1a1b2e;border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:16px 20px;width:260px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:inherit;';
    pop.innerHTML =
        '<div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:6px;">⚠️ Смена не открыта</div>'+
        '<div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:14px;">Откройте смену чтобы начать учёт кассы</div>'+
        '<div style="display:flex;gap:8px;">'+
        '<button id="gcb-pop-open" style="flex:1;padding:8px;background:#166534;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Открыть смену</button>'+
        '<button id="gcb-pop-close" style="padding:8px 12px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);border:none;border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit;">✕</button>'+
        '</div>';
    document.body.appendChild(pop);
    document.getElementById('gcb-pop-open').addEventListener('click', function(){
        pickAdminAndOpen(function(nick){ openShiftManual(nick); pop.remove(); updateBtnBadge(); updateModalIfOpen(); });
    });
    document.getElementById('gcb-pop-close').addEventListener('click', function(){ pop.remove(); });
    // Автоскрытие через 30 сек
    setTimeout(function(){ if(pop.parentNode) pop.remove(); }, 30000);
}

function startBtnPulse(){
    stopBtnPulse();
    var btn = document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var ico = btn.querySelector('div[style*="background"]');
    var phase = false;
    _reminderInterval = setInterval(function(){
        var b = document.getElementById('godji-cashbox-btn');
        if(!b){ stopBtnPulse(); return; }
        var i = b.querySelector('div[style*="background:#166"]') ||
                b.querySelector('.LinksGroup_themeIcon__E9SRO');
        if(!i) return;
        phase = !phase;
        i.style.background = phase ? '#dc2626' : '#166534';
        i.style.boxShadow  = phase ? '0 0 10px rgba(220,38,38,0.7)' : '';
    }, 700);
}

function stopBtnPulse(){
    if(_reminderInterval){ clearInterval(_reminderInterval); _reminderInterval = null; }
    var btn = document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var i = btn.querySelector('.LinksGroup_themeIcon__E9SRO');
    if(i){ i.style.background='#166534'; i.style.boxShadow=''; }
}

setInterval(checkShiftReminder, 30000); // проверяем каждые 30 сек

// ── Слушаем кнопку "Открыть смену" в ERP ─────────────────
function watchShiftBtn(){
    // Кнопка смены в .Shifts_shiftsPaper__9Jml_ (блок с часами), не в header
    var paper = document.querySelector('.Shifts_shiftsPaper__9Jml_');
    if(!paper) return;
    paper.querySelectorAll('button').forEach(function(b){
        if(b._gcbShiftWatched) return;
        b._gcbShiftWatched = true;
        b.addEventListener('click', function(){
            var txt = (b.textContent || '').toLowerCase().trim();
            if(txt.indexOf('открыт') !== -1 && txt.indexOf('смен') !== -1){
                // Нажата "Открыть смену" — ждём 1.5 сек, затем синхронизируем кассу
                setTimeout(function(){
                    if(!loadCurrent()){
                        pickAdminAndOpen(function(nick){
                            var shift = {id:'s_'+Date.now(), openedAt:Date.now(), openedBy:'erp',
                                         adminNick: nick,
                                         cash:0, card:0, manual:0, withdrawal:0, manualEntries:[], seenOpIds:[]};
                            saveCurrent(shift);
                            initMaxId(shift, function(){ saveCurrent(shift); });
                            updateBtnBadge(); updateModalIfOpen();
                        });
                    }
                }, 1500);
            } else if(txt.indexOf('закрыт') !== -1 && txt.indexOf('смен') !== -1){
                // Нажата "Закрыть смену"
                setTimeout(function(){
                    var cur = loadCurrent();
                    if(cur) closeShift(cur, 'erp');
                }, 2000);
            }
        });
    });
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
    // Сбрасываем отключение скрытия при закрытии смены
    try{ localStorage.removeItem(GCB_BLUR_KEY); }catch(ex){}
    _blurDisabled=false;
    updateBtnBadge(); updateModalIfOpen();
}

function openShiftManual(adminNick){
    if(loadCurrent()) return;
    var shift={id:'s_'+Date.now(),openedAt:Date.now(),openedBy:'manual',
               adminNick: adminNick||'',
               cash:0,card:0,manual:0,withdrawal:0,manualEntries:[],seenOpIds:[]};
    saveCurrent(shift);
    initMaxId(shift, function(){ saveCurrent(shift); });
    updateBtnBadge(); updateModalIfOpen();
}

// Выбор админа перед открытием смены
function pickAdminAndOpen(onPicked){
    var admins = loadAdmins();
    if(!admins.length){
        // Нет админов — предлагаем добавить
        var nick = prompt('Нет добавленных админов.\nВведите ник первого админа:','');
        if(!nick||!nick.trim()) return;
        nick = nick.trim();
        admins.push(nick); saveAdmins(admins);
    }
    if(admins.length === 1){
        onPicked(admins[0]); return;
    }
    // Модалка выбора
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100010;display:flex;align-items:center;justify-content:center;';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:320px;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:inherit;';
    var title=document.createElement('div');
    title.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;';
    title.textContent='Кто открывает смену?';
    box.appendChild(title);
    admins.forEach(function(nick){
        var btn=document.createElement('button');
        btn.style.cssText='display:block;width:100%;text-align:left;padding:10px 14px;margin-bottom:6px;background:#f4f4f4;border:1px solid #e8e8e8;border-radius:8px;font-size:13px;font-weight:600;color:#1a1a1a;cursor:pointer;font-family:inherit;transition:background 0.1s;';
        btn.textContent=nick;
        btn.addEventListener('mouseenter',function(){btn.style.background='#e8f5e9';btn.style.borderColor='#bbf7d0';});
        btn.addEventListener('mouseleave',function(){btn.style.background='#f4f4f4';btn.style.borderColor='#e8e8e8';});
        btn.addEventListener('click',function(){ ov.remove(); onPicked(nick); });
        box.appendChild(btn);
    });
    var cancelBtn=document.createElement('button');
    cancelBtn.style.cssText='display:block;width:100%;text-align:center;padding:8px;background:none;border:none;font-size:12px;color:#aaa;cursor:pointer;font-family:inherit;margin-top:4px;';
    cancelBtn.textContent='Отмена';
    cancelBtn.addEventListener('click',function(){ov.remove();});
    box.appendChild(cancelBtn);
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    ov.appendChild(box); document.body.appendChild(ov);
    document.addEventListener('keydown',function eh(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);}});
}

// ── Модалка ───────────────────────────────────────────────
var _modal=null, _overlay=null, _isOpen=false, _tab='current';

function buildModal(){
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;pointer-events:auto;overscroll-behavior:contain;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);

    _modal=document.createElement('div');
    _modal.id='godji-cashbox-modal';
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:720px;max-width:96vw;max-height:90vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
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
        var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0)-(shift.debit||0);
        var tBadge=document.createElement('span');
        tBadge.setAttribute('data-cashval','1');
        tBadge.style.cssText='font-size:18px;font-weight:800;color:#1a1a1a;margin-left:2px;';
        tBadge.textContent=fmtAmtAbs(total);
        attachBlurHover(tBadge);
        // Ник админа рядом с суммой в шапке
        if(shift && shift.adminNick){
            var adminSpan=document.createElement('span');
            adminSpan.style.cssText='display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:2px 10px;margin-right:8px;white-space:nowrap;';
            adminSpan.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'+shift.adminNick;
            tw.appendChild(adminSpan);
        }
        // Кнопка глаза (hover-блюр вкл/выкл)
        var hdrEye=document.createElement('button');
        hdrEye.style.cssText='background:none;border:none;cursor:pointer;color:#bbb;padding:2px 4px;display:flex;align-items:center;margin-left:4px;transition:color 0.15s;';
        function setEyeIcon(hidden){
            hdrEye.title=hidden?'Показать суммы':'Скрыть суммы';
            hdrEye.innerHTML=hidden
                ?'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
                :'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
        setEyeIcon(_valuesHidden);
        hdrEye.addEventListener('click',function(e){
            e.stopPropagation();
            _valuesHidden=!_valuesHidden;
            applyModalBlur(_modal,_valuesHidden);
            setEyeIcon(_valuesHidden);
        });

        // Кнопка "выключить блюр совсем" — текстовая, сбрасывается при переоткрытии
        var hdrNoBlur=document.createElement('button');
        hdrNoBlur.style.cssText='background:none;border:none;cursor:pointer;padding:2px 8px;margin-left:4px;font-size:11px;font-weight:600;border-radius:4px;transition:background 0.15s,color 0.15s;font-family:inherit;white-space:nowrap;';
        function setNoBlurState(){
            if(_blurDisabled){
                hdrNoBlur.textContent='Скрытие: выкл';
                hdrNoBlur.style.color='#166534';
                hdrNoBlur.style.background='#dcfce7';
                hdrNoBlur.title='Включить скрытие сумм';
            } else {
                hdrNoBlur.textContent='Скрытие: вкл';
                hdrNoBlur.style.color='#888';
                hdrNoBlur.style.background='rgba(0,0,0,0.05)';
                hdrNoBlur.title='Выключить скрытие сумм (до новой смены)';
            }
        }
        setNoBlurState();
        hdrNoBlur.addEventListener('click',function(e){
            e.stopPropagation();
            _blurDisabled=!_blurDisabled;
            try{ if(_blurDisabled) localStorage.setItem(GCB_BLUR_KEY,'1');
                 else localStorage.removeItem(GCB_BLUR_KEY); }catch(ex){}
            if(_blurDisabled){
                // Выключаем скрытие — показываем всё
                _valuesHidden=false;
            } else {
                // Включаем скрытие обратно — сразу блюрим
                _valuesHidden=true;
            }
            applyModalBlur(_modal, _valuesHidden);
            setEyeIcon(_valuesHidden);
            setNoBlurState();
            updateBtnBlurState();
        });

        tw.appendChild(tBadge); tw.appendChild(hdrEye); tw.appendChild(hdrNoBlur);
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
        tb.addEventListener('click',function(){
            _tab=t[0];
            renderModal();
            // Восстанавливаем состояние блюра после перерисовки
            setTimeout(function(){ applyModalBlur(_modal, _valuesHidden); }, 10);
        });
        tabs.appendChild(tb);
    });
    _modal.appendChild(tabs);

    var body=document.createElement('div');
    body.style.cssText='overflow-y:auto;overscroll-behavior:contain;flex:1;min-height:0;';
    _modal.appendChild(body);

    if(_tab==='current') renderCurrentTab(body, shift);
    else renderHistoryTab(body);
}


// ── Диагностика кассы ─────────────────────────────────────
function runCashboxDebug(){
    var shift = loadCurrent();
    if(!shift){ alert('Смена не открыта'); return; }
    if(!_authToken){ alert('Нет токена авторизации. Дождитесь загрузки страницы.'); return; }
    if(!shift.seenOpIds||!shift.seenOpIds.length){ alert('В кассе нет учтённых операций.'); return; }

    showDebugPopup('Загружаю операции…', null, null, null);

    window.fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':_authToken,'content-type':'application/json','x-hasura-role':_hasuraRole},
        body:JSON.stringify({query:'query{wallet_operations(where:{id:{_in:'+JSON.stringify(shift.seenOpIds)+'},club_id:{_eq:14}},order_by:{id:asc}){id amount money_type operation_type created_at user_id user{phone users_user_profile{name surname login}}wallet_operation_digest{name}}}'})
    }).then(function(r){return r.json();}).then(function(data){
        var ops = data&&data.data&&data.data.wallet_operations;
        if(!ops){ showDebugPopup('Ошибка запроса', null, null, null); return; }

        var cashOk=0, cardOk=0;
        var refunds=[];
        var allOps=[];

        ops.forEach(function(op){
            var name=(op.wallet_operation_digest&&op.wallet_operation_digest.name)||'';
            var nl=name.toLowerCase();
            var isRef=REFUND_KEYWORDS.some(function(k){return nl.indexOf(k)!==-1;});
            var p=op.user&&op.user.users_user_profile;
            var nick=p?(p.login?'@'+p.login:((p.name||'')+(p.surname?' '+p.surname:'')).trim()):'';
            var userId=op.user_id||'';
            var ts=new Date(op.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

            allOps.push({id:op.id,amount:op.amount,moneyType:op.money_type,nick:nick,userId:userId,ts:ts,name:name,isRef:isRef});

            if(isRef){
                refunds.push({id:op.id,amount:op.amount,nick:nick,userId:userId,ts:ts,name:name,moneyType:op.money_type});
            } else if(op.amount>0&&op.operation_type==='deposit'){
                if(op.money_type==='cash') cashOk+=op.amount;
                else cardOk+=op.amount;
            }
        });

        var cashDiff=Math.round(((shift.cash||0)-cashOk)*100)/100;
        var cardDiff=Math.round(((shift.card||0)-cardOk)*100)/100;
        var hasError=Math.abs(cashDiff)>0.5||Math.abs(cardDiff)>0.5;

        // Автоисправление если в кассе засчитаны возвраты
        var fixCash=0,fixCard=0;
        if(hasError&&refunds.length>0){
            refunds.forEach(function(r){
                if(r.moneyType==='cash') fixCash+=r.amount;
                else fixCard+=r.amount;
            });
            if(fixCash>0||fixCard>0){
                shift.cash=Math.max(0,(shift.cash||0)-fixCash);
                shift.card=Math.max(0,(shift.card||0)-fixCard);
                saveCurrent(shift);
                updateBtnBadge(); updateModalIfOpen();
            }
        }

        var status = hasError&&refunds.length>0 ? 'fixed' :
                     hasError ? 'error' :
                     refunds.length>0 ? 'warn' : 'ok';
        showDebugPopup(status, allOps, refunds,
            {cashDiff:cashDiff,cardDiff:cardDiff,fixCash:fixCash,fixCard:fixCard,
             cashOk:cashOk,cardOk:cardOk,cashTotal:shift.cash,cardTotal:shift.card});
    }).catch(function(e){
        showDebugPopup('error_fetch', null, null, {msg:e.message});
    });
}

function showDebugPopup(status, allOps, refunds, diff){
    var old=document.getElementById('gcb-debug-popup');
    if(old)old.remove();

    var ov=document.createElement('div');
    ov.id='gcb-debug-popup';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100001;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){ if(e.target!==ov) return; var dep=document.getElementById('gcb-deposits-box'); if(dep){dep.remove();return;} ov.remove(); });

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:720px;max-width:96vw;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:inherit;';

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var ht=document.createElement('span');
    ht.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;';
    ht.textContent='🔍 Диагностика кассы';
    var hdrRight=document.createElement('div');
    hdrRight.style.cssText='display:flex;align-items:center;gap:8px;';

    var depBtn=document.createElement('button');
    depBtn.style.cssText='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;color:#166534;font-size:12px;font-weight:600;cursor:pointer;padding:5px 10px;font-family:inherit;display:flex;align-items:center;gap:5px;';
    depBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>Пополнения';
    depBtn.addEventListener('click',function(){ showShiftDeposits(s); });

    var hc=document.createElement('button');
    hc.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#bbb;';
    hc.textContent='×'; hc.addEventListener('click',function(){ov.remove();});
    hdrRight.appendChild(depBtn); hdrRight.appendChild(hc);
    hdr.appendChild(ht); hdr.appendChild(hdrRight);
    box.appendChild(hdr);

    var body=document.createElement('div');
    body.style.cssText='padding:14px 20px;overflow-y:auto;flex:1;';

    // Статус-плашка
    if(status==='loading'||status==='Загружаю операции…'){
        var sl=document.createElement('div');
        sl.style.cssText='padding:10px 14px;border-radius:8px;background:#f0f0f0;color:#555;font-size:13px;font-weight:600;margin-bottom:12px;';
        sl.textContent='⏳ '+status; body.appendChild(sl);
    } else {
        var statusTxt = status==='ok'?'✅ Касса в норме. Расхождений нет.' :
                        status==='fixed'?'🔧 Обнаружены возвраты ERP — исправлено' :
                        status==='warn'?'⚠️ Возвраты ERP в seenOpIds (исключены из суммы)' :
                        status==='error'?'❌ Расхождение (причина не определена)' :
                        status==='error_fetch'?'❌ Ошибка запроса: '+(diff&&diff.msg||'') : status;
        var statusBg = status==='ok'?'#dcfce7;color:#166534':
                       status==='fixed'?'#fff4e0;color:#c87800':
                       status==='warn'?'#fef3c7;color:#92400e':
                       '#fee2e2;color:#991b1b';
        var sl2=document.createElement('div');
        sl2.style.cssText='padding:10px 14px;border-radius:8px;background:'+statusBg+';font-size:13px;font-weight:600;margin-bottom:10px;';
        sl2.textContent=statusTxt; body.appendChild(sl2);
    }

    // Итоги
    if(diff&&diff.cashOk!==undefined){
        var tot=document.createElement('div');
        tot.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;';
        [['Нал. в кассе',fmtAmtAbs(diff.cashTotal),'#166534','#dcfce7'],
         ['Карта в кассе',fmtAmtAbs(diff.cardTotal),'#1d4ed8','#dbeafe']].forEach(function(r){
            var c2=document.createElement('div');
            c2.style.cssText='background:'+r[3]+';border-radius:6px;padding:8px 10px;';
            c2.innerHTML='<div style="font-size:9px;color:'+r[2]+';font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">'+r[0]+'</div><div style="font-size:15px;font-weight:800;color:#1a1a1a;">'+r[1]+'</div>';
            tot.appendChild(c2);
        });
        body.appendChild(tot);
        if(Math.abs(diff.cashDiff)>0.5||Math.abs(diff.cardDiff)>0.5){
            var dEl=document.createElement('div');
            dEl.style.cssText='font-size:12px;color:#991b1b;margin-bottom:10px;font-weight:600;';
            dEl.textContent='Расхождение: нал '+(diff.cashDiff>0?'+':'')+Math.round(diff.cashDiff)+'₽, карта '+(diff.cardDiff>0?'+':'')+Math.round(diff.cardDiff)+'₽';
            if(diff.fixCash||diff.fixCard) dEl.textContent+=' | Исправлено: −'+Math.round(diff.fixCash||0)+'₽ нал, −'+Math.round(diff.fixCard||0)+'₽ карта';
            body.appendChild(dEl);
        }
    }

    // Все операции смены
    if(allOps&&allOps.length){
        var opTitle=document.createElement('div');
        opTitle.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
        opTitle.textContent='Все операции смены ('+allOps.length+')';
        body.appendChild(opTitle);

        var tbl=document.createElement('table');
        tbl.style.cssText='width:100%;border-collapse:collapse;font-size:12px;';
        var thead=document.createElement('thead');
        var thr=document.createElement('tr');
        thr.style.cssText='background:#f9f9f9;';
        [['Время','60px'],['Клиент','',''],['Тип','55px'],['Сумма','70px'],['Примечание','']].forEach(function(col){
            var th=document.createElement('th');
            th.style.cssText='padding:6px 8px;text-align:left;color:#888;font-weight:600;font-size:10px;border-bottom:1px solid #eee;white-space:nowrap;'+(col[1]?'width:'+col[1]+';':'');
            th.textContent=col[0]; thr.appendChild(th);
        });
        thead.appendChild(thr); tbl.appendChild(thead);

        var tbody=document.createElement('tbody');
        allOps.forEach(function(op){
            var tr=document.createElement('tr');
            tr.style.cssText='border-bottom:1px solid #f5f5f5;'+(op.isRef?'background:#fffbeb;':'');

            var tdTime=document.createElement('td'); tdTime.style.cssText='padding:6px 8px;color:#888;white-space:nowrap;'; tdTime.textContent=op.ts;
            var tdNick=document.createElement('td'); tdNick.style.cssText='padding:6px 8px;max-width:140px;';
            if(op.nick&&op.userId){
                var lk=document.createElement('a'); lk.href='/clients/'+op.userId; lk.style.cssText='color:#0066aa;text-decoration:none;font-weight:600;font-size:11px;'; lk.textContent=op.nick;
                lk.addEventListener('mouseenter',function(){lk.style.textDecoration='underline';}); lk.addEventListener('mouseleave',function(){lk.style.textDecoration='none';});
                tdNick.appendChild(lk);
            } else { tdNick.textContent='—'; tdNick.style.color='#ccc'; }
            var tdType=document.createElement('td'); tdType.style.cssText='padding:6px 8px;white-space:nowrap;';
            var typeBadge=document.createElement('span');
            typeBadge.style.cssText='font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;'+(op.moneyType==='cash'?'background:#dcfce7;color:#166534;':'background:#dbeafe;color:#1d4ed8;');
            typeBadge.textContent=op.moneyType==='cash'?'НАЛ':'КАРТА'; tdType.appendChild(typeBadge);
            var tdAmt=document.createElement('td'); tdAmt.style.cssText='padding:6px 8px;font-weight:700;white-space:nowrap;color:'+(op.isRef?'#b45309':'#166534')+';'; tdAmt.textContent=(op.isRef?'↩ ':'')+'+'+Math.round(op.amount)+'₽';
            var tdNote=document.createElement('td'); tdNote.style.cssText='padding:6px 8px;color:#aaa;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; tdNote.textContent=op.name.slice(0,40)||(op.isRef?'⚠️ Возврат ERP':'');

            tr.appendChild(tdTime); tr.appendChild(tdNick); tr.appendChild(tdType); tr.appendChild(tdAmt); tr.appendChild(tdNote);
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody); body.appendChild(tbl);
    }

    box.appendChild(body);
    ov.appendChild(box);
    document.body.appendChild(ov);
    document.addEventListener('keydown',function eh(e){ if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);} });
}

// ── Текущая смена ─────────────────────────────────────────
function renderCurrentTab(body, shift){
    if(!shift){
        var empty=document.createElement('div');
        empty.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 20px;gap:20px;';

        // Иконка
        var eIco=document.createElement('div');
        eIco.style.cssText='width:56px;height:56px;border-radius:14px;background:#fee2e2;display:flex;align-items:center;justify-content:center;';
        eIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/></svg>';

        var eTxt=document.createElement('div');
        eTxt.style.cssText='text-align:center;';
        eTxt.innerHTML='<div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:6px;">Смена не открыта</div>'+
                       '<div style="font-size:13px;color:#aaa;">Откройте смену через ERP или вручную,<br>чтобы начать учёт кассы</div>';

        var btnWrap=document.createElement('div');
        btnWrap.style.cssText='display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';

        // Кнопка ручного открытия
        var openBtn=document.createElement('button');
        openBtn.style.cssText='padding:10px 24px;background:#166534;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:7px;';
        openBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Открыть смену вручную';
        openBtn.addEventListener('click',function(){
            pickAdminAndOpen(function(nick){ openShiftManual(nick); updateBtnBadge(); updateModalIfOpen(); });
            renderModal();
        });

        // Подсказка что смену можно открыть через ERP
        var erpHint=document.createElement('div');
        erpHint.style.cssText='font-size:11px;color:#bbb;text-align:center;';
        erpHint.innerHTML='Или нажмите <b style="color:#888">«Открыть смену»</b> в сайдбаре ERP — касса синхронизируется автоматически';

        empty.appendChild(eIco);
        empty.appendChild(eTxt);
        btnWrap.appendChild(openBtn);
        empty.appendChild(btnWrap);
        empty.appendChild(erpHint);
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
        val.setAttribute('data-cashval','1');
        val.style.cssText='font-size:22px;font-weight:800;color:#1a1a1a;';
        val.textContent=value;
        attachBlurHover(val);
        c.appendChild(top); c.appendChild(val);
        return c;
    }

    var ICO={
        cash:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/></svg>',
        card:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        plus:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        out:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
        debit:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1-3.5 3.5h-1a3.5 3.5 0 0 1-3.5-3.5a1.5 1.5 0 0 1 1.5-1.5"/><path d="M12.5 21h-4.5a4 4 0 0 1-4-4v-1a8 8 0 0 1 14-5.5"/><line x1="16" y1="19" x2="22" y2="19"/></svg>',
    };

    // Карточки — 3 колонки в первом ряду, потом остальные
    cards.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:16px 20px 12px;';
    cards.appendChild(mkCard('Наличные',    fmtAmtAbs(shift.cash),       '#166534','#dcfce7', ICO.cash));
    cards.appendChild(mkCard('Карта',       fmtAmtAbs(shift.card),       '#1d4ed8','#dbeafe', ICO.card));
    cards.appendChild(mkCard('Списания',    fmtAmtAbs(shift.debit||0),   '#991b1b','#fee2e2', ICO.debit));
    // Второй ряд — 2 карточки
    var cards2=document.createElement('div');
    cards2.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 20px 12px;';
    cards2.appendChild(mkCard('Внесение',    fmtAmtAbs(shift.manual),     '#7c3aed','#ede9fe', ICO.plus));
    cards2.appendChild(mkCard('Выемка',      fmtAmtAbs(shift.withdrawal), '#b45309','#fef3c7', ICO.out));
    body.appendChild(cards);
    body.appendChild(cards2);

    // Итого
    var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0)-(shift.debit||0);
    var infoRow=document.createElement('div');
    infoRow.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:0 20px 12px;border-bottom:1px solid #f0f0f0;';
    var infoL=document.createElement('div');
    infoL.style.cssText='font-size:12px;color:#aaa;';
    infoL.textContent='Открыта: '+fmtDate(shift.openedAt);
    var infoR=document.createElement('div');
    infoR.style.cssText='font-size:15px;font-weight:800;color:#1a1a1a;';
    infoR.setAttribute('data-cashval','1');
    attachBlurHover(infoR);
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
            var isDebit=e.type==='debit';
            var row=document.createElement('div');
            row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid #f8f8f8;font-size:12px;';
            var lft=document.createElement('span');
            lft.style.cssText='color:#888;';
            var typeTag = isDebit ? '[Списание] ' : '';
            lft.textContent=typeTag+fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var rgt=document.createElement('span');
            rgt.style.cssText='font-weight:700;color:'+(isDebit?'#991b1b':isOut?'#b45309':'#7c3aed')+';white-space:nowrap;';
            rgt.textContent=(isOut||isDebit?'−':'+')+fmtAmtAbs(e.amount);
            row.appendChild(lft); row.appendChild(rgt);
            logWrap.appendChild(row);
        });
        body.appendChild(logWrap);
    }

    // Кнопка закрытия смены
    var actions=document.createElement('div');
    actions.style.cssText='padding:0 20px 20px;display:flex;align-items:center;gap:8px;';
    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='padding:9px 20px;background:#dc2626;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;';
    closeBtn.textContent='Закрыть смену';
    closeBtn.addEventListener('click',function(){
        if(!confirm('Закрыть смену? Данные сохранятся в журнал.')) return;
        closeShift(loadCurrent(),'manual'); renderModal();
    });

    // Кнопка дебага — маленькая, малозаметная
    var dbgBtn=document.createElement('button');
    dbgBtn.title='Диагностика кассы';
    // Кнопка в светлой модалке — делаем видимой но ненавязчивой
    dbgBtn.style.cssText='padding:0;width:28px;height:28px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:6px;cursor:pointer;color:#bbb;display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0;';
    dbgBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
    dbgBtn.addEventListener('mouseenter',function(){dbgBtn.style.color='#555';dbgBtn.style.borderColor='#bbb';dbgBtn.style.background='#efefef';});
    dbgBtn.addEventListener('mouseleave',function(){dbgBtn.style.color='#bbb';dbgBtn.style.borderColor='#e0e0e0';dbgBtn.style.background='#f5f5f5';});
    dbgBtn.addEventListener('click',function(){ runCashboxDebug(); });

    // Кнопка списка админов — цветная с текстом, прижата вправо
    var admBtn=document.createElement('button');
    admBtn.style.cssText='margin-left:auto;display:flex;align-items:center;gap:6px;padding:7px 13px;height:32px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;cursor:pointer;color:#1d4ed8;font-size:12px;font-weight:700;font-family:inherit;transition:all 0.15s;flex-shrink:0;white-space:nowrap;';
    admBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Список админов';
    admBtn.addEventListener('mouseenter',function(){admBtn.style.background='#dbeafe';admBtn.style.borderColor='#93c5fd';});
    admBtn.addEventListener('mouseleave',function(){admBtn.style.background='#eff6ff';admBtn.style.borderColor='#bfdbfe';});
    admBtn.addEventListener('click',function(){ showAdminList(); });

    actions.appendChild(closeBtn);
    actions.appendChild(dbgBtn);
    actions.appendChild(admBtn);
    body.appendChild(actions);
}

// ── Список админов ───────────────────────────────────────
function showAdminList(){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100010;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:320px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.25);font-family:inherit;';
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var ht=document.createElement('span'); ht.style.cssText='font-size:13px;font-weight:700;color:#1a1a1a;'; ht.textContent='Список админов';
    var hc=document.createElement('button'); hc.style.cssText='background:none;border:none;font-size:18px;cursor:pointer;color:#bbb;line-height:1;'; hc.textContent='×'; hc.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(ht); hdr.appendChild(hc); box.appendChild(hdr);

    function renderList(){
        var listWrap=box.querySelector('.gcb-adm-list');
        if(listWrap) listWrap.remove();
        var wrap=document.createElement('div'); wrap.className='gcb-adm-list';
        wrap.style.cssText='overflow-y:auto;flex:1;padding:10px 12px;';
        var admins=loadAdmins();
        if(!admins.length){
            wrap.innerHTML='<div style="color:#ccc;text-align:center;padding:24px;font-size:13px;">Нет добавленных админов</div>';
        } else {
            admins.forEach(function(nick){
                var row=document.createElement('div');
                row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:7px;margin-bottom:4px;background:#f7f7f7;';
                var nm=document.createElement('span'); nm.style.cssText='font-size:13px;font-weight:600;color:#1a1a1a;'; nm.textContent=nick;
                row.appendChild(nm);
                wrap.appendChild(row);
            });
        }
        // Кнопка добавить
        var addRow=document.createElement('div'); addRow.style.cssText='padding:6px 0 2px;';
        var addBtn=document.createElement('button');
        addBtn.style.cssText='width:100%;padding:9px;background:#f0fdf4;border:1px dashed #86efac;border-radius:7px;color:#166534;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.1s;';
        addBtn.textContent='+ Добавить админа';
        addBtn.addEventListener('click',function(){
            var nick=prompt('Введите ник нового админа:','');
            if(!nick||!nick.trim()) return;
            nick=nick.trim();
            var admins=loadAdmins();
            if(admins.indexOf(nick)!==-1){ alert('Такой админ уже есть'); return; }
            admins.push(nick); saveAdmins(admins);
            renderList();
        });
        addRow.appendChild(addBtn); wrap.appendChild(addRow);
        box.appendChild(wrap);
    }
    renderList();
    ov.appendChild(box); document.body.appendChild(ov);
    document.addEventListener('keydown',function eh(e){if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',eh);}});
}

// ── Журнал смен ───────────────────────────────────────────
function renderHistoryTab(body){
    var allShifts=loadShifts();
    if(!allShifts.length){
        body.innerHTML='<div style="text-align:center;color:#ccc;padding:60px;font-size:14px;">Нет завершённых смен</div>';
        return;
    }

    var _fAdmin='', _fFrom=null, _fTill=null, _sortOpen=0, _sortClose=0, _sortTotal=0;
    // _sortX: 0=off, 1=desc, 2=asc

    var adminNicks=[];
    allShifts.forEach(function(s){ if(s.adminNick&&adminNicks.indexOf(s.adminNick)===-1) adminNicks.push(s.adminNick); });

    // ── Шапка с кнопкой "Сбросить фильтры" ──
    var topBar=document.createElement('div');
    topBar.style.cssText='display:flex;align-items:center;justify-content:flex-end;padding:6px 12px 0;flex-shrink:0;';
    var rstBtn=document.createElement('button');
    rstBtn.textContent='Сбросить фильтры';
    rstBtn.style.cssText='font-size:11px;padding:4px 10px;border:1px solid #ddd;border-radius:5px;background:#fff;color:#888;cursor:pointer;font-family:inherit;transition:background 0.1s;';
    rstBtn.addEventListener('mouseenter',function(){rstBtn.style.background='#f5f5f5';});
    rstBtn.addEventListener('mouseleave',function(){rstBtn.style.background='#fff';});
    rstBtn.addEventListener('click',function(){
        _fAdmin=''; _fFrom=null; _fTill=null; _sortOpen=0; _sortClose=0; _sortTotal=0;
        updateThLabels(); applyFilters();
    });
    topBar.appendChild(rstBtn);
    body.appendChild(topBar);

    // ── Таблица ──
    var tableWrap=document.createElement('div');
    tableWrap.style.cssText='overflow:auto;flex:1;overscroll-behavior:contain;';
    body.appendChild(tableWrap);

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;';
    tableWrap.appendChild(table);

    // ── Thead ──
    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:2;';
    table.appendChild(thead);

    var ICON_N='\u25be', ICON_D='\u25bc', ICON_A='\u25b2';
    var THS='padding:9px 8px;text-align:center;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;text-transform:uppercase;letter-spacing:0.3px;user-select:none;overflow:hidden;';

    var hr=document.createElement('tr');
    var thEls={};

    // Mini calendar dropdown
    function makeCalendarDropdown(onSelect){
        var now=new Date();
        var viewY=now.getFullYear(), viewM=now.getMonth();
        var dropdown=document.createElement('div');
        dropdown.style.cssText='position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);background:#fff;border:1px solid #ddd;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.14);z-index:30;padding:10px;min-width:220px;font-family:inherit;';
        dropdown.addEventListener('click',function(e){e.stopPropagation();});

        // Ручной ввод
        var inputRow=document.createElement('div'); inputRow.style.cssText='display:flex;gap:4px;margin-bottom:8px;';
        var manualIn=document.createElement('input'); manualIn.type='text'; manualIn.placeholder='ДД.ММ.ГГГГ';
        manualIn.style.cssText='flex:1;font-size:11px;padding:4px 7px;border:1px solid #ddd;border-radius:5px;font-family:inherit;';
        var manualOk=document.createElement('button'); manualOk.textContent='OK';
        manualOk.style.cssText='font-size:11px;padding:4px 8px;border:1px solid #86efac;border-radius:5px;background:#f0fdf4;color:#166534;cursor:pointer;font-family:inherit;font-weight:600;';
        manualOk.addEventListener('click',function(){
            var parts=manualIn.value.split('.');
            if(parts.length===3){
                var d=new Date(+parts[2],+parts[1]-1,+parts[0]);
                if(!isNaN(d.getTime())){ onSelect(d); dropdown.remove(); return; }
            }
            manualIn.style.borderColor='#f87171';
        });
        inputRow.appendChild(manualIn); inputRow.appendChild(manualOk);
        dropdown.appendChild(inputRow);

        function buildCal(){
            var old=dropdown.querySelector('.gcb-cal'); if(old) old.remove();
            var cal=document.createElement('div'); cal.className='gcb-cal';
            // Nav
            var nav=document.createElement('div'); nav.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
            var prev=document.createElement('button'); prev.textContent='◀'; prev.style.cssText='background:none;border:none;cursor:pointer;font-size:12px;color:#555;padding:2px 6px;';
            var next=document.createElement('button'); next.textContent='▶'; next.style.cssText='background:none;border:none;cursor:pointer;font-size:12px;color:#555;padding:2px 6px;';
            var lbl=document.createElement('span'); lbl.style.cssText='font-size:12px;font-weight:700;color:#333;';
            var MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
            lbl.textContent=MONTHS[viewM]+' '+viewY;
            prev.addEventListener('click',function(){ viewM--; if(viewM<0){viewM=11;viewY--;} buildCal(); });
            next.addEventListener('click',function(){ viewM++; if(viewM>11){viewM=0;viewY++;} buildCal(); });
            nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next); cal.appendChild(nav);
            // Days header
            var dHdr=document.createElement('div'); dHdr.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:1px;margin-bottom:2px;';
            ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(function(d){
                var c=document.createElement('div'); c.style.cssText='font-size:9px;text-align:center;color:#bbb;font-weight:600;'; c.textContent=d; dHdr.appendChild(c);
            });
            cal.appendChild(dHdr);
            // Days grid
            var grid=document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:2px;';
            var first=new Date(viewY,viewM,1).getDay(); // 0=Sun
            var offset=(first===0)?6:first-1;
            var days=new Date(viewY,viewM+1,0).getDate();
            for(var i=0;i<offset;i++){ var empty=document.createElement('div'); grid.appendChild(empty); }
            for(var day=1;day<=days;day++){
                (function(d){
                    var cell=document.createElement('div');
                    cell.style.cssText='font-size:11px;text-align:center;padding:3px 2px;border-radius:5px;cursor:pointer;color:#333;transition:background 0.1s;';
                    cell.textContent=d;
                    cell.addEventListener('mouseenter',function(){cell.style.background='#eff6ff';cell.style.color='#1d4ed8';});
                    cell.addEventListener('mouseleave',function(){cell.style.background='';cell.style.color='#333';});
                    cell.addEventListener('click',function(){
                        onSelect(new Date(viewY,viewM,d));
                        dropdown.remove();
                    });
                    grid.appendChild(cell);
                })(day);
            }
            cal.appendChild(grid); dropdown.appendChild(cal);
        }
        buildCal();
        return dropdown;
    }

    function makeFilterTh(label, sortVar, onSortChange, onDateSelect, dateVal){
        var th=document.createElement('th');
        th.style.cssText=THS+'cursor:pointer;position:relative;width:110px;';
        function getIcon(v){ return v===0?ICON_N:v===1?ICON_D:ICON_A; }
        function render(){
            var dateStr=dateVal()?(' <span style="font-size:9px;color:#1d4ed8;">'+dateVal().toLocaleDateString('ru-RU')+'</span>'):'';
            th.innerHTML=label+' <span style="font-size:9px;opacity:0.7;">'+getIcon(sortVar())+'</span>'+dateStr;
        }
        render();
        var calDrop=null;
        th.addEventListener('click',function(e){
            e.stopPropagation();
            if(calDrop){ calDrop.remove(); calDrop=null; return; }
            // Первый клик = цикл сортировки, второй (если уже открыт) = закрыть
            // Правый клик или shift-клик = открыть календарь
            if(e.shiftKey||e.altKey){
                // Открыть календарь
                calDrop=makeCalendarDropdown(function(date){
                    onDateSelect(date); render(); applyFilters();
                });
                th.appendChild(calDrop);
                setTimeout(function(){
                    document.addEventListener('click',function cl(){
                        if(calDrop)calDrop.remove(); calDrop=null;
                        document.removeEventListener('click',cl);
                    });
                },10);
            } else {
                onSortChange(); render(); applyFilters();
            }
        });
        // Двойной клик = открыть календарь
        th.addEventListener('dblclick',function(e){
            e.stopPropagation();
            if(calDrop){ calDrop.remove(); calDrop=null; return; }
            calDrop=makeCalendarDropdown(function(date){
                onDateSelect(date); render(); applyFilters();
            });
            th.appendChild(calDrop);
            setTimeout(function(){
                document.addEventListener('click',function cl(){
                    if(calDrop)calDrop.remove(); calDrop=null;
                    document.removeEventListener('click',cl);
                });
            },10);
        });
        return {th:th, render:render};
    }

    function updateThLabels(){
        thEls.open&&thEls.open.render();
        thEls.close&&thEls.close.render();
        thEls.total&&thEls.total.render();
        // Admin th
        if(thEls.admin){
            thEls.admin.innerHTML=(_fAdmin||'Админ')+' <span style="font-size:9px;opacity:0.7;">'+ICON_N+'</span>';
        }
    }

    // Build thead row
    thEls.open = makeFilterTh('Открыта',
        function(){return _sortOpen;},
        function(){_sortOpen=(_sortOpen+1)%3;_sortClose=0;_sortTotal=0;},
        function(d){_fFrom=d;},
        function(){return _fFrom;}
    );
    hr.appendChild(thEls.open.th);

    // Админ ▾
    var thAdmin=document.createElement('th'); thAdmin.style.cssText=THS+'cursor:pointer;position:relative;width:80px;';
    thAdmin.innerHTML=(_fAdmin||'Админ')+' <span style="font-size:9px;opacity:0.7;">'+ICON_N+'</span>';
    thEls.admin=thAdmin;
    var admDrop=null;
    thAdmin.addEventListener('click',function(e){
        e.stopPropagation();
        if(admDrop){admDrop.remove();admDrop=null;return;}
        admDrop=document.createElement('div');
        admDrop.style.cssText='position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:30;min-width:110px;padding:4px 0;font-family:inherit;';
        admDrop.addEventListener('click',function(e2){e2.stopPropagation();});
        function makeAdmOpt(label,val){
            var o=document.createElement('div');
            o.style.cssText='padding:7px 14px;font-size:12px;cursor:pointer;color:'+(_fAdmin===val?'#1d4ed8':'#333')+';font-weight:'+(_fAdmin===val?'700':'400')+';';
            o.textContent=label;
            o.addEventListener('mouseenter',function(){o.style.background='#f0f6ff';});
            o.addEventListener('mouseleave',function(){o.style.background='';});
            o.addEventListener('click',function(){_fAdmin=val;thAdmin.innerHTML=(_fAdmin||'Админ')+' <span style="font-size:9px;opacity:0.7;">'+ICON_N+'</span>';admDrop.remove();admDrop=null;applyFilters();});
            return o;
        }
        admDrop.appendChild(makeAdmOpt('Все',''));
        adminNicks.forEach(function(n){admDrop.appendChild(makeAdmOpt(n,n));});
        thAdmin.appendChild(admDrop);
        setTimeout(function(){document.addEventListener('click',function cl(){if(admDrop)admDrop.remove();admDrop=null;document.removeEventListener('click',cl);});},10);
    });
    hr.appendChild(thAdmin);

    thEls.close = makeFilterTh('Закрыта',
        function(){return _sortClose;},
        function(){_sortClose=(_sortClose+1)%3;_sortOpen=0;_sortTotal=0;},
        function(d){_fTill=d;},
        function(){return _fTill;}
    );
    hr.appendChild(thEls.close.th);

    // В кассе ▾
    var thTotal=document.createElement('th'); thTotal.style.cssText=THS+'cursor:pointer;position:relative;width:78px;';
    function renderTotalTh(){ thTotal.innerHTML='В кассе <span style="font-size:9px;opacity:0.7;">'+(_sortTotal===0?ICON_N:_sortTotal===1?ICON_D:ICON_A)+'</span>'; }
    renderTotalTh(); thEls.total={render:renderTotalTh};
    thTotal.addEventListener('click',function(){_sortTotal=(_sortTotal+1)%3;_sortOpen=0;_sortClose=0;renderTotalTh();applyFilters();});
    hr.appendChild(thTotal);

    ['Нал.','Карта','Внес.','Выем.','Спис.'].forEach(function(n){
        var th=document.createElement('th'); th.style.cssText=THS+'width:64px;'; th.textContent=n; hr.appendChild(th);
    });
    thead.appendChild(hr);

    // ── tbody ──
    var tbody=document.createElement('tbody');
    table.appendChild(tbody);

    function applyFilters(){
        var shifts=allShifts.filter(function(s){
            if(_fAdmin && s.adminNick!==_fAdmin) return false;
            if(_fFrom){
                var from=new Date(_fFrom); from.setHours(0,0,0,0);
                if(s.openedAt < from.getTime()) return false;
            }
            if(_fTill){
                var till=new Date(_fTill); till.setHours(23,59,59,999);
                if(s.openedAt > till.getTime()) return false;
            }
            return true;
        });
        if(_sortOpen===1) shifts.sort(function(a,b){return b.openedAt-a.openedAt;});
        else if(_sortOpen===2) shifts.sort(function(a,b){return a.openedAt-b.openedAt;});
        else if(_sortClose===1) shifts.sort(function(a,b){return (b.closedAt||0)-(a.closedAt||0);});
        else if(_sortClose===2) shifts.sort(function(a,b){return (a.closedAt||0)-(b.closedAt||0);});
        else if(_sortTotal===1) shifts.sort(function(a,b){
            var ta=(a.cash||0)+(a.card||0)+(a.manual||0)-(a.withdrawal||0)-(a.debit||0);
            var tb=(b.cash||0)+(b.card||0)+(b.manual||0)-(b.withdrawal||0)-(b.debit||0);
            return tb-ta;
        });
        else if(_sortTotal===2) shifts.sort(function(a,b){
            var ta=(a.cash||0)+(a.card||0)+(a.manual||0)-(a.withdrawal||0)-(a.debit||0);
            var tb=(b.cash||0)+(b.card||0)+(b.manual||0)-(b.withdrawal||0)-(b.debit||0);
            return ta-tb;
        });
        rebuildRows(shifts);
    }

    function rebuildRows(shifts){
        tbody.innerHTML='';
        if(!shifts.length){
            var empty=document.createElement('tr');
            var etd=document.createElement('td'); etd.colSpan=9; etd.style.cssText='text-align:center;color:#ccc;padding:40px;font-size:13px;'; etd.textContent='Нет смен по выбранным фильтрам';
            empty.appendChild(etd); tbody.appendChild(empty); return;
        }
        shifts.forEach(function(s){
            var total=(s.cash||0)+(s.card||0)+(s.manual||0)-(s.withdrawal||0)-(s.debit||0);
            var tr=document.createElement('tr');
            tr.style.cssText='border-bottom:2px solid #d1d5db;cursor:pointer;background:#fff;transition:background 0.1s;';
            tr.addEventListener('mouseenter',function(){tr.style.background='#f0f6ff';});
            tr.addEventListener('mouseleave',function(){tr.style.background='#fff';});
            tr.addEventListener('click',function(){showShiftDetail(s);});

            var P='padding:8px 8px;vertical-align:middle;text-align:center;font-size:12px;white-space:nowrap;overflow:hidden;';

            // Открыта — двустрочная с ником в стиле бейджа
            var tdO=document.createElement('td'); tdO.style.cssText=P+'text-align:left;';
            if(s.adminNick){
                var nb=document.createElement('div');
                nb.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:1px 8px;margin-bottom:3px;';
                nb.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'+s.adminNick;
                tdO.appendChild(nb);
            }
            var d1=document.createElement('div'); d1.style.cssText='font-size:11px;color:#555;'; d1.textContent=fmtDate(s.openedAt); tdO.appendChild(d1);
            tr.appendChild(tdO);

            // Админ — пустая (ник уже в "Открыта")
            var tdA=document.createElement('td'); tdA.style.cssText=P; tr.appendChild(tdA);

            // Закрыта
            var tdC=document.createElement('td'); tdC.style.cssText=P;
            tdC.textContent=s.closedAt?fmtDate(s.closedAt):'—'; tdC.style.color=s.closedAt?'#555':'#ccc'; tr.appendChild(tdC);

            // Данные
            [[fmtAmtAbs(total),'font-weight:800;color:#1a1a1a;font-size:13px;'],
             [fmtAmtAbs(s.cash),'color:#166534;font-weight:600;'],
             [fmtAmtAbs(s.card),'color:#1d4ed8;font-weight:600;'],
             [fmtAmtAbs(s.manual),'color:#7c3aed;font-weight:600;'],
             [fmtAmtAbs(s.withdrawal),'color:#b45309;font-weight:600;'],
             [fmtAmtAbs(s.debit||0),'color:#991b1b;font-weight:600;'],
            ].forEach(function(col){
                var td=document.createElement('td'); td.style.cssText=P+col[1]; td.textContent=col[0]; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    applyFilters();
}


// ── Детальная карточка смены ──────────────────────────────
function showShiftDetail(s){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){ if(e.target!==ov) return; var dep=document.getElementById('gcb-deposits-box'); if(dep){dep.remove();return;} ov.remove(); });
    document.body.appendChild(ov);

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:720px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.3);';

    var hdr=document.createElement('div');
    hdr.style.cssText='padding:14px 20px 10px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    // Строка 1: заголовок + крестик
    var hdrTop=document.createElement('div');
    hdrTop.style.cssText='display:flex;align-items:center;justify-content:space-between;';
    var ht=document.createElement('span');
    ht.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;';
    ht.textContent='Смена: '+fmtDate(s.openedAt)+' → '+(s.closedAt?fmtDate(s.closedAt):'открыта');
    var hc=document.createElement('button');
    hc.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#bbb;line-height:1;';
    hc.textContent='×'; hc.addEventListener('click',function(){ov.remove();});
    // Ник админа рядом с крестиком
    if(s.adminNick){
        var sdAdmin=document.createElement('span');
        sdAdmin.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:2px 9px;margin-right:6px;white-space:nowrap;';
        sdAdmin.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'+s.adminNick;
        hdrTop.insertBefore(sdAdmin, hc);
    }
    hdrTop.appendChild(ht); hdrTop.appendChild(hc);
    // Строка 2: кнопка "История пополнений" по центру
    var hdrBot=document.createElement('div');
    hdrBot.style.cssText='display:flex;justify-content:center;margin-top:8px;';
    var depBtn=document.createElement('button');
    depBtn.style.cssText='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;color:#166534;font-size:12px;font-weight:600;cursor:pointer;padding:5px 16px;font-family:inherit;';
    depBtn.textContent='История пополнений';
    depBtn.addEventListener('click',function(){ showShiftDeposits(s); });
    hdrBot.appendChild(depBtn);
    hdr.appendChild(hdrTop); hdr.appendChild(hdrBot);
    box.appendChild(hdr);

    var total=(s.cash||0)+(s.card||0)+(s.manual||0)-(s.withdrawal||0)-(s.debit||0);
    var grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px 20px 8px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    [['Наличные',fmtAmtAbs(s.cash),'#166534','#dcfce7'],
     ['Карта',fmtAmtAbs(s.card),'#1d4ed8','#dbeafe'],
     ['Списания',fmtAmtAbs(s.debit||0),'#991b1b','#fee2e2']].forEach(function(r){
        var c=document.createElement('div');
        c.style.cssText='background:'+r[3]+';border-radius:8px;padding:10px 12px;';
        c.innerHTML='<div style="font-size:9px;color:'+r[2]+';font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">'+r[0]+'</div>'+
                    '<div style="font-size:16px;font-weight:800;color:#1a1a1a;">'+r[1]+'</div>';
        grid.appendChild(c);
    });
    var grid2=document.createElement('div');
    grid2.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:0 20px 14px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    [['Внесение',fmtAmtAbs(s.manual),'#7c3aed','#ede9fe'],
     ['Выемка',fmtAmtAbs(s.withdrawal),'#b45309','#fef3c7'],
     ['В кассе',fmtAmtAbs(total),'#1a1a1a','#f5f5f5']].forEach(function(r){
        var c=document.createElement('div');
        c.style.cssText='background:'+r[3]+';border-radius:8px;padding:10px 12px;';
        c.innerHTML='<div style="font-size:9px;color:'+r[2]+';font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">'+r[0]+'</div>'+
                    '<div style="font-size:16px;font-weight:800;color:#1a1a1a;">'+r[1]+'</div>';
        grid2.appendChild(c);
    });
    box.appendChild(grid);
    box.appendChild(grid2);
    var tw=document.createElement('div');
    tw.style.cssText='overflow-y:auto;overscroll-behavior:contain;flex:1;min-height:0;padding:12px 20px;';
    var entries=s.manualEntries||[];
    if(entries.length){
        var lt=document.createElement('div');
        lt.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
        lt.textContent='Ручные операции';
        tw.appendChild(lt);
        entries.forEach(function(e){
            var isOut=e.type==='out';
            var isDebit=e.type==='debit';
            var row=document.createElement('div');
            row.style.cssText='display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f5f5f5;font-size:13px;';
            var l=document.createElement('span'); l.style.cssText='color:#888;';
            var typeTag=isDebit?'[Списание] ':'';
            l.textContent=typeTag+fmtDate(e.ts)+(e.comment?' · '+e.comment:'');
            var r=document.createElement('span'); r.style.cssText='font-weight:700;color:'+(isDebit?'#991b1b':isOut?'#b45309':'#7c3aed')+';';
            r.textContent=(isOut||isDebit?'−':'+')+fmtAmtAbs(e.amount);
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

// ── Пополнения за смену (из журнала смен) ────────────────
function showShiftDeposits(s){
    if(!_authToken){ alert('Нет токена авторизации'); return; }

    // Модалка пополнений — перетаскиваемая, без затемнения фона
    var box2=document.createElement('div');
    box2.id='gcb-deposits-box';
    box2.style.cssText='position:fixed;top:0;left:0;z-index:100002;background:#fff;border-radius:12px;width:560px;max-width:96vw;max-height:82vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.35);';
    document.body.appendChild(box2);

    var hdr2=document.createElement('div');
    hdr2.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;cursor:grab;user-select:none;background:#fafafa;border-radius:12px 12px 0 0;';
    var ht2=document.createElement('span');
    ht2.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;';
    ht2.textContent='Пополнения смены: '+fmtDate(s.openedAt);
    var hc2=document.createElement('button');
    hc2.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#bbb;line-height:1;';
    hc2.textContent='×'; hc2.addEventListener('click',function(){ if(box2._closeOnOut) document.removeEventListener('click',box2._closeOnOut,true); box2.remove(); });
    hdr2.appendChild(ht2); hdr2.appendChild(hc2);
    box2.appendChild(hdr2);

    // Закрытие по клику вне модалки — через 'click' с задержкой после открытия
    // (задержка нужна чтобы сам клик открытия не закрыл сразу)
    setTimeout(function(){
        function closeOnOut(e){
            if(!box2.isConnected){ document.removeEventListener('click', closeOnOut, true); return; }
            if(!box2.contains(e.target)){
                e.stopPropagation(); // не даём клику закрыть и overlay смены
                box2.remove();
                document.removeEventListener('click', closeOnOut, true);
            }
        }
        document.addEventListener('click', closeOnOut, true);
        box2._closeOnOut = closeOnOut; // сохраняем для Escape
    }, 200);

    // Перетаскивание — Pointer Events API + transform3d + rAF для максимальной плавности
    (function(){
        // Начальное положение
        var initLeft = Math.round((window.innerWidth - 560) / 2);
        var initTop  = Math.round(window.innerHeight * 0.10);
        // Используем translate3d — GPU-слой, никаких layout reflows
        box2.style.position='fixed';
        box2.style.left='0';
        box2.style.top='0';
        box2.style.transform='translate3d('+initLeft+'px,'+initTop+'px,0)';
        box2.style.transformOrigin='top left';
        // willChange только во время перетаскивания — иначе вызывает размытие текста

        var tx=initLeft, ty=initTop; // текущая позиция в px
        var rafId=null;

        hdr2.addEventListener('pointerdown',function(e){
            if(e.target===hc2||e.button!==0) return;
            e.preventDefault();
            hdr2.setPointerCapture(e.pointerId);
            hdr2.style.cursor='grabbing';
            box2.style.willChange='transform';
            var startX=e.clientX, startY=e.clientY;
            var startTx=tx, startTy=ty;

            function onMove(ev){
                var dx=ev.clientX-startX;
                var dy=ev.clientY-startY;
                tx=startTx+dx; ty=startTy+dy;
                if(rafId) cancelAnimationFrame(rafId);
                rafId=requestAnimationFrame(function(){
                    box2.style.transform='translate3d('+tx+'px,'+ty+'px,0)';
                });
            }
            function onUp(){
                hdr2.style.cursor='grab';
                box2.style.willChange='auto'; // снимаем после drag — убирает размытие
                hdr2.removeEventListener('pointermove',onMove);
                hdr2.removeEventListener('pointerup',onUp);
                hdr2.removeEventListener('pointercancel',onUp);
                if(rafId){cancelAnimationFrame(rafId);rafId=null;}
            }
            hdr2.addEventListener('pointermove',onMove);
            hdr2.addEventListener('pointerup',onUp);
            hdr2.addEventListener('pointercancel',onUp);
        });
    })();

    var body2=document.createElement('div');
    body2.style.cssText='overflow-y:auto;flex:1;padding:16px 20px;';
    body2.innerHTML='<div style="color:#aaa;text-align:center;padding:30px;font-size:13px;">Загружаю...</div>';
    box2.appendChild(body2);
    // box2 уже добавлен в document.body выше

    // Используем seenOpIds — те же id что учитывались в кассе во время смены
    var ids = s.seenOpIds || [];
    if(!ids.length){
        body2.innerHTML='<div style="color:#aaa;text-align:center;padding:40px;font-size:13px;">Операций в этой смене не зафиксировано.<br><span style="font-size:11px;color:#ccc;">История фиксируется начиная с версии 3.11</span></div>';
        return;
    }

    window.fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':_authToken,'content-type':'application/json','x-hasura-role':_hasuraRole},
        body:JSON.stringify({
            operationName:'GCBOpsForShift',
            query:'query GCBOpsForShift($ids:[Int!]!){wallet_operations(where:{id:{_in:$ids}},order_by:{id:asc}){id created_at amount money_type operation_type user_id user{users_user_profile{name surname login}}wallet_operation_digest{name}}}',
            variables:{ids:ids}
        })
    }).then(function(r){return r.json();}).then(function(d){
        var ops=(d.data&&d.data.wallet_operations)||[];
        body2.innerHTML='';
        if(!ops.length){
            body2.innerHTML='<div style="color:#aaa;text-align:center;padding:40px;font-size:13px;">Нет данных</div>';
            return;
        }
        var opTitle=document.createElement('div');
        opTitle.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
        opTitle.textContent='Операции смены ('+ops.length+')';
        body2.appendChild(opTitle);

        var tbl=document.createElement('table');
        tbl.style.cssText='width:100%;border-collapse:collapse;font-size:12px;';
        var thead=document.createElement('thead');
        var thr=document.createElement('tr');
        thr.style.cssText='background:#f9f9f9;';
        [['Время','60px'],['Клиент',''],['Тип','55px'],['Сумма','70px'],['Примечание','']].forEach(function(col){
            var th=document.createElement('th');
            th.style.cssText='padding:6px 8px;text-align:left;color:#888;font-weight:600;font-size:10px;border-bottom:1px solid #eee;white-space:nowrap;'+(col[1]?'width:'+col[1]+';':'');
            th.textContent=col[0]; thr.appendChild(th);
        });
        thead.appendChild(thr); tbl.appendChild(thead);

        var tbody=document.createElement('tbody');
        var totalCash=0, totalCard=0;
        ops.forEach(function(op){
            var p=op.user&&op.user.users_user_profile;
            var nick=p?(p.login?'@'+p.login:((p.name||'')+(p.surname?' '+p.surname:'')).trim()):'';
            var userId=op.user_id||'';
            var digest=(op.wallet_operation_digest&&op.wallet_operation_digest.name)||'';
            var isCash=op.money_type==='cash';
            var ts=new Date(op.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

            var tr=document.createElement('tr');
            tr.style.cssText='border-bottom:1px solid #f5f5f5;';

            var tdTime=document.createElement('td'); tdTime.style.cssText='padding:6px 8px;color:#888;white-space:nowrap;'; tdTime.textContent=ts;
            var tdNick=document.createElement('td'); tdNick.style.cssText='padding:6px 8px;max-width:140px;';
            if(nick&&userId){
                var lk=document.createElement('a'); lk.href='/clients/'+userId; lk.style.cssText='color:#0066aa;text-decoration:none;font-weight:600;font-size:11px;'; lk.textContent=nick;
                lk.addEventListener('mouseenter',function(){lk.style.textDecoration='underline';}); lk.addEventListener('mouseleave',function(){lk.style.textDecoration='none';});
                tdNick.appendChild(lk);
            } else { tdNick.textContent='—'; tdNick.style.color='#ccc'; }
            var tdType=document.createElement('td'); tdType.style.cssText='padding:6px 8px;white-space:nowrap;';
            var typeBadge=document.createElement('span');
            typeBadge.style.cssText='font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;'+(isCash?'background:#dcfce7;color:#166534;':'background:#dbeafe;color:#1d4ed8;');
            typeBadge.textContent=isCash?'НАЛ':'КАРТА'; tdType.appendChild(typeBadge);
            var tdAmt=document.createElement('td'); tdAmt.style.cssText='padding:6px 8px;font-weight:700;white-space:nowrap;color:#166534;'; tdAmt.textContent='+'+Math.round(op.amount)+'₽';
            var tdNote=document.createElement('td'); tdNote.style.cssText='padding:6px 8px;color:#aaa;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; tdNote.textContent=digest.slice(0,40);

            tr.appendChild(tdTime); tr.appendChild(tdNick); tr.appendChild(tdType); tr.appendChild(tdAmt); tr.appendChild(tdNote);
            tbody.appendChild(tr);
            if(isCash) totalCash+=op.amount||0; else totalCard+=op.amount||0;
        });
        tbl.appendChild(tbody); body2.appendChild(tbl);

        var foot=document.createElement('div');
        foot.style.cssText='padding:10px 8px;border-top:2px solid #eee;display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:13px;font-weight:700;';
        foot.innerHTML='<span style="font-size:12px;color:#888;font-weight:400;">'+ops.length+' операций</span>'+
            '<span><span style="color:#166534;">Нал: '+fmtAmtAbs(totalCash)+'</span>'+
            (totalCard?' &nbsp;<span style="color:#1d4ed8;">Безнал: '+fmtAmtAbs(totalCard)+'</span>':'')+
            ' &nbsp;<span style="color:#1a1a1a;">Итого: '+fmtAmtAbs(totalCash+totalCard)+'</span></span>';
        body2.appendChild(foot);
    }).catch(function(e){
        body2.innerHTML='<div style="color:#991b1b;padding:20px;font-size:13px;">Ошибка: '+e.message+'</div>';
    });

    document.addEventListener('keydown',function eh2(e){
        if(e.key==='Escape'){
            if(box2._closeOnOut) document.removeEventListener('click', box2._closeOnOut, true);
            box2.remove();
            document.removeEventListener('keydown',eh2);
        }
    });
}

// ── Диагностика ───────────────────────────────────────────
// ── Показ/скрытие модалки ────────────────────────────────
function showModal(){
    if(!_modal) buildModal();
    _valuesHidden=true;
    // Восстанавливаем сохранённое состояние скрытия (не сбрасываем при каждом открытии)
    _blurDisabled = (function(){ try{ return localStorage.getItem(GCB_BLUR_KEY)==='1'; }catch(e){return false;} })();
    renderModal();
    _modal.style.display='flex';
    _overlay.style.display='block';
    _isOpen=true;
    setTimeout(function(){
        applyModalBlur(_modal,true);
        updateBtnBlurState();
    },50);
}
function hideModal(){
    if(!_modal) return;
    _modal.style.display='none';
    _overlay.style.display='none';
    _isOpen=false; _valuesHidden=true;
}
function updateModalIfOpen(){ if(_isOpen)renderModal(); }

// ── Кнопка (NavLink стиль, перед divider) ────────────────
function updateBtnBadge(){
    var btn=document.getElementById('godji-cashbox-btn');
    if(!btn) return;
    var shift=loadCurrent();
    var dot=btn.querySelector('.gcb-dot');
    if(dot) dot.style.background=shift?'#22c55e':'#ef4444';
    var icoEl=btn.querySelector('.LinksGroup_themeIcon__E9SRO');
    if(icoEl) icoEl.style.background=shift?'#166534':'#991b1b';
    var sumEl=btn.querySelector('.gcb-sum');
    if(sumEl){
        if(shift){
            var total=(shift.cash||0)+(shift.card||0)+(shift.manual||0)-(shift.withdrawal||0)-(shift.debit||0);
            var fmt = total >= 10000 ? Math.round(total)+'₽' : fmtAmtAbs(total);
            sumEl.textContent = fmt;
            sumEl.style.color = 'rgba(255,255,255,0.5)';
            if(_blurDisabled){
                sumEl.style.filter='none';
                sumEl.onmouseenter=null;
                sumEl.onmouseleave=null;
            } else {
                sumEl.style.filter='blur(4px)';
                sumEl.onmouseenter=function(){sumEl.style.filter='none';};
                sumEl.onmouseleave=function(){if(!_blurDisabled)sumEl.style.filter='blur(4px)';};
            }
        } else {
            sumEl.textContent='закрыта';
            sumEl.style.color='rgba(255,255,255,0.3)';
            sumEl.style.filter='none';
            sumEl.onmouseenter=null; sumEl.onmouseleave=null;
        }
    }
}

function createBtn(){
    // Если строка уже вставлена — выходим
    if(document.getElementById('godji-cashbox-row')) return;
    var paper = document.querySelector('.Shifts_shiftsPaper__9Jml_');
    if(!paper) return;

    // Ищем ERP-кнопку смены в любом месте paper
    var erpBtn = paper.querySelector('button[data-variant="filled"]');
    if(!erpBtn) return;

    // Сжимаем ERP-кнопку: узкая, та же высота
    erpBtn.style.setProperty('flex', '0 0 68px', 'important');
    erpBtn.style.setProperty('width', '68px', 'important');
    erpBtn.style.setProperty('min-width', '0', 'important');
    erpBtn.style.setProperty('padding', '4px 6px', 'important');
    erpBtn.style.setProperty('font-size', '10px', 'important');
    erpBtn.style.setProperty('white-space', 'normal', 'important');
    erpBtn.style.setProperty('word-break', 'break-word', 'important');
    erpBtn.style.setProperty('text-align', 'center', 'important');
    erpBtn.style.setProperty('line-height', '1.3', 'important');
    erpBtn.style.setProperty('overflow', 'visible', 'important');
    erpBtn.style.setProperty('display', 'flex', 'important');
    erpBtn.style.setProperty('align-items', 'center', 'important');
    erpBtn.style.setProperty('justify-content', 'center', 'important');
    erpBtn.removeAttribute('data-block');
    // Mantine вкладывает текст в span — форсируем перенос через MutationObserver
    (function(){
        function forceWrap(){
            erpBtn.querySelectorAll('span').forEach(function(sp){
                sp.style.setProperty('white-space','normal','important');
                sp.style.setProperty('text-align','center','important');
                sp.style.setProperty('word-break','break-word','important');
                sp.style.setProperty('line-height','1.25','important');
                sp.style.setProperty('display','block','important');
            });
        }
        forceWrap();
        setTimeout(forceWrap, 300);
        setTimeout(forceWrap, 1000);
    })();

    // Обёртка — заменяет erpBtn визуально, но erpBtn остаётся в DOM
    // Оборачиваем erpBtn в flex-контейнер, добавляя нашу кнопку слева
    var row = document.createElement('div');
    row.id = 'godji-cashbox-row';
    row.style.cssText = 'display:flex;align-items:stretch;gap:3px;width:100%;';

    // Наша кнопка — flex:1
    var btn = document.createElement('button');
    btn.id = 'godji-cashbox-btn';
    btn.type = 'button';
    btn.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:rgba(22,101,52,0.85);border:none;border-radius:6px;padding:0 8px;height:54px;cursor:pointer;font-family:inherit;box-sizing:border-box;transition:background 0.15s;';
    btn.addEventListener('mouseenter', function(){ btn.style.background='rgba(22,101,52,1)'; });
    btn.addEventListener('mouseleave', function(){ btn.style.background='rgba(22,101,52,0.85)'; });

    var ico = document.createElement('div');
    ico.style.cssText = 'width:20px;height:20px;border-radius:4px;background:rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><circle cx="12" cy="14" r="2"/></svg>';

    var dot = document.createElement('span');
    dot.className = 'gcb-dot';
    dot.style.cssText = 'position:absolute;top:-2px;right:-2px;width:6px;height:6px;border-radius:50%;background:#ef4444;border:1.5px solid #1a1b2e;';
    ico.appendChild(dot);

    var textWrap = document.createElement('div');
    textWrap.style.cssText = 'display:flex;flex-direction:column;min-width:0;flex:1;';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px;font-weight:700;color:#fff;white-space:nowrap;line-height:1.2;';
    lbl.textContent = 'Касса смены';

    var sumEl = document.createElement('span');
    sumEl.className = 'gcb-sum';
    sumEl.style.cssText = 'font-size:11px;font-weight:600;white-space:nowrap;line-height:1.2;margin-top:2px;color:rgba(255,255,255,0.4);';

    textWrap.appendChild(lbl);
    textWrap.appendChild(sumEl);
    btn.appendChild(ico);
    btn.appendChild(textWrap);

    btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        if(_isOpen) hideModal(); else showModal();
    });

    // erpBtn может быть не прямым дочерним paper — вставляем через его родителя
    var erpParent = erpBtn.parentNode;
    if(!erpParent) return;
    erpParent.insertBefore(row, erpBtn);
    row.appendChild(btn);
    row.appendChild(erpBtn);
    // Одинаковая высота
    erpBtn.style.setProperty('height', '54px', 'important');
    erpBtn.style.setProperty('align-self', 'stretch', 'important');
    erpBtn.style.setProperty('box-sizing', 'border-box', 'important');
    erpBtn.style.setProperty('font-size', '9.5px', 'important');
    erpBtn.style.setProperty('line-height', '1.3', 'important');
    erpBtn.style.setProperty('display', 'flex', 'important');
    erpBtn.style.setProperty('align-items', 'center', 'important');
    erpBtn.style.setProperty('justify-content', 'center', 'important');

    updateBtnBadge();
}

// ── MutationObserver + init ───────────────────────────────
var _obs = new MutationObserver(function(){
    if(!document.getElementById('godji-cashbox-row')) createBtn();
});

function initObservers(){
    _obs.observe(document.body, {childList:true, subtree:false});
    setTimeout(createBtn, 1500);
    setTimeout(createBtn, 3000);
    setTimeout(createBtn, 5000);
}





if(document.body){
    initObservers();
} else {
    document.addEventListener('DOMContentLoaded', initObservers);
}

})();

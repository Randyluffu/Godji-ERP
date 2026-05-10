// ==UserScript==
// @name         Годжи — Детектор багоюза
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Обнаруживает злоупотребление багом пакет→почасовой→завершение с возвратом лишних бонусов
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_bugdetect.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_bugdetect.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var CLUB_ID     = 14;
var API_URL     = 'https://hasura.godji.cloud/v1/graphql';
var STORAGE_KEY = 'godji_bugdetect_v1';
var POLL_MS     = 20000; // polling каждые 20 сек
var WINDOW_MS   = 300000; // окно детекции — 5 минут

// Minute тарифы (ERP возвращает деньги при отмене)
var MINUTE_TARIFF_IDS = [103,104,110,111,117,118,124,125,131,132];
function isMinuteTariff(id){ return MINUTE_TARIFF_IDS.indexOf(parseInt(id)) !== -1; }

// ── localStorage ─────────────────────────────────────────
function loadData(){
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{"cases":{}, "seenOpIds":[]}'); }
    catch(e){ return {cases:{}, seenOpIds:[]}; }
}
function saveData(d){ try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(d)); }catch(e){} }
function getAuth(){ return window._godjiAuthToken||null; }
function getRole(){ return window._godjiHasuraRole||'club_admin'; }

function gql(op, query, vars){
    var auth=getAuth();
    if(!auth) return Promise.reject(new Error('Нет токена'));
    return fetch(API_URL,{
        method:'POST',
        headers:{'authorization':auth,'content-type':'application/json','x-hasura-role':getRole()},
        body:JSON.stringify({operationName:op,variables:vars,query:query})
    }).then(function(r){return r.json();}).then(function(d){
        if(d.errors&&d.errors.length) throw new Error(d.errors[0].message);
        return d.data;
    });
}

// ── Отслеживаем активные сеансы ──────────────────────────
// Структура: { sessionId: { userId, walletId, nick, tariffId, tariffType, startTs, hadPacket } }
var _watchedSessions = {};
var _lastMaxOpId = 0;

// Обогащаем из getDashboardDevices
function updateWatchedSessions(data){
    var devs = data && data.getDashboardDevices && data.getDashboardDevices.devices;
    if(!devs) return;
    devs.forEach(function(dev){
        (dev.sessions||[]).forEach(function(s){
            if(!s||!s.id) return;
            var sid = String(s.id);
            var tariffId = s.tariff && s.tariff.id;
            var isMin = isMinuteTariff(tariffId);
            if(!_watchedSessions[sid]){
                _watchedSessions[sid] = {
                    sessionId: s.id,
                    userId:  s.user && s.user.id,
                    walletId: s.user && s.user.wallet && s.user.wallet.id,
                    nick:    s.user && (s.user.nickname || ''),
                    tariffId: tariffId,
                    isMinute: isMin,
                    hadPacketBefore: false, // был ли пакетный до переключения
                    startTs: Date.now(),
                };
            } else {
                var prev = _watchedSessions[sid];
                // Если раньше тариф был пакетным, а теперь стал почасовым — ПОДОЗРЕНИЕ
                if(!prev.isMinute && isMin){
                    prev.hadPacketBefore = true;
                    prev.switchedToMinuteTs = Date.now();
                }
                prev.tariffId = tariffId;
                prev.isMinute = isMin;
            }
        });
    });
}

// ── Polling операций ──────────────────────────────────────
var GQL_INIT = 'query BDInit($clubId:Int!){wallet_operations(where:{club_id:{_eq:$clubId}},order_by:{id:desc},limit:1){id}}';
var GQL_OPS  = 'query BDOps($since:Int!,$clubId:Int!){wallet_operations(where:{id:{_gt:$since},club_id:{_eq:$clubId}},order_by:{id:asc},limit:100){id amount money_type operation_type created_at user_id wallet_operation_digest{name description reservation_id}}}';
var GQL_DASH = 'query BDDash($clubId:Int!){getDashboardDevices(params:{clubId:$clubId}){devices{name sessions{id status endAt tariff{id name}user{id nickname wallet{id}}}}}}';

function initPolling(){
    gql('BDInit',GQL_INIT,{clubId:CLUB_ID}).then(function(d){
        var ops = d&&d.wallet_operations;
        if(ops&&ops.length) _lastMaxOpId = ops[0].id;
        setInterval(poll, POLL_MS);
        poll();
    }).catch(function(){
        setTimeout(initPolling, 5000);
    });
}

function poll(){
    if(!getAuth()) return;
    // Обновляем список активных сеансов
    gql('BDDash',GQL_DASH,{clubId:CLUB_ID}).then(updateWatchedSessions).catch(function(){});

    if(!_lastMaxOpId) return;
    gql('BDOps',GQL_OPS,{since:_lastMaxOpId,clubId:CLUB_ID}).then(function(d){
        var ops = d&&d.wallet_operations||[];
        if(!ops.length) return;
        ops.forEach(function(op){
            if(op.id>_lastMaxOpId) _lastMaxOpId=op.id;
            analyzeOp(op);
        });
    }).catch(function(){});
}

// ── Анализ операции ───────────────────────────────────────
// Структура детекции: { userId → { refundOps: [], switchTs } }
var _suspectMap = {}; // userId → { switchedTs, refundOps: [], sessionId }

function analyzeOp(op){
    if(!op.user_id) return;
    var uid = op.user_id;
    var name = (op.wallet_operation_digest&&op.wallet_operation_digest.name)||'';
    var desc = (op.wallet_operation_digest&&op.wallet_operation_digest.description)||'';
    var resId = op.wallet_operation_digest&&op.wallet_operation_digest.reservation_id;
    var ts = new Date(op.created_at).getTime();

    // Ищем: операция — возврат бонусов при завершении (deposit non_cash после cancel)
    var isRefund = op.operation_type==='deposit' && op.money_type==='non_cash';
    if(!isRefund) return;

    // Ищем подозреваемого — кто недавно переключился с пакета на почасовой
    var suspect = null;
    Object.keys(_watchedSessions).forEach(function(sid){
        var s = _watchedSessions[sid];
        if(s.userId !== uid) return;
        if(!s.hadPacketBefore) return;
        if(!s.switchedToMinuteTs) return;
        var timeSinceSwitch = ts - s.switchedToMinuteTs;
        if(timeSinceSwitch >= 0 && timeSinceSwitch <= WINDOW_MS){
            suspect = s;
        }
    });
    if(!suspect) return;

    // Нашли подозреваемого — теперь вычисляем размер возврата
    var refundAmount = Math.abs(op.amount);

    // Получаем стоимость фактически использованного почасового времени
    // Мы знаем: switchedToMinuteTs — момент переключения на почасовой
    // Сеанс завершился — значит использовалось время с момента переключения до завершения
    // Но у нас нет точного времени завершения — используем время операции возврата
    var minutesUsed = Math.ceil((ts - suspect.switchedToMinuteTs) / 60000);

    // Стоимость минуты для данного тарифа — запросим
    checkSuspect(uid, suspect, refundAmount, minutesUsed, op.id, resId, ts);
}

function checkSuspect(userId, sess, refundAmount, minutesUsed, opId, resId, ts){
    // Получаем данные пользователя для отображения
    gql('BDUser',
        'query BDUser($uid:String!,$clubId:Int!){users_by_pk(id:$uid){users_user_profile{login name surname}users_wallets(where:{club_id:{_eq:$clubId}},limit:1){id balance_amount balance_bonus}}}',
        {uid:userId,clubId:CLUB_ID}
    ).then(function(d){
        var u = d&&d.users_by_pk;
        var profile = u&&u.users_user_profile;
        var wallet = u&&u.users_wallets&&u.users_wallets[0];
        var nick = (profile&&profile.login)||sess.nick||userId.slice(0,8);
        var name = profile?([profile.surname,profile.name].filter(Boolean).join(' ')):nick;
        var walletId = (wallet&&wallet.id)||sess.walletId;
        var bonusBalance = wallet?Math.round(wallet.balance_bonus):null;

        // Проверяем: сумма возврата значительно превышает стоимость минуты × minutesUsed
        // Если возврат > minutesUsed + 30 (30 — погрешность) → багоюз
        // Минимальный порог: 50 бонусов (фильтруем мелочь)
        var THRESHOLD = 50;
        var excess = refundAmount - minutesUsed; // грубая оценка
        if(refundAmount < THRESHOLD) return; // слишком мало — не стоит внимания
        if(excess < 20) return; // возврат не превышает ожидаемого — ок

        // Показываем уведомление
        showBugAlert({
            userId: userId,
            nick: nick,
            name: name,
            walletId: walletId,
            bonusBalance: bonusBalance,
            refundAmount: refundAmount,
            minutesUsed: minutesUsed,
            excess: excess,
            opId: opId,
            resId: resId,
            ts: ts,
        });

        // Записываем в журнал
        var data = loadData();
        if(!data.cases) data.cases={};
        data.cases['bug_'+opId] = {
            userId: userId, nick: nick, name: name,
            refundAmount: refundAmount, minutesUsed: minutesUsed,
            excess: excess, opId: opId, resId: resId,
            ts: ts, status: 'pending'
        };
        saveData(data);

        // Добавляем операцию в историю операций
        notifyOPJ(userId, nick, refundAmount, excess, opId);

        // Удаляем из watched (уже сработало)
        Object.keys(_watchedSessions).forEach(function(sid){
            if(_watchedSessions[sid].userId===userId) delete _watchedSessions[sid];
        });

    }).catch(function(){});
}

// ── Уведомление с подтверждением ─────────────────────────
function showBugAlert(info){
    var old=document.getElementById('godji-bug-alert');
    if(old) old.remove();

    var overlay=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999998;display:flex;align-items:center;justify-content:center;');
    overlay.id='godji-bug-alert';

    var box=mk('div','background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.3);width:480px;max-width:96vw;font-family:inherit;overflow:hidden;border:2px solid #cc0001;');

    // Заголовок
    var hdr=mk('div','background:#cc0001;padding:14px 20px;display:flex;align-items:center;gap:10px;');
    hdr.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'+
        '<span style="color:#fff;font-size:15px;font-weight:700;">⚠ Обнаружен багоюз!</span>';

    // Тело
    var body=mk('div','padding:20px;');

    var clientLink='/clients/'+info.userId;
    body.innerHTML=
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 12px;background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;">'+
            '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cc0001" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'+
            '<div><a href="'+clientLink+'" style="color:#cc0001;font-weight:700;text-decoration:none;font-size:14px;">@'+esc(info.nick)+'</a>'+
            (info.name&&info.name!==info.nick?'<span style="font-size:12px;color:#666;margin-left:6px;">'+esc(info.name)+'</span>':'')+
            '</div>'+
        '</div>'+
        '<table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:14px;">'+
            '<tr><td style="padding:5px 0;color:#666;">Возвращено ERP:</td><td style="font-weight:700;color:#cc0001;text-align:right;">'+info.refundAmount+' бонусов</td></tr>'+
            '<tr><td style="padding:5px 0;color:#666;">Расчётное (за '+info.minutesUsed+' мин):</td><td style="text-align:right;color:#333;">'+(info.refundAmount-info.excess)+' бонусов</td></tr>'+
            '<tr style="border-top:1px solid #f0f0f0;"><td style="padding:5px 0;font-weight:600;color:#333;">Лишних бонусов:</td><td style="font-weight:700;color:#cc0001;text-align:right;">+'+Math.round(info.excess)+'</td></tr>'+
            (info.bonusBalance!==null?'<tr><td style="padding:5px 0;color:#666;">Баланс бонусов:</td><td style="text-align:right;color:#333;">'+info.bonusBalance+'</td></tr>':'')+
        '</table>'+
        '<div style="font-size:12px;color:#888;margin-bottom:6px;">Схема: пакетный тариф → продление почасовым → завершение → возврат лишних бонусов</div>';

    if(info.bonusBalance!==null){
        body.innerHTML+='<div style="background:#fff0f0;border:1px solid #fca5a5;border-radius:8px;padding:10px 12px;font-size:12px;color:#cc0001;margin-bottom:14px;">'+
            '<b>Предложение:</b> Списать <b>'+Math.round(info.excess)+' бонусов</b> с баланса клиента (лишний возврат)'+
        '</div>';
    }

    // Кнопки
    var foot=mk('div','display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid #f0f0f0;background:#fafafa;');

    var btnIgnore=mk('button','background:#f5f5f5;border:1px solid #e0e0e0;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#666;');
    btnIgnore.textContent='Игнорировать';
    btnIgnore.onclick=function(){
        overlay.remove();
        markCase(info.opId,'ignored');
        addNoteToClient(info.userId, info.nick, 'багоюз', false);
    };

    var btnWriteoff=mk('button','background:#cc0001;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#fff;');
    btnWriteoff.textContent='Списать '+Math.round(info.excess)+' бонусов';
    btnWriteoff.onclick=function(){
        btnWriteoff.disabled=true;
        btnWriteoff.textContent='Списываем…';
        if(!info.walletId){
            showToast('Нет walletId — невозможно списать',false);
            overlay.remove(); return;
        }
        withdrawBonus(info.walletId, Math.round(info.excess), info.userId, info.nick)
            .then(function(){
                overlay.remove();
                markCase(info.opId,'deducted');
                addNoteToClient(info.userId, info.nick, 'багоюз', true);
                showToast('✓ Списано '+Math.round(info.excess)+' бонусов с @'+info.nick, true);
            })
            .catch(function(e){
                showToast('✗ Ошибка: '+e.message, false);
                btnWriteoff.disabled=false;
                btnWriteoff.textContent='Списать '+Math.round(info.excess)+' бонусов';
            });
    };

    foot.appendChild(btnIgnore);
    foot.appendChild(btnWriteoff);
    box.appendChild(hdr); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Звук
    try{ (new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAA')).play(); }catch(e){}
}

// ── API: списание бонусов ─────────────────────────────────
function withdrawBonus(walletId, amount, userId, nick){
    return gql('BDBugDeduct',
        'mutation BDBugDeduct($walletId:Int!,$amount:Float!,$desc:String){walletWithdrawWithBonus(params:{walletId:$walletId,amount:$amount,description:$desc}){operationId}}',
        {walletId:parseInt(walletId), amount:amount, desc:'Списание бонусов (багоюз: пакет→почасовой→завершение). Ник: @'+nick}
    );
}

// ── Заметка на карточке клиента ──────────────────────────
function addNoteToClient(userId, nick, type, deducted){
    var key = 'godji_note_v2_'+userId;
    var existing = {};
    try{ existing = JSON.parse(localStorage.getItem(key)||'{}'); }catch(e){}

    var ts = new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    var newText = '⚠ БАГОЮЗ ('+ts+')' + (deducted?' — бонусы списаны':' — не списано');

    // Добавляем к существующей заметке
    var currentHtml = existing.html||'';
    if(currentHtml && currentHtml !== '<br>'){
        currentHtml += '<br>' + newText;
    } else {
        currentHtml = newText;
    }

    var note = {
        html: currentHtml,
        fontSize: existing.fontSize||15,
        bold: true,
        italic: false,
        color: '#e03131'
    };
    try{ localStorage.setItem(key, JSON.stringify(note)); }catch(e){}
}

// ── Уведомление в историю операций ───────────────────────
function notifyOPJ(userId, nick, refundAmount, excess, opId){
    // Добавляем синтетическую запись в godji_opjournal
    try{
        var journal = JSON.parse(localStorage.getItem('godji_opjournal')||'[]');
        journal.push({
            opId: 'bug_'+opId,
            id:   'bug_'+opId,
            ts:   Date.now(),
            type: 'bug_exploit',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/></svg>',
            label: 'Багоюз',
            color: '#cc0001',
            bg: '#fff0f0',
            amount: '+'+Math.round(excess)+' G (лишних)',
            comment: 'Пакет→почасовой→завершение. Возврат: '+refundAmount+' G',
            nick: nick,
            pc: '',
            suspicious: false,
            isBugExploit: true,
        });
        // Обрезаем до 72 часов
        var cutoff = Date.now() - 72*3600000;
        journal = journal.filter(function(r){return r.ts>cutoff;});
        localStorage.setItem('godji_opjournal', JSON.stringify(journal));
    }catch(e){}
}

function markCase(opId, status){
    var data=loadData();
    var key='bug_'+opId;
    if(data.cases[key]) data.cases[key].status=status;
    saveData(data);
}

// ── Утилиты ───────────────────────────────────────────────
function mk(tag,css){ var e=document.createElement(tag); if(css) e.style.cssText=css; return e; }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var _toastEl=null;
function showToast(msg,ok){
    if(_toastEl&&_toastEl.parentNode) _toastEl.parentNode.removeChild(_toastEl);
    var t=mk('div','position:fixed;bottom:70px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:10px;font-size:13px;font-weight:500;font-family:inherit;z-index:999999;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.3);'+(ok?'background:#166534;color:#bbf7d0;':'background:#7f1d1d;color:#fecaca;'));
    _toastEl=t; t.textContent=msg; document.body.appendChild(t);
    setTimeout(function(){ if(t.parentNode){ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},300); } },4000);
}

// ── Регистрация типа в истории операций ──────────────────
// Если godji_operations_journal поддерживает TYPE_OPTS — добавляем
setTimeout(function(){
    if(window._godjiOPJRegisterType){
        window._godjiOPJRegisterType('bug_exploit','⚠ Багоюз','#cc0001','#fff0f0');
    }
}, 2000);

// ── Запуск ───────────────────────────────────────────────
function tryInit(){
    if(!getAuth()){
        setTimeout(tryInit, 1000); return;
    }
    initPolling();
}

if(document.body){ tryInit(); }
else{ document.addEventListener('DOMContentLoaded', tryInit); }

})();

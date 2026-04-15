// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Журнал всех операций через polling wallet_operations
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
'use strict';

var STORAGE_KEY = 'godji_opjournal';
var SAFE_KEY    = 'godji_opjournal_safe';
var MAX_DAYS    = 3;
var CLUB_ID     = 14;
var POLL_MS     = 10000;

var _authToken  = null;
var _hasuraRole = 'club_admin';
var _lastMaxId  = null;  // последний виденный ID из wallet_operations
var _seenIds    = {};    // быстрая проверка дублей

// ── Перехват токена (через inline script как касса) ───────
(function(){
    var code = [
        '(function(){',
        '  if(window.__gojTokenHooked) return; window.__gojTokenHooked=true;',
        '  var _f=window.fetch;',
        '  window.fetch=function(url,opts){',
        '    if(opts&&opts.headers&&opts.headers.authorization){',
        '      window._godjiAuthToken=opts.headers.authorization;',
        '      window._godjiHasuraRole=opts.headers["x-hasura-role"]||"club_admin";',
        '    }',
        '    return _f.apply(this,arguments);',
        '  };',
        '})();'
    ].join('\n');
    function inject(){
        var root=document.head||document.documentElement;
        if(!root){setTimeout(inject,10);return;}
        var s=document.createElement('script');
        s.textContent=code;
        root.appendChild(s);s.remove();
    }
    inject();
})();

function getAuth(){
    return window._godjiAuthToken||_authToken||null;
}
function getRole(){
    return window._godjiHasuraRole||_hasuraRole||'club_admin';
}

// ── localStorage ──────────────────────────────────────────
function loadJournal(){
    try{
        var raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
        var cutoff=Date.now()-MAX_DAYS*86400000;
        var result = raw.filter(function(r){return r.ts>cutoff;});
        // Миграция: исправляем старые записи с G у сессионных операций

        return result;
    }catch(e){return[];}
}
function saveJournal(j){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(j));}catch(e){}
}
function loadSafeIds(){
    try{return JSON.parse(localStorage.getItem(SAFE_KEY)||'[]');}catch(e){return[];}
}
function saveSafeIds(ids){
    try{localStorage.setItem(SAFE_KEY,JSON.stringify(ids));}catch(e){}
}
function markSafe(entryId){
    var ids=loadSafeIds();
    if(ids.indexOf(entryId)===-1){ids.push(entryId);saveSafeIds(ids);}
}

// ── Добавить запись ───────────────────────────────────────
function addEntry(entry){
    if(!entry.id) entry.id='e'+Date.now()+Math.random();
    if(!entry.ts) entry.ts=Date.now();

    var journal=loadJournal();
    // Дедупликация: проверяем и в памяти и в журнале
    if(entry.opId){
        if(_seenIds[entry.opId]) return;
        if(journal.some(function(r){return r.opId===entry.opId;})) {
            _seenIds[entry.opId]=true; return;
        }
        _seenIds[entry.opId]=true;
    }

    journal.push(entry); // push в конец — новые внизу
    var cutoff=Date.now()-MAX_DAYS*86400000;
    journal=journal.filter(function(r){return r.ts>cutoff;});
    saveJournal(journal);
    updateModalIfVisible();
    updateBadge();
}

// ── Определение типа операции по digest.name ─────────────
function classifyOp(op){
    var name=(op.wallet_operation_digest&&op.wallet_operation_digest.name)||'';
    var desc=(op.wallet_operation_digest&&op.wallet_operation_digest.description)||'';
    var resId=op.wallet_operation_digest&&op.wallet_operation_digest.reservation_id;
    var amt=op.amount||0;
    var nl=name.toLowerCase();

    var type, icon, label, color, bg;

    if(nl.indexOf('пополнение наличными')!==-1){
        type='deposit_cash'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M6 12h.01M18 12h.01"/></svg>'; label='Пополнение наличными'; color='#166534'; bg='#dcfce7';
    } else if(nl.indexOf('пополнение по карте')!==-1||nl.indexOf('пополнение картой')!==-1||
              (nl.indexOf('пополнение')!==-1&&op.money_type==='non_cash'&&amt>0&&!resId&&nl.indexOf('бонус')===-1)){
        type='deposit_card'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'; label='Пополнение по карте'; color='#1d4ed8'; bg='#dbeafe';
    } else if(nl.indexOf('пополнение бонусов')!==-1||nl.indexOf('начисление бонусов')!==-1){
        type='deposit_bonus'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/></svg>'; label='Начисление бонусов'; color='#c87800'; bg='#fff4e0';
    } else if(nl.indexOf('возврат бонусов')!==-1||nl.indexOf('возврат стоимости')!==-1||nl.indexOf('возврат')!==-1){
        // Возврат бонусов при завершении — НЕ подозрительно, это стандарт
        type='refund_bonus'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14l-4-4 4-4"/><path d="M5 10h10a4 4 0 1 1 0 8h-1"/></svg>'; label='Возврат бонусов'; color='#0369a1'; bg='#e0f2fe';
    } else if(nl.indexOf('бесплатное время')!==-1||nl.indexOf('бесплатн')!==-1){
        type='free_time'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>'; label='Бесплатное время'; color='#007799'; bg='#e8f8ff';
    } else if(nl.indexOf('продление')!==-1||nl.indexOf('prolongat')!==-1){
        type='session_prolong'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>';
        label='Продление сеанса';
        color='#3355cc'; bg='#e8f0ff';
    } else if(nl.indexOf('бронирование')!==-1||(nl.indexOf('списание')!==-1&&nl.indexOf('сессию')!==-1)){
        // Списание за бронирование — это денежная операция при запуске, показываем как часть продления/запуска
        type='session_prolong'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>'; label='Списание за сеанс'; color='#3355cc'; bg='#e8f0ff';
    } else if(nl.indexOf('пересадк')!==-1||nl.indexOf('перевод')!==-1||nl.indexOf('transfer')!==-1||nl.indexOf('переместил')!==-1){
        type='session_transfer'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>'; label='Пересадка'; color='#cc6600'; bg='#fff0e0';
    } else if(nl.indexOf('завершени')!==-1&&nl.indexOf('сессии')!==-1){
        type='session_finish'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'; label='Завершение сеанса'; color='#cc2200'; bg='#fde8e8';
    } else if(nl.indexOf('наш скрипт')!==-1||nl.indexOf('списание с баланса')!==-1||
              (op.money_type==='cash'&&op.operation_type==='withdraw')){
        type='debit_money'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'; label='Списание с баланса'; color='#991b1b'; bg='#fee2e2';
    } else if(op.operation_type==='withdraw'&&op.money_type==='non_cash'&&!resId){
        // Списание бонусов вручную (не за сессию)
        type='debit_bonus'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'; label='Списание бонусов'; color='#7c3aed'; bg='#ede9fe';
    } else if(op.operation_type==='withdraw'&&resId){
        type='session_prolong'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>';
        label='Продление сеанса';
        color='#3355cc'; bg='#e8f0ff';
    } else if(amt>0&&op.operation_type==='deposit'&&op.money_type==='cash'){
        type='deposit_cash'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M6 12h.01M18 12h.01"/></svg>'; label='Пополнение наличными'; color='#166534'; bg='#dcfce7';
    } else if(amt>0&&op.operation_type==='deposit'&&op.money_type==='non_cash'){
        type='deposit_bonus'; icon='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/></svg>'; label='Начисление бонусов'; color='#c87800'; bg='#fff4e0';
    } else {
        type='other'; icon='•'; label=name||'Операция'; color='#555'; bg='#f5f5f5';
    }

    return {type:type, icon:icon, label:label, color:color, bg:bg,
            name:name, desc:desc, resId:resId};
}

// ── Детектор подозрительных ───────────────────────────────
var _recentByWallet={};

function checkSuspicious(op, userId, cls){
    var amt=op.amount;
    if(!amt||amt<=0||op.operation_type!=='deposit') return false;
    // Не считаем подозрительными: возврат бонусов, бесплатное время, пополнение бонусами за сессию
    if(cls.type==='refund_bonus'||cls.type==='free_time') return false;
    if(cls.type==='deposit_bonus'&&op.wallet_operation_digest&&op.wallet_operation_digest.reservation_id) return false;
    // Только реальные пополнения (наличные/карта)
    if(cls.type!=='deposit_cash'&&cls.type!=='deposit_card') return false;

    var key=userId+'_'+Math.round(amt*100);
    var now=Date.now();
    var opTime=new Date(op.created_at).getTime();

    if(!_recentByWallet[key]) _recentByWallet[key]=[];
    _recentByWallet[key]=_recentByWallet[key].filter(function(t){return opTime-t<15000;});

    var count=_recentByWallet[key].length;
    _recentByWallet[key].push(opTime);

    return count>=1;
}

// ── GQL запрос ────────────────────────────────────────────
var GQL_OPS = 'query GojOps($since:Int!,$clubId:Int!){wallet_operations(where:{id:{_gt:$since},club_id:{_eq:$clubId}},order_by:{id:asc},limit:50){id amount money_type operation_type created_at user_id user{phone users_user_profile{name surname login}} wallet_operation_digest{name description reservation_id reservation{reservations_club_device{name}}}}}';

function fetchNewOps(){
    var auth=getAuth();
    if(!auth||_lastMaxId===null) return;

    fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':auth,'content-type':'application/json','x-hasura-role':getRole()},
        body:JSON.stringify({operationName:'GojOps',variables:{since:_lastMaxId,clubId:CLUB_ID},query:GQL_OPS})
    }).then(function(r){return r.json();}).then(function(data){
        var ops=data&&data.data&&data.data.wallet_operations;
        if(!ops||!ops.length) return;

        ops.forEach(function(op){
            if(op.id>_lastMaxId) _lastMaxId=op.id;

            var cls=classifyOp(op);
            var isSusp=checkSuspicious(op,op.user_id,cls);

            // Формируем строку клиента
            var userInfo = '';
            var userUrl = op.user_id ? '/clients/'+op.user_id : '';
            if(op.user && op.user.users_user_profile){
                var p=op.user.users_user_profile;
                var nick=p.login||'';
                var name2=(p.name||'')+(p.surname?' '+p.surname:'');
                userInfo = nick ? '@'+nick : name2;
            }

            addEntry({
                opId: op.id,
                id: 'op'+op.id,
                ts: new Date(op.created_at).getTime(),
                type: isSusp ? 'suspicious' : cls.type,
                icon: isSusp ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' : cls.icon,
                label: isSusp ? 'Подозрит.: '+cls.label : cls.label,
                color: isSusp ? '#b45309' : cls.color,
                bg: isSusp ? '#fef3c7' : cls.bg,
                amount: formatAmt(op.amount, op.money_type),
                comment: cls.desc||'',
                extra: (function(){
                    var e='';
                    if(cls.resId){
                        e='Сеанс #'+cls.resId;
                        var dev=op.wallet_operation_digest&&op.wallet_operation_digest.reservation&&
                                op.wallet_operation_digest.reservation.reservations_club_device&&
                                op.wallet_operation_digest.reservation.reservations_club_device.name;
                        if(dev) e+=' · ПК '+dev;
                    } else {
                        e='';
                    }
                    return e;
                })(),
                client: userInfo,
                clientUrl: userUrl,
                suspicious: isSusp,
                origType: cls.type,
                origLabel: cls.label,
                origIcon: cls.icon,
                origColor: cls.color,
                origBg: cls.bg
            });

            if(isSusp) showSuspiciousToast();
        });
    }).catch(function(){});
}

// ── Инициализация — получаем последний ID ─────────────────
var GQL_INIT = 'query GojInit($clubId:Int!){wallet_operations(where:{club_id:{_eq:$clubId}},order_by:{id:desc},limit:1){id}}';

// Отдельный polling для резервирований (сеансы)
// ── Слушаем события сеансов от godji_session_history ─────
// session_history делает DOM-скан каждые 2 сек и записывает события в localStorage
var _lastSessionEventTs = 0;

function checkSessionEvents(){
    try{
        var raw = localStorage.getItem('godji_session_events');
        if(!raw) return;
        var data = JSON.parse(raw);
        if(!data||!data.ts||data.ts<=_lastSessionEventTs) return;
        _lastSessionEventTs = data.ts;

        var events = data.events||[];
        events.forEach(function(ev){
            var nick = ev.nick ? '@'+ev.nick : (ev.userName||'');
            var extra = 'ПК '+ev.pc+(ev.pastTime?' · '+ev.pastTime:'');
            var clientUrl = ev.clientUrl||'';
            var evTs = ev.ts||Date.now();

            if(ev.type==='transfer'){
                var opId = 'sess_transfer_'+ev.pc+'_'+evTs;
                addEntry({opId:opId,id:opId,ts:evTs,
                    type:'session_transfer',icon:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',label:'Пересадка',
                    color:'#cc6600',bg:'#fff0e0',amount:'',
                    comment:(ev.toNick?'→ @'+ev.toNick:''),
                    extra:extra,client:nick,clientUrl:clientUrl,suspicious:false});
            } else {
                // Завершение сеанса
                var opId2 = 'sess_fin_'+ev.pc+'_'+evTs;
                addEntry({opId:opId2,id:opId2,ts:evTs,
                    type:'session_finish',icon:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',label:'Завершение сеанса',
                    color:'#cc2200',bg:'#fde8e8',amount:'',comment:'',
                    extra:extra,client:nick,clientUrl:clientUrl,suspicious:false});
            }
        });
    }catch(e){}
}

function initLastId(){
    var auth=getAuth();
    if(!auth){ setTimeout(initLastId,1000); return; }

    fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':auth,'content-type':'application/json','x-hasura-role':getRole()},
        body:JSON.stringify({operationName:'GojInit',variables:{clubId:CLUB_ID},query:GQL_INIT})
    }).then(function(r){return r.json();}).then(function(data){
        var ops=data&&data.data&&data.data.wallet_operations;
        if(ops&&ops.length){
            _lastMaxId=ops[0].id;
        } else {
            _lastMaxId=0;
        }
        // Загружаем seenIds из существующего журнала чтобы не дублировать
        var journal=loadJournal();
        journal.forEach(function(e){ if(e.opId) _seenIds[e.opId]=true; });
        // Также обновляем _lastMaxId если в журнале есть более свежие записи
        journal.forEach(function(e){
            if(e.opId && typeof e.opId==='number' && e.opId>_lastMaxId) _lastMaxId=e.opId;
        });
        // Инициализируем _lastReservationId
        // Инициализируем метку времени для событий сеансов
        _lastSessionEventTs = Date.now();

        // Запускаем polling операций и проверку событий сеансов
        setInterval(fetchNewOps, POLL_MS);
        setInterval(checkSessionEvents, 2500); // чуть чаще чем scan() в session_history
    }).catch(function(){
        setTimeout(initLastId,3000);
    });
}

// Ждём токен потом инициализируемся

// ── Слушаем пересадку через __gcb__ (касса перехватывает все запросы) ──
document.addEventListener('__gcb__', function(ev){
    var d=ev.detail;
    if(!d||!d.res||!d.res.data) return;
    var data=d.res.data;
    // Пересадка: userReservationTransferDevice
    if(data.userReservationTransferDevice){
        var result=data.userReservationTransferDevice;
        var resId=result.reservationId||'';
        // Пытаемся получить info из запроса
        var req=''; try{req=JSON.parse(d.req);}catch(e){}
        var deviceFrom=req.variables&&req.variables.deviceFrom||'';
        var deviceTo=req.variables&&req.variables.deviceTo||'';
        var extra=deviceFrom&&deviceTo?'ПК '+deviceFrom+' → ПК '+deviceTo:(resId?'Сеанс #'+resId:'');
        var opId='transfer_res_'+(resId||Date.now());
        addEntry({opId:opId,id:opId,ts:Date.now(),
            type:'session_transfer',
            icon:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>',
            label:'Пересадка',color:'#cc6600',bg:'#fff0e0',
            amount:'',comment:'',extra:extra,client:'',clientUrl:'',suspicious:false});
    }
});

function waitForToken(){
    if(getAuth()){ initLastId(); return; }
    setTimeout(waitForToken,1000);
}
setTimeout(waitForToken,2000);

// ── Слушаем списания от godji_wallet_debit ────────────────
document.addEventListener('__godji_debit__', function(ev){
    var dd=ev.detail;
    if(!dd) return;
    addEntry({
        opId:'debit_'+dd.ts,
        id:'debit_'+dd.ts,
        ts:dd.ts||Date.now(),
        type:'debit_money', icon:'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>', label:'Списание с баланса',
        color:'#991b1b', bg:'#fee2e2',
        amount:formatAmt(-Math.abs(dd.amount),"cash"),
        comment:dd.comment||'', extra:''
    });
});

// ── Уведомление о подозрительной операции ─────────────────
function showSuspiciousToast(){
    if(document.getElementById('goj-sus-toast')) return;
    var t=document.createElement('div');
    t.id='goj-sus-toast';
    t.style.cssText='position:fixed;bottom:24px;right:24px;background:#b45309;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:999999;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:inherit;line-height:1.4;';
    t.innerHTML='⚠️ Подозрительная операция!<br><span style="font-weight:400;font-size:12px;">Нажмите для проверки</span>';
    t.addEventListener('click',function(){t.remove();_filterType='suspicious';showModal();});
    document.body.appendChild(t);
    setTimeout(function(){if(t.parentNode)t.remove();},8000);
}

// ── Форматирование ────────────────────────────────────────
function formatAmt(n, moneyType){
    if(n===undefined||n===null||n==='') return '';
    var v=parseFloat(n); if(isNaN(v)) return '';
    var sym = moneyType==='non_cash' ? ' G' : ' ₽';
    return (v>=0?'+':'')+v.toFixed(v%1?2:0)+sym;
}
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── Модальное окно ────────────────────────────────────────
var _modal=null,_overlay=null,_visible=false;
var _filterTypes=[],_filterText='',_filterNick='';

function buildModal(){
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);
    _modal=document.createElement('div');
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:900px;max-width:96vw;max-height:85vh;background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_visible)hideModal();});
}

function renderModal(){
    if(!_modal) return;
    _modal.innerHTML='';
    var journal=loadJournal();
    var safeIds=loadSafeIds();
    var suspCount=journal.filter(function(r){return r.suspicious&&safeIds.indexOf(r.id)===-1;}).length;

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var hL=document.createElement('div');
    hL.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    var hIco=document.createElement('div');
    hIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    var hTit=document.createElement('span');
    hTit.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;';
    hTit.textContent='История операций (7 дней)';
    hL.appendChild(hIco); hL.appendChild(hTit);
    if(suspCount>0){
        var sB=document.createElement('span');
        sB.style.cssText='background:#b45309;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;cursor:pointer;';
        sB.textContent='⚠️ '+suspCount+' подозрительных';
        sB.addEventListener('click',function(){_filterTypes=['suspicious'];renderModal();});
        hL.appendChild(sB);
    }
    var hR=document.createElement('div');
    hR.style.cssText='display:flex;align-items:center;gap:8px;';
    var clrBtn=document.createElement('button');
    clrBtn.style.cssText='background:#fff0f0;border:none;color:#cc2200;font-size:12px;cursor:pointer;padding:4px 10px;border-radius:6px;font-family:inherit;font-weight:600;';
    clrBtn.textContent='Очистить';
    clrBtn.addEventListener('click',function(){
        if(!confirm('Очистить историю?')) return;
        localStorage.removeItem(STORAGE_KEY);
        _seenIds={};
        renderModal(); updateBadge();
    });
    var xBtn=document.createElement('button');
    xBtn.style.cssText='background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:0;line-height:1;';
    xBtn.textContent='×'; xBtn.addEventListener('click',hideModal);
    hR.appendChild(clrBtn); hR.appendChild(xBtn);
    hdr.appendChild(hL); hdr.appendChild(hR);
    _modal.appendChild(hdr);

    // Фильтры — два ряда: типы (мультивыбор тегами) + ник + поиск
    var fWrap=document.createElement('div');
    fWrap.style.cssText='border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;';

    // Ряд 1: теги типов
    var typeRow=document.createElement('div');
    typeRow.style.cssText='display:flex;flex-wrap:wrap;gap:5px;padding:8px 16px 6px;';

    var TYPE_OPTS=[
        ['suspicious','⚠️ Подозрит.','#b45309','#fef3c7'],
        ['deposit_cash','💵 Нал.','#166534','#dcfce7'],
        ['deposit_card','💳 Карта','#1d4ed8','#dbeafe'],
        ['deposit_bonus','🎁 Бонусы','#c87800','#fff4e0'],
        ['refund_bonus','↩️ Возврат','#0369a1','#e0f2fe'],
        ['free_time','⌛ Бесплатно','#007799','#e8f8ff'],
        ['session_start','▶️ Запуск','#0066cc','#e0f0ff'],
        ['session_finish','⏹️ Заверш.','#cc2200','#fde8e8'],
        ['session_prolong','⏩ Продление','#3355cc','#e8f0ff'],
        ['session_transfer','🔀 Пересадка','#cc6600','#fff0e0'],
        ['debit_money','➖₽','#991b1b','#fee2e2'],
        ['debit_bonus','➖🎁','#7c3aed','#ede9fe'],
        ['other','• Прочее','#555','#f5f5f5']
    ];

    TYPE_OPTS.forEach(function(o){
        var tag=document.createElement('button');
        tag.type='button';
        var active=_filterTypes.indexOf(o[0])!==-1;
        tag.style.cssText='padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600;cursor:pointer;border:1.5px solid '+(active?o[2]:'#e0e0e0')+';'+
            'background:'+(active?o[3]:'#fff')+';color:'+(active?o[2]:'#888')+';transition:all 0.12s;white-space:nowrap;';
        tag.textContent=o[1];
        tag.addEventListener('click',function(){
            var idx=_filterTypes.indexOf(o[0]);
            if(idx===-1) _filterTypes.push(o[0]); else _filterTypes.splice(idx,1);
            renderModal();
        });
        typeRow.appendChild(tag);
    });
    fWrap.appendChild(typeRow);

    // Ряд 2: ник + поиск
    var fBar=document.createElement('div');
    fBar.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 16px 8px;flex-wrap:wrap;';

    // Фильтр по нику
    var allNicks=[''];
    journal.forEach(function(r){ if(r.client&&allNicks.indexOf(r.client)===-1) allNicks.push(r.client); });
    allNicks.sort();
    var nickSelect=document.createElement('select');
    nickSelect.style.cssText='background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;max-width:150px;';
    allNicks.forEach(function(n){
        var opt=document.createElement('option'); opt.value=n; opt.textContent=n||'Все клиенты';
        if(n===_filterNick) opt.selected=true;
        nickSelect.appendChild(opt);
    });
    nickSelect.addEventListener('change',function(){_filterNick=this.value;renderModal();});

    var searchInp=document.createElement('input');
    searchInp.type='text'; searchInp.placeholder='Поиск…'; searchInp.value=_filterText;
    searchInp.style.cssText='background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;outline:none;width:160px;';
    searchInp.addEventListener('input',function(){_filterText=this.value.toLowerCase();renderModal();});

    // Сброс фильтров
    if(_filterTypes.length||_filterNick||_filterText){
        var resetBtn=document.createElement('button');
        resetBtn.type='button';
        resetBtn.style.cssText='padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid #e0e0e0;background:#fff;color:#888;';
        resetBtn.textContent='× Сбросить';
        resetBtn.addEventListener('click',function(){_filterTypes=[];_filterNick='';_filterText='';renderModal();});
        fBar.appendChild(resetBtn);
    }

    fBar.appendChild(nickSelect); fBar.appendChild(searchInp);
    fWrap.appendChild(fBar);
    _modal.appendChild(fWrap);

    // Тело
    var body=document.createElement('div');
    body.style.cssText='overflow-y:auto;flex:1;';
    _modal.appendChild(body);

    var filtered=journal.slice();
    if(_filterTypes.length){
        filtered=filtered.filter(function(r){
            // suspicious — отдельная проверка
            if(_filterTypes.indexOf('suspicious')!==-1&&r.suspicious&&safeIds.indexOf(r.id)===-1) return true;
            return _filterTypes.indexOf(r.type)!==-1;
        });
    }
    if(_filterNick){
        filtered=filtered.filter(function(r){ return r.client===_filterNick; });
    }
    if(_filterText){
        filtered=filtered.filter(function(r){
            return [r.comment||'',r.extra||'',r.amount||'',r.label||'',r.client||''].join(' ').toLowerCase().indexOf(_filterText)!==-1;
        });
    }

    if(!filtered.length){
        body.innerHTML='<div style="text-align:center;color:#aaa;padding:50px;font-size:14px;">Нет операций</div>';
        return;
    }
    // journal уже хранит от старых к новым (push в конец) — новые внизу

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;';
    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Время','100px'],['Тип','200px'],['Клиент','110px'],['Сеанс / ПК','110px'],['Сумма','80px'],['Комментарий','auto']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 14px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #efefef;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent=c[0]; hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);

    var tbody=document.createElement('tbody');
    filtered.forEach(function(rec){
        var isSafe=safeIds.indexOf(rec.id)!==-1;
        var isSusp=rec.suspicious&&!isSafe;

        var tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid #f5f5f5;transition:background 0.1s;'+(isSusp?'background:#fffbeb;':'');
        tr.addEventListener('mouseenter',function(){tr.style.background=isSusp?'#fef3c7':'#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background=isSusp?'#fffbeb':'';});

        var tdDate=document.createElement('td');
        tdDate.style.cssText='padding:9px 14px;color:#888;white-space:nowrap;font-size:12px;';
        tdDate.textContent=fmtDate(rec.ts);

        var tdType=document.createElement('td');
        tdType.style.cssText='padding:9px 14px;';
        var badge=document.createElement('span');
        badge.style.cssText='background:'+(rec.bg||'#f5f5f5')+';color:'+(rec.color||'#555')+';border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;';
        if(rec.icon){
            var icoSpan=document.createElement('span');
            icoSpan.style.cssText='display:inline-flex;align-items:center;flex-shrink:0;';
            icoSpan.innerHTML=rec.icon;
            badge.appendChild(icoSpan);
        }
        var lblSpan=document.createElement('span');
        lblSpan.textContent=rec.label;
        badge.appendChild(lblSpan);
        tdType.appendChild(badge);

        var tdExtra=document.createElement('td');
        tdExtra.style.cssText='padding:9px 14px;color:#555;font-size:12px;white-space:nowrap;';
        tdExtra.textContent=rec.extra||'—';

        var tdAmt=document.createElement('td');
        tdAmt.style.cssText='padding:9px 14px;white-space:nowrap;font-weight:600;';
        if(rec.amount){
            tdAmt.style.color=rec.amount.charAt(0)==='+' ? '#166534' : '#991b1b';
            tdAmt.textContent=rec.amount;
        } else { tdAmt.style.color='#bbb'; tdAmt.textContent='—'; }

        var tdCmt=document.createElement('td');
        tdCmt.style.cssText='padding:9px 14px;font-size:12px;max-width:200px;word-break:break-word;';
        var cmtSpan=document.createElement('span');
        cmtSpan.style.color=rec.comment?'#555':'#ccc';
        cmtSpan.textContent=rec.comment||'—';
        tdCmt.appendChild(cmtSpan);

        if(isSusp){
            var safeBtn=document.createElement('button');
            safeBtn.style.cssText='margin-left:8px;background:#dcfce7;border:none;color:#166534;font-size:11px;cursor:pointer;padding:2px 7px;border-radius:4px;font-family:inherit;font-weight:600;';
            safeBtn.textContent='✓ Безопасно';
            safeBtn.addEventListener('click',function(ev){
                ev.stopPropagation();
                markSafe(rec.id);
                // Откатываем тип к оригинальному
                var journal=loadJournal();
                var idx=journal.findIndex(function(r){return r.id===rec.id;});
                if(idx!==-1&&rec.origType){
                    journal[idx].type=rec.origType;
                    journal[idx].label=rec.origLabel||rec.origType;
                    journal[idx].icon=rec.origIcon||'•';
                    journal[idx].color=rec.origColor||'#555';
                    journal[idx].bg=rec.origBg||'#f5f5f5';
                    journal[idx].suspicious=false;
                    saveJournal(journal);
                }
                renderModal();updateBadge();
            });
            tdCmt.appendChild(safeBtn);
        } else if(isSafe&&rec.suspicious){
            var safeTag=document.createElement('span');
            safeTag.style.cssText='margin-left:8px;color:#166534;font-size:11px;font-weight:600;';
            safeTag.textContent='✓ Безопасно';
            tdCmt.appendChild(safeTag);
        }

        var tdClient=document.createElement('td');
        tdClient.style.cssText='padding:9px 14px;font-size:12px;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis;';
        if(rec.client&&rec.clientUrl){
            var clk=document.createElement('a');
            clk.href=rec.clientUrl;
            clk.style.cssText='color:#0066aa;text-decoration:none;font-weight:600;font-size:12px;';
            clk.textContent=rec.client;
            clk.addEventListener('mouseenter',function(){clk.style.textDecoration='underline';});
            clk.addEventListener('mouseleave',function(){clk.style.textDecoration='none';});
            tdClient.appendChild(clk);
        } else if(rec.client){
            tdClient.style.color='#555';
            tdClient.textContent=rec.client;
        } else {
            tdClient.style.color='#ccc';
            tdClient.textContent='—';
        }

        tr.appendChild(tdDate); tr.appendChild(tdType); tr.appendChild(tdClient);
        tr.appendChild(tdExtra); tr.appendChild(tdAmt); tr.appendChild(tdCmt);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody); body.appendChild(table);
    // Автоскролл вниз (новые операции внизу)
    setTimeout(function(){ body.scrollTop=body.scrollHeight; },10);
}

function showModal(){
    if(!_modal) buildModal();
    renderModal();
    _modal.style.display='flex'; _overlay.style.display='block'; _visible=true;
    _lastSeenCount=loadJournal().length; updateBadge();
    var b=document.getElementById('godji-opj-btn'); if(b) b.setAttribute('data-active','true');
}
function hideModal(){
    if(!_modal) return;
    _modal.style.display='none'; _overlay.style.display='none'; _visible=false;
    var b=document.getElementById('godji-opj-btn'); if(b) b.removeAttribute('data-active');
}
function updateModalIfVisible(){ if(_visible) renderModal(); }

// ── Бейдж ─────────────────────────────────────────────────
var _lastSeenCount=0;
function updateBadge(){
    var badge=document.getElementById('goj-sidebar-badge');
    if(!badge) return;
    var journal=loadJournal();
    var safeIds=loadSafeIds();
    var suspCount=journal.filter(function(r){return r.suspicious&&safeIds.indexOf(r.id)===-1;}).length;
    if(suspCount>0){
        badge.textContent='⚠️ '+suspCount;
        badge.style.background='#b45309';
        badge.style.display='';
    } else {
        badge.style.display='none';
    }
}

// ── Предупреждение при закрытии смены ────────────────────
function watchCashboxCloseBtn(){
    new MutationObserver(function(){
        document.querySelectorAll('#godji-cashbox-modal button').forEach(function(b){
            if(b._gojWatched||b.textContent.trim()!=='Закрыть смену') return;
            b._gojWatched=true;
            b.addEventListener('click',function(e){
                var journal=loadJournal();
                var safeIds=loadSafeIds();
                var suspCount=journal.filter(function(r){return r.suspicious&&safeIds.indexOf(r.id)===-1;}).length;
                if(!suspCount) return;
                e.stopImmediatePropagation();
                var go=confirm('\u26a0\ufe0f Перед закрытием смены: '+suspCount+' подозрительных операций!\n\nOK — проверить в «История операций»\nОтмена — закрыть смену без проверки');
                if(go){ showModal(); _filterType='suspicious'; renderModal(); }
                else { b._gojWatched=false; b.click(); b._gojWatched=true; }
            },true);
        });
    }).observe(document.body,{childList:true,subtree:true});
}

// ── Кнопка в сайдбаре (footer, перед divider) ────────────
function createSidebarBtn(){
    if(document.getElementById('godji-opj-btn')) return;
    var shifts = document.querySelector('.Shifts_shiftsPaper__9Jml_');
    if(!shifts) return;
    var shiftsSection = shifts.closest('.m_6dcfc7c7');
    if(!shiftsSection) return;
    var nav = shiftsSection.parentNode;

    var oldW = document.getElementById('godji-opj-btn-wrap');
    if(oldW) oldW.remove();

    var section = document.createElement('div');
    section.id = 'godji-opj-btn-wrap';
    section.className = 'm_6dcfc7c7 mantine-AppShell-section onest';
    section.style.cssText = 'padding-inline:var(--mantine-spacing-md);';

    var btn=document.createElement('a');
    btn.id='godji-opj-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='width:100%;box-sizing:border-box;text-decoration:none;';

    var sec=document.createElement('span');
    sec.className='m_690090b5 mantine-NavLink-section';
    sec.setAttribute('data-position','left');
    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:var(--mantine-color-gg_primary-filled);--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    sec.appendChild(ico);

    var bodyDiv=document.createElement('div');
    bodyDiv.className='m_f07af9d2 mantine-NavLink-body';
    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.textContent='История операций';
    var badge=document.createElement('span');
    badge.id='goj-sidebar-badge';
    badge.style.cssText='margin-left:auto;background:#cc0001;color:#fff;font-size:11px;font-weight:700;border-radius:10px;padding:1px 6px;display:none;flex-shrink:0;';
    bodyDiv.appendChild(lbl);

    btn.appendChild(sec); btn.appendChild(bodyDiv); btn.appendChild(badge);
    btn.addEventListener('click',function(e){
        e.stopPropagation();
        if(_visible){hideModal();btn.removeAttribute('data-active');}
        else{showModal();btn.setAttribute('data-active','true');}
    });

    section.appendChild(btn);
    // История операций — ПЕРЕД историей сеансов (которая тоже перед часами)
    nav.insertBefore(section, shiftsSection);
    updateBadge();
}


function tryCreateSidebarBtn(){
    if(document.getElementById('godji-opj-btn')) return;
    if(!document.querySelector('.Shifts_shiftsPaper__9Jml_')){ setTimeout(tryCreateSidebarBtn,500); return; }
    createSidebarBtn();
}

var _obs=new MutationObserver(function(){
    if(!document.getElementById('godji-opj-btn')||!document.getElementById('godji-history-btn')) tryCreateSidebarBtn();
});

if(document.body){
    _obs.observe(document.body,{childList:true,subtree:false});
    setTimeout(tryCreateSidebarBtn,1200);
    setTimeout(watchCashboxCloseBtn,2000);
} else {
    document.addEventListener('DOMContentLoaded',function(){
        _obs.observe(document.body,{childList:true,subtree:false});
        setTimeout(tryCreateSidebarBtn,1200);
        setTimeout(watchCashboxCloseBtn,2000);
    });
}

setInterval(updateBadge,10000);

})();

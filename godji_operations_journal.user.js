// ==UserScript==
// @name         Годжи — История операций
// @namespace    http://tampermonkey.net/
// @version      3.1
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
var MAX_DAYS    = 7;
var CLUB_ID     = 14;
var POLL_MS     = 10000;

var _authToken  = null;
var _hasuraRole = 'club_admin';
var _lastMaxId  = null;  // последний виденный ID из wallet_operations
var _seenIds    = {};    // быстрая проверка дублей

// ── Кэш userId → ник ─────────────────────────────────────
var _nickCache = {}; // userId → nickname

function enrichNicks(ops){
    // Собираем уникальные userId у которых нет ника в кэше
    var missing = [];
    ops.forEach(function(op){
        if(op.user_id && !_nickCache[op.user_id]) missing.push(op.user_id);
    });
    if(!missing.length) return Promise.resolve();

    var auth = getAuth();
    if(!auth) return Promise.resolve();

    // Hasura: ищем по user_id в users или users_user_profile
    var gql = 'query GojNicks($ids:[String!]!){users_user_profile(where:{user_id:{_in:$ids}}){user_id login}}';
    return fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':auth,'content-type':'application/json','x-hasura-role':getRole()},
        body:JSON.stringify({operationName:'GojNicks',variables:{ids:missing},query:gql})
    }).then(function(r){return r.json();}).then(function(data){
        var rows = data&&data.data&&data.data.users_user_profile;
        if(!rows) return;
        rows.forEach(function(r){ if(r.user_id&&r.login) _nickCache[r.user_id]=r.login; });
    }).catch(function(){});
}

function getNick(userId){
    if(!userId) return '';
    return _nickCache[userId] || '';
}


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
        return raw.filter(function(r){return r.ts>cutoff;});
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
    if(_seenIds[entry.opId]) return; // дубль по opId
    if(entry.opId) _seenIds[entry.opId]=true;

    var journal=loadJournal();
    journal.unshift(entry);
    var cutoff=Date.now()-MAX_DAYS*86400000;
    journal=journal.filter(function(r){return r.ts>cutoff;});
    saveJournal(journal);
    updateModalIfVisible();
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
        type='deposit_cash'; icon='💵'; label='Пополнение наличными'; color='#166534'; bg='#dcfce7';
    } else if(nl.indexOf('пополнение по карте')!==-1||nl.indexOf('пополнение картой')!==-1||(op.money_type==='non_cash'&&nl.indexOf('пополнение')!==-1&&!resId&&amt>0&&nl.indexOf('бонус')===-1)){
        type='deposit_card'; icon='💳'; label='Пополнение по карте'; color='#1d4ed8'; bg='#dbeafe';
    } else if(nl.indexOf('пополнение бонусов')!==-1||nl.indexOf('начисление бонусов')!==-1){
        type='deposit_bonus'; icon='🎁'; label='Начисление бонусов'; color='#c87800'; bg='#fff4e0';
    } else if(nl.indexOf('возврат бонусов')!==-1||nl.indexOf('возврат стоимости')!==-1){
        type='refund_bonus'; icon='↩️'; label='Возврат бонусов'; color='#0369a1'; bg='#e0f2fe';
    } else if(nl.indexOf('бесплатное время')!==-1||nl.indexOf('бесплатн')!==-1){
        type='free_time'; icon='⌛'; label='Бесплатное время'; color='#007799'; bg='#e8f8ff';
    } else if(nl.indexOf('списание бонусов за продление')!==-1){
        type='session_prolong'; icon='⏩'; label='Продление сеанса'; color='#3355cc'; bg='#e8f0ff';
    } else if(nl.indexOf('списание за бронирование')!==-1||nl.indexOf('списание за сессию')!==-1){
        type='session_start'; icon='▶️'; label='Запуск сеанса'; color='#0066cc'; bg='#e0f0ff';
    } else if(nl.indexOf('списание бонусов')!==-1&&amt<0){
        type='debit_bonus'; icon='➖🎁'; label='Списание бонусов'; color='#7c3aed'; bg='#ede9fe';
    } else if((nl.indexOf('списание')!==-1||nl.indexOf('withdraw')!==-1)&&op.money_type==='cash'){
        type='debit_money'; icon='➖💵'; label='Списание с баланса'; color='#991b1b'; bg='#fee2e2';
    } else if(amt<0&&op.operation_type==='withdraw'){
        type='debit_bonus'; icon='➖'; label='Списание'; color='#7c3aed'; bg='#ede9fe';
    } else if(amt>0&&op.operation_type==='deposit'&&op.money_type==='cash'){
        type='deposit_cash'; icon='💵'; label='Пополнение наличными'; color='#166534'; bg='#dcfce7';
    } else if(amt>0&&op.operation_type==='deposit'&&op.money_type==='non_cash'){
        type='deposit_bonus'; icon='🎁'; label='Пополнение бонусами'; color='#c87800'; bg='#fff4e0';
    } else {
        type='other'; icon='•'; label=name||'Операция'; color='#555'; bg='#f5f5f5';
    }

    return {type:type, icon:icon, label:label, color:color, bg:bg,
            name:name, desc:desc, resId:resId};
}

// ── Детектор подозрительных ───────────────────────────────
var _recentByWallet={};

function checkSuspicious(op, userId){
    var amt=op.amount;
    if(!amt||amt<=0||op.operation_type!=='deposit') return false;

    var key=userId+'_'+Math.round(amt*100);
    var now=Date.now();
    var opTime=new Date(op.created_at).getTime();

    if(!_recentByWallet[key]) _recentByWallet[key]=[];
    // Чистим старше 15 сек
    _recentByWallet[key]=_recentByWallet[key].filter(function(t){return opTime-t<15000;});

    var count=_recentByWallet[key].length;
    _recentByWallet[key].push(opTime);

    if(count>=1){
        return true; // уже была такая же операция за 15 сек
    }
    return false;
}

// ── GQL запрос ────────────────────────────────────────────
var GQL_OPS = 'query GojOps($since:Int!,$clubId:Int!){wallet_operations(where:{id:{_gt:$since},club_id:{_eq:$clubId}},order_by:{id:asc},limit:50){id amount money_type operation_type created_at user_id wallet_operation_digest{name description reservation_id}}}';

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

        // Сначала обогащаем ники, потом добавляем записи
        enrichNicks(ops).then(function(){
            ops.forEach(function(op){
                if(op.id>_lastMaxId) _lastMaxId=op.id;
                var cls=classifyOp(op);
                // Возврат бонусов при завершении сеанса — НЕ подозрительно
                var isRefund = cls.type === 'refund_bonus';
                var isSusp = !isRefund && checkSuspicious(op,op.user_id);
                var nick = getNick(op.user_id);
                addEntry({
                    opId: op.id,
                    id: 'op'+op.id,
                    ts: new Date(op.created_at).getTime(),
                    type: isSusp ? 'suspicious' : cls.type,
                    icon: isSusp ? '⚠️' : cls.icon,
                    label: isSusp ? 'Подозрительная операция' : cls.label,
                    color: isSusp ? '#b45309' : cls.color,
                    bg: isSusp ? '#fef3c7' : cls.bg,
                    amount: formatAmt(op.amount),
                    comment: cls.desc||'',
                    extra: cls.resId ? 'Сеанс #'+cls.resId : ('ОП #'+op.id),
                    nick: nick,
                    suspicious: isSusp,
                    origType: cls.type,
                    origLabel: cls.label
                });
                // toast убран
            });
        });
    }).catch(function(){});
}

// ── Инициализация — получаем последний ID ─────────────────
var GQL_INIT = 'query GojInit($clubId:Int!){wallet_operations(where:{club_id:{_eq:$clubId}},order_by:{id:desc},limit:1){id}}';

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
        // Загружаем также seenIds из уже существующего журнала
        var journal=loadJournal();
        journal.forEach(function(e){ if(e.opId) _seenIds[e.opId]=true; });
        // Запускаем polling
        setInterval(fetchNewOps, POLL_MS);
    }).catch(function(){
        setTimeout(initLastId,3000);
    });
}

// Ждём токен потом инициализируемся
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
        type:'debit_money', icon:'➖💵', label:'Списание с баланса',
        color:'#991b1b', bg:'#fee2e2',
        amount:formatAmt(-Math.abs(dd.amount)),
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
function formatAmt(n){
    if(n===undefined||n===null||n==='') return '';
    var v=parseFloat(n); if(isNaN(v)) return '';
    return (v>=0?'+':'')+Math.round(v)+' ₽';
}
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── Модальное окно ────────────────────────────────────────
var _modal=null,_overlay=null,_visible=false;
var _filterType='',_filterText='';

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
        sB.addEventListener('click',function(){_filterType='suspicious';renderModal();});
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

    // Фильтры
    var fBar=document.createElement('div');
    fBar.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;flex-wrap:wrap;';
    var typeSelect=document.createElement('select');
    typeSelect.style.cssText='background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;';
    [['','Все операции'],['suspicious','⚠️ Подозрительные'],
     ['deposit_cash','💵 Пополнение наличными'],['deposit_card','💳 Пополнение по карте'],
     ['deposit_bonus','🎁 Начисление бонусов'],['refund_bonus','↩️ Возврат бонусов'],
     ['free_time','⌛ Бесплатное время'],['session_start','▶️ Запуск сеанса'],
     ['session_prolong','⏩ Продление сеанса'],['debit_money','➖💵 Списание с баланса'],
     ['debit_bonus','➖🎁 Списание бонусов'],['other','• Прочее']
    ].forEach(function(o){
        var opt=document.createElement('option');
        opt.value=o[0]; opt.textContent=o[1];
        if(o[0]===_filterType) opt.selected=true;
        typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change',function(){_filterType=this.value;renderModal();});
    var searchInp=document.createElement('input');
    searchInp.type='text'; searchInp.placeholder='Поиск…'; searchInp.value=_filterText;
    searchInp.style.cssText='background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;outline:none;width:190px;';
    searchInp.addEventListener('input',function(){_filterText=this.value.toLowerCase();renderModal();});
    fBar.appendChild(typeSelect); fBar.appendChild(searchInp);
    _modal.appendChild(fBar);

    // Тело
    var body=document.createElement('div');
    body.style.cssText='overflow-y:auto;flex:1;';
    _modal.appendChild(body);

    var filtered=journal.slice();
    if(_filterType==='suspicious'){
        filtered=filtered.filter(function(r){return r.suspicious&&safeIds.indexOf(r.id)===-1;});
    } else if(_filterType){
        filtered=filtered.filter(function(r){return r.type===_filterType;});
    }
    if(_filterText){
        filtered=filtered.filter(function(r){
            return [r.comment||'',r.extra||'',r.amount||'',r.label||''].join(' ').toLowerCase().indexOf(_filterText)!==-1;
        });
    }

    if(!filtered.length){
        body.innerHTML='<div style="text-align:center;color:#aaa;padding:50px;font-size:14px;">Нет операций</div>';
        return;
    }

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;';
    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Время','90px'],['Тип','200px'],['Ник','110px'],['Сеанс / ОП','100px'],['Сумма','85px'],['Комментарий','auto']].forEach(function(c){
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
        badge.style.cssText='background:'+(rec.bg||'#f5f5f5')+';color:'+(rec.color||'#555')+';border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;';
        badge.textContent=(rec.icon||'')+(rec.icon?' ':'')+rec.label;
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
            safeBtn.addEventListener('click',function(ev){ev.stopPropagation();markSafe(rec.id);renderModal();updateBadge();});
            tdCmt.appendChild(safeBtn);
        } else if(isSafe&&rec.suspicious){
            var safeTag=document.createElement('span');
            safeTag.style.cssText='margin-left:8px;color:#166534;font-size:11px;font-weight:600;';
            safeTag.textContent='✓ Безопасно';
            tdCmt.appendChild(safeTag);
        }

        var tdNick = document.createElement('td');
        tdNick.style.cssText = 'padding:9px 14px;font-size:12px;white-space:nowrap;';
        if(rec.nick){
            var nickA = document.createElement('a');
            nickA.href = 'javascript:void(0)';
            nickA.style.cssText = 'color:#60a5fa;font-size:12px;text-decoration:none;font-weight:600;';
            nickA.textContent = '@'+rec.nick;
            nickA.addEventListener('click',function(e){
                e.preventDefault();
                var inp = document.querySelector('input[placeholder*="оиск"],input[placeholder*="ик клиента"]');
                if(inp){ inp.value=rec.nick; inp.dispatchEvent(new Event('input',{bubbles:true})); }
            });
            tdNick.appendChild(nickA);
        } else {
            tdNick.innerHTML = '<span style="color:rgba(255,255,255,0.15);">—</span>';
        }
        tr.appendChild(tdDate); tr.appendChild(tdType); tr.appendChild(tdNick); tr.appendChild(tdExtra);
        tr.appendChild(tdAmt); tr.appendChild(tdCmt);
        tbody.appendChild(tr);
    });
    table.appendChild(tbody); body.appendChild(table);
}

function showModal(){
    if(!_modal) buildModal();
    renderModal();
    _modal.style.display='flex'; _overlay.style.display='block'; _visible=true;
    _lastSeenCount=loadJournal().length; updateBadge();
}
function hideModal(){
    if(!_modal) return;
    _modal.style.display='none'; _overlay.style.display='none'; _visible=false;
}
function updateModalIfVisible(){ if(_visible) renderModal(); }

// ── Бейдж ─────────────────────────────────────────────────
var _lastSeenCount=0;
function updateBadge(){}).length;
    var newCount=journal.length-_lastSeenCount;
    if(suspCount>0){
        badge.textContent='⚠️ '+suspCount;
        badge.style.background='#b45309';
        badge.style.display='';
    } else if(newCount>0&&!_visible){
        badge.textContent='+'+newCount;
        badge.style.background='#cc0001';
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
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;
    var divider=footer.querySelector('.mantine-Divider-root');
    if(!divider) return;

    var btn=document.createElement('a');
    btn.id='godji-opj-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 16px 8px 12px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='width:32px;height:32px;border-radius:8px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

    var bodyDiv=document.createElement('div');
    bodyDiv.className='m_f07af9d2 mantine-NavLink-body';
    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText='font-size:14px;font-weight:600;color:var(--mantine-color-white,#fff);white-space:nowrap;';
    lbl.textContent='История операций';

    var badge=document.createElement('span');
    bodyDiv.appendChild(lbl);
    btn.appendChild(ico); btn.appendChild(bodyDiv);
    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.05)';});
    btn.addEventListener('mouseleave',function(){btn.style.background='';});
    btn.addEventListener('click',function(e){
        e.stopPropagation();
        if(_visible) hideModal(); else showModal();
    });

    // История операций должна быть ВЫШЕ истории сеансов
    // Если кнопка сеансов уже есть — вставляем перед ней, иначе перед divider
    var sessBtn = footer.querySelector('#godji-history-btn');
    var anchor = sessBtn || divider;
    footer.insertBefore(btn, anchor);
}

function tryCreateSidebarBtn(){
    if(document.getElementById('godji-opj-btn')) return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    var divider=footer&&footer.querySelector('.mantine-Divider-root');
    if(!footer||!divider){ setTimeout(tryCreateSidebarBtn,500); return; }
    createSidebarBtn();
}

var _obs=new MutationObserver(function(){
    if(!document.getElementById('godji-opj-btn')) tryCreateSidebarBtn();
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

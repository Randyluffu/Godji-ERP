// ==UserScript==
// @name         Годжи — Бан-лист
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Бан-лист клиентов с причиной, фото, автозавершением сеанса
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_banlist_v1';
var CLUB_ID = 14;

// ── localStorage ─────────────────────────────────────────
function loadBanlist(){
    try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{"banned":{},"log":[]}'); }
    catch(e){ return {banned:{},log:[]}; }
}
function saveBanlist(data){
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(data)); }catch(e){}
}

function isBanned(userId){ return !!loadBanlist().banned[userId]; }

function banUser(userId, nick, name, reason, photos){
    var data = loadBanlist();
    data.banned[userId] = {
        userId: userId, nick: nick||'', name: name||'',
        reason: reason, photos: photos||[],
        ts: Date.now()
    };
    data.log.push({
        action:'ban', userId:userId, nick:nick||'', name:name||'',
        reason:reason, ts:Date.now()
    });
    saveBanlist(data);
}

function unbanUser(userId, reason){
    var data = loadBanlist();
    var entry = data.banned[userId];
    if(!entry) return;
    data.log.push({
        action:'unban', userId:userId, nick:entry.nick||'', name:entry.name||'',
        reason:reason, banReason:entry.reason, ts:Date.now()
    });
    delete data.banned[userId];
    saveBanlist(data);
}

// ── Auth token + fetch hook через unsafeWindow ───────────
var _authToken = null, _hasuraRole = 'club_admin';

(function(){
    var _win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    var _orig = _win.fetch;
    if(_win.__banHookedDirect) return;
    _win.__banHookedDirect = true;

    _win.fetch = function(url, opts) {
        // Токен
        if(opts && opts.headers && opts.headers.authorization) {
            _authToken = opts.headers.authorization;
            _hasuraRole = opts.headers['x-hasura-role'] || 'club_admin';
        }
        // Перехват создания сеанса
        if(opts && opts.body) {
            try {
                var b = JSON.parse(opts.body);
                var op = b.operationName || '';
                var vars = b.variables || {};
                var params = vars.params || {};
                var userId = params.userId || vars.userId || '';
                var isCreate = userId && (
                    op === 'CreateBooking' || op === 'CreateBooking2' ||
                    op.indexOf('ReservationCreate') !== -1 ||
                    (url && url.indexOf && url.indexOf('/reservation/create') !== -1)
                );
                if(isCreate && isBanned(userId)) {
                    console.warn('[banlist] Intercepted session for banned user:', userId);
                    var prom = _orig.apply(this, arguments);
                    prom.then(function(r) {
                        r.clone().json().then(function(d) {
                            if(d && d.data && !d.errors) {
                                document.dispatchEvent(new CustomEvent('godji_ban_session_created',{detail:{userId:userId}}));
                            }
                        }).catch(function(){});
                    }).catch(function(){});
                    return prom;
                }
            } catch(e){}
        }
        return _orig.apply(this, arguments);
    };
})();
function getAuth(){ return _authToken||null; }
function getRole(){ return _hasuraRole; }

function gql(query, variables, opName){
    var t=getAuth(); if(!t) return Promise.reject('no auth');
    return fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':t,'content-type':'application/json','x-hasura-role':getRole()},
        body: JSON.stringify({operationName:opName||null,query:query,variables:variables||{}})
    }).then(function(r){return r.json();});
}

// Завершить сеанс
function finishSession(sessionId){
    return gql(
        'mutation FinishBanned($id:Int!){userReservationFinish(params:{sessionId:$id}){success}}',
        {id:sessionId}, 'FinishBanned'
    );
}

// ── Фото → base64 ─────────────────────────────────────────
function fileToBase64(file){
    return new Promise(function(res,rej){
        var r=new FileReader();
        r.onload=function(){res(r.result);};
        r.onerror=rej;
        r.readAsDataURL(file);
    });
}

// ── Форматирование дат ────────────────────────────────────
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear()+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── Модальное окно бана ───────────────────────────────────
function showBanModal(userId, nick, name, onDone){
    if(document.getElementById('godji-ban-modal')) return;

    var ov=document.createElement('div');
    ov.id='godji-ban-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;';

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,0.22);font-family:inherit;overflow:hidden;';
    box.addEventListener('click',function(e){e.stopPropagation();});

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #f0f0f0;';
    var hIco=document.createElement('div');
    hIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
    var hTxt=document.createElement('div');
    hTxt.style.cssText='flex:1;';
    hTxt.innerHTML='<div style="font-size:15px;font-weight:700;color:#1a1a1a;">Заблокировать клиента</div>'+
        '<div style="font-size:12px;color:#888;margin-top:2px;">'+(nick?'@'+nick+' · ':'')+name+'</div>';
    var xBtn=document.createElement('button');
    xBtn.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    xBtn.innerHTML='&times;';
    xBtn.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(hIco); hdr.appendChild(hTxt); hdr.appendChild(xBtn);

    // Тело
    var body=document.createElement('div');
    body.style.cssText='padding:16px 20px;display:flex;flex-direction:column;gap:12px;';

    // Причина
    var reasonLbl=document.createElement('label');
    reasonLbl.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.4px;display:flex;flex-direction:column;gap:4px;';
    reasonLbl.textContent='Причина блокировки *';
    var reasonInp=document.createElement('textarea');
    reasonInp.placeholder='Опишите причину блокировки…';
    reasonInp.rows=3;
    reasonInp.style.cssText='border:1px solid #e0e0e0;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;color:#333;resize:vertical;outline:none;transition:border-color 0.15s;';
    reasonInp.addEventListener('focus',function(){reasonInp.style.borderColor='#cc0001';});
    reasonInp.addEventListener('blur',function(){reasonInp.style.borderColor='#e0e0e0';});
    reasonLbl.appendChild(reasonInp);

    // Фото
    var photoLbl=document.createElement('label');
    photoLbl.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.4px;display:flex;flex-direction:column;gap:4px;';
    photoLbl.textContent='Фотографии (необязательно)';
    var photoInp=document.createElement('input');
    photoInp.type='file'; photoInp.accept='image/*'; photoInp.multiple=true;
    photoInp.style.cssText='font-size:12px;color:#555;';
    var photoPreview=document.createElement('div');
    photoPreview.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;';
    var _photos=[];
    photoInp.addEventListener('change',async function(){
        _photos=[];
        photoPreview.innerHTML='';
        for(var i=0;i<photoInp.files.length;i++){
            var b64=await fileToBase64(photoInp.files[i]);
            _photos.push(b64);
            var img=document.createElement('img');
            img.src=b64;
            img.style.cssText='width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e0;';
            photoPreview.appendChild(img);
        }
    });
    photoLbl.appendChild(photoInp); photoLbl.appendChild(photoPreview);

    // Статус
    var statusEl=document.createElement('div');
    statusEl.style.cssText='font-size:12px;color:#cc0001;min-height:16px;';

    // Кнопка
    var submitBtn=document.createElement('button');
    submitBtn.style.cssText='background:#cc0001;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:background 0.15s;';
    submitBtn.textContent='Заблокировать';
    submitBtn.addEventListener('mouseenter',function(){submitBtn.style.background='#a80000';});
    submitBtn.addEventListener('mouseleave',function(){submitBtn.style.background='#cc0001';});
    submitBtn.addEventListener('click',function(){
        var reason=reasonInp.value.trim();
        if(!reason){ statusEl.textContent='Укажите причину блокировки'; return; }
        banUser(userId, nick, name, reason, _photos);
        ov.remove();
        if(onDone) onDone();
        showBanBadge(userId);
    });

    body.appendChild(reasonLbl);
    body.appendChild(photoLbl);
    body.appendChild(statusEl);
    body.appendChild(submitBtn);
    box.appendChild(hdr); box.appendChild(body);
    ov.appendChild(box);
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    document.body.appendChild(ov);
    setTimeout(function(){reasonInp.focus();},50);
}

// ── Модальное окно разбана ────────────────────────────────
function showUnbanModal(userId, nick, name, onDone){
    if(document.getElementById('godji-unban-modal')) return;
    var data=loadBanlist();
    var entry=data.banned[userId];

    var ov=document.createElement('div');
    ov.id='godji-unban-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;';

    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:12px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,0.22);font-family:inherit;overflow:hidden;';
    box.addEventListener('click',function(e){e.stopPropagation();});

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #f0f0f0;';
    var hIco=document.createElement('div');
    hIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#166534;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 1-12 0"/><line x1="2" y1="4" x2="22" y2="20"/><path d="M3 3l18 18"/></svg>';
    var hTxt=document.createElement('div');
    hTxt.style.cssText='flex:1;';
    hTxt.innerHTML='<div style="font-size:15px;font-weight:700;color:#1a1a1a;">Разблокировать клиента</div>'+
        '<div style="font-size:12px;color:#888;margin-top:2px;">'+(nick?'@'+nick+' · ':'')+name+'</div>';
    if(entry){
        hTxt.innerHTML+='<div style="font-size:11px;color:#cc0001;margin-top:4px;">Причина бана: '+entry.reason+'</div>';
    }
    var xBtn=document.createElement('button');
    xBtn.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    xBtn.innerHTML='&times;'; xBtn.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(hIco); hdr.appendChild(hTxt); hdr.appendChild(xBtn);

    var body=document.createElement('div');
    body.style.cssText='padding:16px 20px;display:flex;flex-direction:column;gap:12px;';

    var reasonLbl=document.createElement('label');
    reasonLbl.style.cssText='font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.4px;display:flex;flex-direction:column;gap:4px;';
    reasonLbl.textContent='Причина разблокировки *';
    var reasonInp=document.createElement('textarea');
    reasonInp.placeholder='Укажите причину разблокировки…';
    reasonInp.rows=2;
    reasonInp.style.cssText='border:1px solid #e0e0e0;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;color:#333;resize:vertical;outline:none;transition:border-color 0.15s;';
    reasonInp.addEventListener('focus',function(){reasonInp.style.borderColor='#166534';});
    reasonInp.addEventListener('blur',function(){reasonInp.style.borderColor='#e0e0e0';});
    reasonLbl.appendChild(reasonInp);

    var statusEl=document.createElement('div');
    statusEl.style.cssText='font-size:12px;color:#cc0001;min-height:16px;';

    var submitBtn=document.createElement('button');
    submitBtn.style.cssText='background:#166534;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
    submitBtn.textContent='Разблокировать';
    submitBtn.addEventListener('click',function(){
        var reason=reasonInp.value.trim();
        if(!reason){statusEl.textContent='Укажите причину';return;}
        unbanUser(userId,reason);
        ov.remove();
        if(onDone) onDone();
        removeBanBadge(userId);
    });

    body.appendChild(reasonLbl); body.appendChild(statusEl); body.appendChild(submitBtn);
    box.appendChild(hdr); box.appendChild(body);
    ov.appendChild(box);
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
    document.body.appendChild(ov);
    setTimeout(function(){reasonInp.focus();},50);
}

// ── Значок бана на карточке ───────────────────────────────
function showBanBadge(userId){
    var existing=document.getElementById('godji-ban-badge-'+userId);
    if(existing) return;
    // Найдём карточку клиента по userId в URL или в Gamer ID
    var kbds=document.querySelectorAll('kbd');
    kbds.forEach(function(kbd){
        if(kbd.textContent.trim()===userId){
            var card=kbd.closest('.mantine-Card-root,[class*="Card-root"]');
            if(!card) return;
            var badge=document.createElement('div');
            badge.id='godji-ban-badge-'+userId;
            badge.style.cssText='background:#fff0f0;border:1px solid #fca5a5;border-radius:6px;padding:4px 10px;font-size:12px;color:#cc0001;font-weight:600;display:flex;align-items:center;gap:6px;margin-top:6px;';
            var entry=loadBanlist().banned[userId];
            badge.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
            badge.innerHTML+=' <span>ЗАБЛОКИРОВАН'+(entry?': '+entry.reason:'')+'</span>';
            var avatarFlex=card.querySelector('[class*="Flex-root"]');
            if(avatarFlex) avatarFlex.appendChild(badge);
        }
    });
}
function removeBanBadge(userId){
    var b=document.getElementById('godji-ban-badge-'+userId);
    if(b) b.remove();
}

// ── Кнопка бана на странице клиента (/clients/:id) ────────
function injectClientPageBanBtn(){
    if(document.getElementById('godji-ban-client-btn')) return;
    var clientId=null;
    var m=window.location.pathname.match(/\/clients\/([a-f0-9-]{36})/);
    if(m) clientId=m[1];
    if(!clientId) return;

    // Найдём секцию с именем/ником (содержит Avatar + name + badge + nick + phone)
    var avatarSections=document.querySelectorAll('.mantine-Avatar-root');
    var targetFlex=null;
    avatarSections.forEach(function(av){
        var flex=av.closest('[class*="Flex-root"]');
        if(flex && flex.querySelector('[class*="Tabs-tab"]')) return; // skip tab areas
        if(flex) targetFlex=flex.parentNode;
    });

    if(!targetFlex) return;

    // Получаем ник и имя со страницы
    var nick='', name='';
    var nickEl=document.querySelector('[class*="Text-root"][style*="font-size-xs"]');
    // Ищем @login
    document.querySelectorAll('p,span').forEach(function(el){
        if(el.textContent.match(/^@\w+$/) && !nick) nick=el.textContent.slice(1);
    });
    var nameEl=document.querySelector('[class*="Text-root"][style*="font-weight: 700"]');
    if(nameEl) name=nameEl.textContent.trim();

    var banned=isBanned(clientId);

    var btn=document.createElement('button');
    btn.id='godji-ban-client-btn';
    btn.className='mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
    btn.setAttribute('data-variant','light');
    btn.setAttribute('data-size','xs');
    btn.style.cssText=banned
        ?'--button-bg:var(--mantine-color-green-light);--button-hover:var(--mantine-color-green-light-hover);--button-color:var(--mantine-color-green-light-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;margin-left:6px;'
        :'--button-bg:var(--mantine-color-red-light);--button-hover:var(--mantine-color-red-light-hover);--button-color:var(--mantine-color-red-light-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;margin-left:6px;';

    var inner=document.createElement('span'); inner.className='m_80f1301b mantine-Button-inner';
    var sec=document.createElement('span'); sec.className='m_a74036a mantine-Button-section'; sec.setAttribute('data-position','left');
    sec.innerHTML=banned
        ?'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
        :'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
    var lbl=document.createElement('span'); lbl.className='m_811560b9 mantine-Button-label';
    lbl.textContent=banned?'Разблокировать':'Заблокировать';
    inner.appendChild(sec); inner.appendChild(lbl); btn.appendChild(inner);

    btn.addEventListener('click',function(){
        if(isBanned(clientId)){
            showUnbanModal(clientId,nick,name,function(){
                btn.remove(); setTimeout(injectClientPageBanBtn,100);
            });
        } else {
            showBanModal(clientId,nick,name,function(){
                btn.remove(); setTimeout(injectClientPageBanBtn,100);
            });
        }
    });

    // Вставляем в flex-строку с аватаром — третьим элементом после аватара и текстового блока
    // Ищем flex-контейнер с Avatar внутри (первый уровень карточки)
    var avatarEl=document.querySelector('.mantine-Avatar-root[data-size="xl"]');
    var avatarRow=avatarEl?avatarEl.closest('[class*="Flex-root"]'):null;
    if(avatarRow){
        // Делаем строку space-between чтобы кнопка прижалась вправо
        avatarRow.style.justifyContent='space-between';
        avatarRow.style.width='100%';
        // Кнопку оборачиваем в выравнивающий div
        var btnWrap=document.createElement('div');
        btnWrap.style.cssText='display:flex;align-items:flex-start;flex-shrink:0;padding-top:2px;';
        btnWrap.appendChild(btn);
        avatarRow.appendChild(btnWrap);
    } else {
        targetFlex.appendChild(btn);
    }

    // Показываем бадж если забанен
    if(isBanned(clientId)){
        var banInfo=document.createElement('div');
        banInfo.id='godji-ban-info-banner';
        banInfo.style.cssText='background:#fff0f0;border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:12px;color:#cc0001;font-weight:600;margin-top:8px;display:flex;align-items:flex-start;gap:8px;';
        var entry=loadBanlist().banned[clientId];
        banInfo.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'+
            '<div><div style="font-weight:700;">КЛИЕНТ ЗАБЛОКИРОВАН</div>'+
            '<div style="font-weight:400;margin-top:2px;color:#991b1b;">'+(entry?entry.reason:'')+'</div>'+
            '<div style="font-weight:400;margin-top:2px;color:#bbb;font-size:11px;">'+(entry?fmtDate(entry.ts):'')+'</div></div>';
        // Фото
        if(entry && entry.photos && entry.photos.length){
            var photosRow=document.createElement('div');
            photosRow.style.cssText='display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;';
            entry.photos.forEach(function(src){
                var img=document.createElement('img');
                img.src=src; img.style.cssText='width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #fca5a5;cursor:pointer;';
                img.addEventListener('click',function(){
                    var ov=document.createElement('div');
                    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
                    var big=document.createElement('img');
                    big.src=src; big.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px;';
                    ov.appendChild(big); ov.addEventListener('click',function(){ov.remove();});
                    document.body.appendChild(ov);
                });
                photosRow.appendChild(img);
            });
            banInfo.appendChild(photosRow);
        }
        var firstDivider=targetFlex.querySelector('.mantine-Divider-root');
        if(firstDivider) targetFlex.insertBefore(banInfo, firstDivider);
        else targetFlex.appendChild(banInfo);
    }
}

// ── Перехват посадки за ПК — автозавершение сеанса ────────
var _watchedSessions={};

function watchForBannedSessions(){
    var auth=getAuth(); if(!auth) return;
    var data=loadBanlist();
    var bannedIds=Object.keys(data.banned);
    if(!bannedIds.length) return;

    gql(
        'query CheckBanned($clubId:Int!){reservations(where:{club_id:{_eq:$clubId},status:{_nin:["finished","canceled"]}},limit:100){id user_id status}}',
        {clubId:CLUB_ID}, 'CheckBanned'
    ).then(function(d){
        var res=d.data&&d.data.reservations;
        if(!res) return;
        res.forEach(function(r){
            if(bannedIds.indexOf(r.user_id)===-1) return;
            if(_watchedSessions[r.id]) return;
            _watchedSessions[r.id]=true;
            var entry=data.banned[r.user_id];
            console.warn('[banlist] Auto-finishing session',r.id,'for banned user',r.user_id);
            finishSession(r.id).then(function(result){
                console.log('[banlist] Finished session',r.id,'result:',JSON.stringify(result));
                // Показываем уведомление
                var toast=document.createElement('div');
                toast.style.cssText='position:fixed;top:20px;right:20px;z-index:999999;background:#fff0f0;border:2px solid #cc0001;border-radius:10px;padding:12px 16px;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,0.2);max-width:320px;';
                toast.innerHTML='<div style="font-size:13px;font-weight:700;color:#cc0001;margin-bottom:2px;">Сеанс завершён</div>'+
                    '<div style="font-size:12px;color:#991b1b;">Клиент заблокирован: '+(entry?entry.reason:'')+'</div>';
                document.body.appendChild(toast);
                setTimeout(function(){toast.remove();},5000);
            }).catch(function(e){
                console.error('[banlist] Failed to finish session',r.id,e);
                // Retry после 3 сек
                setTimeout(function(){ delete _watchedSessions[r.id]; },3000);
            });
        });
    }).catch(function(){});
}

// Запускаем сразу и каждые 5 секунд
setInterval(watchForBannedSessions, 5000);

// ── Вкладки на странице /clients ──────────────────────────
function injectBanTabs(){
    if(!window.location.pathname.startsWith('/clients')) return;
    if(window.location.pathname.length > 15) return; // не на /clients/:id
    if(document.getElementById('godji-ban-tab')) return;

    var tabsList=document.querySelector('.mantine-Tabs-list');
    if(!tabsList) return;

    var tabsRoot=tabsList.closest('.mantine-Tabs-root');
    if(!tabsRoot) return;

    // Вкладка "Заблокированные"
    var banTab=document.createElement('button');
    banTab.id='godji-ban-tab';
    banTab.className='mantine-focus-auto m_539e827b m_4ec4dce6 mantine-Tabs-tab m_87cf2631 mantine-UnstyledButton-root';
    banTab.setAttribute('data-variant','default'); banTab.setAttribute('data-orientation','horizontal');
    banTab.setAttribute('type','button'); banTab.setAttribute('role','tab');
    banTab.style.cssText='font-size:var(--mantine-font-size-md);font-weight:500;';
    banTab.innerHTML='<span class="mantine-Tabs-tabLabel">Заблокированные</span>';

    // Вкладка "Разблокированные"
    var unbanTab=document.createElement('button');
    unbanTab.id='godji-unban-tab';
    unbanTab.className='mantine-focus-auto m_539e827b m_4ec4dce6 mantine-Tabs-tab m_87cf2631 mantine-UnstyledButton-root';
    unbanTab.setAttribute('data-variant','default'); unbanTab.setAttribute('data-orientation','horizontal');
    unbanTab.setAttribute('type','button'); unbanTab.setAttribute('role','tab');
    unbanTab.style.cssText='font-size:var(--mantine-font-size-md);font-weight:500;';
    unbanTab.innerHTML='<span class="mantine-Tabs-tabLabel">Разблокированные</span>';

    tabsList.appendChild(banTab);
    tabsList.appendChild(unbanTab);

    // Панели
    var banPanel=document.createElement('div');
    banPanel.id='godji-ban-panel';
    banPanel.style.cssText='display:none;padding:16px 0;';

    var unbanPanel=document.createElement('div');
    unbanPanel.id='godji-unban-panel';
    unbanPanel.style.cssText='display:none;padding:16px 0;';

    tabsRoot.appendChild(banPanel);
    tabsRoot.appendChild(unbanPanel);

    // Переключение вкладок
    // Скрываем наши панели когда нажимается нативная вкладка ERP
    function hideOurPanels(){
        banPanel.style.display='none';
        unbanPanel.style.display='none';
        banTab.removeAttribute('data-active');
        banTab.setAttribute('aria-selected','false');
        unbanTab.removeAttribute('data-active');
        unbanTab.setAttribute('aria-selected','false');
        // Показываем нативные панели ERP обратно
        tabsRoot.querySelectorAll('.mantine-Tabs-panel').forEach(function(p){
            p.style.removeProperty('display');
        });
    }

    function activateOurTab(tabEl, panelEl){
        // Деактивируем нативные вкладки ERP визуально
        tabsList.querySelectorAll('.mantine-Tabs-tab').forEach(function(t){
            if(t===tabEl) return;
            t.setAttribute('aria-selected','false');
            t.removeAttribute('data-active');
        });
        // Скрываем нативные панели ERP
        tabsRoot.querySelectorAll('.mantine-Tabs-panel').forEach(function(p){
            p.style.display='none';
        });
        // Скрываем вторую нашу панель
        [banPanel,unbanPanel].forEach(function(p){ if(p!==panelEl) p.style.display='none'; });
        tabEl.setAttribute('aria-selected','true');
        tabEl.setAttribute('data-active','true');
        panelEl.style.display='block';
    }

    // Нативные вкладки ERP — восстанавливаем их поведение
    tabsList.querySelectorAll('.mantine-Tabs-tab').forEach(function(t){
        if(t.id==='godji-ban-tab'||t.id==='godji-unban-tab') return;
        t.addEventListener('click',function(){
            hideOurPanels();
        });
    });

    banTab.addEventListener('click',function(){
        activateOurTab(banTab, banPanel);
        renderBanPanel(banPanel);
    });
    unbanTab.addEventListener('click',function(){
        activateOurTab(unbanTab, unbanPanel);
        renderUnbanPanel(unbanPanel);
    });
}

// ── Рендер панели "Заблокированные" ───────────────────────
function renderBanPanel(container){
    container.innerHTML='';
    var data=loadBanlist();
    var banned=Object.values(data.banned);

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    var title=document.createElement('span');
    title.style.cssText='font-size:16px;font-weight:700;color:#1a1a1a;';
    title.textContent='Заблокированные клиенты ('+banned.length+')';
    hdr.appendChild(title);
    container.appendChild(hdr);

    if(!banned.length){
        var empty=document.createElement('div');
        empty.style.cssText='text-align:center;color:#aaa;padding:60px 20px;font-size:14px;';
        empty.textContent='Нет заблокированных клиентов';
        container.appendChild(empty);
        return;
    }

    var grid=document.createElement('div');
    grid.style.cssText='display:flex;flex-direction:column;gap:10px;';

    banned.sort(function(a,b){return b.ts-a.ts;}).forEach(function(entry){
        var card=document.createElement('div');
        card.style.cssText='background:#fff;border:1px solid #efefef;border-left:4px solid #cc0001;border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:12px;box-shadow:0 1px 4px rgba(0,0,0,0.06);';

        // Фото
        if(entry.photos && entry.photos.length){
            var photoWrap=document.createElement('div');
            photoWrap.style.cssText='display:flex;flex-direction:column;gap:4px;flex-shrink:0;';
            entry.photos.forEach(function(src){
                var img=document.createElement('img');
                img.src=src; img.style.cssText='width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e0;cursor:pointer;';
                img.addEventListener('click',function(){
                    var ov=document.createElement('div');
                    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
                    var big=document.createElement('img'); big.src=src; big.style.cssText='max-width:90vw;max-height:90vh;border-radius:8px;';
                    ov.appendChild(big); ov.addEventListener('click',function(){ov.remove();}); document.body.appendChild(ov);
                });
                photoWrap.appendChild(img);
            });
            card.appendChild(photoWrap);
        }

        var info=document.createElement('div'); info.style.cssText='flex:1;min-width:0;';
        var nameRow=document.createElement('div'); nameRow.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;';
        var nameEl=document.createElement('a');
        nameEl.href='/clients/'+entry.userId; nameEl.target='_blank';
        nameEl.style.cssText='font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;';
        nameEl.textContent=entry.name||(entry.nick?'@'+entry.nick:entry.userId.slice(0,8));
        nameEl.addEventListener('mouseenter',function(){nameEl.style.textDecoration='underline';});
        nameEl.addEventListener('mouseleave',function(){nameEl.style.textDecoration='none';});
        if(entry.nick){
            var nickSpan=document.createElement('span');
            nickSpan.style.cssText='font-size:12px;color:#888;';
            nickSpan.textContent='@'+entry.nick;
            nameRow.appendChild(nameEl); nameRow.appendChild(nickSpan);
        } else { nameRow.appendChild(nameEl); }

        var reasonEl=document.createElement('div'); reasonEl.style.cssText='font-size:13px;color:#cc0001;margin-bottom:4px;';
        reasonEl.textContent='Причина: '+entry.reason;
        var dateEl=document.createElement('div'); dateEl.style.cssText='font-size:11px;color:#aaa;';
        dateEl.textContent='Заблокирован: '+fmtDate(entry.ts);

        // Кнопка разбана
        var unbanBtn=document.createElement('button');
        unbanBtn.style.cssText='margin-top:8px;background:#dcfce7;border:1px solid #86efac;color:#166534;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;';
        unbanBtn.textContent='Разблокировать';
        unbanBtn.addEventListener('click',function(){
            showUnbanModal(entry.userId, entry.nick, entry.name, function(){
                renderBanPanel(container);
            });
        });

        info.appendChild(nameRow); info.appendChild(reasonEl); info.appendChild(dateEl); info.appendChild(unbanBtn);
        card.appendChild(info);
        grid.appendChild(card);
    });

    container.appendChild(grid);
}

// ── Рендер панели "Разблокированные" ─────────────────────
function renderUnbanPanel(container){
    container.innerHTML='';
    var data=loadBanlist();
    var logs=data.log.filter(function(l){return l.action==='unban';}).slice().reverse();

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;';
    var title=document.createElement('span');
    title.style.cssText='font-size:16px;font-weight:700;color:#1a1a1a;';
    title.textContent='История разблокировок ('+logs.length+')';

    // Фильтр по нику
    var nickSel=document.createElement('select');
    nickSel.style.cssText='background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;';
    var allNicks=[''];
    logs.forEach(function(l){if(l.nick&&allNicks.indexOf(l.nick)===-1)allNicks.push(l.nick);});
    allNicks.sort();
    allNicks.forEach(function(n){
        var opt=document.createElement('option'); opt.value=n; opt.textContent=n||'Все клиенты'; nickSel.appendChild(opt);
    });
    var _filterNick='';
    nickSel.addEventListener('change',function(){
        _filterNick=this.value;
        renderRows();
    });

    hdr.appendChild(title); hdr.appendChild(nickSel);
    container.appendChild(hdr);

    var listEl=document.createElement('div');
    listEl.style.cssText='display:flex;flex-direction:column;gap:8px;';
    container.appendChild(listEl);

    function renderRows(){
        listEl.innerHTML='';
        var filtered=_filterNick?logs.filter(function(l){return l.nick===_filterNick;}):logs;
        if(!filtered.length){
            listEl.innerHTML='<div style="text-align:center;color:#aaa;padding:60px 20px;font-size:14px;">Нет записей</div>';
            return;
        }
        filtered.forEach(function(entry){
            var row=document.createElement('div');
            row.style.cssText='background:#fff;border:1px solid #efefef;border-left:4px solid #166534;border-radius:8px;padding:10px 16px;';
            var nameLink=entry.userId?('<a href="/clients/'+entry.userId+'" target="_blank" style="font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;">'+(entry.name||(entry.nick?'@'+entry.nick:entry.userId.slice(0,8)))+'</a>'):'';
            var nick=entry.nick?('<span style="font-size:12px;color:#888;margin-left:8px;">@'+entry.nick+'</span>'):'';
            row.innerHTML='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">'+nameLink+nick+'</div>'+
                '<div style="font-size:12px;color:#166534;margin-bottom:2px;"><b>Причина разбана:</b> '+entry.reason+'</div>'+
                '<div style="font-size:12px;color:#888;margin-bottom:2px;"><b>Был забанен за:</b> '+(entry.banReason||'—')+'</div>'+
                '<div style="font-size:11px;color:#aaa;">'+fmtDate(entry.ts)+'</div>';
            listEl.appendChild(row);
        });
    }
    renderRows();
}

// ── При создании сеанса для забаненного клиента — немедленно завершаем ──────
document.addEventListener('godji_ban_session_created', function(e){
    var userId = e.detail && e.detail.userId;
    var entry = loadBanlist().banned[userId] || {};
    console.warn('[banlist] Session created for banned user, will finish immediately:', userId);

    // Показываем ошибку поверх страницы — как будто посадка не удалась
    var overlay = document.getElementById('godji-ban-error-overlay');
    if(overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'godji-ban-error-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:999999;'+
        'display:flex;align-items:center;justify-content:center;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;'+
        'text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:inherit;';
    box.innerHTML = '<div style="width:56px;height:56px;background:#fff0f0;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">'+
        '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cc0001" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>'+
        '<div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Клиент заблокирован</div>'+
        '<div style="font-size:14px;color:#cc0001;margin-bottom:6px;">'+(entry.reason||'')+'</div>'+
        '<div style="font-size:12px;color:#888;margin-bottom:20px;">Сеанс завершается автоматически</div>'+
        '<button id="godji-ban-close-btn" style="background:#cc0001;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Закрыть</button>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('godji-ban-close-btn').addEventListener('click', function(){overlay.remove();});

    // Немедленно завершаем сеанс через watchForBannedSessions
    setTimeout(watchForBannedSessions, 800);
    setTimeout(watchForBannedSessions, 2500);
    setTimeout(watchForBannedSessions, 5000);

    // Закрываем overlay через 8 сек если не закрыли
    setTimeout(function(){if(overlay.parentNode)overlay.remove();}, 8000);
});

// ── Инициализация ─────────────────────────────────────────
var _initDone=false;
function init(){
    var path=window.location.pathname;
    if(path.match(/\/clients\/[a-f0-9-]{36}/)){
        injectClientPageBanBtn();
    }
    if(path.startsWith('/clients')&&path.length<=10){
        injectBanTabs();
    }
}

var _lastPath=window.location.pathname;
setInterval(function(){
    if(window.location.pathname!==_lastPath){
        _lastPath=window.location.pathname;
        _initDone=false;
        setTimeout(init,1500);
    }
    if(!_initDone){
        var path=window.location.pathname;
        if(path.match(/\/clients\/[a-f0-9-]{36}/)&&document.querySelector('.mantine-Avatar-root')){
            injectClientPageBanBtn(); _initDone=true;
        }
        if(path.startsWith('/clients')&&path.length<=10&&document.querySelector('.mantine-Tabs-list')){
            injectBanTabs(); _initDone=true;
        }
    }
},1000);

new MutationObserver(function(){
    setTimeout(init,500);
}).observe(document.body||document.documentElement,{childList:true,subtree:false});

setTimeout(init,2000);
setTimeout(watchForBannedSessions,5000);

})();

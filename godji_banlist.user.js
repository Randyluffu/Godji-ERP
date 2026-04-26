// ==UserScript==
// @name         Годжи — Бан-лист
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Бан-лист клиентов с причиной, фото, автозавершением сеанса
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
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

// Синхронизируем бан-лист в window для inline-скрипта
function syncBanlist(){
    var ids = Object.keys(loadBanlist().banned);
    window.__godji_banned_ids = ids;
}
syncBanlist();

function banUser(userId, nick, name, reason, photos){
    var data = loadBanlist();
    data.banned[userId] = { userId:userId, nick:nick||'', name:name||'',
        reason:reason, photos:photos||[], ts:Date.now() };
    data.log.push({ action:'ban', userId:userId, nick:nick||'', name:name||'',
        reason:reason, ts:Date.now() });
    saveBanlist(data); syncBanlist();
}
function unbanUser(userId, reason){
    var data = loadBanlist();
    var entry = data.banned[userId]; if(!entry) return;
    data.log.push({ action:'unban', userId:userId, nick:entry.nick||'', name:entry.name||'',
        reason:reason, banReason:entry.reason, ts:Date.now() });
    delete data.banned[userId];
    saveBanlist(data); syncBanlist();
}

// ── Fetch hook через inline-script ───────────────────────
// window.__godji_banned_ids — простой массив, доступен из page context
(function(){
    var parts = [
        '(function(){',
        'if(window.__banHk)return;window.__banHk=true;',
        'var _f=window.fetch;',
        'window.fetch=function(url,opts){',
        '  if(opts&&opts.headers&&opts.headers.authorization){',
        '    window._bkAuth=opts.headers.authorization;',
        '    window._bkRole=opts.headers["x-hasura-role"]||"club_admin";',
        '  }',
        '  if(opts&&opts.body){try{',
        '    var b=JSON.parse(opts.body);',
        '    var op=b.operationName||"";',
        '    var p=(b.variables||{}).params||(b.variables||{});',
        '    var uid=p.userId||"";',
        '    var bl=window.__godji_banned_ids||[];',
        '    if(uid&&(op==="CreateBooking"||op==="CreateBooking2"||op.indexOf("ReservationCreate")!==-1)&&bl.indexOf(uid)!==-1){',
        '      console.warn("[banlist] banned:",uid);',
        '      var pr=_f.apply(this,arguments);',
        '      pr.then(function(r){r.clone().json().then(function(d){',
        '        if(d&&d.data&&!d.errors)document.dispatchEvent(new CustomEvent("__ban_created",{detail:{u:uid}}));window.__ban_pending=uid;',
        '      }).catch(function(){});}).catch(function(){});',
        '      return pr;',
        '    }',
        '  }catch(e){}}',
        '  return _f.apply(this,arguments);',
        '};',
        '}())'
    ];
    var s = document.createElement('script');
    s.textContent = parts.join('\n');
    (document.head||document.documentElement).appendChild(s);
    s.remove();
})();

function getAuth(){ return window._bkAuth||null; }
function getRole(){ return window._bkRole||'club_admin'; }

function gql(q,v,op){
    var t=getAuth(); if(!t) return Promise.reject('no auth');
    return fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'authorization':t,'content-type':'application/json','x-hasura-role':getRole()},
        body:JSON.stringify({operationName:op||null,query:q,variables:v||{}})
    }).then(function(r){return r.json();});
}
function finishSession(sessionId){
    return gql('mutation FB($id:Int!){userReservationCancel(params:{sessionId:$id}){success}}',
        {id:sessionId},'FB');
}
function fileToBase64(file){
    return new Promise(function(res,rej){var r=new FileReader();r.onload=function(){res(r.result);};r.onerror=rej;r.readAsDataURL(file);});
}
function fmtDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear()+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// ── Модалка бана ──────────────────────────────────────────
function showBanModal(userId, nick, name, onDone){
    if(document.getElementById('godji-ban-modal')) return;
    var ov=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;');
    ov.id='godji-ban-modal';
    var box=mk('div','background:#fff;border-radius:12px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,0.22);font-family:inherit;overflow:hidden;');
    box.addEventListener('click',function(e){e.stopPropagation();});

    var hdr=mk('div','display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #f0f0f0;');
    var hIco=mk('div','width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;');
    hIco.innerHTML=SVG_BAN;
    var hTxt=mk('div','flex:1;');
    hTxt.innerHTML='<div style="font-size:15px;font-weight:700;color:#1a1a1a;">Заблокировать клиента</div>'+
        '<div style="font-size:12px;color:#888;margin-top:2px;">'+(nick?'@'+nick+' · ':'')+name+'</div>';
    var xBtn=mk('button','background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;');
    xBtn.innerHTML='&times;'; xBtn.onclick=function(){ov.remove();};
    hdr.appendChild(hIco); hdr.appendChild(hTxt); hdr.appendChild(xBtn);

    var body=mk('div','padding:16px 20px;display:flex;flex-direction:column;gap:12px;');
    var reasonLbl=mkLabel('Причина блокировки *');
    var reasonInp=mk('textarea','border:1px solid #e0e0e0;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;color:#333;resize:vertical;outline:none;transition:border-color 0.15s;width:100%;box-sizing:border-box;');
    reasonInp.rows=3; reasonInp.placeholder='Опишите причину…';
    reasonInp.onfocus=function(){reasonInp.style.borderColor='#cc0001';};
    reasonInp.onblur=function(){reasonInp.style.borderColor='#e0e0e0';};
    reasonLbl.appendChild(reasonInp);

    var photoLbl=mkLabel('Фотографии (необязательно)');
    var photoInp=mk('input','font-size:12px;color:#555;'); photoInp.type='file'; photoInp.accept='image/*'; photoInp.multiple=true;
    var photoPreview=mk('div','display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;');
    var _photos=[];
    photoInp.onchange=async function(){
        _photos=[]; photoPreview.innerHTML='';
        for(var i=0;i<photoInp.files.length;i++){
            var b64=await fileToBase64(photoInp.files[i]); _photos.push(b64);
            var img=mk('img','width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e0;');
            img.src=b64; photoPreview.appendChild(img);
        }
    };
    photoLbl.appendChild(photoInp); photoLbl.appendChild(photoPreview);

    var statusEl=mk('div','font-size:12px;color:#cc0001;min-height:16px;');
    var submitBtn=mk('button','background:#cc0001;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;');
    submitBtn.textContent='Заблокировать';
    submitBtn.onclick=function(){
        var reason=reasonInp.value.trim();
        if(!reason){statusEl.textContent='Укажите причину';return;}
        banUser(userId,nick,name,reason,_photos);
        ov.remove(); if(onDone)onDone();
    };
    body.appendChild(reasonLbl); body.appendChild(photoLbl); body.appendChild(statusEl); body.appendChild(submitBtn);
    box.appendChild(hdr); box.appendChild(body); ov.appendChild(box);
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
    document.body.appendChild(ov);
    setTimeout(function(){reasonInp.focus();},50);
}

// ── Модалка разбана ───────────────────────────────────────
function showUnbanModal(userId, nick, name, onDone){
    if(document.getElementById('godji-unban-modal')) return;
    var entry=loadBanlist().banned[userId];
    var ov=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;');
    ov.id='godji-unban-modal';
    var box=mk('div','background:#fff;border-radius:12px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,0.22);font-family:inherit;overflow:hidden;');
    box.addEventListener('click',function(e){e.stopPropagation();});

    var hdr=mk('div','display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid #f0f0f0;');
    var hIco=mk('div','width:32px;height:32px;border-radius:8px;background:#166534;display:flex;align-items:center;justify-content:center;flex-shrink:0;');
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-11 11-5-5"/></svg>';
    var hTxt=mk('div','flex:1;');
    hTxt.innerHTML='<div style="font-size:15px;font-weight:700;color:#1a1a1a;">Разблокировать клиента</div>'+
        '<div style="font-size:12px;color:#888;margin-top:2px;">'+(nick?'@'+nick+' · ':'')+name+'</div>'+
        (entry?'<div style="font-size:11px;color:#cc0001;margin-top:3px;">Причина бана: '+entry.reason+'</div>':'');
    var xBtn=mk('button','background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;');
    xBtn.innerHTML='&times;'; xBtn.onclick=function(){ov.remove();};
    hdr.appendChild(hIco); hdr.appendChild(hTxt); hdr.appendChild(xBtn);

    var body=mk('div','padding:16px 20px;display:flex;flex-direction:column;gap:12px;');
    var reasonLbl=mkLabel('Причина разблокировки *');
    var reasonInp=mk('textarea','border:1px solid #e0e0e0;border-radius:7px;padding:8px 10px;font-size:13px;font-family:inherit;color:#333;resize:vertical;outline:none;transition:border-color 0.15s;width:100%;box-sizing:border-box;');
    reasonInp.rows=2; reasonInp.placeholder='Укажите причину…';
    reasonInp.onfocus=function(){reasonInp.style.borderColor='#166534';};
    reasonInp.onblur=function(){reasonInp.style.borderColor='#e0e0e0';};
    reasonLbl.appendChild(reasonInp);
    var statusEl=mk('div','font-size:12px;color:#cc0001;min-height:16px;');
    var submitBtn=mk('button','background:#166534;color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;width:100%;');
    submitBtn.textContent='Разблокировать';
    submitBtn.onclick=function(){
        var reason=reasonInp.value.trim();
        if(!reason){statusEl.textContent='Укажите причину';return;}
        unbanUser(userId,reason); ov.remove(); if(onDone)onDone();
    };
    body.appendChild(reasonLbl); body.appendChild(statusEl); body.appendChild(submitBtn);
    box.appendChild(hdr); box.appendChild(body); ov.appendChild(box);
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
    document.body.appendChild(ov);
    setTimeout(function(){reasonInp.focus();},50);
}

// ── Overlay "сеанс создан для забаненного" ───────────────
// Fallback: inline-скрипт записывает window.__ban_pending если event не доставлен
setInterval(function(){
    if(window.__ban_pending){
        var uid=window.__ban_pending; window.__ban_pending=null;
        document.dispatchEvent(new CustomEvent('__ban_created',{detail:{u:uid}}));
    }
},500);

document.addEventListener('__ban_created', function(e){
    var userId = e.detail && e.detail.u;
    var entry = loadBanlist().banned[userId] || {};
    var ov=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:999999;display:flex;align-items:center;justify-content:center;');
    ov.id='godji-ban-error-ov';
    var box=mk('div','background:#fff;border-radius:12px;padding:28px 32px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.3);font-family:inherit;');
    box.innerHTML='<div style="width:56px;height:56px;background:#fff0f0;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">'+
        SVG_BAN_BIG+'</div>'+
        '<div style="font-size:18px;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Клиент заблокирован</div>'+
        '<div style="font-size:14px;color:#cc0001;margin-bottom:6px;">'+(entry.reason||'')+'</div>'+
        '<div style="font-size:12px;color:#888;margin-bottom:20px;">Сеанс завершается автоматически</div>';
    var closeBtn=mk('button','background:#cc0001;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;');
    closeBtn.textContent='Закрыть';
    closeBtn.onclick=function(){ov.remove();};
    box.appendChild(closeBtn); ov.appendChild(box); document.body.appendChild(ov);
    setTimeout(function(){if(ov.parentNode)ov.remove();},8000);
    // Немедленно завершаем сеанс
    setTimeout(watchForBannedSessions, 1000);
    setTimeout(watchForBannedSessions, 3000);
});

// ── SVG иконки ────────────────────────────────────────────
var SVG_BAN = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
var SVG_BAN_BIG = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cc0001" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';
var SVG_BAN_SM = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>';

// ── Helpers ───────────────────────────────────────────────
function mk(tag, css){ var e=document.createElement(tag); if(css)e.style.cssText=css; return e; }
function mkLabel(text){ var l=mk('label','font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.4px;display:flex;flex-direction:column;gap:4px;'); l.textContent=text; return l; }

// ── Автозавершение сеансов забаненных ─────────────────────
var _watchedSessions = {};
function watchForBannedSessions(){
    var auth=getAuth(); if(!auth) return;
    var bannedIds=Object.keys(loadBanlist().banned);
    if(!bannedIds.length) return;
    gql('query CB($clubId:Int!){reservations(where:{club_id:{_eq:$clubId}},order_by:{id:desc},limit:100){id user_id status}}',
        {clubId:CLUB_ID},'CB'
    ).then(function(d){
        var res=d.data&&d.data.reservations; if(!res) return;
        var INACTIVE=['finished','canceled','ended','completed','closed','end_rejected','rejected','end_finished'];
        res.forEach(function(r){
            if(bannedIds.indexOf(r.user_id)===-1) return;
            if(INACTIVE.indexOf(r.status)!==-1) return;
            if(_watchedSessions[r.id]) return;
            _watchedSessions[r.id]=true;
            var entry=loadBanlist().banned[r.user_id];
            console.warn('[banlist] finishing session',r.id,'status:',r.status,'for banned user',r.user_id);
            finishSession(r.id).then(function(result){
                console.log('[banlist] finishSession result:', JSON.stringify(result));
                if(result && result.errors) {
                    console.error('[banlist] finish failed:', result.errors[0].message);
                    delete _watchedSessions[r.id];
                    return;
                }
                var toast=mk('div','position:fixed;top:20px;right:20px;z-index:999999;background:#fff0f0;border:2px solid #cc0001;border-radius:10px;padding:12px 16px;font-family:inherit;box-shadow:0 4px 16px rgba(0,0,0,0.2);max-width:320px;');
                toast.innerHTML='<div style="font-size:13px;font-weight:700;color:#cc0001;margin-bottom:2px;">Сеанс завершён</div>'+
                    '<div style="font-size:12px;color:#991b1b;">'+(entry?entry.reason:'')+'</div>';
                document.body.appendChild(toast);
                setTimeout(function(){if(toast.parentNode)toast.remove();},5000);
            }).catch(function(e){ console.error('[banlist] finish error:', e); delete _watchedSessions[r.id]; });
        });
    }).catch(function(){});
}
setInterval(watchForBannedSessions, 5000);

// ── Кнопка бана на карточке клиента /clients/:id ─────────
function injectClientPageBanBtn(){
    if(document.getElementById('godji-ban-client-btn')) return;
    var m=window.location.pathname.match(/\/clients\/([a-f0-9-]{36})/);
    if(!m) return;
    var clientId=m[1];

    var avatarEl=document.querySelector('.mantine-Avatar-root[data-size="xl"]');
    if(!avatarEl) return;
    var avatarRow=avatarEl.closest('[class*="Flex-root"]');
    if(!avatarRow) return;

    var nick='', name='';
    document.querySelectorAll('p,span').forEach(function(el){
        if(el.textContent.match(/^@\w+$/)&&!nick) nick=el.textContent.slice(1);
    });
    var nameEl=document.querySelector('[style*="font-weight: 700"]');
    if(nameEl) name=nameEl.textContent.trim();

    var banned=isBanned(clientId);
    var btn=mk('button',banned
        ?'background:var(--mantine-color-green-light,#dcfce7);border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#166534;display:flex;align-items:center;gap:5px;'
        :'background:var(--mantine-color-red-light,#fff0f0);border:none;border-radius:7px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#cc0001;display:flex;align-items:center;gap:5px;');
    btn.id='godji-ban-client-btn';
    btn.innerHTML=(banned?'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-11 11-5-5"/></svg>':'<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>')+
        '<span>'+(banned?'Разблокировать':'Заблокировать')+'</span>';
    btn.onclick=function(){
        if(isBanned(clientId)){
            showUnbanModal(clientId,nick,name,function(){btn.remove();setTimeout(injectClientPageBanBtn,100);});
        } else {
            showBanModal(clientId,nick,name,function(){btn.remove();setTimeout(injectClientPageBanBtn,100);});
        }
    };

    // Вставляем в flex-ряд с аватаром, справа
    avatarRow.style.justifyContent='space-between';
    var wrap=mk('div','display:flex;align-items:flex-start;flex-shrink:0;padding-top:2px;');
    wrap.appendChild(btn); avatarRow.appendChild(wrap);

    // Баннер бана на карточке
    var existing=document.getElementById('godji-ban-info-banner');
    if(existing) existing.remove();
    if(banned){
        var entry=loadBanlist().banned[clientId];
        var banner=mk('div','background:#fff0f0;border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:12px;color:#cc0001;font-weight:600;margin-top:8px;display:flex;align-items:flex-start;gap:8px;');
        banner.id='godji-ban-info-banner';
        banner.innerHTML=SVG_BAN_SM+
            '<div><div style="font-weight:700;">КЛИЕНТ ЗАБЛОКИРОВАН</div>'+
            '<div style="font-weight:400;margin-top:2px;color:#991b1b;">'+(entry?entry.reason:'')+'</div>'+
            '<div style="font-weight:400;margin-top:2px;color:#bbb;font-size:11px;">'+(entry?fmtDate(entry.ts):'')+'</div></div>';
        if(entry&&entry.photos&&entry.photos.length){
            var pr=mk('div','display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;');
            entry.photos.forEach(function(src){
                var img=mk('img','width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #fca5a5;cursor:pointer;');
                img.src=src;
                img.onclick=function(){
                    var ov=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:pointer;');
                    var big=mk('img','max-width:90vw;max-height:90vh;border-radius:8px;'); big.src=src;
                    ov.appendChild(big); ov.onclick=function(){ov.remove();}; document.body.appendChild(ov);
                };
                pr.appendChild(img);
            });
            banner.appendChild(pr);
        }
        var parentFlex=avatarRow.parentNode;
        if(parentFlex){
            var nextEl=avatarRow.nextSibling;
            if(nextEl) parentFlex.insertBefore(banner,nextEl);
            else parentFlex.appendChild(banner);
        }
    }
}

// ── Вкладки на /clients ───────────────────────────────────
function injectBanTabs(){
    if(!window.location.pathname.startsWith('/clients')) return;
    if(window.location.pathname.length>10) return;
    if(document.getElementById('godji-ban-tab')) return;
    var tabsList=document.querySelector('.mantine-Tabs-list');
    if(!tabsList) return;
    var tabsRoot=tabsList.closest('.mantine-Tabs-root');
    if(!tabsRoot) return;

    function mkTab(id, label){
        var t=mk('button','font-size:var(--mantine-font-size-md);font-weight:500;');
        t.id=id; t.className='mantine-focus-auto m_539e827b m_4ec4dce6 mantine-Tabs-tab m_87cf2631 mantine-UnstyledButton-root';
        t.setAttribute('data-variant','default'); t.setAttribute('data-orientation','horizontal');
        t.setAttribute('type','button'); t.setAttribute('role','tab');
        t.innerHTML='<span class="mantine-Tabs-tabLabel">'+label+'</span>';
        return t;
    }

    var banTab=mkTab('godji-ban-tab','Заблокированные');
    var unbanTab=mkTab('godji-unban-tab','Разблокированные');
    tabsList.appendChild(banTab); tabsList.appendChild(unbanTab);

    var banPanel=mk('div','display:none;padding:16px 0;');
    banPanel.id='godji-ban-panel';
    var unbanPanel=mk('div','display:none;padding:16px 0;');
    unbanPanel.id='godji-unban-panel';
    tabsRoot.appendChild(banPanel); tabsRoot.appendChild(unbanPanel);

    function deactivateAll(){
        tabsList.querySelectorAll('.mantine-Tabs-tab').forEach(function(t){
            t.setAttribute('aria-selected','false'); t.removeAttribute('data-active');
        });
        tabsRoot.querySelectorAll('.mantine-Tabs-panel').forEach(function(p){ p.style.removeProperty('display'); });
        banPanel.style.display='none'; unbanPanel.style.display='none';
        banTab.setAttribute('aria-selected','false'); banTab.removeAttribute('data-active');
        unbanTab.setAttribute('aria-selected','false'); unbanTab.removeAttribute('data-active');
    }

    // Нативные вкладки — восстанавливаем поведение
    tabsList.querySelectorAll('.mantine-Tabs-tab:not([id^="godji"])').forEach(function(t){
        t.addEventListener('click', deactivateAll);
    });

    function activateOur(tab, panel, renderFn){
        deactivateAll();
        tabsRoot.querySelectorAll('.mantine-Tabs-panel').forEach(function(p){ p.style.display='none'; });
        tab.setAttribute('aria-selected','true'); tab.setAttribute('data-active','true');
        panel.style.display='block'; renderFn(panel);
    }
    banTab.addEventListener('click',function(){ activateOur(banTab,banPanel,renderBanPanel); });
    unbanTab.addEventListener('click',function(){ activateOur(unbanTab,unbanPanel,renderUnbanPanel); });
}

// ── Рендер "Заблокированные" ──────────────────────────────
function renderBanPanel(container){
    container.innerHTML='';
    var banned=Object.values(loadBanlist().banned).sort(function(a,b){return b.ts-a.ts;});
    var title=mk('div','font-size:16px;font-weight:700;color:#1a1a1a;margin-bottom:16px;');
    title.textContent='Заблокированные клиенты ('+banned.length+')';
    container.appendChild(title);
    if(!banned.length){
        var e=mk('div','text-align:center;color:#aaa;padding:60px;font-size:14px;');
        e.textContent='Нет заблокированных клиентов'; container.appendChild(e); return;
    }
    var list=mk('div','display:flex;flex-direction:column;gap:10px;');
    banned.forEach(function(entry){
        var card=mk('div','background:#fff;border:1px solid #efefef;border-left:4px solid #cc0001;border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:12px;');
        if(entry.photos&&entry.photos.length){
            var pw=mk('div','display:flex;flex-direction:column;gap:4px;flex-shrink:0;');
            entry.photos.forEach(function(src){
                var img=mk('img','width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #e0e0e0;cursor:pointer;');
                img.src=src; img.onclick=function(){
                    var ov=mk('div','position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:pointer;');
                    var big=mk('img','max-width:90vw;max-height:90vh;border-radius:8px;'); big.src=src;
                    ov.appendChild(big); ov.onclick=function(){ov.remove();}; document.body.appendChild(ov);
                }; pw.appendChild(img);
            }); card.appendChild(pw);
        }
        var info=mk('div','flex:1;min-width:0;');
        var nr=mk('div','display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;');
        var na=mk('a','font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;');
        na.href='/clients/'+entry.userId; na.target='_blank';
        na.textContent=entry.name||(entry.nick?'@'+entry.nick:entry.userId.slice(0,8));
        na.onmouseenter=function(){na.style.textDecoration='underline';}; na.onmouseleave=function(){na.style.textDecoration='none';};
        nr.appendChild(na);
        if(entry.nick){var ns=mk('span','font-size:12px;color:#888;'); ns.textContent='@'+entry.nick; nr.appendChild(ns);}
        var re=mk('div','font-size:13px;color:#cc0001;margin-bottom:4px;'); re.textContent='Причина: '+entry.reason;
        var de=mk('div','font-size:11px;color:#aaa;'); de.textContent='Заблокирован: '+fmtDate(entry.ts);
        var ub=mk('button','margin-top:8px;background:#dcfce7;border:1px solid #86efac;color:#166534;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;');
        ub.textContent='Разблокировать';
        ub.onclick=function(){ showUnbanModal(entry.userId,entry.nick,entry.name,function(){renderBanPanel(container);}); };
        info.appendChild(nr); info.appendChild(re); info.appendChild(de); info.appendChild(ub);
        card.appendChild(info); list.appendChild(card);
    });
    container.appendChild(list);
}

// ── Рендер "Разблокированные" ─────────────────────────────
function renderUnbanPanel(container){
    container.innerHTML='';
    var logs=loadBanlist().log.filter(function(l){return l.action==='unban';}).slice().reverse();
    var hdr=mk('div','display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;');
    var title=mk('span','font-size:16px;font-weight:700;color:#1a1a1a;'); title.textContent='История разблокировок ('+logs.length+')';
    var nickSel=mk('select','background:#fff;border:1px solid #e0e0e0;color:#444;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;cursor:pointer;');
    var nicks=[''];
    logs.forEach(function(l){if(l.nick&&nicks.indexOf(l.nick)===-1)nicks.push(l.nick);});
    nicks.sort().forEach(function(n){var o=mk('option'); o.value=n; o.textContent=n||'Все клиенты'; nickSel.appendChild(o);});
    var _fNick='';
    hdr.appendChild(title); hdr.appendChild(nickSel); container.appendChild(hdr);
    var list=mk('div','display:flex;flex-direction:column;gap:8px;'); container.appendChild(list);
    function renderRows(){
        list.innerHTML='';
        var filtered=_fNick?logs.filter(function(l){return l.nick===_fNick;}):logs;
        if(!filtered.length){list.innerHTML='<div style="text-align:center;color:#aaa;padding:60px;font-size:14px;">Нет записей</div>';return;}
        filtered.forEach(function(entry){
            var row=mk('div','background:#fff;border:1px solid #efefef;border-left:4px solid #166534;border-radius:8px;padding:10px 16px;');
            var na=entry.userId?('<a href="/clients/'+entry.userId+'" target="_blank" style="font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;">'+(entry.name||(entry.nick?'@'+entry.nick:entry.userId.slice(0,8)))+'</a>'):'';
            var ni=entry.nick?('<span style="font-size:12px;color:#888;margin-left:8px;">@'+entry.nick+'</span>'):'';
            row.innerHTML='<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">'+na+ni+'</div>'+
                '<div style="font-size:12px;color:#166534;margin-bottom:2px;"><b>Причина разбана:</b> '+entry.reason+'</div>'+
                '<div style="font-size:12px;color:#888;margin-bottom:2px;"><b>Был забанен за:</b> '+(entry.banReason||'—')+'</div>'+
                '<div style="font-size:11px;color:#aaa;">'+fmtDate(entry.ts)+'</div>';
            list.appendChild(row);
        });
    }
    nickSel.onchange=function(){_fNick=this.value;renderRows();};
    renderRows();
}

// ── Инициализация ─────────────────────────────────────────
var _initDone=false, _lastPath=window.location.pathname;

function init(){
    var path=window.location.pathname;
    if(path.match(/\/clients\/[a-f0-9-]{36}/)) injectClientPageBanBtn();
    if(path.startsWith('/clients')&&path.length<=10) injectBanTabs();
}

setInterval(function(){
    if(window.location.pathname!==_lastPath){ _lastPath=window.location.pathname; _initDone=false; setTimeout(init,1500); }
    if(!_initDone){
        var path=window.location.pathname;
        if(path.match(/\/clients\/[a-f0-9-]{36}/)&&document.querySelector('.mantine-Avatar-root')){ injectClientPageBanBtn(); _initDone=true; }
        if(path.startsWith('/clients')&&path.length<=10&&document.querySelector('.mantine-Tabs-list')){ injectBanTabs(); _initDone=true; }
    }
},1000);

new MutationObserver(function(){ setTimeout(init,500); })
    .observe(document.body||document.documentElement,{childList:true,subtree:false});

setTimeout(init,2000);
setTimeout(watchForBannedSessions,5000);

})();

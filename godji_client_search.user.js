// ==UserScript==
// @name         Годжи — Быстрый поиск клиента
// @namespace    http://tampermonkey.net/
// @version      5.24
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_client_search.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_client_search.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==
(function(){
'use strict';

var _tok=null,_role='club_admin',_oF=window.fetch;
window.fetch=function(url,opts){
    if(opts&&opts.headers&&opts.headers.authorization){_tok=opts.headers.authorization;_role=opts.headers['x-hasura-role']||'club_admin';}
    return _oF.apply(this,arguments);
};
function hdrs(){var t=_tok||window._godjiAuthToken;if(!t)return null;return{'authorization':t,'content-type':'application/json','x-hasura-role':_role||'club_admin'};}
async function gql(q,v){var h=hdrs();if(!h)return null;try{var r=await _oF('https://hasura.godji.cloud/v1/graphql',{method:'POST',headers:h,body:JSON.stringify({query:q,variables:v})});return await r.json();}catch(e){return null;}}

async function searchClients(q){
    if(!q.trim())return[];
    var res=await gql('query S($q:String!,$c:Int!){users(where:{role:{_eq:user},users_wallets:{club_id:{_eq:$c}},_or:[{users_user_profile:{login:{_ilike:$q}}},{users_user_profile:{name:{_ilike:$q}}},{users_user_profile:{surname:{_ilike:$q}}},{phone:{_ilike:$q}}]},order_by:{users_reservations_aggregate:{max:{time_from:desc_nulls_last}}},limit:8){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$c}},limit:1){balance_amount balance_bonus}users_reservations(where:{club_id:{_eq:$c}},order_by:{time_from:desc},limit:1){time_from}}}',{q:'%'+q.trim()+'%',c:14});
    return res&&res.data&&res.data.users?res.data.users:[];
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

var _panel=null,_modal=null,_st=null,_colOpen=false,_sbObs=null;

// === SIDEBAR COLLAPSE ===
function getNavLink(text){
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb)return null;
    return Array.from(sb.querySelectorAll('a.mantine-focus-auto')).find(function(a){
        var l=a.querySelector('.m_1f6ac4c4');return l&&l.textContent.trim()===text;
    });
}

function updateHistoryPos(){
    var hist=document.getElementById('godji-history-btn');
    if(!hist)return;
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb)return;
    var maxB=0;
    Array.from(sb.querySelectorAll('a.mantine-focus-auto,a[id^="godji-col"]')).forEach(function(a){
        if(a.style.display==='none')return;
        var r=a.getBoundingClientRect();
        if(r.bottom>maxB)maxB=r.bottom;
    });
    if(maxB<100)return;
    hist.style.top=Math.round(maxB)+'px';
    hist.style.bottom='';
}

function applyCollapse(){
    ['Магазин клуба','Финансы клуба'].forEach(function(t){
        var a=getNavLink(t);if(a)a.style.display=_colOpen?'':'none';
    });
    var icon=document.getElementById('godji-col-icon');
    if(icon)icon.style.transform=_colOpen?'rotate(180deg)':'';
    setTimeout(updateHistoryPos,50);
}

function insertCollapseBtn(){
    if(document.getElementById('godji-col-btn'))return;
    var bookLink=getNavLink('Бронирование');
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!bookLink||!sb)return;
    var btn=document.createElement('a');
    btn.id='godji-col-btn';btn.className=bookLink.className;btn.href='javascript:void(0)';
    var body=document.createElement('div');body.className='m_f07af9d2 mantine-NavLink-body';
    body.style.cssText='display:flex;justify-content:space-between;align-items:center;width:100%;';
    var lbl=document.createElement('span');lbl.className='m_1f6ac4c4 mantine-NavLink-label';lbl.textContent='Ещё';
    var icon=document.createElement('span');icon.id='godji-col-icon';
    icon.style.cssText='font-size:11px;opacity:0.5;transition:transform 0.2s;margin-right:8px;';icon.textContent='▾';
    body.appendChild(lbl);body.appendChild(icon);btn.appendChild(body);
    btn.addEventListener('click',function(){_colOpen=!_colOpen;applyCollapse();});
    sb.insertBefore(btn,bookLink.nextSibling);
    applyCollapse();
}

function watchSidebar(){
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb||_sbObs)return;
    _sbObs=new MutationObserver(function(){
        applyCollapse();
        if(!document.getElementById('godji-col-btn')){_sbObs.disconnect();_sbObs=null;setTimeout(function(){insertCollapseBtn();watchSidebar();},100);}
    });
    _sbObs.observe(sb,{childList:true});
}

// Следим за появлением godji-history-btn
new MutationObserver(function(muts){
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType===1&&n.id==='godji-history-btn'){
                setTimeout(updateHistoryPos,50);setTimeout(updateHistoryPos,300);setTimeout(updateHistoryPos,1000);
            }
        });
    });
}).observe(document.body||document.documentElement,{childList:true});

// Polling позиции истории
setInterval(function(){
    var hist=document.getElementById('godji-history-btn');
    if(!hist)return;
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb)return;
    var maxB=0;
    Array.from(sb.querySelectorAll('a.mantine-focus-auto,a[id^="godji-col"]')).forEach(function(a){
        if(a.style.display==='none')return;
        var r=a.getBoundingClientRect();if(r.bottom>maxB)maxB=r.bottom;
    });
    if(maxB<100)return;
    var newTop=Math.round(maxB)+'px';
    if(hist.style.top!==newTop){hist.style.top=newTop;hist.style.bottom='';}
},300);

// === SEARCH BUTTON ===
function createSearchBtn(){
    if(document.getElementById('godji-search-btn'))return;
    var btn=document.createElement('a');
    btn.id='godji-search-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='position:fixed;bottom:456px;left:0;z-index:500;display:flex;align-items:center;gap:12px;width:280px;height:46px;padding:8px 12px 8px 18px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';
    var ico=document.createElement('div');
    ico.style.cssText='width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
    var lbl=document.createElement('span');
    lbl.style.cssText='font-size:14px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.1px;';
    lbl.textContent='Поиск клиента';
    btn.appendChild(ico);btn.appendChild(lbl);
    document.body.appendChild(btn);
    btn.addEventListener('click',togglePanel);
}

// === SEARCH PANEL ===
function createSearchPanel(){
    if(_panel)return;
    var p=document.createElement('div');
    p.id='godji-search-panel';
    // Фиксированная позиция прямо над кнопкой, не двигается
    // Панель зажата между top:16px и bottom:502px — никуда не двигается
    p.style.cssText='position:fixed;top:16px;bottom:502px;left:0;width:280px;background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md,8px);box-shadow:0 -4px 24px rgba(0,0,0,0.3);z-index:9999;display:none;flex-direction:column;font-family:var(--mantine-font-family);overflow:hidden;';

    var hw=document.createElement('div');
    hw.style.cssText='padding:8px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--mantine-color-default-border);flex-shrink:0;';
    var si=document.createElement('div');
    si.style.cssText='color:var(--mantine-color-dimmed);line-height:0;flex-shrink:0;';
    si.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
    var inp=document.createElement('input');
    inp.id='godji-search-input';inp.type='text';inp.placeholder='Ник, имя, телефон...';
    inp.setAttribute('autocomplete','off');inp.setAttribute('autocorrect','off');
    inp.setAttribute('autocapitalize','off');inp.setAttribute('spellcheck','false');
    inp.style.cssText='flex:1;border:none;outline:none;background:transparent;font-size:var(--mantine-font-size-sm,14px);font-family:inherit;color:var(--mantine-color-text);';

    // Кнопка "Добавить клиента"
    var addBtn=document.createElement('button');
    addBtn.title='Добавить клиента';
    addBtn.style.cssText='flex-shrink:0;width:26px;height:26px;border-radius:6px;background:rgba(204,0,1,0.12);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#cc0001;transition:background 0.15s;';
    addBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>';
    addBtn.onmouseenter=function(){addBtn.style.background='rgba(204,0,1,0.22)';};
    addBtn.onmouseleave=function(){addBtn.style.background='rgba(204,0,1,0.12)';};
    addBtn.addEventListener('click',function(e){
        e.stopPropagation();
        openAddClientModal();
    });

    hw.appendChild(si);hw.appendChild(inp);hw.appendChild(addBtn);

    var res=document.createElement('div');
    res.id='godji-search-results';
    res.style.cssText='overflow-y:auto;flex:1;min-height:0;';

    p.appendChild(hw);p.appendChild(res);
    document.body.appendChild(p);
    _panel=p;

    inp.addEventListener('input',function(){
        clearTimeout(_st);
        var q=inp.value.trim();
        if(!q){res.innerHTML='';return;}
        res.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--mantine-color-dimmed);">Поиск...</div>';
        _st=setTimeout(async function(){renderResults(await searchClients(q),res);},250);
    });
    inp.addEventListener('keydown',function(e){if(e.key==='Escape')closePanel();});
}

function closePanel(){
    if(!_panel)return;
    _panel.style.display='none';
    var i=document.getElementById('godji-search-input');
    var r=document.getElementById('godji-search-results');
    if(i)i.value='';if(r)r.innerHTML='';
}

function togglePanel(){
    if(!_panel)createSearchPanel();
    if(_panel.style.display!=='none'){closePanel();}
    else{
        _panel.style.display='flex';
        setTimeout(function(){var i=document.getElementById('godji-search-input');if(i)i.focus();},50);
    }
}

// === ADD CLIENT MODAL ===
function openAddClientModal(){
    if(_modal){_modal.remove();_modal=null;}

    // Оверлей
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(ov);
    _modal=ov;

    // Спиннер
    var spinner=document.createElement('div');
    spinner.style.cssText='width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#cc0001;border-radius:50%;animation:godji-spin 0.7s linear infinite;';
    if(!document.getElementById('godji-spin-style')){
        var st=document.createElement('style');st.id='godji-spin-style';
        st.textContent='@keyframes godji-spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
    }
    ov.appendChild(spinner);

    function cleanup(){if(ov.parentNode)ov.remove();if(iframe&&iframe.parentNode)iframe.remove();_modal=null;}
    ov.addEventListener('click',function(e){if(e.target===ov)cleanup();});
    document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){cleanup();document.removeEventListener('keydown',esc);}});

    // Скрытый iframe на /clients
    var iframe=document.createElement('iframe');
    iframe.src='/clients';
    iframe.style.cssText='position:fixed;top:-9999px;left:-9999px;width:1920px;height:1080px;border:none;opacity:0;pointer-events:none;';
    document.body.appendChild(iframe);

    var _clicked=false,_shown=false;
    var t=setInterval(function(){
        if(_shown)return;
        try{
            var idoc=iframe.contentDocument||iframe.contentWindow.document;
            if(!idoc||!idoc.body)return;

            // Шаг 1: кликаем кнопку добавления
            if(!_clicked){
                var addBtn=Array.from(idoc.querySelectorAll('button')).find(function(b){return b.textContent.trim()==='Добавить клиента';});
                if(!addBtn)return;
                _clicked=true;
                addBtn.click();
                return;
            }

            // Шаг 2: ждём модалку
            var modalInner=idoc.querySelector('.mantine-Modal-inner');
            var modalContent=idoc.querySelector('.mantine-Modal-content[data-modal-content="true"]');
            if(!modalContent||!modalInner)return;

            _shown=true;
            clearInterval(t);

            // Размеры модалки
            var r=modalContent.getBoundingClientRect();
            var mw=Math.ceil(r.width)||440;
            var mh=Math.ceil(r.height)||280;

            // CSS — скрываем ВСЁ кроме модалки, включая сайдбар
            var s=idoc.createElement('style');
            s.textContent=
                '*{visibility:hidden!important}'+
                '.mantine-Modal-inner,.mantine-Modal-inner *{visibility:visible!important}'+
                '.mantine-Modal-overlay{display:none!important}'+
                '.mantine-Modal-inner{position:fixed!important;top:0!important;left:0!important;'+
                'width:'+mw+'px!important;height:'+mh+'px!important;'+
                'display:block!important;padding:0!important;overflow:hidden!important;}'+
                'html,body{overflow:hidden!important;background:transparent!important;margin:0!important;padding:0!important;}';
            idoc.head.appendChild(s);

            // Показываем iframe обрезанным по размеру модалки
            iframe.style.cssText=[
                'position:static',
                'width:'+mw+'px',
                'height:'+mh+'px',
                'border:none',
                'border-radius:var(--mantine-radius-md,8px)',
                'box-shadow:0 16px 48px rgba(0,0,0,0.6)',
                'opacity:1',
                'pointer-events:all',
                'display:block',
                'flex-shrink:0',
            ].join(';');

            if(spinner.parentNode)spinner.remove();
            ov.appendChild(iframe);

            // Следим за закрытием модалки
            new MutationObserver(function(){
                try{
                    if(!idoc.querySelector('.mantine-Modal-content[data-modal-content="true"]')){
                        cleanup();
                    }
                }catch(e2){}
            }).observe(idoc.body,{childList:true,subtree:true});

        }catch(e){}
    },100);

    setTimeout(function(){if(!_shown){clearInterval(t);if(spinner.parentNode)spinner.remove();}},10000);
}


function renderResults(clients,container){
    container.innerHTML='';
    if(!clients.length){container.innerHTML='<div style="padding:10px 12px;font-size:12px;color:var(--mantine-color-dimmed);">Ничего не найдено</div>';return;}
    clients.forEach(function(c,i){
        var pr=c.users_user_profile||{};
        var w=c.users_wallets&&c.users_wallets[0];
        var name=[pr.surname,pr.name].filter(Boolean).join(' ')||'—';
        var nick=pr.login?'@'+pr.login:'';
        var bal=w?Math.round(w.balance_amount)+' ₽':'';
        var bon=w&&w.balance_bonus>0?' · '+Math.round(w.balance_bonus)+' G':'';
        // Последний визит
        var lastVisit='';
        if(c.users_reservations&&c.users_reservations[0]){
            var d=new Date(c.users_reservations[0].time_from);
            var now=new Date();
            var diffDays=Math.floor((now-d)/(1000*60*60*24));
            if(diffDays===0)lastVisit='сегодня';
            else if(diffDays===1)lastVisit='вчера';
            else if(diffDays<7)lastVisit=diffDays+' дн. назад';
            else lastVisit=d.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
        }
        var item=document.createElement('div');
        item.style.cssText='padding:8px 12px;cursor:pointer;transition:background 0.1s;'+(i>0?'border-top:1px solid var(--mantine-color-default-border)':'');
        item.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;">'+
            '<span style="font-size:var(--mantine-font-size-sm,14px);font-weight:600;color:var(--mantine-color-text);">'+esc(nick||name)+'</span>'+
            '<span style="font-size:11px;color:var(--mantine-color-dimmed);white-space:nowrap;flex-shrink:0;">'+esc(bal+bon)+'</span></div>'+
            '<div style="font-size:11px;color:var(--mantine-color-dimmed);margin-top:2px;display:flex;justify-content:space-between;gap:8px;">'+
            '<span style="display:flex;gap:8px;">'+(nick?'<span>'+esc(name)+'</span>':'')+(c.phone?'<span>'+esc(c.phone)+'</span>':'')+'</span>'+
            (lastVisit?'<span style="opacity:0.6;flex-shrink:0;">'+esc(lastVisit)+'</span>':'')+
            '</div>';
        item.addEventListener('mouseenter',function(){item.style.background='var(--mantine-color-default-hover)';});
        item.addEventListener('mouseleave',function(){item.style.background='';});
        item.addEventListener('click',function(){openClientModal(c.id);});
        container.appendChild(item);
    });
}

// === CLIENT MODAL (iframe) ===
function openClientModal(clientId){
    if(_modal){_modal.remove();_modal=null;}
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.addEventListener('click',function(e){if(e.target===ov){ov.remove();_modal=null;}});

    var m=document.createElement('div');
    m.style.cssText='background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md,8px);width:min(1400px,calc(100vw - 32px));height:min(90vh,960px);display:flex;flex-direction:column;font-family:var(--mantine-font-family);box-shadow:0 24px 64px rgba(0,0,0,0.4);overflow:hidden;';

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--mantine-color-default-border);flex-shrink:0;background:var(--mantine-color-body);';
    var title=document.createElement('span');title.style.cssText='font-size:13px;color:var(--mantine-color-dimmed);';title.textContent='Карточка клиента';
    var btns=document.createElement('div');btns.style.cssText='display:flex;gap:8px;align-items:center;';
    var openFull=document.createElement('a');
    openFull.href='/clients/'+clientId;openFull.target='_blank';
    openFull.style.cssText='font-size:12px;color:var(--mantine-color-dimmed);text-decoration:none;padding:3px 8px;border-radius:4px;border:1px solid var(--mantine-color-default-border);';
    openFull.textContent='↗ Открыть';
    var cls=document.createElement('button');
    cls.style.cssText='background:none;border:none;color:var(--mantine-color-dimmed);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;';
    cls.textContent='×';cls.addEventListener('click',function(){ov.remove();_modal=null;});
    btns.appendChild(openFull);btns.appendChild(cls);
    hdr.appendChild(title);hdr.appendChild(btns);

    var iframe=document.createElement('iframe');
    iframe.src='/clients/'+clientId;
    iframe.style.cssText='flex:1;border:none;width:100%;opacity:0;transition:opacity 0.2s;';

    // Элементы для скрытия
    var _SELECTORS=[
        '.mantine-AppShell-navbar',
        '.Sidebar_navbar__h0i17',
        '.Sidebar_header__dm6Ua',
        '[class*="Sidebar_navbar"]',
        '[class*="Sidebar_header"]',
        '.mantine-Breadcrumbs-root',
    ];

    function hideEl(el){
        if(!el||el._gcsHidden)return;
        el.style.cssText='display:none';
        el._gcsHidden=true;
    }

    function fixIframe(){
        try{
            var idoc=iframe.contentDocument||iframe.contentWindow.document;
            if(!idoc||!idoc.body)return;
            // Скрываем sidebar и шапку
            _SELECTORS.forEach(function(sel){
                idoc.querySelectorAll(sel).forEach(hideEl);
            });
            // Скрываем все godji-* элементы
            idoc.querySelectorAll('[id^="godji"]').forEach(hideEl);
            // Убираем отступы у main
            var main=idoc.querySelector('.mantine-AppShell-main');
            if(main){
                main.style.paddingLeft='0';
                main.style.marginLeft='0';
                main.style.paddingTop='0';
            }
            // CSS переменные на root
            var root=idoc.querySelector('.mantine-AppShell-root,[class*="Layout_appShell"]');
            if(root){
                root.style.setProperty('--app-shell-navbar-width','0px','important');
                root.style.setProperty('--app-shell-navbar-offset','0px','important');
                root.style.setProperty('--app-shell-header-height','0px','important');
            }
            iframe.style.opacity='1';
        }catch(e){}
    }

    function attachIframeObserver(){
        try{
            var idoc=iframe.contentDocument||iframe.contentWindow.document;
            if(!idoc||!idoc.body)return;
            // Только childList — без attributes чтобы не вызвать бесконечный цикл
            new MutationObserver(function(muts){
                muts.forEach(function(m){
                    m.addedNodes.forEach(function(n){
                        if(n.nodeType!==1)return;
                        var cn=typeof n.className==='string'?n.className:'';
                        if(cn.indexOf('AppShell-navbar')!==-1||
                           cn.indexOf('Sidebar_navbar')!==-1||
                           cn.indexOf('Sidebar_header')!==-1){hideEl(n);}
                        _SELECTORS.forEach(function(sel){
                            if(n.querySelectorAll)n.querySelectorAll(sel).forEach(hideEl);
                        });
                        if(n.id&&n.id.indexOf('godji')===0)hideEl(n);
                        if(n.querySelectorAll)n.querySelectorAll('[id^="godji"]').forEach(hideEl);
                    });
                });
            }).observe(idoc.body,{childList:true,subtree:true});
        }catch(e){}
    }

    iframe.onload=function(){
        // Показываем iframe через 2 сек в любом случае
        setTimeout(function(){iframe.style.opacity='1';},2000);
        attachIframeObserver();
        // Быстрый polling пока sidebar не скрыт
        var attempts=0;
        var timer=setInterval(function(){
            attempts++;
            fixIframe();
            if(attempts>40)clearInterval(timer);
        },100);
    };

    m.appendChild(hdr);m.appendChild(iframe);
    ov.appendChild(m);document.body.appendChild(ov);_modal=ov;

    document.addEventListener('keydown',function esc(e){
        if(e.key==='Escape'){ov.remove();_modal=null;document.removeEventListener('keydown',esc);}
    });
}

// === INIT ===
function setup(){
    insertCollapseBtn();watchSidebar();
    createSearchBtn();createSearchPanel();
    setTimeout(updateHistoryPos,500);
    setTimeout(updateHistoryPos,2000);
}

new MutationObserver(function(){
    if(!document.getElementById('godji-search-btn'))createSearchBtn();
    if(!document.getElementById('godji-col-btn')){insertCollapseBtn();watchSidebar();}
}).observe(document.body||document.documentElement,{childList:true,subtree:true});

document.addEventListener('click',function(e){
    if(!_panel||_panel.style.display==='none')return;
    var btn=document.getElementById('godji-search-btn');
    if(!_panel.contains(e.target)&&(!btn||!btn.contains(e.target)))closePanel();
});

if(document.body){setup();setTimeout(setup,1500);setTimeout(setup,4000);}
else document.addEventListener('DOMContentLoaded',function(){setup();setTimeout(setup,1500);});

})();

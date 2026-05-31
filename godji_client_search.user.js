// ==UserScript==
// @name         Годжи — Быстрый поиск клиента
// @namespace    http://tampermonkey.net/
// @version      5.32
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://github.com/Randyluffu/Godji-ERP/raw/refs/heads/main/godji_client_search.user.js
// @downloadURL  https://github.com/Randyluffu/Godji-ERP/raw/refs/heads/main/godji_client_search.user.js
// @grant        none
// @exclude      https://godji.cloud/tv/*
// @exclude      https://*.godji.cloud/tv/*
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
    var c=await getClubId();
    var res=await gql('query S($q:String!,$c:Int!){users(where:{role:{_eq:user},users_wallets:{club_id:{_eq:$c}},_or:[{users_user_profile:{login:{_ilike:$q}}},{users_user_profile:{name:{_ilike:$q}}},{users_user_profile:{surname:{_ilike:$q}}},{phone:{_ilike:$q}}]},limit:20){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$c}},limit:1){balance_amount balance_bonus}}}',{q:'%'+q.trim()+'%',c:c});
    var users=res&&res.data&&res.data.users?res.data.users:[];
    var digits=q.replace(/\D/g,'');
    if(digits.length>=4){
        var tail=digits.slice(-4);
        users.sort(function(a,b){
            var aM=a.phone&&a.phone.replace(/\D/g,'').endsWith(tail)?0:1;
            var bM=b.phone&&b.phone.replace(/\D/g,'').endsWith(tail)?0:1;
            return aM-bM;
        });
    }
    return users.slice(0,8);
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

var _panel=null,_modal=null,_st=null,_colOpen=false,_sbObs=null;
var _clubId=null;

// Определяем clubId текущего клуба — из URL или из API, кэшируем в localStorage на 7 дней
async function getClubId(){
    if(_clubId) return _clubId;
    var CACHE_KEY='godji_club_id_cache';
    var CACHE_TTL=7*24*60*60*1000; // 7 дней
    try{
        var raw=localStorage.getItem(CACHE_KEY);
        if(raw){
            var obj=JSON.parse(raw);
            if(obj&&obj.id&&(Date.now()-obj.ts)<CACHE_TTL){
                _clubId=obj.id;return _clubId;
            }
        }
    }catch(e){}
    // Получаем из API — список клубов текущего пользователя
    var res=await gql('query{club_admins(limit:1){club_id}}',{});
    var id=res&&res.data&&res.data.club_admins&&res.data.club_admins[0]&&res.data.club_admins[0].club_id;
    if(!id){
        // Fallback: ищем clubId в URL страницы или в DOM
        var m=window.location.search.match(/clubId=(\d+)/);
        if(m) id=parseInt(m[1]);
    }
    if(!id){
        // Fallback: смотрим в тексте страницы (ERP часто передаёт clubId в запросах)
        id=14; // последний резерв
    }
    _clubId=id;
    try{localStorage.setItem(CACHE_KEY,JSON.stringify({id:id,ts:Date.now()}));}catch(e){}
    return _clubId;
}

// === SIDEBAR COLLAPSE ===
function getNavLink(text){
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb)return null;
    return Array.from(sb.querySelectorAll('a.mantine-focus-auto')).find(function(a){
        var l=a.querySelector('.m_1f6ac4c4');return l&&l.textContent.trim()===text;
    });
}

function updateHistoryPos(){
    // Кнопки историй теперь в footer (insertBefore divider) — не трогаем их позицию
    var hist=document.getElementById('godji-history-btn');
    var opj=document.getElementById('godji-opj-btn');
    if(hist){ hist.style.top=''; hist.style.bottom=''; hist.style.position=''; }
    if(opj){ opj.style.top=''; opj.style.bottom=''; opj.style.position=''; }
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

// Позиция кнопок историй управляется их собственными скриптами (footer insertBefore)

// === SEARCH BUTTON ===

// === ADD CLIENT BUTTON ===
function openAddClientModal(){
    // Сначала пробуем кликнуть нативную кнопку ERP (на странице /clients)
    var nativeBtn = Array.from(document.querySelectorAll('button.mantine-Button-root')).find(function(b){
        var lbl = b.querySelector('[class*="Button-label"]');
        return lbl && lbl.textContent.trim() === 'Добавить клиента';
    });
    if(nativeBtn && !nativeBtn.disabled){
        nativeBtn.click();
        return;
    }

    if(document.getElementById('godji-add-client-modal')) return;

    var ov=document.createElement('div');
    ov.id='godji-add-client-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});

    var wrap=document.createElement('div');
    wrap.innerHTML='<section class="m_fd1ab0aa m_54c44539 mantine-Modal-content m_1b7284a3 mantine-Paper-root" data-modal-content="true" role="dialog" tabindex="-1" aria-modal="true" aria-describedby="mantine-8ktkxdaqd-body" aria-labelledby="mantine-8ktkxdaqd-title" style="transition-property: opacity, transform; backface-visibility: hidden; will-change: transform, opacity; transition-duration: 200ms; transition-timing-function: ease; opacity: 1; transform: translateY(0px);" data-ban-uid=""><header class="m_b5489c3c m_d0e2b9cd mantine-Modal-header"><h2 class="m_615af6c9 Add_modalTitle__KwLRz mantine-Modal-title" id="mantine-8ktkxdaqd-title"><div class="m_8bffd616 mantine-Flex-root __m__-rss" style="align-items: center; justify-content: space-between; width: 100%;"><p class="mantine-focus-auto m_b6d8b162 mantine-Text-root" data-size="lg" style="--text-fz: var(--mantine-font-size-lg); --text-lh: var(--mantine-line-height-lg); font-weight: 500;">Привязать клиента к клубу</p></div></h2><button class="mantine-focus-auto mantine-active m_220c80f2 m_606cb269 mantine-Modal-close m_86a44da5 mantine-CloseButton-root m_87cf2631 mantine-UnstyledButton-root" data-variant="subtle" type="button"><svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: var(--cb-icon-size, 70%); height: var(--cb-icon-size, 70%);"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg></button></header><div class="m_5df29311 mantine-Modal-body" id="mantine-8ktkxdaqd-body"><p class="mantine-focus-auto m_b6d8b162 mantine-Text-root" data-size="sm" style="--text-fz: var(--mantine-font-size-sm); --text-lh: var(--mantine-line-height-sm); margin-bottom: var(--mantine-spacing-md);">Введите номер телефона клиента, с которым он&nbsp;регистрировался в&nbsp;<a target="_blank" href="https://id.godji.cloud/registration" style="display: inline-flex; align-items: baseline; border: 1px dotted blue; border-radius: 4px; padding: 0px 4px;"><img alt="G" loading="lazy" width="14" height="16" decoding="async" data-nimg="1" src="/godji.svg" style="color: transparent; margin-right: 4px; padding-top: 4px;">GamerID<svg xmlns="http://www.w3.org/2000/svg" width="16" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-link " style="margin-left: 4px; align-self: end;"><path d="M9 15l6 -6"></path><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"></path><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"></path></svg></a></p><form><div class="m_8bffd616 mantine-Flex-root __m__-rt2" style="gap: var(--mantine-spacing-md); flex-direction: column;"><div class="m_46b77525 mantine-InputWrapper-root" style="margin-inline: auto; width: 100%;" data-error="true"><label class="m_8fdc1311 mantine-InputWrapper-label" data-required="true" for="mantine-brx4b3tgr" id="mantine-brx4b3tgr-label">Номер телефона<span class="m_78a94662 mantine-InputWrapper-required" aria-hidden="true"> *</span></label><div class="m_6c018570 mantine-Input-wrapper" data-variant="default" style="--input-left-section-pointer-events: none; --input-right-section-pointer-events: none; --input-margin-bottom: calc(var(--mantine-spacing-xs) / 2);"><input class="m_8fb7ebe7 mantine-Input-input" data-variant="default" placeholder="+7 (000) 000-00-00" name="phoneNumber" data-autofocus="true" autocomplete="off" aria-invalid="false" id="mantine-brx4b3tgr" value="" aria-describedby="mantine-brx4b3tgr-error"></div><p class="m_8f816625 mantine-InputWrapper-error" id="mantine-brx4b3tgr-error">Номер введен неверно</p></div><div class="m_8bffd616 mantine-Flex-root __m__-rt9" style="gap: var(--mantine-spacing-md); justify-content: center;"><button class="mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root" data-variant="outline" data-block="true" type="button" style="--button-bg: transparent; --button-hover: var(--mantine-color-gray-outline-hover); --button-color: var(--mantine-color-gray-outline); --button-bd: calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-gray-outline);"><span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Отмена</span></span></button><button class="mantine-focus-auto m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root" data-variant="filled" data-disabled="true" data-block="true" type="submit" disabled="" style="--button-bg: var(--mantine-color-blue-filled); --button-hover: var(--mantine-color-blue-filled-hover); --button-color: var(--mantine-color-white); --button-bd: calc(0.0625rem * var(--mantine-scale)) solid transparent;"><span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Найти</span></span></button></div></div></form></div></section>';
    var section=wrap.firstElementChild;
    if(!section){ov.remove();return;}
    section.addEventListener('click',function(e){e.stopPropagation();});
    ov.appendChild(section);
    document.body.appendChild(ov);

    // Закрытие
    var closeBtn=section.querySelector('[class*="mantine-Modal-close"],[class*="CloseButton"]');
    if(closeBtn) closeBtn.addEventListener('click',function(){ov.remove();});
    var cancelBtn=section.querySelector('button[data-variant="outline"]');
    if(cancelBtn) cancelBtn.addEventListener('click',function(){ov.remove();});

    // Фокус на инпут
    var phoneInput=section.querySelector('input[name="phoneNumber"],input[placeholder*="000"]');
    if(phoneInput) setTimeout(function(){phoneInput.focus();},100);

    // Кнопка Найти — логика
    var submitBtn=section.querySelector('button[type="submit"],button[data-variant="filled"]');
    var errEl=section.querySelector('[class*="InputWrapper-error"]');
    // Убираем состояние ошибки при инициализации (ERP может рендерить с data-error=true)
    if(errEl){errEl.style.display='none';errEl.textContent='';}
    var inputWrapper=section.querySelector('[class*="InputWrapper-root"]');
    if(inputWrapper) inputWrapper.setAttribute('data-error','false');
    if(submitBtn){submitBtn.disabled=false;submitBtn.removeAttribute('data-disabled');}

    function showErr(msg){
        if(!errEl)return;
        errEl.textContent=msg;
        errEl.style.display=msg?'':'none';
        var w=section.querySelector('[class*="InputWrapper-root"]');
        if(w) w.setAttribute('data-error',msg?'true':'false');
    }

    async function doFind(){
        if(!phoneInput) return;
        var phone=phoneInput.value.trim();
        if(!phone){showErr('Введите номер телефона');return;}
        showErr('');
        if(submitBtn){submitBtn.disabled=true;var lbl=submitBtn.querySelector('[class*="Button-label"]');if(lbl)lbl.textContent='Поиск...';}

        // Ищем по всей сети — getClubId нужен для контекста запроса
        var cid=await getClubId();
        var res=await gql(
            'query findUserByPhone($phone:String!,$club_id:Int!){findUserByPhone(params:{phone:$phone,clubId:$club_id}){id phone users_user_profile{name surname login}users_wallets{id club_id balance_amount balance_bonus}}}',
            {phone:phone,club_id:cid}
        );

        if(submitBtn){submitBtn.disabled=false;var lbl=submitBtn.querySelector('[class*="Button-label"]');if(lbl)lbl.textContent='Найти';}

        if(!res||!res.data||!res.data.findUserByPhone){showErr('Пользователь не найден');return;}
        var user=res.data.findUserByPhone;

        // Просто открываем карточку клиента — привязка к клубу выполняется вручную через ERP
        ov.remove();
        openClientModal(user.id,user.users_wallets&&user.users_wallets[0]);
    }

    if(submitBtn) submitBtn.addEventListener('click',doFind);
    var form=section.querySelector('form');
    if(form) form.addEventListener('submit',function(e){e.preventDefault();doFind();});
    document.addEventListener('keydown',function escH(e){
        if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',escH);}
    });
}

function createSearchBtn(){
    if(document.getElementById('godji-search-btn')) return;
    // Только на страницах с сайдбаром
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')) return;

    var btn=document.createElement('a');
    btn.id='godji-search-btn';
    // Берём className от нативной NavLink — всё стилизуется через CSS ERP
    var nativeLink = document.querySelector('a[href="/bookings"]') ||
                     document.querySelector('a.mantine-NavLink-root');
    btn.className = nativeLink ? nativeLink.className
        : 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    // Фиксированная позиция как раньше — архитектура скрипта
    btn.style.cssText='position:fixed;bottom:456px;left:0;z-index:199;width:280px;display:flex;align-items:center;';

    // Иконка через ThemeIcon — точно как у нативных кнопок
    var sec=document.createElement('span');
    sec.className='m_690090b5 mantine-NavLink-section';
    sec.setAttribute('data-position','left');
    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:var(--mantine-color-gg_primary-filled);--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
    sec.appendChild(ico);

    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.textContent='Поиск клиента';

    var body=document.createElement('div');
    body.className='m_f07af9d2 mantine-NavLink-body';
    body.appendChild(lbl);

    // Кнопка добавления клиента справа
    var addBtn=document.createElement('div');
    addBtn.id='godji-add-client-btn';
    addBtn.title='Добавить клиента';
    addBtn.style.cssText='width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:var(--mantine-radius-sm);color:var(--mantine-color-dimmed);flex-shrink:0;margin-right:4px;transition:background 0.15s,color 0.15s;cursor:pointer;';
    addBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M16 19h6"/><path d="M19 16v6"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4"/></svg>';
    addBtn.addEventListener('mouseenter',function(){addBtn.style.background='var(--mantine-color-default-hover)';addBtn.style.color='var(--mantine-color-text)';});
    addBtn.addEventListener('mouseleave',function(){addBtn.style.background='';addBtn.style.color='var(--mantine-color-dimmed)';});
    addBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openAddClientModal();});
    body.style.flex='1';

    btn.appendChild(sec); btn.appendChild(body); btn.appendChild(addBtn);
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
    hw.appendChild(si);hw.appendChild(inp);

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
        var item=document.createElement('div');
        item.style.cssText='padding:8px 12px;cursor:pointer;transition:background 0.1s;'+(i>0?'border-top:1px solid var(--mantine-color-default-border)':'');
        // Проверяем есть ли заметка у клиента
        var hasNote = false;
        try {
            var noteRaw = localStorage.getItem('godji_note_v2_' + c.id);
            if (noteRaw) {
                var noteData = JSON.parse(noteRaw);
                hasNote = !!(noteData && noteData.html && noteData.html.trim() && noteData.html !== '<br>');
            }
        } catch(e) {}
        var noteIndicator = hasNote
            ? '<span title="Есть заметка" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#cc0001;flex-shrink:0;margin-left:4px;margin-top:3px;"></span>'
            : '';
        item.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="display:flex;align-items:center;gap:4px;"><span style="font-size:var(--mantine-font-size-sm,14px);font-weight:600;color:var(--mantine-color-text);">'+esc(nick||name)+'</span>'+noteIndicator+'</div><span style="font-size:11px;color:var(--mantine-color-dimmed);white-space:nowrap;flex-shrink:0;">'+esc(bal+bon)+'</span></div>'+
            '<div style="font-size:11px;color:var(--mantine-color-dimmed);margin-top:2px;display:flex;gap:8px;">'+(nick?'<span>'+esc(name)+'</span>':'')+(c.phone?'<span>'+esc(c.phone)+'</span>':'')+'</div>';
        item.addEventListener('mouseenter',function(){item.style.background='var(--mantine-color-default-hover)';});
        item.addEventListener('mouseleave',function(){item.style.background='';});
        item.addEventListener('click',function(){openClientModal(c.id,c.users_wallets&&c.users_wallets[0]);});
        container.appendChild(item);
    });
}

// === CLIENT MODAL (iframe) ===
function openClientModal(clientId, clientWallet){
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

    var iframeWrap=document.createElement('div');
    // overflow:hidden по X — обрезает сайдбар, но не режет вертикальные модалки
    iframeWrap.style.cssText='flex:1;overflow-x:hidden;overflow-y:visible;position:relative;min-height:0;';
    var iframe=document.createElement('iframe');
    iframe.src='/clients/'+clientId;
    iframe.style.cssText='border:none;width:calc(100% + 300px);margin-left:-300px;height:100%;opacity:0;transition:opacity 0.2s;display:block;';

    // Элементы для скрытия
    var _SELECTORS=[
        '.Sidebar_header__dm6Ua',
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
            // Скрываем все godji-* элементы кроме кнопки списания
            idoc.querySelectorAll('[id^="godji"]').forEach(function(el){
                if(el.id==='godji-debit-btn'||el.id==='godji-debit-overlay'||el.id==='godji-client-note') return;
                hideEl(el);
            });
            // Убираем отступ слева у main (был равен ширине navbar)
            var main=idoc.querySelector('.mantine-AppShell-main');
            if(main){
                main.style.setProperty('padding-left','16px','important');
                main.style.setProperty('margin-left','0','important');
                main.style.setProperty('padding-top','16px','important');
            }
            // Запрещаем горизонтальный скролл внутри iframe
            if(idoc.body) idoc.body.style.overflowX='hidden';
            // CSS переменные на documentElement (для корректного позиционирования внутренних модалок)
            try{
                idoc.documentElement.style.setProperty('--app-shell-navbar-width','0px','important');
                idoc.documentElement.style.setProperty('--app-shell-navbar-offset','0px','important');
                idoc.documentElement.style.setProperty('--app-shell-header-height','0px','important');
            }catch(ee){}
            // CSS переменные на root
            var root=idoc.querySelector('.mantine-AppShell-root,[class*="Layout_appShell"]');
            if(root){
                root.style.setProperty('--app-shell-navbar-width','0px','important');
                root.style.setProperty('--app-shell-navbar-offset','0px','important');
                root.style.setProperty('--app-shell-header-height','0px','important');
            }
            iframe.style.opacity='1';

            // Скрываем navbar через CSS
            var styleEl=idoc.createElement('style');
            styleEl.id='godji-iframe-fix-style';
            styleEl.textContent=[
                'body{overflow-x:hidden!important;}',
                '.mantine-AppShell-navbar,.Sidebar_navbar__h0i17,[class*="Sidebar_navbar"]{display:none!important;}',
            ].join('');
            if(!idoc.getElementById('godji-iframe-fix-style')) idoc.head.appendChild(styleEl);

            // Компенсируем сдвиг iframe для модалок — вычисляем реальную ширину navbar
            var navbar=idoc.querySelector('.mantine-AppShell-navbar,.Sidebar_navbar__h0i17,[class*="Sidebar_navbar"]');
            var nbW=navbar?navbar.offsetWidth:280;
            var portalStyle=idoc.getElementById('godji-iframe-portal-fix');
            if(!portalStyle){
                portalStyle=idoc.createElement('style');
                portalStyle.id='godji-iframe-portal-fix';
                idoc.head.appendChild(portalStyle);
            }
            // position:fixed внутри iframe отсчитывается от левого края iframe viewport
            // iframe сдвинут на margin-left:-nbW, значит fixed элементы тоже сдвинуты
            // компенсируем: left смещаем на +nbW, width уменьшаем на nbW
            portalStyle.textContent=[
                '[data-portal="true"]{',
                '  left:'+nbW+'px!important;',
                '  width:calc(100% - '+nbW+'px)!important;',
                '}',
            ].join('');

            // Показываем список клубов под "Статистика по сети клубов"
            injectClubsList(idoc, clientId);
        }catch(e){}
    }

    async function injectClubsList(idoc, userId){
        try{
            var res=await gql(
                'query GetUserClubs($userId:String!){users_wallets(where:{user_id:{_eq:$userId}}){club_id wallets_club{name}balance_amount balance_bonus}}',
                {userId:userId}
            );
            var wallets=res&&res.data&&res.data.users_wallets;
            if(!wallets||!wallets.length)return;

            var attempts=0;
            var timer=setInterval(function(){
                attempts++;
                if(attempts>40){clearInterval(timer);return;}
                try{
                    if(idoc.getElementById('godji-clubs-list')){clearInterval(timer);return;}

                    // Ищем элемент содержащий текст "Статистика по сети"
                    var target=null;
                    idoc.querySelectorAll('p,span,h3,h4,div').forEach(function(el){
                        if(!target && el.children.length===0 &&
                           el.textContent.indexOf('Статистика по сети')!==-1) target=el;
                    });
                    if(!target)return;
                    clearInterval(timer);

                    // Поднимаемся до блока-карточки
                    var block=target;
                    for(var i=0;i<6;i++){
                        if(!block.parentElement)break;
                        block=block.parentElement;
                        var cn=block.className||'';
                        if(cn.indexOf('Paper')!==-1||cn.indexOf('card')!==-1||cn.indexOf('Card')!==-1) break;
                    }

                    var div=idoc.createElement('div');
                    div.id='godji-clubs-list';
                    div.style.cssText='margin-top:12px;padding-top:10px;border-top:1px solid var(--mantine-color-default-border,#e9ecef);';

                    var title=idoc.createElement('p');
                    title.style.cssText='font-size:13px;font-weight:600;margin-bottom:6px;';
                    title.textContent='Привязан к клубам';
                    div.appendChild(title);

                    wallets.forEach(function(w){
                        var name=w.wallets_club&&w.wallets_club.name||('Клуб '+w.club_id);
                        var row=idoc.createElement('div');
                        row.style.cssText='display:flex;justify-content:space-between;font-size:11px;color:var(--mantine-color-dimmed,#868e96);padding:2px 0;';
                        row.innerHTML='<span>'+name+'</span><span>'+
                            (w.balance_amount?Math.round(w.balance_amount)+' ₽':'')+
                            (w.balance_bonus?' · '+Math.round(w.balance_bonus)+' G':'')+'</span>';
                        div.appendChild(row);
                    });
                    block.appendChild(div);
                }catch(ee){}
            },400);
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
                        if(n.id&&n.id.indexOf('godji')===0&&n.id!=='godji-debit-btn'&&n.id!=='godji-debit-overlay'&&n.id!=='godji-client-note')hideEl(n);
                        if(n.querySelectorAll)n.querySelectorAll('[id^="godji"]').forEach(function(el){
                            if(el.id==='godji-debit-btn'||el.id==='godji-debit-overlay'||el.id==='godji-client-note') return;
                            hideEl(el);
                        });
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

    iframeWrap.appendChild(iframe);
    m.appendChild(hdr);m.appendChild(iframeWrap);
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

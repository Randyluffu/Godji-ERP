// ==UserScript==
// @name         Годжи — Быстрый поиск клиента
// @namespace    http://tampermonkey.net/
// @version      5.22
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
    var res=await gql('query S($q:String!,$c:Int!){users(where:{role:{_eq:user},users_wallets:{club_id:{_eq:$c}},_or:[{users_user_profile:{login:{_ilike:$q}}},{users_user_profile:{name:{_ilike:$q}}},{users_user_profile:{surname:{_ilike:$q}}},{phone:{_ilike:$q}}]},limit:8){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$c}},limit:1){balance_amount balance_bonus}}}',{q:'%'+q.trim()+'%',c:14});
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
    if(document.getElementById('godji-add-client-modal')) return;
    var ov=document.createElement('div');
    ov.id='godji-add-client-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.addEventListener('click',function(e){if(e.target===ov){ov.remove();}});

    // Открываем /clients в iframe и кликаем кнопку "Добавить клиента"
    var section=document.createElement('section');
    section.className='m_fd1ab0aa m_54c44539 mantine-Modal-content m_1b7284a3 mantine-Paper-root';
    section.setAttribute('role','dialog');
    section.style.cssText='opacity:1;transform:translateY(0px);min-width:calc(28rem * var(--mantine-scale));max-width:90vw;';

    var header=document.createElement('header');
    header.className='m_b5489c3c m_d0e2b9cd mantine-Modal-header';
    var h2=document.createElement('h2');
    h2.className='m_615af6c9 mantine-Modal-title';
    h2.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;width:100%;"><p class="mantine-focus-auto m_b6d8b162 mantine-Text-root" data-size="lg" style="--text-fz:var(--mantine-font-size-lg);--text-lh:var(--mantine-line-height-lg);font-weight:500;">Привязать клиента к клубу</p></div>';
    var xBtn=document.createElement('button');
    xBtn.className='mantine-focus-auto mantine-active m_220c80f2 m_606cb269 mantine-Modal-close m_86a44da5 mantine-CloseButton-root m_87cf2631 mantine-UnstyledButton-root';
    xBtn.setAttribute('data-variant','subtle');xBtn.setAttribute('type','button');
    xBtn.innerHTML='<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:70%;height:70%;"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>';
    xBtn.addEventListener('click',function(){ov.remove();});
    header.appendChild(h2);header.appendChild(xBtn);

    var body=document.createElement('div');
    body.className='m_5df29311 mantine-Modal-body';
    body.innerHTML='<p class="mantine-focus-auto m_b6d8b162 mantine-Text-root" data-size="sm" style="--text-fz:var(--mantine-font-size-sm);--text-lh:var(--mantine-line-height-sm);margin-bottom:var(--mantine-spacing-md);">Введите номер телефона клиента, с которым он регистрировался в <a target="_blank" href="https://id.godji.cloud/registration" style="display:inline-flex;align-items:baseline;border:1px dotted blue;border-radius:4px;padding:0 4px;"><img alt="G" width="14" height="16" src="/godji.svg" style="color:transparent;margin-right:4px;padding-top:4px;">GamerID</a></p><form id="godji-add-client-form"><div class="m_8bffd616 mantine-Flex-root" style="gap:var(--mantine-spacing-md);flex-direction:column;"><div class="m_46b77525 mantine-InputWrapper-root" style="margin-inline:auto;width:100%;"><label class="m_8fdc1311 mantine-InputWrapper-label" data-required="true">Номер телефона<span class="m_78a94662 mantine-InputWrapper-required"> *</span></label><div class="m_6c018570 mantine-Input-wrapper" data-variant="default"><input id="godji-add-phone-input" class="m_8fb7ebe7 mantine-Input-input" data-variant="default" placeholder="+7 (000) 000-00-00" name="phoneNumber" autocomplete="off" aria-invalid="false" value=""></div></div><div class="m_8bffd616 mantine-Flex-root" style="gap:var(--mantine-spacing-md);justify-content:center;"><button class="mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root" data-variant="outline" type="button" id="godji-add-cancel-btn" style="--button-bg:transparent;--button-hover:var(--mantine-color-gray-outline-hover);--button-color:var(--mantine-color-gray-outline);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-gray-outline);"><span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Отмена</span></span></button><button class="mantine-focus-auto m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root" data-variant="filled" type="submit" id="godji-add-submit-btn" style="--button-bg:var(--mantine-color-blue-filled);--button-hover:var(--mantine-color-blue-filled-hover);--button-color:var(--mantine-color-white);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;"><span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Найти</span></span></button></div></div></form>';

    section.appendChild(header);section.appendChild(body);
    ov.appendChild(section);
    document.body.appendChild(ov);

    document.getElementById('godji-add-cancel-btn').addEventListener('click',function(){ov.remove();});
    document.getElementById('godji-add-client-form').addEventListener('submit',function(e){
        e.preventDefault();
        var phone=document.getElementById('godji-add-phone-input').value.trim();
        if(!phone)return;
        // Перенаправляем на /clients с параметром поиска
        window.open('/clients?phone='+encodeURIComponent(phone),'_blank');
        ov.remove();
    });

    setTimeout(function(){
        var inp=document.getElementById('godji-add-phone-input');
        if(inp)inp.focus();
    },100);

    document.addEventListener('keydown',function escHandler(e){
        if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',escHandler);}
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
    btn.style.cssText='position:fixed;bottom:456px;left:0;z-index:199;width:280px;';

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
    body.style.cssText='flex:1;';
    body.appendChild(lbl);

    // Кнопка добавления клиента — иконка person-plus справа
    var addBtn=document.createElement('div');
    addBtn.id='godji-add-client-btn';
    addBtn.title='Добавить клиента';
    addBtn.style.cssText='width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:var(--mantine-radius-sm);color:var(--mantine-color-dimmed);flex-shrink:0;margin-right:4px;transition:background 0.15s,color 0.15s;cursor:pointer;';
    addBtn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M16 19h6"/><path d="M19 16v6"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4"/></svg>';
    addBtn.addEventListener('mouseenter',function(){addBtn.style.background='var(--mantine-color-default-hover)';addBtn.style.color='var(--mantine-color-text)';});
    addBtn.addEventListener('mouseleave',function(){addBtn.style.background='';addBtn.style.color='var(--mantine-color-dimmed)';});
    addBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openAddClientModal();});

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
    p.style.cssText='position:fixed;top:16px;bottom:502px;left:0;width:280px;background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md,8px);box-shadow:0 -4px 24px rgba(0,0,0,0.3);z-index:198;display:none;flex-direction:column;font-family:var(--mantine-font-family);overflow:hidden;';

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

    var iframe=document.createElement('iframe');
    iframe.src='/clients/'+clientId;
    iframe.style.cssText='flex:1;border:none;width:100%;opacity:0;transition:opacity 0.2s;';

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
            // Сдвигаем контент влево скрывая сайдбар за левым краем
            var navbar=idoc.querySelector('.mantine-AppShell-navbar,.Sidebar_navbar__h0i17,[class*="Sidebar_navbar"]');
            if(navbar){
                var nbW=navbar.offsetWidth||280;
                // Сайдбар оставляем как есть — просто скрываем его за краем iframe
                navbar.style.left='-'+nbW+'px';
            }
            var main=idoc.querySelector('.mantine-AppShell-main');
            if(main){
                main.style.paddingLeft='16px';
                main.style.marginLeft='0';
                main.style.paddingTop='16px';
            }
            var root=idoc.querySelector('.mantine-AppShell-root,[class*="Layout_appShell"]');
            if(root){
                root.style.setProperty('--app-shell-navbar-width','0px','important');
                root.style.setProperty('--app-shell-navbar-offset','0px','important');
                root.style.setProperty('--app-shell-header-height','0px','important');
                root.style.overflowX='hidden';
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

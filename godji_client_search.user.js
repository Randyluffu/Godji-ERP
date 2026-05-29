// ==UserScript==
// @name         Годжи — Быстрый поиск клиента
// @namespace    http://tampermonkey.net/
// @version      5.25
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
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});

    // Используем mantine-классы точно как оригинальная модалка ERP
    var section=document.createElement('section');
    section.className='m_fd1ab0aa m_54c44539 mantine-Modal-content m_1b7284a3 mantine-Paper-root';
    section.setAttribute('role','dialog');section.setAttribute('tabindex','-1');
    section.style.cssText='opacity:1;transform:translateY(0px);min-width:calc(28rem * var(--mantine-scale));max-width:90vw;';
    section.addEventListener('click',function(e){e.stopPropagation();});

    var header=document.createElement('header');
    header.className='m_b5489c3c m_d0e2b9cd mantine-Modal-header';
    var h2=document.createElement('h2');
    h2.className='m_615af6c9 mantine-Modal-title';
    h2.innerHTML='<div class="m_8bffd616 mantine-Flex-root" style="align-items:center;justify-content:space-between;width:100%;"><p class="mantine-focus-auto m_b6d8b162 mantine-Text-root" data-size="lg" style="--text-fz:var(--mantine-font-size-lg);--text-lh:var(--mantine-line-height-lg);font-weight:500;">Привязать клиента к клубу</p></div>';
    var xBtn=document.createElement('button');
    xBtn.className='mantine-focus-auto mantine-active m_220c80f2 m_606cb269 mantine-Modal-close m_86a44da5 mantine-CloseButton-root m_87cf2631 mantine-UnstyledButton-root';
    xBtn.setAttribute('data-variant','subtle');xBtn.setAttribute('type','button');
    xBtn.innerHTML='<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:70%;height:70%;"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>';
    xBtn.addEventListener('click',function(){ov.remove();});
    header.appendChild(h2);header.appendChild(xBtn);

    var body=document.createElement('div');
    body.className='m_5df29311 mantine-Modal-body';

    var desc=document.createElement('p');
    desc.className='mantine-focus-auto m_b6d8b162 mantine-Text-root';
    desc.setAttribute('data-size','sm');
    desc.style.cssText='--text-fz:var(--mantine-font-size-sm);--text-lh:var(--mantine-line-height-sm);margin-bottom:var(--mantine-spacing-md);';
    desc.innerHTML='Введите номер телефона клиента, с которым он регистрировался в <a target="_blank" href="https://id.godji.cloud/registration" style="display:inline-flex;align-items:baseline;border:1px dotted blue;border-radius:4px;padding:0 4px;"><img alt="G" width="14" height="16" src="/godji.svg" style="color:transparent;margin-right:4px;padding-top:4px;">GamerID</a>';

    // Инпут телефона
    var inputWrap=document.createElement('div');
    inputWrap.className='m_46b77525 mantine-InputWrapper-root';
    inputWrap.style.cssText='margin-inline:auto;width:100%;';
    var label=document.createElement('label');
    label.className='m_8fdc1311 mantine-InputWrapper-label';
    label.setAttribute('data-required','true');
    label.innerHTML='Номер телефона<span class="m_78a94662 mantine-InputWrapper-required"> *</span>';
    var inputDiv=document.createElement('div');
    inputDiv.className='m_6c018570 mantine-Input-wrapper';
    inputDiv.setAttribute('data-variant','default');
    var phoneInput=document.createElement('input');
    phoneInput.id='godji-add-phone-input';
    phoneInput.className='m_8fb7ebe7 mantine-Input-input';
    phoneInput.setAttribute('data-variant','default');
    phoneInput.setAttribute('placeholder','+7 (000) 000-00-00');
    phoneInput.setAttribute('autocomplete','off');
    inputDiv.appendChild(phoneInput);
    inputWrap.appendChild(label);inputWrap.appendChild(inputDiv);

    // Сообщение об ошибке/статусе
    var statusMsg=document.createElement('p');
    statusMsg.className='m_8f816625 mantine-InputWrapper-error';
    statusMsg.style.cssText='margin-top:4px;min-height:18px;';
    statusMsg.textContent='';
    inputWrap.appendChild(statusMsg);

    // Кнопки
    var btnRow=document.createElement('div');
    btnRow.className='m_8bffd616 mantine-Flex-root';
    btnRow.style.cssText='gap:var(--mantine-spacing-md);justify-content:center;margin-top:var(--mantine-spacing-md);';

    var cancelBtn=document.createElement('button');
    cancelBtn.className='mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
    cancelBtn.setAttribute('data-variant','outline');cancelBtn.setAttribute('type','button');
    cancelBtn.style.cssText='--button-bg:transparent;--button-hover:var(--mantine-color-gray-outline-hover);--button-color:var(--mantine-color-gray-outline);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-gray-outline);';
    cancelBtn.innerHTML='<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Отмена</span></span>';
    cancelBtn.addEventListener('click',function(){ov.remove();});

    var submitBtn=document.createElement('button');
    submitBtn.id='godji-add-submit-btn';
    submitBtn.className='mantine-focus-auto m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
    submitBtn.setAttribute('data-variant','filled');submitBtn.setAttribute('type','button');
    submitBtn.style.cssText='--button-bg:var(--mantine-color-blue-filled);--button-hover:var(--mantine-color-blue-filled-hover);--button-color:var(--mantine-color-white);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    submitBtn.innerHTML='<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Найти</span></span>';

    btnRow.appendChild(cancelBtn);btnRow.appendChild(submitBtn);

    var stack=document.createElement('div');
    stack.className='m_6d731127 mantine-Stack-root';
    stack.style.cssText='--stack-gap:var(--mantine-spacing-lg);--stack-align:stretch;';
    stack.appendChild(desc);stack.appendChild(inputWrap);stack.appendChild(btnRow);
    body.appendChild(stack);

    section.appendChild(header);section.appendChild(body);
    ov.appendChild(section);
    document.body.appendChild(ov);
    setTimeout(function(){phoneInput.focus();},100);

    // === Логика ===
    function setLoading(on){
        submitBtn.disabled=on;
        submitBtn.style.opacity=on?'0.6':'1';
        var lbl=submitBtn.querySelector('.mantine-Button-label');
        if(lbl) lbl.textContent=on?'Поиск...':'Найти';
    }

    function setError(msg){
        statusMsg.textContent=msg||'';
        statusMsg.style.color=msg?'var(--mantine-color-error)':'';
        inputWrap.setAttribute('data-error',msg?'true':'false');
    }

    async function doFind(){
        var phone=phoneInput.value.trim();
        if(!phone){setError('Введите номер телефона');return;}
        setError('');setLoading(true);

        // Шаг 1: findUserByPhone
        var res=await gql(
            'query findUserByPhone($phone:String!,$club_id:Int!){findUserByPhone(params:{phone:$phone,clubId:$club_id}){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$club_id}},limit:1){id balance_amount balance_bonus}}}',
            {phone:phone,club_id:14}
        );

        setLoading(false);

        if(!res||!res.data||!res.data.findUserByPhone){
            setError('Пользователь не найден');return;
        }
        var user=res.data.findUserByPhone;

        // Шаг 2: AttachUserToClubById
        setLoading(true);
        var lbl2=submitBtn.querySelector('.mantine-Button-label');
        if(lbl2) lbl2.textContent='Привязка...';

        var att=await gql(
            'mutation AttachUserToClubById($clubId:Int!,$userId:String!){attachUserToClub(params:{clubId:$clubId,userId:$userId}){success __typename}}',
            {clubId:14,userId:user.id}
        );

        setLoading(false);

        if(!att||!att.data||!att.data.attachUserToClub||!att.data.attachUserToClub.success){
            // Возможно уже привязан — всё равно открываем карточку
            if(att&&att.errors&&att.errors[0]&&att.errors[0].message&&att.errors[0].message.indexOf('already')!==-1){
                // уже привязан — ок
            } else {
                setError('Ошибка привязки. Возможно клиент уже привязан.');
            }
        }

        // Шаг 3: открываем карточку клиента
        ov.remove();
        openClientModal(user.id, user.users_wallets&&user.users_wallets[0]);
    }

    submitBtn.addEventListener('click',doFind);
    phoneInput.addEventListener('keydown',function(e){if(e.key==='Enter')doFind();});
    document.addEventListener('keydown',function escH(e){
        if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',escH);}
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

    // Обёртка — скрывает сайдбар через overflow:hidden
    var iframeWrap=document.createElement('div');
    iframeWrap.style.cssText='flex:1;overflow:hidden;position:relative;';

    var iframe=document.createElement('iframe');
    iframe.src='/clients/'+clientId;
    // iframe шире контейнера на ширину сайдбара (~280px), сдвинут влево
    iframe.style.cssText='border:none;width:calc(100% + 280px);height:100%;margin-left:-280px;opacity:0;transition:opacity 0.2s;';

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
            // Скрываем navbar полностью — он всё равно скрыт overflow:hidden обёртки
            var navbar=idoc.querySelector('.mantine-AppShell-navbar,.Sidebar_navbar__h0i17,[class*="Sidebar_navbar"]');
            if(navbar) navbar.style.cssText='display:none!important';
            // Скрываем шапку и breadcrumbs
            _SELECTORS.forEach(function(sel){
                idoc.querySelectorAll(sel).forEach(hideEl);
            });
            // Скрываем все кастомные кнопки кроме заметок и списания
            idoc.querySelectorAll('[id^="godji"],[class*="godji-"]').forEach(function(el){
                if(el.id==='godji-debit-btn'||el.id==='godji-debit-overlay'||el.id==='godji-client-note') return;
                hideEl(el);
            });
            // Убираем отступы у main — сайдбар скрыт, отступ не нужен
            var main=idoc.querySelector('.mantine-AppShell-main');
            if(main){
                main.style.paddingLeft='16px';
                main.style.marginLeft='0';
                main.style.paddingTop='16px';
                main.style.width='100%';
            }
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

function createSearchBtn(){
    if(document.getElementById('godji-search-btn')) return;
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')) return;

    var btn=document.createElement('a');
    btn.id='godji-search-btn';
    var nativeLink=document.querySelector('a[href="/bookings"]')||document.querySelector('a.mantine-NavLink-root');
    btn.className=nativeLink?nativeLink.className:'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='position:fixed;bottom:456px;left:0;z-index:199;width:280px;display:flex;align-items:center;';

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

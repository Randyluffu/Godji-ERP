// ==UserScript==
// @name         Годжи — Быстрый поиск клиента
// @namespace    http://tampermonkey.net/
// @version      5.28
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
    var res=await gql('query S($q:String!,$c:Int!){users(where:{role:{_eq:user},users_wallets:{club_id:{_eq:$c}},_or:[{users_user_profile:{login:{_ilike:$q}}},{users_user_profile:{name:{_ilike:$q}}},{users_user_profile:{surname:{_ilike:$q}}},{phone:{_ilike:$q}}]},limit:20){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$c}},limit:1){balance_amount balance_bonus}}}',{q:'%'+q.trim()+'%',c:14});
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

new MutationObserver(function(muts){
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType===1&&n.id==='godji-history-btn'){
                setTimeout(updateHistoryPos,50);setTimeout(updateHistoryPos,300);setTimeout(updateHistoryPos,1000);
            }
        });
    });
}).observe(document.body||document.documentElement,{childList:true});

// === ADD CLIENT ===
// Кликаем оригинальную кнопку ERP «Привязать клиента» если она есть на странице /clients
// Если нет — показываем нашу простую модалку с телефоном
function openAddClientModal(){
    // Попробуем найти нативную кнопку ERP на странице /clients
    var nativeAddBtn = Array.from(document.querySelectorAll('button')).find(function(b){
        var t = b.textContent||'';
        return t.trim()==='Привязать клиента' || t.trim()==='Добавить клиента';
    });
    if(nativeAddBtn){
        nativeAddBtn.click();
        return;
    }

    // Нет нативной кнопки — показываем собственную модалку с корректным полем телефона
    if(document.getElementById('godji-add-client-modal')) return;

    var ov=document.createElement('div');
    ov.id='godji-add-client-modal';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;';
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});

    var box=document.createElement('div');
    box.style.cssText='background:var(--mantine-color-body);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-md,8px);box-shadow:0 24px 64px rgba(0,0,0,0.4);width:420px;max-width:calc(100vw - 32px);font-family:var(--mantine-font-family);overflow:hidden;';
    box.addEventListener('click',function(e){e.stopPropagation();});

    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--mantine-color-default-border);';
    var htitle=document.createElement('span');htitle.style.cssText='font-size:var(--mantine-font-size-lg,18px);font-weight:500;';htitle.textContent='Привязать клиента к клубу';
    var hclose=document.createElement('button');
    hclose.style.cssText='background:none;border:none;color:var(--mantine-color-dimmed);font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    hclose.textContent='×';hclose.addEventListener('click',function(){ov.remove();});
    hdr.appendChild(htitle);hdr.appendChild(hclose);

    var body=document.createElement('div');
    body.style.cssText='padding:20px;display:flex;flex-direction:column;gap:16px;';

    var desc=document.createElement('p');
    desc.style.cssText='font-size:var(--mantine-font-size-sm,14px);color:var(--mantine-color-text);margin:0;';
    desc.textContent='Введите номер телефона клиента, с которым он регистрировался в GamerID.';

    var label=document.createElement('label');
    label.style.cssText='display:flex;flex-direction:column;gap:6px;font-size:var(--mantine-font-size-sm,14px);font-weight:500;';
    label.textContent='Номер телефона ';
    var req=document.createElement('span');req.style.color='#e03131';req.textContent='*';
    label.appendChild(req);

    var inp=document.createElement('input');
    inp.type='tel';
    inp.placeholder='+7 (900) 000-00-00';
    inp.autocomplete='tel';
    inp.style.cssText='border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm,6px);padding:8px 12px;font-size:var(--mantine-font-size-sm,14px);font-family:inherit;background:var(--mantine-color-default);color:var(--mantine-color-text);outline:none;width:100%;box-sizing:border-box;transition:border-color 0.15s;';
    inp.addEventListener('focus',function(){inp.style.borderColor='var(--mantine-color-gg_primary-filled)';});
    inp.addEventListener('blur',function(){inp.style.borderColor='var(--mantine-color-default-border)';});

    // Форматирование телефона +7 (XXX) XXX-XX-XX
    inp.addEventListener('input',function(){
        var raw=inp.value.replace(/\D/g,'');
        if(!raw){inp.value='';return;}
        // Приводим к 11 цифрам с 7 впереди
        if(raw.startsWith('8'))raw='7'+raw.slice(1);
        if(!raw.startsWith('7'))raw='7'+raw;
        raw=raw.slice(0,11);
        var f='+'+raw[0];
        if(raw.length>1)f+=' ('+raw.slice(1,4);
        if(raw.length>4)f+=') '+raw.slice(4,7);
        if(raw.length>7)f+='-'+raw.slice(7,9);
        if(raw.length>9)f+='-'+raw.slice(9,11);
        inp.value=f;
    });

    var err=document.createElement('p');
    err.style.cssText='font-size:12px;color:#e03131;margin:0;display:none;';

    var ftr=document.createElement('div');
    ftr.style.cssText='display:flex;gap:8px;justify-content:center;';

    var btnCancel=document.createElement('button');
    btnCancel.textContent='Отмена';
    btnCancel.style.cssText='flex:1;padding:9px;border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm,6px);background:transparent;color:var(--mantine-color-text);font-size:var(--mantine-font-size-sm,14px);font-family:inherit;cursor:pointer;';
    btnCancel.addEventListener('click',function(){ov.remove();});

    var btnFind=document.createElement('button');
    btnFind.textContent='Найти';
    btnFind.style.cssText='flex:1;padding:9px;border:none;border-radius:var(--mantine-radius-sm,6px);background:var(--mantine-color-gg_primary-filled);color:#fff;font-size:var(--mantine-font-size-sm,14px);font-family:inherit;cursor:pointer;font-weight:600;transition:opacity 0.15s;';

    ftr.appendChild(btnCancel);ftr.appendChild(btnFind);
    label.appendChild(inp);
    body.appendChild(desc);body.appendChild(label);body.appendChild(err);body.appendChild(ftr);
    box.appendChild(hdr);box.appendChild(body);
    ov.appendChild(box);document.body.appendChild(ov);
    setTimeout(function(){inp.focus();inp.value='+7 ';},100);

    async function doFind(){
        var raw=inp.value.replace(/\D/g,'');
        if(raw.length<11){err.style.display='';err.textContent='Введите полный номер телефона';return;}
        err.style.display='none';
        btnFind.disabled=true;btnFind.textContent='Поиск...';btnFind.style.opacity='0.7';

        var phone='+'+raw;
        var res=await gql(
            'query findUserByPhone($phone:String!,$club_id:Int!){findUserByPhone(params:{phone:$phone,clubId:$club_id}){id phone users_user_profile{name surname login}users_wallets(where:{club_id:{_eq:$club_id}},limit:1){id balance_amount balance_bonus}}}',
            {phone:phone,club_id:14}
        );

        if(!res||!res.data||!res.data.findUserByPhone){
            btnFind.disabled=false;btnFind.textContent='Найти';btnFind.style.opacity='1';
            err.style.display='';err.textContent='Пользователь не найден';return;
        }
        var user=res.data.findUserByPhone;

        btnFind.textContent='Привязка...';
        var att=await gql(
            'mutation AttachUserToClubById($clubId:Int!,$userId:String!){attachUserToClub(params:{clubId:$clubId,userId:$userId}){success __typename}}',
            {clubId:14,userId:user.id}
        );
        btnFind.disabled=false;btnFind.textContent='Найти';btnFind.style.opacity='1';

        var ok=att&&att.data&&att.data.attachUserToClub&&att.data.attachUserToClub.success;
        var alreadyOk=att&&att.errors&&att.errors[0]&&att.errors[0].message&&att.errors[0].message.indexOf('already')!==-1;
        if(!ok&&!alreadyOk){err.style.display='';err.textContent='Ошибка привязки. Попробуйте ещё раз.';return;}

        ov.remove();
        openClientModal(user.id,user.users_wallets&&user.users_wallets[0]);
    }

    btnFind.addEventListener('click',doFind);
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')doFind();if(e.key==='Escape')ov.remove();});
    document.addEventListener('keydown',function escH(e){
        if(e.key==='Escape'){ov.remove();document.removeEventListener('keydown',escH);}
    });
}

function createSearchBtn(){
    if(document.getElementById('godji-search-btn')) return;
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')) return;

    var btn=document.createElement('a');
    btn.id='godji-search-btn';
    var nativeLink = document.querySelector('a[href="/bookings"]') ||
                     document.querySelector('a.mantine-NavLink-root');
    btn.className = nativeLink ? nativeLink.className
        : 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
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
    body.appendChild(lbl);

    var addBtn=document.createElement('div');
    addBtn.id='godji-add-client-btn';
    addBtn.title='Привязать клиента к клубу';
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
        var hasNote=false;
        try{var nr=localStorage.getItem('godji_note_v2_'+c.id);if(nr){var nd=JSON.parse(nr);hasNote=!!(nd&&nd.html&&nd.html.trim()&&nd.html!=='<br>');}}catch(e){}
        var noteInd=hasNote?'<span title="Есть заметка" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#cc0001;flex-shrink:0;margin-left:4px;margin-top:3px;"></span>':'';
        item.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="display:flex;align-items:center;gap:4px;"><span style="font-size:var(--mantine-font-size-sm,14px);font-weight:600;color:var(--mantine-color-text);">'+esc(nick||name)+'</span>'+noteInd+'</div><span style="font-size:11px;color:var(--mantine-color-dimmed);white-space:nowrap;flex-shrink:0;">'+esc(bal+bon)+'</span></div>'+
            '<div style="font-size:11px;color:var(--mantine-color-dimmed);margin-top:2px;display:flex;gap:8px;">'+(nick?'<span>'+esc(name)+'</span>':'')+(c.phone?'<span>'+esc(c.phone)+'</span>':'')+'</div>';
        item.addEventListener('mouseenter',function(){item.style.background='var(--mantine-color-default-hover)';});
        item.addEventListener('mouseleave',function(){item.style.background='';});
        item.addEventListener('click',function(){openClientModal(c.id,c.users_wallets&&c.users_wallets[0]);});
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

    // iframeWrap с overflow:hidden — сайдбар уедет за левый край
    var iframeWrap=document.createElement('div');
    iframeWrap.style.cssText='flex:1;overflow:hidden;position:relative;min-height:0;';

    var iframe=document.createElement('iframe');
    iframe.src='/clients/'+clientId;
    // Ширина 100% — не расширяем модалку.
    // Смещаем влево через margin-left чтобы сайдбар (~300px) ушёл за левый край.
    // overflow:hidden на wrap обрезает то что левее.
    iframe.style.cssText='border:none;width:calc(100% + 300px);height:100%;margin-left:-300px;opacity:0;transition:opacity 0.2s;display:block;';

    var _SELECTORS=[
        '.mantine-AppShell-navbar',
        '.Sidebar_navbar__h0i17',
        '[class*="Sidebar_navbar"]',
    ];

    function hideEl(el){
        if(!el||el._gcsHidden)return;
        el.style.display='none';
        el._gcsHidden=true;
    }

    function fixIframe(){
        try{
            var idoc=iframe.contentDocument||iframe.contentWindow.document;
            if(!idoc||!idoc.body)return;
            _SELECTORS.forEach(function(sel){idoc.querySelectorAll(sel).forEach(hideEl);});
            // Скрываем godji-элементы кроме нужных
            idoc.querySelectorAll('[id^="godji"]').forEach(function(el){
                if(el.id==='godji-debit-btn'||el.id==='godji-debit-overlay'||el.id==='godji-client-note') return;
                hideEl(el);
            });
            // Убираем padding-left у main и сдвигаем контент к левому краю
            var main=idoc.querySelector('.mantine-AppShell-main,.Layout_mainContent__xcKGS');
            if(main){
                main.style.paddingLeft='16px';
                main.style.marginLeft='0';
                main.style.paddingTop='12px';
            }
            // CSS-переменные: убираем отступ под navbar
            var root=idoc.querySelector(':root');
            if(root){
                try{
                    idoc.documentElement.style.setProperty('--app-shell-navbar-width','0px','important');
                    idoc.documentElement.style.setProperty('--app-shell-navbar-offset','0px','important');
                }catch(e){}
            }
            var appShell=idoc.querySelector('.mantine-AppShell-root,[class*="Layout_appShell"]');
            if(appShell){
                appShell.style.setProperty('--app-shell-navbar-width','0px','important');
                appShell.style.setProperty('--app-shell-navbar-offset','0px','important');
            }
            iframe.style.opacity='1';
        }catch(e){}
    }

    function attachIframeObserver(){
        try{
            var idoc=iframe.contentDocument||iframe.contentWindow.document;
            if(!idoc||!idoc.body)return;
            new MutationObserver(function(muts){
                muts.forEach(function(m){
                    m.addedNodes.forEach(function(n){
                        if(n.nodeType!==1)return;
                        var cn=typeof n.className==='string'?n.className:'';
                        if(cn.indexOf('AppShell-navbar')!==-1||cn.indexOf('Sidebar_navbar')!==-1){hideEl(n);}
                        _SELECTORS.forEach(function(sel){if(n.querySelectorAll)n.querySelectorAll(sel).forEach(hideEl);});
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
        setTimeout(function(){iframe.style.opacity='1';},2000);
        attachIframeObserver();
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

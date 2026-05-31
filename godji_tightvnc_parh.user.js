// ==UserScript==
// @name         Годжи — TightVNC [Парх]
// @namespace    http://tampermonkey.net/
// @version      1.2
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @exclude      https://godji.cloud/tv/*
// @exclude      https://*.godji.cloud/tv/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

var PROXY = 'http://localhost:6080';
var CLUB_ID = 15;

// Карта филиала Парх (clubId=15)
// Координаты из DeviceItem на devicesLayer (450x800) — реальные размеры на экране
var LAYER_W = 450, LAYER_H = 800;
var MAP_IMG = 'https://goodgame-prod.storage.yandexcloud.net/tmp-55-1766578732533';
var CARD_ORIG = 24; // реальный размер карточки в px на этом экране

// Обрезка: bbox всех ПК с отступом, чтобы были видны очертания комнат
// Из консоли: minX=32, minY=148, maxX=414, maxY=653 — берём с запасом 30px
var CROP_X = 0, CROP_Y = 110, CROP_W = 450, CROP_H = 580;
var POPUP_W = 400;
var MAP_SCALE = POPUP_W / CROP_W;
var POPUP_H = Math.round(CROP_H * MAP_SCALE);

// Координаты left-top угла карточек в layer coords (450x800)
var PC_POS = {
    '1': {x:183,y:627}, '2': {x:146,y:627}, '3': {x:108,y:627},
    '4': {x:108,y:545}, '5': {x:145,y:545},
    '6': {x:101,y:442}, '7': {x:145,y:442}, '8': {x:191,y:442},
    '9': {x:234,y:442}, '10': {x:234,y:417}, '11': {x:191,y:417},
    '12': {x:146,y:417}, '13': {x:101,y:417},
    '14': {x:102,y:346}, '15': {x:146,y:346}, '16': {x:191,y:345},
    '17': {x:236,y:345}, '18': {x:236,y:320}, '19': {x:191,y:320},
    '20': {x:146,y:320}, '21': {x:102,y:320},
    '22': {x:32,y:363},  '23': {x:32,y:330},
    '24': {x:253,y:163}, '25': {x:253,y:195},
    '26': {x:300,y:148}, '27': {x:344,y:148}, '28': {x:386,y:148},
    '29': {x:385,y:225}, '30': {x:345,y:226},
    '31': {x:345,y:265}, '32': {x:388,y:265},
    '33': {x:386,y:365}, '34': {x:345,y:364},
    '35': {x:385,y:432}, '36': {x:345,y:432},
    '37': {x:344,y:470}
};

// ── Тост ─────────────────────────────────────────────────
function toast(msg, ok){
    var old = document.getElementById('gj-vnc-toast');
    if(old) old.remove();
    var t = document.createElement('div');
    t.id = 'gj-vnc-toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:399;pointer-events:none;'
        + 'background:var(--mantine-color-body,#1a1b2e);border:1px solid '+(ok?'rgba(74,222,128,.3)':'rgba(239,68,68,.3)')
        + ';border-radius:8px;padding:10px 18px;font-size:13px;font-family:var(--mantine-font-family,inherit);'
        + 'color:'+(ok?'#4ade80':'#f87171')+';display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);';
    t.innerHTML = (ok
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    ) + '<span>' + msg + '</span>';
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(function(){if(t.parentNode)t.remove();},300); }, 2500);
}

// ── Всплывашка с картой ───────────────────────────────────
var _popup = null;
var _popupOpen = false;
var _pcData = {};

function togglePopup(anchor){
    if(_popupOpen){ closePopup(); return; }
    openPopup(anchor);
}

function openPopup(anchor){
    closePopup();
    _popupOpen = true;
    updateSidebarBtn(true);

    var popup = document.createElement('div');
    _popup = popup;
    popup.id = 'gj-vnc-popup';

    popup.style.cssText=[
        'position:fixed','left:284px','top:60px',
        'width:'+POPUP_W+'px','max-height:calc(100vh - 70px)',
        'z-index:299',
        'background:#f8f9fa',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:0 8px 8px 0',
        'box-shadow:4px 0 32px rgba(0,0,0,.7)',
        'font-family:var(--mantine-font-family,inherit)',
        'overflow:hidden','display:flex','flex-direction:column',
        'transform:translateX(-20px)','opacity:0',
        'transition:transform 0.2s ease,opacity 0.2s ease',
    ].join(';');
    requestAnimationFrame(function(){popup.style.transform='translateX(0)';popup.style.opacity='1';});

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(0,0,0,0.08);flex-shrink:0;color:#1a1a2e;background:#f8f9fa;';

    var hdrL = document.createElement('div');
    hdrL.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var hIco = document.createElement('div');
    hIco.style.cssText = 'width:26px;height:26px;background:var(--mantine-color-gg_primary-filled,#cc0001);border-radius:6px;display:flex;align-items:center;justify-content:center;';
    hIco.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    var hTxt = document.createElement('span');
    hTxt.style.cssText = 'font-size:13px;font-weight:700;color:#1a1a2e;';
    hTxt.textContent = 'Просмотр экрана';
    hdrL.appendChild(hIco); hdrL.appendChild(hTxt);

    var statusDot = document.createElement('span');
    statusDot.id = 'gj-vnc-status-dot';
    statusDot.style.cssText = 'font-size:11px;color:rgba(0,0,0,0.55);font-weight:500;';
    statusDot.textContent = '● проверка…';

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;color:#1a1a2e;opacity:0.6;font-size:18px;line-height:1;';
    closeBtn.textContent = '×';
    closeBtn.onclick = closePopup;

    hdr.appendChild(hdrL); hdr.appendChild(statusDot); hdr.appendChild(closeBtn);
    popup.appendChild(hdr);

    // Карта
    var mapWrap = document.createElement('div');
    mapWrap.style.cssText='position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;';
    mapWrap.id = 'gj-vnc-map';
    popup.appendChild(mapWrap);

    document.body.appendChild(popup);

    // Закрытие по клику снаружи
    setTimeout(function(){
        document.addEventListener('click', outsideClose);
    }, 0);

    loadPCData(mapWrap, statusDot);
}

function outsideClose(e){
    if(_popup && !_popup.contains(e.target)){
        var btn = document.getElementById('gj-vnc-sidebar-btn');
        if(btn && btn.contains(e.target)) return;
        closePopup();
    }
}

function closePopup(){
    if(_popup){
        var p=_popup; _popup=null;
        p.style.transform='translateX(-20px)'; p.style.opacity='0';
        setTimeout(function(){ if(p.parentNode) p.remove(); },220);
    }
    _popupOpen=false; updateSidebarBtn(false);
    document.removeEventListener('click',outsideClose);
}

function loadERPStatus(cb){
    var auth=window._godjiAuth||window._godjiAuthToken||window._bkAuth||window._banAuth||'';
    if(!auth){ cb(new Set()); return; }
    fetch('https://hasura.godji.cloud/v1/graphql',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':auth,'x-hasura-role':'club_admin'},
        body:JSON.stringify({query:'query GetVNCStatus($clubId:Int!){getDashboardDevices(clubId:$clubId){devices{name sessions{status}}}}',variables:{clubId:CLUB_ID}})
    }).then(function(r){return r.json();}).then(function(res){
        var busy=new Set();
        var devs=(res.data&&res.data.getDashboardDevices&&res.data.getDashboardDevices.devices)||[];
        devs.forEach(function(d){
            if(d.sessions&&d.sessions.some(function(s){return s.status==='session_acting'||s.status==='active'||s.status==='created'||s.status==='booking_confirmed';}))
                busy.add(d.name);
        });
        cb(busy);
    }).catch(function(){cb(new Set());});
}

function loadPCData(mapWrap, statusDot){
    fetch(PROXY+'/status')
        .then(function(r){return r.json();})
        .then(function(vncData){
            loadERPStatus(function(busySet){
                var merged={};
                Object.keys(vncData).forEach(function(name){
                    merged[name]={ip:vncData[name].ip,name:vncData[name].name,busy:busySet.has(name)};
                });
                _pcData=merged;
                var cnt=Object.keys(merged).length;
                statusDot.innerHTML='<span style="color:#4ade80;">●</span> <span style="color:rgba(0,0,0,.5);">'+cnt+' ПК</span>';
                renderMap(mapWrap,merged,busySet);
            });
        })
        .catch(function(){
            statusDot.innerHTML='<span style="color:#f87171;">●</span> <span style="color:rgba(0,0,0,.4);">нет сервера</span>';
            renderMap(mapWrap,{},new Set());
            toast('VNC-сервер не запущен. Запустите vnc_server_parh.py',false);
        });
}

function renderMap(mapWrap, data, busySet){
    busySet=busySet||new Set();
    mapWrap.innerHTML='';
    mapWrap.style.cssText='position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;';

    var scaleX=POPUP_W/CROP_W;
    var scaleY=POPUP_H/CROP_H;
    var bgW=Math.round(LAYER_W*scaleX);
    var bgH=Math.round(LAYER_H*scaleY);
    var bgOffX=-Math.round(CROP_X*scaleX);
    var bgOffY=-Math.round(CROP_Y*scaleY);
    var bgWrap=document.createElement('div');
    bgWrap.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    var img=document.createElement('img');
    img.src=MAP_IMG;
    img.style.cssText='position:absolute;left:'+bgOffX+'px;top:'+bgOffY+'px;width:'+bgW+'px;height:'+bgH+'px;display:block;';
    bgWrap.appendChild(img); mapWrap.appendChild(bgWrap);

    var CARD=36;
    Object.keys(PC_POS).forEach(function(name){
        var pos=PC_POS[name];
        var cx=pos.x+CARD_ORIG/2;
        var cy=pos.y+CARD_ORIG/2;
        var px=Math.round((cx-CROP_X)*scaleX)-CARD/2;
        var py=Math.round((cy-CROP_Y)*scaleY)-CARD/2;
        var inVNC=!!(data[name]);
        var busy=busySet.has(name);
        var bg  = busy  ? 'linear-gradient(135deg,#c00 0%,#e53935 100%)'
                : inVNC ? 'linear-gradient(135deg,#1b5e20 0%,#43a047 100%)'
                : 'linear-gradient(135deg,#333 0%,#555 100%)';
        var bdr = busy  ? '#b71c1c' : inVNC ? '#2e7d32' : '#444';
        var clickable=inVNC;
        var cell=document.createElement('button');
        cell.title='ПК '+name;
        cell.style.cssText=[
            'position:absolute','left:'+px+'px','top:'+py+'px',
            'width:'+CARD+'px','height:'+CARD+'px',
            'border-radius:7px','border:2px solid '+bdr,'background:'+bg,
            'color:#fff','font-size:8px','font-weight:800',
            'cursor:'+(clickable?'pointer':'default'),
            'display:flex','flex-direction:column','align-items:center','justify-content:center',
            'gap:2px','font-family:inherit','padding:0','line-height:1',
            'transition:transform .12s,box-shadow .12s','z-index:2',
            'text-shadow:0 1px 3px rgba(0,0,0,0.7)','box-shadow:0 2px 6px rgba(0,0,0,0.35)',
        ].join(';');
        var lbl=document.createElement('span');
        lbl.style.cssText='color:#fff;font-size:8px;font-weight:800;line-height:1;pointer-events:none;';
        lbl.textContent=name; cell.appendChild(lbl);
        if(clickable){
            cell.addEventListener('mouseenter',function(){cell.style.transform='scale(1.18)';cell.style.boxShadow='0 4px 12px rgba(0,0,0,0.5)';cell.style.zIndex='10';});
            cell.addEventListener('mouseleave',function(){cell.style.transform='';cell.style.boxShadow='0 2px 6px rgba(0,0,0,0.35)';cell.style.zIndex='2';});
            cell.addEventListener('click',function(e){e.stopPropagation();connectPC(name);});
        }
        mapWrap.appendChild(cell);
    });
}

function connectPC(name){
    var url = PROXY + '/connect?pc=' + encodeURIComponent(name);
    fetch(url)
        .then(function(r){ return r.json(); })
        .then(function(res){
            if(res.error) throw new Error(res.error);
            toast('ПК ' + name + ' — подключение открыто', true);
        })
        .catch(function(e){
            var msg = (e.message||'').toLowerCase().indexOf('refused') >= 0 ||
                      (e.message||'').toLowerCase().indexOf('failed')  >= 0
                ? 'VNC-сервер не запущен. Запустите vnc_server_parh.py'
                : (e.message || 'Ошибка подключения');
            toast(msg, false);
        });
}

// ── Кнопка в сайдбаре ────────────────────────────────────
function createSidebarBtn(){
    if(document.getElementById('gj-vnc-sidebar-btn')) return;
    var inner = document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!inner) return;

    var nativeLink = document.querySelector('a[href="/bookings"]') ||
                     document.querySelector('a.mantine-NavLink-root');
    var cls = nativeLink ? nativeLink.className
        : 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';

    var btn = document.createElement('a');
    btn.id = 'gj-vnc-sidebar-btn';
    btn.className = cls;
    btn.href = 'javascript:void(0)';

    var sec = document.createElement('span');
    sec.className = 'm_690090b5 mantine-NavLink-section';
    sec.setAttribute('data-position','left');
    var icoWrap = document.createElement('div');
    icoWrap.className = 'LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    icoWrap.setAttribute('data-variant','filled');
    icoWrap.style.cssText = '--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:var(--mantine-color-gg_primary-filled,#cc0001);--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    icoWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    sec.appendChild(icoWrap);

    var body = document.createElement('div');
    body.className = 'm_f07af9d2 mantine-NavLink-body';
    var lbl = document.createElement('span');
    lbl.className = 'm_1f6ac4c4 mantine-NavLink-label';
    lbl.textContent = 'Просмотр экрана';
    body.appendChild(lbl);

    btn.appendChild(sec); btn.appendChild(body);
    btn.addEventListener('click', function(e){ e.stopPropagation(); togglePopup(btn); });

    var s = btn.style;
    s.setProperty('position','fixed');
    s.setProperty('bottom','408px');
    s.setProperty('left','0');
    s.setProperty('width','280px');
    s.setProperty('z-index','150');
    s.setProperty('box-sizing','border-box');
    document.body.appendChild(btn);
}

function updateSidebarBtn(open){
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if(!btn) return;
    if(open) btn.setAttribute('data-active','true');
    else btn.removeAttribute('data-active');
}

// ── Init ──────────────────────────────────────────────────
function tryInit(){
    if(!document.querySelector('nav.mantine-AppShell-navbar')){ setTimeout(tryInit,500); return; }
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')){ setTimeout(tryInit,500); return; }
    createSidebarBtn();
}

new MutationObserver(function(muts){
    muts.forEach(function(m){
        if(m.addedNodes.length && !document.getElementById('gj-vnc-sidebar-btn')) tryInit();
    });
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if(btn){
        var nav = document.querySelector('nav.mantine-AppShell-navbar');
        var hidden = !nav || window.getComputedStyle(nav).display === 'none';
        if(hidden) btn.style.display = 'none';
        else if(btn.style.display === 'none') btn.style.display = '';
    }
}).observe(document.body || document.documentElement, {childList:true, subtree:false});

setTimeout(tryInit, 1000);
setTimeout(tryInit, 2500);
setTimeout(tryInit, 5000);

})();

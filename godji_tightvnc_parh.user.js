// ==UserScript==
// @name         Годжи — TightVNC [Парх]
// @namespace    http://tampermonkey.net/
// @version      1.0
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

// Карта филиала Парх (clubId=15)
// Координаты из DeviceItem на devicesLayer (1149x2043)
var LAYER_W = 1149, LAYER_H = 2043;
var MAP_IMG = 'https://goodgame-prod.storage.yandexcloud.net/tmp-55-1766578732533';
var CARD_ORIG = 61;

// Обрезка: bbox всех ПК + отступ 20px
var CROP_X = 62, CROP_Y = 359, CROP_W = 990, CROP_H = 1302;
var POPUP_W = 480;
var MAP_SCALE = POPUP_W / CROP_W;
var POPUP_H = Math.round(CROP_H * MAP_SCALE);

// Координаты left-top угла карточек из devicesLayer
var PC_POS = {
    '1': {x:467,y:1600}, '2': {x:373,y:1600}, '3': {x:276,y:1600},
    '4': {x:276,y:1393}, '5': {x:369,y:1393},
    '6': {x:258,y:1130}, '7': {x:370,y:1130}, '8': {x:487,y:1130},
    '9': {x:598,y:1129}, '10': {x:598,y:1064}, '11': {x:487,y:1065},
    '12': {x:372,y:1066}, '13': {x:259,y:1064},
    '14': {x:260,y:884}, '15': {x:374,y:884}, '16': {x:488,y:882},
    '17': {x:603,y:882}, '18': {x:603,y:816}, '19': {x:488,y:817},
    '20': {x:374,y:817}, '21': {x:260,y:817},
    '22': {x:82,y:926}, '23': {x:82,y:843},
    '24': {x:646,y:416}, '25': {x:646,y:498},
    '26': {x:767,y:379}, '27': {x:879,y:379}, '28': {x:986,y:379},
    '29': {x:983,y:575}, '30': {x:880,y:576},
    '31': {x:882,y:678}, '32': {x:990,y:678},
    '33': {x:986,y:932}, '34': {x:880,y:930},
    '35': {x:983,y:1103}, '36': {x:881,y:1102},
    '37': {x:879,y:1199}
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

function loadPCData(mapWrap, statusDot){
    fetch(PROXY + '/status')
        .then(function(r){ return r.json(); })
        .then(function(data){
            _pcData = data;
            var cnt = Object.keys(data).length;
            statusDot.innerHTML = '<span style="color:#4ade80;">●</span> <span style="color:rgba(0,0,0,.5);">'+cnt+' ПК</span>';
            renderMap(mapWrap, data);
        })
        .catch(function(){
            statusDot.innerHTML = '<span style="color:#f87171;">●</span> <span style="color:rgba(0,0,0,.4);">нет сервера</span>';
            renderMap(mapWrap, {});
            toast('VNC-сервер не запущен. Запустите vnc_server_parh.py', false);
        });
}

function renderMap(mapWrap, data){
    mapWrap.innerHTML='';
    mapWrap.style.cssText='position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;';

    // Фон: масштабируем изображение карты под popup
    var scaleX = POPUP_W / CROP_W;
    var scaleY = POPUP_H / CROP_H;
    var bgW = Math.round(LAYER_W * scaleX);
    var bgH = Math.round(LAYER_H * scaleY);
    var bgOffX = -Math.round(CROP_X * scaleX);
    var bgOffY = -Math.round(CROP_Y * scaleY);

    var bgWrap = document.createElement('div');
    bgWrap.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    var img = document.createElement('img');
    img.src = MAP_IMG;
    img.style.cssText='position:absolute;left:'+bgOffX+'px;top:'+bgOffY+'px;width:'+bgW+'px;height:'+bgH+'px;display:block;';
    bgWrap.appendChild(img); mapWrap.appendChild(bgWrap);

    var CARD = 36;
    Object.keys(PC_POS).forEach(function(name){
        var pos = PC_POS[name];
        // Центр карточки в layer coords
        var cx = pos.x + CARD_ORIG / 2;
        var cy = pos.y + CARD_ORIG / 2;
        // Позиция в popup coords
        var px = Math.round((cx - CROP_X) * scaleX) - CARD / 2;
        var py = Math.round((cy - CROP_Y) * scaleY) - CARD / 2;

        var pc = data[name] || null;
        var avail = !!pc;

        var cell = document.createElement('button');
        cell.title = 'ПК ' + name;
        var bg  = avail ? 'linear-gradient(135deg,#c00 0%,#e53935 100%)' : 'linear-gradient(135deg,#1b5e20 0%,#43a047 100%)';
        var bdr = avail ? '#b71c1c' : '#2e7d32';
        cell.style.cssText=[
            'position:absolute',
            'left:'+px+'px','top:'+py+'px',
            'width:'+CARD+'px','height:'+CARD+'px',
            'border-radius:7px',
            'border:2px solid '+bdr,
            'background:'+bg,
            'color:#fff',
            'font-size:8px','font-weight:800',
            'cursor:'+(avail?'pointer':'default'),
            'display:flex','flex-direction:column','align-items:center','justify-content:center',
            'gap:2px','font-family:inherit','padding:0','line-height:1',
            'transition:transform .12s,box-shadow .12s','z-index:2',
            'text-shadow:0 1px 3px rgba(0,0,0,0.7)',
            'box-shadow:0 2px 6px rgba(0,0,0,0.35)',
        ].join(';');

        var lbl = document.createElement('span');
        lbl.style.cssText='color:#fff;font-size:8px;font-weight:800;line-height:1;pointer-events:none;';
        lbl.textContent = name;
        cell.appendChild(lbl);

        if(avail){
            cell.addEventListener('mouseenter',function(){ cell.style.transform='scale(1.18)'; cell.style.boxShadow='0 4px 12px rgba(0,0,0,0.5)'; cell.style.zIndex='10'; });
            cell.addEventListener('mouseleave',function(){ cell.style.transform=''; cell.style.boxShadow='0 2px 6px rgba(0,0,0,0.35)'; cell.style.zIndex='2'; });
            cell.addEventListener('click',function(e){ e.stopPropagation(); connectPC(name); });
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

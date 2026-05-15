// ==UserScript==
// @name         Годжи — TightVNC
// @namespace    http://tampermonkey.net/
// @version      3.12
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

// Точные координаты ПК с оригинальной карты дашборда (1920x1133)
// Карта масштабируется до popup-размера через scale
var MAP_ORIG_W=1920,MAP_ORIG_H=1133;
var MAP_IMG='https://goodgame-prod.storage.yandexcloud.net/tmp-2-1773905668693';
// TV layer размеры (из godji.cloud/tv/club-map)
var LAYER_W=1818,LAYER_H=1073;
var CARD_ORIG=57; // размер карточки в TV layer
// Обрезка: bbox всех ПК + отступ 20px
var CROP_X=579,CROP_Y=25,CROP_W=700,CROP_H=1016;
var POPUP_W=500;
var MAP_SCALE=POPUP_W/CROP_W;
var POPUP_H=Math.round(CROP_H*MAP_SCALE);

// Координаты left-top угла карточек из TV layer (1818x1073)
var PC_POS = {
    '01':{x:661,y:367},'02':{x:599,y:369},'03':{x:599,y:260},
    '04':{x:668,y:259},'05':{x:739,y:259},'06':{x:824,y:450},
    '07':{x:896,y:452},'08':{x:1082,y:328},'09':{x:1146,y:328},
    '10':{x:960,y:45},'11':{x:1015,y:45},'12':{x:1071,y:45},'13':{x:1126,y:45},
    '14':{x:1048,y:170},'15':{x:1105,y:169},'16':{x:1146,y:266},'17':{x:1084,y:265},
    '18':{x:1142,y:588},'19':{x:1202,y:588},'20':{x:1181,y:680},
    '21':{x:1118,y:680},'22':{x:1057,y:680},'23':{x:1046,y:741},'24':{x:1116,y:741},
    '25':{x:1116,y:848},'26':{x:1065,y:892},'27':{x:1008,y:860},
    '28':{x:951,y:870},'29':{x:951,y:807},'30':{x:884,y:794},
    '31':{x:884,y:851},'32':{x:885,y:912},'33':{x:795,y:964},
    '34':{x:793,y:895},'35':{x:794,y:835},'36':{x:728,y:836},
    '37':{x:728,y:896},'38':{x:728,y:963},'39':{x:608,y:882},
    '40':{x:608,y:819},'41':{x:814,y:582},'TV 1':{x:1111,y:466}
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

    // Позиционируем справа от сайдбара (280px) под кнопкой
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
    hTxt.style.cssText = 'font-size:13px;font-weight:700;color:var(--mantine-color-white,#e8eaf0);';
    hTxt.textContent = 'Просмотр экрана';
    hdrL.appendChild(hIco); hdrL.appendChild(hTxt);

    var statusDot = document.createElement('span');
    statusDot.id = 'gj-vnc-status-dot';
    statusDot.style.cssText = 'font-size:11px;color:rgba(0,0,0,0.5);font-weight:500;';
    statusDot.textContent = '●  проверка…';

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

    // Загружаем данные ПК
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
    var m=document.getElementById('gj-vnc-menu'); if(m) m.remove();
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
            statusDot.innerHTML = '<span style="color:#4ade80;">●</span> <span style="color:rgba(255,255,255,.4);">'+cnt+' ПК</span>';
            renderMap(mapWrap, data);
        })
        .catch(function(){
            statusDot.innerHTML = '<span style="color:#f87171;">●</span> <span style="color:rgba(255,255,255,.3);">нет сервера</span>';
            renderMap(mapWrap, {});
            toast('VNC-сервер не запущен. Запустите vnc_server.py', false);
        });
}

function renderMap(mapWrap, data){
    mapWrap.innerHTML='';
    mapWrap.style.cssText='position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;';
    // Фон карты
    var bgScaleX=(POPUP_W/CROP_W)*(LAYER_W/MAP_ORIG_W);
    var bgScaleY=(POPUP_H/CROP_H)*(LAYER_H/MAP_ORIG_H);
    var bgW=Math.round(MAP_ORIG_W*bgScaleX);
    var bgH=Math.round(MAP_ORIG_H*bgScaleY);
    var bgOffX=-Math.round(CROP_X*(bgW/LAYER_W));
    var bgOffY=-Math.round(CROP_Y*(bgH/LAYER_H));
    var bgWrap=document.createElement('div');
    bgWrap.style.cssText='position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    var img=document.createElement('img');
    img.src=MAP_IMG;
    img.style.cssText='position:absolute;left:'+bgOffX+'px;top:'+bgOffY+'px;width:'+bgW+'px;height:'+bgH+'px;display:block;';
    bgWrap.appendChild(img); mapWrap.appendChild(bgWrap);

    var CARD=36;
    Object.keys(PC_POS).forEach(function(name){
        var pos=PC_POS[name];
        var cx=pos.x+CARD_ORIG/2, cy=pos.y+CARD_ORIG/2;
        var px=Math.round((cx-CROP_X)*MAP_SCALE)-CARD/2;
        var py=Math.round((cy-CROP_Y)*MAP_SCALE)-CARD/2;
        var pc=data[name]||data[name.replace('TV ','TV')]||data[name.replace(/^0/,'')]||null;
        var avail=!!pc;
        var cell=document.createElement('button');
        cell.title='ПК '+name;
        // Занятые — красные, свободные — зелёные
        var bg = avail ? 'linear-gradient(135deg,#c00 0%,#e53935 100%)' : 'linear-gradient(135deg,#1b5e20 0%,#43a047 100%)';
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
        var lbl=document.createElement('span');
        lbl.style.cssText='color:#fff;font-size:8px;font-weight:800;line-height:1;pointer-events:none;';
        lbl.textContent=name; cell.appendChild(lbl);
        if(avail){
            cell.addEventListener('mouseenter',function(){ cell.style.transform='scale(1.18)'; cell.style.boxShadow='0 4px 12px rgba(0,0,0,0.5)'; cell.style.zIndex='10'; });
            cell.addEventListener('mouseleave',function(){ cell.style.transform=''; cell.style.boxShadow='0 2px 6px rgba(0,0,0,0.35)'; cell.style.zIndex='2'; });
            cell.addEventListener('click',function(e){ e.stopPropagation(); showVncMenu(name,cell); });
        }
        mapWrap.appendChild(cell);
    });
}

function connectPC(name, viewOnly){
    var url=PROXY+'/connect?pc='+encodeURIComponent(name)+(viewOnly?'&view=1':'');
    fetch(url)
        .then(function(r){return r.json();})
        .then(function(res){
            if(res.error) throw new Error(res.error);
            toast('ПК '+name+' — '+(viewOnly?'просмотр':'управление')+' открыт', true);
        })
        .catch(function(e){
            var msg = (e.message||'').toLowerCase().indexOf('refused')>=0||
                      (e.message||'').toLowerCase().indexOf('failed')>=0
                ? 'VNC-сервер не запущен. Запустите vnc_server.py'
                : (e.message||'Ошибка подключения');
            toast(msg, false);
        });
}

// Меню выбора режима — в стиле ERP
function showVncMenu(name, cell){
    var old=document.getElementById('gj-vnc-menu');
    if(old){ old.remove(); if(old._pc===name) return; }
    var menu=document.createElement('div');
    menu.id='gj-vnc-menu'; menu._pc=name;
    var cr=cell.getBoundingClientRect();
    menu.style.cssText=[
        'position:fixed',
        'left:'+(cr.right+4)+'px',
        'top:'+cr.top+'px',
        'background:#ffffff',
        'border:1px solid rgba(0,0,0,0.12)',
        'border-radius:8px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.15)',
        'z-index:9999','overflow:hidden','min-width:210px',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var ttl=document.createElement('div');
    ttl.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 14px 8px;border-bottom:1px solid rgba(0,0,0,0.08);';
    ttl.innerHTML='<div style="width:22px;height:22px;background:#cc0001;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
        +'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></div>'
        +'<span style="font-size:12px;font-weight:700;color:#1a1a2e;">ПК '+name+'</span>';
    menu.appendChild(ttl);

    function mkBtn(label,ico,cb){
        var b=document.createElement('button');
        b.style.cssText='display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;background:none;border:none;'
            +'color:#1a1a2e;font-size:13px;cursor:pointer;text-align:left;transition:background 0.1s;font-family:inherit;';
        b.innerHTML='<span style="opacity:0.5;display:flex;color:#1a1a2e;">'+ico+'</span><span style="color:#1a1a2e;">'+label+'</span>';
        b.onmouseenter=function(){ b.style.background='rgba(0,0,0,0.05)'; };
        b.onmouseleave=function(){ b.style.background='none'; };
        b.onclick=function(e){ e.stopPropagation(); menu.remove(); cb(); };
        return b;
    }
    var eyeIco='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var ctrlIco='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
    menu.appendChild(mkBtn('Только просмотр',eyeIco,function(){ connectPC(name,true); }));
    menu.appendChild(mkBtn('Просмотр с управлением',ctrlIco,function(){ connectPC(name,false); }));

    document.body.appendChild(menu);
    var mr=menu.getBoundingClientRect();
    if(mr.right>window.innerWidth-10) menu.style.left=(cr.left-mr.width-4)+'px';
    if(mr.bottom>window.innerHeight-10) menu.style.top=(window.innerHeight-mr.height-10)+'px';

    setTimeout(function(){
        document.addEventListener('click',function cm(ev){
            if(!menu.contains(ev.target)){ menu.remove(); document.removeEventListener('click',cm); }
        });
    },0);
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

    // Кнопка fixed прямо под "Поиск клиента" (godji-search-btn bottom:456px, высота ~46px)
    // setProperty — обход CSP который блокирует style.cssText
    var s=btn.style;
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

// ── Кнопка просмотра в карточке ПК на дашборде ───────────


// ── Init — только body observer, никакого observer на linksInner ──
function tryInit(){
    // Не показываем кнопку если нет сайдбара (например в поиске клиента)
    if(!document.querySelector('nav.mantine-AppShell-navbar')){ setTimeout(tryInit,500); return; }
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')){ setTimeout(tryInit,500); return; }
    createSidebarBtn();
}

new MutationObserver(function(muts){
    muts.forEach(function(m){
        if(m.addedNodes.length && !document.getElementById('gj-vnc-sidebar-btn')) tryInit();
    });
    // Скрываем кнопку если сайдбар не виден (страницы без navbar — поиск клиента и т.п.)
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if(btn){
        var nav = document.querySelector('nav.mantine-AppShell-navbar');
        var visible = nav && nav.offsetParent !== null && nav.offsetWidth > 0;
        btn.style.display = visible ? '' : 'none';
    }
}).observe(document.body || document.documentElement, {childList:true, subtree:false});

setTimeout(tryInit, 1000);
setTimeout(tryInit, 2500);
setTimeout(tryInit, 5000);

})();

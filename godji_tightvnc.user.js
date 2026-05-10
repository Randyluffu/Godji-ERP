// ==UserScript==
// @name         Годжи — TightVNC
// @namespace    http://tampermonkey.net/
// @version      3.5
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
var MAP_ORIG_W = 1920, MAP_ORIG_H = 1133;
var MAP_IMG = 'https://goodgame-prod.storage.yandexcloud.net/tmp-2-1773905668693';
// Обрезаем карту до области с ПК (убираем пустые края)
var CROP_X = 602, CROP_Y = 18, CROP_W = 728, CROP_H = 1060;
var POPUP_W = 500;
var MAP_SCALE = POPUP_W / CROP_W; // ~0.687
var POPUP_H = Math.round(CROP_H * MAP_SCALE); // ~728px

// Реальные координаты ПК (left, top) с оригинальной карты
var PC_POS = {
    '01':{x:698,y:388},'02':{x:632,y:390},'03':{x:632,y:275},
    '04':{x:705,y:273},'05':{x:780,y:274},'06':{x:870,y:475},
    '07':{x:946,y:477},'08':{x:1142,y:346},'09':{x:1210,y:346},
    '10':{x:1014,y:48},'11':{x:1072,y:48},'12':{x:1131,y:48},'13':{x:1189,y:48},
    '14':{x:1107,y:179},'15':{x:1167,y:178},'16':{x:1210,y:281},'17':{x:1145,y:280},
    '18':{x:1206,y:621},'19':{x:1269,y:621},'20':{x:1247,y:718},
    '21':{x:1181,y:718},'22':{x:1116,y:718},'23':{x:1105,y:782},'24':{x:1178,y:782},
    '25':{x:1191,y:908},'26':{x:1137,y:954},'27':{x:1004,y:905},
    '28':{x:1060,y:882},'29':{x:1003,y:852},'30':{x:933,y:838},
    '31':{x:933,y:899},'32':{x:934,y:963},'33':{x:839,y:1018},
    '34':{x:837,y:945},'35':{x:838,y:882},'36':{x:769,y:883},
    '37':{x:769,y:946},'38':{x:769,y:1017},'39':{x:642,y:931},
    '40':{x:642,y:865},'41':{x:859,y:615},'TV 1':{x:1173,y:492}
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
    popup.style.cssText = [
        'position:fixed',
        'left:284px','top:0','bottom:0',
        'width:'+POPUP_W+'px',
        'z-index:299',
        'background:var(--mantine-color-body,#1a1b2e)',
        'border-left:1px solid rgba(255,255,255,0.1)',
        'border-radius:0 8px 8px 0',
        'box-shadow:4px 0 32px rgba(0,0,0,.7)',
        'font-family:var(--mantine-font-family,inherit)',
        'overflow:hidden','display:flex','flex-direction:column',
        'transform:translateX(-20px)','opacity:0',
        'transition:transform 0.2s ease,opacity 0.2s ease',
    ].join(';');
    requestAnimationFrame(function(){
        popup.style.transform='translateX(0)';
        popup.style.opacity='1';
    });

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';

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
    statusDot.style.cssText = 'font-size:11px;color:rgba(255,255,255,.3);';
    statusDot.textContent = '●  проверка…';

    var closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;font-size:18px;line-height:1;padding:0;';
    closeBtn.textContent = '×';
    closeBtn.onclick = closePopup;

    hdr.appendChild(hdrL); hdr.appendChild(statusDot); hdr.appendChild(closeBtn);
    popup.appendChild(hdr);

    // Карта
    var mapWrap = document.createElement('div');
    mapWrap.style.cssText = 'position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:auto;';
    mapWrap.id = 'gj-vnc-map';
    popup.appendChild(mapWrap);

    // Легенда
    var legend = document.createElement('div');
    legend.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 14px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:rgba(255,255,255,.35);flex-shrink:0;';
    legend.innerHTML = '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:rgba(204,0,1,.35);border:1px solid rgba(204,0,1,.6);display:inline-block;"></span>Доступен</span>'
        + '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);display:inline-block;"></span>Нет в конфиге</span>';
    popup.appendChild(legend);

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
    _popupOpen=false;
    updateSidebarBtn(false);
    document.removeEventListener('click', outsideClose);
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
        });
}

function renderMap(mapWrap, data){
    mapWrap.innerHTML = '';
    mapWrap.style.cssText = 'position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;background:#1a1b2e;';

    // Фоновое изображение с обрезкой через object-position
    // Показываем только область CROP_X,CROP_Y размером CROP_W x CROP_H из 1920x1133
    var bg = document.createElement('div');
    var scaleX = POPUP_W / CROP_W;
    var scaleY = POPUP_H / CROP_H;
    var fullW = Math.round(MAP_ORIG_W * scaleX);
    var fullH = Math.round(MAP_ORIG_H * scaleY);
    var offX = -Math.round(CROP_X * scaleX);
    var offY = -Math.round(CROP_Y * scaleY);
    bg.style.cssText = [
        'position:absolute;top:0;left:0',
        'width:'+POPUP_W+'px;height:'+POPUP_H+'px',
        'overflow:hidden;pointer-events:none',
    ].join(';');
    var img = document.createElement('img');
    img.src = MAP_IMG;
    img.style.cssText = [
        'position:absolute',
        'left:'+offX+'px;top:'+offY+'px',
        'width:'+fullW+'px;height:'+fullH+'px',
        'display:block;pointer-events:none',
    ].join(';');
    bg.appendChild(img);
    mapWrap.appendChild(bg);

    // БЕЗ затемнения — карта светлая как оригинал ERP

    // Карточки ПК
    var CARD = 22;
    Object.keys(PC_POS).forEach(function(name){
        var pos = PC_POS[name];
        // Смещаем координаты на CROP
        var px = Math.round((pos.x - CROP_X) * MAP_SCALE);
        var py = Math.round((pos.y - CROP_Y) * MAP_SCALE);

        var numStr = name.replace('TV ','TV');
        var pc = data[name] || data[numStr] || data[name.replace(/^0/,'')] || null;
        var avail = !!pc;

        var cell = document.createElement('button');
        cell.title = 'ПК '+name;
        cell.style.cssText = [
            'position:absolute',
            'left:'+(px - CARD/2)+'px',
            'top:'+(py - CARD/2)+'px',
            'width:'+CARD+'px;height:'+CARD+'px',
            'border-radius:5px',
            'border:1.5px solid '+(avail?'rgba(220,38,38,0.9)':'rgba(255,255,255,0.3)'),
            'background:'+(avail?'rgba(239,68,68,0.85)':'rgba(255,255,255,0.2)'),
            'color:#fff;font-size:6px;font-weight:800',
            'cursor:'+(avail?'pointer':'default'),
            'display:flex;flex-direction:column;align-items:center;justify-content:center',
            'gap:1px;font-family:inherit;padding:0;line-height:1',
            'transition:transform .1s;z-index:2',
            'text-shadow:0 1px 3px rgba(0,0,0,0.9)',
            'box-shadow:0 1px 4px rgba(0,0,0,0.5)',
        ].join(';');

        var numEl = document.createElement('span');
        numEl.textContent = name;
        cell.appendChild(numEl);

        if(avail){
            var dot = document.createElement('span');
            dot.style.cssText = 'width:3px;height:3px;border-radius:50%;background:#fff;opacity:0.85;';
            cell.appendChild(dot);
            cell.addEventListener('mouseenter',function(){
                cell.style.transform='scale(1.25)'; cell.style.zIndex='10';
            });
            cell.addEventListener('mouseleave',function(){
                cell.style.transform=''; cell.style.zIndex='2';
            });
            cell.addEventListener('click',function(e){
                e.stopPropagation();
                showVncMenu(name,cell);
            });
        }
        mapWrap.appendChild(cell);
    });
}

function showVncMenu(name, cell){
    var old = document.getElementById('gj-vnc-menu');
    if(old){ old.remove(); if(old._pc===name) return; }

    var menu = document.createElement('div');
    menu.id = 'gj-vnc-menu';
    menu._pc = name;
    var cr = cell.getBoundingClientRect();
    menu.style.cssText = [
        'position:fixed',
        'left:'+(cr.right+6)+'px',
        'top:'+(cr.top-4)+'px',
        'background:#252640',
        'border:1px solid rgba(255,255,255,0.15)',
        'border-radius:8px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.7)',
        'z-index:9999;overflow:hidden;min-width:190px',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var ttl = document.createElement('div');
    ttl.style.cssText = 'padding:7px 14px 6px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.45);border-bottom:1px solid rgba(255,255,255,0.07);';
    ttl.textContent = 'ПК '+name;
    menu.appendChild(ttl);

    function mkBtn(label, ico, cb){
        var b = document.createElement('button');
        b.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:9px 14px;background:none;border:none;color:#e8eaf0;font-size:12px;cursor:pointer;text-align:left;transition:background 0.1s;';
        b.innerHTML = ico+'<span>'+label+'</span>';
        b.addEventListener('mouseenter',function(){ b.style.background='rgba(255,255,255,0.07)'; });
        b.addEventListener('mouseleave',function(){ b.style.background='none'; });
        b.addEventListener('click',function(e){ e.stopPropagation(); menu.remove(); cb(); });
        return b;
    }
    var eyeIco = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var ctrlIco = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';

    var num = parseInt(name, 10);
    // PROXY = 'http://localhost:6080' — веб-интерфейс TightVNC
    // view-only: добавляем ?view=1, управление — без параметра
    var baseUrl = PROXY + (isNaN(num) ? '/?pc='+encodeURIComponent(name) : '/?pc='+num);
    menu.appendChild(mkBtn('Только просмотр', eyeIco, function(){ window.open(baseUrl+'&view=1','_blank'); }));
    menu.appendChild(mkBtn('Просмотр с управлением', ctrlIco, function(){ window.open(baseUrl,'_blank'); }));

    document.body.appendChild(menu);
    setTimeout(function(){
        document.addEventListener('click', function cm(ev){
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

    // Вставляем после последней нативной ссылки в linksInner
    // (godji-search-btn — fixed в body, не здесь)
    var allLinks = inner.querySelectorAll(':scope > a.mantine-NavLink-root');
    var lastNative = null;
    allLinks.forEach(function(a){
        if(!a.id || (!a.id.startsWith('godji') && !a.id.startsWith('gj-'))){
            lastNative = a;
        }
    });
    if(lastNative && lastNative.nextSibling){
        inner.insertBefore(btn, lastNative.nextSibling);
    } else if(lastNative){
        inner.appendChild(btn);
    } else {
        inner.appendChild(btn);
    }
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
    if(!document.querySelector('.Sidebar_linksInner__oTy_4')){ setTimeout(tryInit,500); return; }
    createSidebarBtn();
}

new MutationObserver(function(muts){
    muts.forEach(function(m){
        if(m.addedNodes.length && !document.getElementById('gj-vnc-sidebar-btn')) tryInit();
    });
}).observe(document.body || document.documentElement, {childList:true, subtree:false});

setTimeout(tryInit, 1000);
setTimeout(tryInit, 2500);
setTimeout(tryInit, 5000);

})();

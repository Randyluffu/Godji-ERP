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
// Размер попапа — берём 420px ширину, высота пропорциональна
var POPUP_W = 420;
var POPUP_H = Math.round(MAP_ORIG_H / MAP_ORIG_W * POPUP_W); // ~248px
var MAP_SCALE = POPUP_W / MAP_ORIG_W; // ~0.219

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
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999999;pointer-events:none;'
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
    var btnRect = anchor.getBoundingClientRect();
    popup.style.cssText = [
        'position:fixed',
        'left:288px',
        'top:'+(btnRect.top-10)+'px',
        'width:'+POPUP_W+'px',
        'z-index:99990',
        'background:var(--mantine-color-body,#1a1b2e)',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:12px',
        'box-shadow:0 8px 32px rgba(0,0,0,.6)',
        'font-family:var(--mantine-font-family,inherit)',
        'overflow:hidden',
        'display:flex',
        'flex-direction:column',
    ].join(';');

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
    mapWrap.style.cssText = 'position:relative;width:'+POPUP_W+'px;height:'+POPUP_H+'px;flex-shrink:0;overflow:hidden;';
    mapWrap.id = 'gj-vnc-map';
    popup.appendChild(mapWrap);

    // Легенда
    var legend = document.createElement('div');
    legend.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 14px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:rgba(255,255,255,.35);flex-shrink:0;';
    legend.innerHTML = '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:rgba(204,0,1,.35);border:1px solid rgba(204,0,1,.6);display:inline-block;"></span>Доступен</span>'
        + '<span style="display:flex;align-items:center;gap:4px;"><span style="width:10px;height:10px;border-radius:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);display:inline-block;"></span>Нет в конфиге</span>';
    popup.appendChild(legend);

    document.body.appendChild(popup);

    // Подгоняем если выходит за низ экрана
    var pRect = popup.getBoundingClientRect();
    if(pRect.bottom > window.innerHeight - 10){
        popup.style.top = Math.max(10, window.innerHeight - pRect.height - 10) + 'px';
    }

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
    if(_popup){ _popup.remove(); _popup = null; }
    _popupOpen = false;
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

    // Фон — оригинальное изображение карты
    var bg = document.createElement('img');
    bg.src = 'https://goodgame-prod.storage.yandexcloud.net/tmp-2-1773905668693';
    bg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:fill;display:block;';
    mapWrap.appendChild(bg);

    // Накладываем карточки ПК с точными координатами
    var CARD = 28; // размер карточки в пикселях на попапе (55 * MAP_SCALE ~ 12, но увеличим для кликабельности)

    Object.keys(PC_POS).forEach(function(name){
        var pos = PC_POS[name];
        var px = Math.round(pos.x * MAP_SCALE);
        var py = Math.round(pos.y * MAP_SCALE);

        // Ищем в данных сервера
        var numStr = name.replace('TV ','TV');
        var pc = data[name] || data[numStr] || data[name.replace(/^0/,'')] || null;
        var avail = !!pc;

        var cell = document.createElement('button');
        cell.title = 'ПК ' + name;
        cell.style.cssText = [
            'position:absolute',
            'left:'+(px - CARD/2)+'px',
            'top:'+(py - CARD/2)+'px',
            'width:'+CARD+'px',
            'height:'+CARD+'px',
            'border-radius:5px',
            'border:1.5px solid '+(avail?'rgba(220,38,38,0.9)':'rgba(255,255,255,0.2)'),
            'background:'+(avail?'rgba(239,68,68,0.75)':'rgba(255,255,255,0.15)'),
            'color:#fff',
            'font-size:7px','font-weight:800',
            'cursor:'+(avail?'pointer':'default'),
            'display:flex','flex-direction:column','align-items:center','justify-content:center',
            'gap:1px','font-family:inherit','padding:0','line-height:1',
            'transition:background .12s,transform .1s',
            'z-index:2',
        ].join(';');

        var numEl = document.createElement('span');
        numEl.textContent = name;
        cell.appendChild(numEl);

        if(avail){
            var dot = document.createElement('span');
            dot.style.cssText = 'width:3px;height:3px;border-radius:50%;background:#fff;opacity:0.8;';
            cell.appendChild(dot);
            cell.addEventListener('mouseenter',function(){
                cell.style.background='rgba(220,38,38,0.95)';
                cell.style.transform='scale(1.15)';
                cell.style.zIndex='10';
            });
            cell.addEventListener('mouseleave',function(){
                cell.style.background='rgba(239,68,68,0.75)';
                cell.style.transform='';
                cell.style.zIndex='2';
            });
            cell.addEventListener('click',function(e){
                e.stopPropagation();
                connectPC(name,cell);
            });
        }

        mapWrap.appendChild(cell);
    });
}

function connectPC(name, cell){
    cell.disabled = true;
    cell.style.opacity = '.5';
    fetch(PROXY + '/connect?pc=' + encodeURIComponent(name))
        .then(function(r){ return r.json(); })
        .then(function(res){
            if(res.error) throw new Error(res.error);
            toast('Просмотр экрана ПК ' + name + ' открыт', true);
            cell.style.background = 'rgba(74,222,128,.25)';
            cell.style.borderColor = 'rgba(74,222,128,.6)';
            setTimeout(function(){
                cell.disabled = false;
                cell.style.opacity = '';
                cell.style.background = 'rgba(204,0,1,.18)';
                cell.style.borderColor = 'rgba(204,0,1,.5)';
            }, 2000);
        })
        .catch(function(e){
            toast(e.message || 'Ошибка подключения', false);
            cell.disabled = false;
            cell.style.opacity = '';
        });
}

// ── Кнопка в сайдбаре ────────────────────────────────────
function createSidebarBtn(){
    if(document.getElementById('gj-vnc-sidebar-btn')) return;
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

    // position:fixed прямо под кнопкой поиска клиента (bottom:456px минус высота кнопки ~46px)
    btn.style.position = 'fixed';
    btn.style.bottom = '408px';
    btn.style.left = '0';
    btn.style.width = '280px';
    btn.style.zIndex = '500';
    btn.style.boxSizing = 'border-box';
    document.body.appendChild(btn);
}

function updateSidebarBtn(open){
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if(!btn) return;
    if(open) btn.setAttribute('data-active','true');
    else btn.removeAttribute('data-active');
}

// ── Кнопка просмотра в карточке ПК на дашборде ───────────
// hookPcCards убран — subtree:true на body вызывал краш браузера

function addVncButtonToCard(panel, pcName){
    if(panel.querySelector('.gj-vnc-card-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'gj-vnc-card-btn';
    btn.style.cssText = 'background:var(--mantine-color-gg_primary-filled,#cc0001);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;white-space:nowrap;';
    btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>Просмотр';
    btn.addEventListener('click', function(e){ e.stopPropagation(); connectPC(pcName, btn); });
    panel.appendChild(btn);
}

// ── Init — только body observer, никакого observer на linksInner ──
function tryInit(){
    if(!document.querySelector('nav.mantine-AppShell-navbar')){ setTimeout(tryInit,500); return; }
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

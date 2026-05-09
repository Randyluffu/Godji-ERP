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
// Реальные координаты ПК из DevicesLayer дашборда (px при zoom=1)
var LAYER_W = 658, LAYER_H = 533;
// Попап: выдвигается вправо от сайдбара (280px)
var POPUP_W = 700;
var POPUP_H = Math.round(LAYER_H / LAYER_W * POPUP_W); // ~567px
var MAP_SCALE = POPUP_W / LAYER_W; // ~1.064

var PC_POS = {
    '01':{x:349,y:194},'02':{x:316,y:195},'03':{x:316,y:138},
    '04':{x:353,y:136},'05':{x:390,y:137},'06':{x:435,y:238},
    '07':{x:473,y:238},'08':{x:571,y:173},'09':{x:605,y:173},
    '10':{x:507,y:24},'11':{x:536,y:24},'12':{x:565,y:24},'13':{x:594,y:24},
    '14':{x:553,y:89},'15':{x:583,y:89},'16':{x:605,y:140},'17':{x:573,y:140},
    '18':{x:603,y:310},'19':{x:634,y:310},'20':{x:623,y:359},
    '21':{x:590,y:359},'22':{x:558,y:359},'23':{x:553,y:391},'24':{x:589,y:391},
    '25':{x:595,y:454},'26':{x:568,y:477},'27':{x:502,y:453},
    '28':{x:530,y:441},'29':{x:501,y:426},'30':{x:466,y:419},
    '31':{x:466,y:449},'32':{x:467,y:481},'33':{x:419,y:509},
    '34':{x:418,y:473},'35':{x:419,y:441},'36':{x:384,y:441},
    '37':{x:384,y:473},'38':{x:384,y:508},'39':{x:321,y:465},
    '40':{x:321,y:433},'41':{x:429,y:308},'TV 1':{x:586,y:246}
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

    // Выдвигается вправо от сайдбара с анимацией, z-index под Mantine модалки
    popup.style.cssText = [
        'position:fixed',
        'left:284px',
        'top:0',
        'bottom:0',
        'width:'+POPUP_W+'px',
        'z-index:299',
        'background:#1a1b2e',
        'border-left:1px solid rgba(255,255,255,0.12)',
        'border-radius:0 12px 12px 0',
        'box-shadow:4px 0 32px rgba(0,0,0,.7)',
        'font-family:var(--mantine-font-family,inherit)',
        'overflow:hidden',
        'display:flex',
        'flex-direction:column',
        'transform:translateX(-20px)',
        'opacity:0',
        'transition:transform 0.22s ease,opacity 0.22s ease',
    ].join(';');
    // Анимация появления
    requestAnimationFrame(function(){
        popup.style.transform = 'translateX(0)';
        popup.style.opacity = '1';
    });

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;color:#fff;';

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
    if(_popup){
        var p = _popup; _popup = null;
        p.style.transform = 'translateX(-20px)';
        p.style.opacity = '0';
        setTimeout(function(){ if(p.parentNode) p.remove(); }, 220);
    }
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
    // Фон — светло-серый как оригинальная карта ERP
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;inset:0;background:#e8eaf0;border-radius:4px;';
    mapWrap.appendChild(bg);

    var CARD = 20; // размер карточки ПК в пикселях
    Object.keys(PC_POS).forEach(function(name){
        var pos = PC_POS[name];
        var px = Math.round(pos.x * MAP_SCALE);
        var py = Math.round(pos.y * MAP_SCALE);
        var st = data[name] || {};
        var occupied = st.status === 'occupied' || st.occupied;

        var card = document.createElement('div');
        card.style.cssText = [
            'position:absolute',
            'left:'+(px)+'px',
            'top:'+(py)+'px',
            'width:'+CARD+'px',
            'height:'+CARD+'px',
            'background:'+(occupied?'#cc0001':'rgba(204,0,1,0.25)'),
            'border:1px solid '+(occupied?'#cc0001':'rgba(204,0,1,0.5)'),
            'border-radius:4px',
            'cursor:pointer',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'justify-content:center',
            'transition:transform 0.1s,border-color 0.1s',
            'box-sizing:border-box',
        ].join(';');

        var lbl = document.createElement('div');
        lbl.style.cssText = 'color:#fff;font-size:7px;font-weight:700;line-height:1;text-align:center;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.8);';
        lbl.textContent = name;
        card.appendChild(lbl);

        card.addEventListener('mouseenter', function(){ card.style.transform='scale(1.15)'; card.style.borderColor='#fff'; });
        card.addEventListener('mouseleave', function(){ card.style.transform=''; card.style.borderColor=occupied?'#cc0001':'rgba(204,0,1,0.5)'; });
        card.addEventListener('click', function(e){
            e.stopPropagation();
            onCardClick(name, st);
        });
        mapWrap.appendChild(card);
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
function hookPcCards(){
    new MutationObserver(function(muts){
        muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
                if(n.nodeType !== 1) return;
                var panels = n.querySelectorAll ? n.querySelectorAll('[class*="DeviceCard"],[class*="deviceCard"]') : [];
                panels.forEach(function(panel){
                    if(panel._vncHooked) return;
                    panel._vncHooked = true;
                    var nameEl = panel.querySelector('[class*="name"],[class*="Name"]');
                    var pcName = nameEl ? nameEl.textContent.trim() : null;
                    if(!pcName) return;
                    addVncButtonToCard(panel, pcName);
                });
            });
        });
    }).observe(document.body, {childList:true,subtree:false});
}

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
hookPcCards();

})();

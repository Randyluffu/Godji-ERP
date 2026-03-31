// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// Скрипт настроек:
// 1. Вставляет кнопку-шестерёнку в footer сайдбара (рядом с "Гоголя Админ")
// 2. При клике выдвигает панель настроек
// 3. Прячет кнопки: Сбросить подсветки (#godji-reset-btn), 
//    Карта (#godji-map-toggle), Цвета меню (#godji-colors-toggle)
// 4. Их функции доступны через панель настроек

var _panelOpen = false;
var _panel = null;

// ── Скрываем перенесённые кнопки ─────────────────────────
function hideMovedButtons(){
    ['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'].forEach(function(id){
        var el = document.getElementById(id);
        if(el && el.style.display !== 'none') el.style.display = 'none';
        // Вешаем observer чтобы ловить момент создания
        if(!el) window['_settings_hide_'+id] = true;
    });
}

// MutationObserver — как только кнопки появляются, скрываем
new MutationObserver(function(muts){
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType !== 1) return;
            var id = n.id || '';
            if(['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'].indexOf(id) !== -1){
                n.style.display = 'none';
            }
        });
    });
    // Также проверяем периодически
    hideMovedButtons();
}).observe(document.body, {childList:true, subtree:false});

setInterval(hideMovedButtons, 1000);

// ── Панель настроек ───────────────────────────────────────
function buildPanel(){
    _panel = document.createElement('div');
    _panel.id = 'godji-settings-panel';
    _panel.style.cssText = [
        'position:fixed','bottom:52px','left:0',
        'width:280px',
        'background:var(--mantine-color-body,#1a1b1e)',
        'border:1px solid rgba(255,255,255,0.09)',
        'border-radius:0 12px 0 0',
        'box-shadow:0 -4px 24px rgba(0,0,0,0.4)',
        'z-index:9998','display:none','flex-direction:column',
        'font-family:var(--mantine-font-family,inherit)',
        'overflow:hidden','padding-bottom:8px',
    ].join(';');

    // Заголовок
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:12px 16px 10px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);letter-spacing:0.8px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.06);';
    hdr.textContent = 'Настройки';
    _panel.appendChild(hdr);

    // Пункты настроек
    addToggleRow('Карта посадки', 'godji_map_enabled', true, function(val){
        var wrap = document.getElementById('gm-wrap');
        var mc = document.querySelector('.Map_mapContainer__a7ebY');
        if(wrap) wrap.style.display = val ? '' : 'none';
        if(mc) Array.from(mc.children).forEach(function(ch){
            if(ch.id !== 'gm-wrap'){
                ch.style.display = val ? 'none' : '';
                ch.style.visibility = val ? 'hidden' : '';
            }
        });
        // Обновляем тоггл в seating_map если он есть
        var mapTrack = document.querySelector('#godji-map-toggle div[style*="border-radius:10px"]');
        var mapThumb = mapTrack && mapTrack.querySelector('div');
        if(mapTrack) mapTrack.style.background = val ? '#cc0001' : 'rgba(255,255,255,0.25)';
        if(mapThumb) mapThumb.style.left = val ? '19px' : '3px';
        try{ localStorage.setItem('godji_map_enabled', val ? '1' : '0'); }catch(e){}
    });

    addToggleRow('Цвета меню', 'godji_colors_enabled', true, function(val){
        // Симулируем клик на тоггл в menu_colors
        var colorsToggle = document.getElementById('godji-colors-toggle');
        if(colorsToggle){
            var track = colorsToggle.querySelector('div[style*="border-radius:12px"]');
            if(track) track.click();
        } else {
            // Напрямую через GM
            try{
                var cur = GM_getValue('colorsEnabled', true);
                if(cur !== val) GM_setValue('colorsEnabled', val);
            }catch(e){}
        }
    });

    addActionRow('Сбросить подсветки', resetHighlights,
        '<path d="M4 7h16M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M10 12l4 4m0-4l-4 4"/>');

    addActionRow('TV карта (оригинал)', openOrigTV,
        '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M12 17v4"/>');

    document.body.appendChild(_panel);
}

function addToggleRow(label, storageKey, defaultVal, onChange){
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:default;';
    row.addEventListener('mouseenter', function(){ row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', function(){ row.style.background = ''; });

    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.8);font-weight:500;';
    lbl.textContent = label;

    // Читаем текущее значение
    var cur = defaultVal;
    try{
        var stored = localStorage.getItem(storageKey);
        if(stored !== null) cur = stored !== '0' && stored !== 'false';
    }catch(e){}

    var track = document.createElement('div');
    track.style.cssText = 'width:36px;height:20px;border-radius:10px;position:relative;flex-shrink:0;transition:background 0.2s;cursor:pointer;';
    var thumb = document.createElement('div');
    thumb.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.4);';

    function updateVis(val){
        track.style.background = val ? '#cc0001' : 'rgba(255,255,255,0.2)';
        thumb.style.left = val ? '19px' : '3px';
    }
    updateVis(cur);

    track.appendChild(thumb);
    track.addEventListener('click', function(e){
        e.stopPropagation();
        cur = !cur;
        updateVis(cur);
        try{ localStorage.setItem(storageKey, cur ? '1' : '0'); }catch(e){}
        onChange(cur);
    });

    row.appendChild(lbl); row.appendChild(track);
    _panel.appendChild(row);
}

function addActionRow(label, onClick, svgPath){
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;cursor:pointer;';
    row.addEventListener('mouseenter', function(){ row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', function(){ row.style.background = ''; });

    var ico = document.createElement('div');
    ico.style.cssText = 'color:rgba(255,255,255,0.45);line-height:0;flex-shrink:0;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + svgPath + '</svg>';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.8);font-weight:500;';
    lbl.textContent = label;

    row.appendChild(ico); row.appendChild(lbl);
    row.addEventListener('click', function(){ onClick(); });
    _panel.appendChild(row);
}

function resetHighlights(){
    var btn = document.getElementById('godji-reset-btn');
    if(btn){ btn.click(); return; }
    // Напрямую
    try{
        localStorage.removeItem('godji_cleanup_pcs');
        localStorage.removeItem('godji_cleanup_state');
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf,.gm-card').forEach(function(c){
            c.style.outline=''; c.style.outlineOffset=''; c.style.boxShadow='';
            var gt = c.querySelector('.gm-timer');
            if(gt){ gt.textContent=''; gt.style.color=''; }
        });
        document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(r){
            r.style.backgroundColor='';
        });
        showToast('Подсветки сброшены');
    }catch(e){}
}

function openOrigTV(){
    var mc = document.querySelector('.Map_mapContainer__a7ebY');
    if(!mc) return;
    var origEls = Array.from(mc.children).filter(function(ch){ return ch.id !== 'gm-wrap'; });
    origEls.forEach(function(ch){ ch.style.visibility=''; ch.style.display=''; });
    var origBtn = null;
    mc.querySelectorAll('button').forEach(function(b){
        if(b.textContent.trim().toUpperCase().indexOf('TV') !== -1) origBtn = b;
    });
    if(origBtn) origBtn.click();
    origEls.forEach(function(ch){
        ch.style.display = 'none';
        ch.style.visibility = 'hidden';
        ch.style.pointerEvents = 'none';
    });
}

function showToast(msg){
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.95);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-family:inherit;font-weight:500;z-index:99999;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.style.opacity='0'; t.style.transition='opacity 0.3s'; }, 2000);
    setTimeout(function(){ t.remove(); }, 2400);
}

// ── Кнопка-шестерёнка в footer сайдбара ──────────────────
function createSettingsBtn(){
    if(document.getElementById('godji-settings-btn')) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;

    // Вставляем кнопку перед разделителем
    var divider = footer.querySelector('.mantine-Divider-root');

    var btn = document.createElement('button');
    btn.id = 'godji-settings-btn';
    btn.type = 'button';
    btn.style.cssText = 'position:absolute;right:12px;bottom:16px;width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.5);transition:background 0.15s,color 0.15s;z-index:200;flex-shrink:0;padding:0;';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';

    btn.addEventListener('mouseenter', function(){ btn.style.background='rgba(255,255,255,0.14)'; btn.style.color='rgba(255,255,255,0.9)'; });
    btn.addEventListener('mouseleave', function(){ btn.style.background=_panelOpen?'rgba(255,255,255,0.12)':'rgba(255,255,255,0.08)'; btn.style.color=_panelOpen?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.5)'; });

    btn.addEventListener('click', function(e){
        e.stopPropagation();
        togglePanel();
    });

    // footer нужен position:relative для absolute btn
    footer.style.position = 'relative';
    footer.appendChild(btn);

    buildPanel();
}

function togglePanel(){
    if(!_panel) buildPanel();
    _panelOpen = !_panelOpen;
    _panel.style.display = _panelOpen ? 'flex' : 'none';
    var btn = document.getElementById('godji-settings-btn');
    if(btn){
        btn.style.background = _panelOpen ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)';
        btn.style.color = _panelOpen ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)';
    }
}

// Закрытие при клике вне
document.addEventListener('click', function(e){
    if(!_panelOpen) return;
    var btn = document.getElementById('godji-settings-btn');
    if(_panel && !_panel.contains(e.target) && (!btn || !btn.contains(e.target))){
        _panelOpen = false;
        _panel.style.display = 'none';
        if(btn){ btn.style.background='rgba(255,255,255,0.08)'; btn.style.color='rgba(255,255,255,0.5)'; }
    }
});

// Наблюдаем за появлением footer
new MutationObserver(function(){
    if(!document.getElementById('godji-settings-btn')){
        createSettingsBtn();
    }
}).observe(document.body, {childList:true, subtree:true});

setTimeout(createSettingsBtn, 1000);
setTimeout(createSettingsBtn, 3000);

})();

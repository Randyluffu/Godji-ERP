// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      4.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// ── Глобальный API регистрации ────────────────────────────
// Другие скрипты вызывают window.__godjiRegisterSetting(config)
// config = {
//   id: string,
//   label: string,
//   icon: string (SVG),
//   iconBg: string (CSS color),
//   type: 'button' | 'toggle',
//   onClick: function()        — для button
//   getState: function()→bool  — для toggle
//   onToggle: function(newVal) — для toggle
// }

var _items = [];
var _panel = null;
var _inner = null;
var _open  = false;

// Подхватываем регистрации которые пришли до загрузки этого скрипта
// (другие скрипты пишут в window.__godjiSettingsQueue напрямую)
if(window.__godjiSettingsQueue && window.__godjiSettingsQueue.length){
    window.__godjiSettingsQueue.forEach(function(cfg){ _items.push(cfg); });
}

// Устанавливаем функцию регистрации — другие скрипты ждут её через retry
window.__godjiRegisterSetting = function(cfg){
    if(!cfg||!cfg.id) return;
    var i = _items.findIndex(function(x){ return x.id === cfg.id; });
    if(i !== -1) _items[i] = cfg; else _items.push(cfg);
    if(_open && _inner) renderItems();
};

// Также обрабатываем очередь которая могла накопиться пока мы инициализировались
function _drainQueue(){
    if(window.__godjiSettingsQueue && window.__godjiSettingsQueue.length){
        window.__godjiSettingsQueue.forEach(function(cfg){
            if(!cfg||!cfg.id) return;
            var i=_items.findIndex(function(x){return x.id===cfg.id;});
            if(i===-1) _items.push(cfg); else _items[i]=cfg;
        });
        window.__godjiSettingsQueue = [];
    }
}
setInterval(_drainQueue, 500);

// ── Рендер ────────────────────────────────────────────────
function renderItems(){
    if(!_inner) return;
    _inner.innerHTML = '';
    _items.forEach(function(cfg){
        // Используем точный класс NavLink как у кнопок сайдбара
        var row = document.createElement('a');
        row.href = 'javascript:void(0)';
        row.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        row.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 16px 8px 12px;cursor:pointer;box-sizing:border-box;text-decoration:none;';
        row.addEventListener('mouseenter',function(){row.style.background='rgba(255,255,255,0.05)';});
        row.addEventListener('mouseleave',function(){row.style.background='';});

        var icoSec = document.createElement('span');
        icoSec.className = 'm_690090b5 mantine-NavLink-section';
        icoSec.setAttribute('data-position','left');
        var ico = document.createElement('div');
        ico.className = 'LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
        ico.setAttribute('data-variant','filled');
        ico.style.cssText = '--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:'+(cfg.iconBg||'#555')+';--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
        ico.innerHTML = cfg.icon || '';
        icoSec.appendChild(ico);
        row.appendChild(icoSec);

        var body = document.createElement('div');
        body.className = 'm_f07af9d2 mantine-NavLink-body';
        var lbl = document.createElement('span');
        lbl.className = 'm_1f6ac4c4 mantine-NavLink-label';
        lbl.textContent = cfg.label;
        body.appendChild(lbl);
        row.appendChild(body);

        if(cfg.type === 'toggle'){
            var track = document.createElement('div');
            track.style.cssText = 'width:38px;height:22px;border-radius:11px;position:relative;flex-shrink:0;transition:background 0.2s;';
            var thumb = document.createElement('div');
            thumb.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
            track.appendChild(thumb);
            row.appendChild(track);

            function sync(){
                var on = cfg.getState ? !!cfg.getState() : false;
                track.style.background = on ? '#cc0001' : 'rgba(255,255,255,0.2)';
                thumb.style.left = on ? '19px' : '3px';
            }
            sync();
            var si = setInterval(sync, 400);

            function toggle(e){
                e.stopPropagation();
                var on = cfg.getState ? !!cfg.getState() : false;
                if(cfg.onToggle) cfg.onToggle(!on);
                setTimeout(sync, 80);
            }
            var rightSec = document.createElement('span');
            rightSec.className = 'm_690090b5 mantine-NavLink-section';
            rightSec.setAttribute('data-position','right');
            rightSec.appendChild(track);
            row.appendChild(rightSec);
            track.addEventListener('click', toggle);
            row.addEventListener('click', toggle);
        } else {
            row.addEventListener('click', function(e){
                e.stopPropagation();
                if(cfg.onClick) cfg.onClick();
            });
        }
        _inner.appendChild(row);
    });
}

// ── Панель ────────────────────────────────────────────────
function buildPanel(){
    if(_panel) return;
    _panel = document.createElement('div');
    _panel.id = 'godji-settings-panel';
    _panel.style.cssText = [
        'position:fixed','left:280px','bottom:0','width:280px',
        'background:var(--mantine-color-body,#1a1b2e)',
        'border-left:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1))',
        'border-top:1px solid var(--mantine-color-default-border,rgba(255,255,255,0.1))',
        'box-shadow:4px 0 20px rgba(0,0,0,0.5)',
        'z-index:9998','display:none','flex-direction:column',
        'overflow:hidden','font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:var(--mantine-spacing-sm) var(--mantine-spacing-md) var(--mantine-spacing-xs);display:flex;align-items:center;gap:var(--mantine-spacing-xs);flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.07);';
    hdr.innerHTML = '<span style="font-size:calc(0.6875rem * var(--mantine-scale));font-weight:700;color:var(--mantine-color-dimmed);letter-spacing:0.05em;text-transform:uppercase;">Настройки</span>';
    _panel.appendChild(hdr);

    _inner = document.createElement('div');
    _inner.style.cssText = 'display:flex;flex-direction:column;padding:calc(0.25rem * var(--mantine-scale)) 0;';
    _panel.appendChild(_inner);
    document.body.appendChild(_panel);

    document.addEventListener('click',function(e){
        if(!_open) return;
        var btn = document.getElementById('godji-settings-btn');
        if(_panel&&!_panel.contains(e.target)&&(!btn||!btn.contains(e.target))) closePanel();
    });
}

function alignPanel(){
    if(!_panel) return;
    // Panel starts from top of shifts/clock section, extends to bottom
    var shifts = document.querySelector('.Shifts_shiftsPaper__9Jml_');
    if(shifts){
        var r = shifts.getBoundingClientRect();
        _panel.style.top = r.top + 'px';
        _panel.style.bottom = '0';
        _panel.style.maxHeight = (window.innerHeight - r.top) + 'px';
    } else {
        _panel.style.top = ''; _panel.style.bottom = '0';
    }
}

function openPanel(){ _drainQueue(); buildPanel(); renderItems(); alignPanel(); _panel.style.display='flex'; _open=true; var b=document.getElementById('godji-settings-btn'); if(b) b.style.background='rgba(204,0,1,0.2)'; }
function closePanel(){ if(_panel) _panel.style.display='none'; _open=false; var b=document.getElementById('godji-settings-btn'); if(b) b.style.background='rgba(255,255,255,0.07)'; }
function togglePanel(){ if(_open) closePanel(); else openPanel(); }

// ── Кнопка шестерни ───────────────────────────────────────
function createBtn(){
    if(!document.querySelector('.Sidebar_footer__1BA98')) return;
    if(document.getElementById('godji-settings-btn')) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;
    footer.style.position = 'relative';
    var btn = document.createElement('button');
    btn.id = 'godji-settings-btn';
    btn.type = 'button';
    btn.title = 'Настройки';
    btn.style.cssText = 'position:absolute;right:10px;bottom:0;height:44px;width:30px;border-radius:7px;border:none;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.4);transition:background 0.15s,color 0.15s;z-index:200;padding:0;';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.addEventListener('mouseenter',function(){ if(!_open){btn.style.background='rgba(255,255,255,0.13)';btn.style.color='rgba(255,255,255,0.85)';} });
    btn.addEventListener('mouseleave',function(){ if(!_open){btn.style.background='rgba(255,255,255,0.07)';btn.style.color='rgba(255,255,255,0.5)';} });
    btn.addEventListener('click',function(e){ e.stopPropagation(); togglePanel(); });
    footer.appendChild(btn);
}

window.addEventListener('resize', alignPanel);
new MutationObserver(function(){ if(!document.getElementById('godji-settings-btn')) createBtn(); })
    .observe(document.body||document.documentElement, {childList:true,subtree:false});

if(document.body){ setTimeout(createBtn,1000); setTimeout(createBtn,3000); setTimeout(buildPanel,500); }
else document.addEventListener('DOMContentLoaded',function(){ setTimeout(createBtn,1000); setTimeout(buildPanel,500); });

})();

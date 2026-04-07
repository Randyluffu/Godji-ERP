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

window.__godjiRegisterSetting = function(cfg){
    var i = _items.findIndex(function(x){ return x.id === cfg.id; });
    if(i !== -1) _items[i] = cfg; else _items.push(cfg);
    if(_open && _inner) renderItems();
};

// ── Рендер ────────────────────────────────────────────────
function renderItems(){
    if(!_inner) return;
    _inner.innerHTML = '';
    _items.forEach(function(cfg){
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px 8px 12px;height:44px;box-sizing:border-box;cursor:pointer;transition:background 0.12s;';
        row.addEventListener('mouseenter',function(){ row.style.background='rgba(255,255,255,0.06)'; });
        row.addEventListener('mouseleave',function(){ row.style.background=''; });

        var ico = document.createElement('div');
        ico.style.cssText = 'width:28px;height:28px;border-radius:7px;background:'+(cfg.iconBg||'#555')+';display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        ico.innerHTML = cfg.icon || '';
        row.appendChild(ico);

        var lbl = document.createElement('span');
        lbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.9);font-weight:500;flex:1;white-space:nowrap;';
        lbl.textContent = cfg.label;
        row.appendChild(lbl);

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
        'position:fixed','left:280px','bottom:0','width:260px',
        'background:var(--mantine-color-body,#1a1b2e)',
        'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:0 10px 10px 0',
        'box-shadow:6px 0 24px rgba(0,0,0,0.6)',
        'z-index:9998','display:none','flex-direction:column',
        'overflow:hidden','font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:8px 14px 6px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    hdr.innerHTML = '<span style="color:rgba(255,255,255,0.3);line-height:0"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg></span>'
        + '<span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:1.2px;text-transform:uppercase;">Настройки</span>';
    _panel.appendChild(hdr);

    _inner = document.createElement('div');
    _inner.style.cssText = 'display:flex;flex-direction:column;padding:4px 0;';
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
    var f = document.querySelector('.Sidebar_footer__1BA98');
    if(!f) return;
    var r = f.getBoundingClientRect();
    _panel.style.bottom = Math.max(0, window.innerHeight - r.bottom) + 'px';
}

function openPanel(){ buildPanel(); renderItems(); alignPanel(); _panel.style.display='flex'; _open=true; var b=document.getElementById('godji-settings-btn'); if(b) b.style.background='rgba(204,0,1,0.2)'; }
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
    btn.style.cssText = 'position:absolute;right:10px;bottom:8px;width:30px;height:30px;border-radius:7px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.5);transition:background 0.15s,color 0.15s;z-index:200;padding:0;';
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

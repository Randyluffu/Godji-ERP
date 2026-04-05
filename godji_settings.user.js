// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      3.3
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// В панель настроек уходят кнопки с этими id
var MOVED_IDS = ['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'];

var _open = false;
var _panel = null;
var _panelInner = null;

function hasSidebar(){
    return !!document.querySelector('.Sidebar_footer__1BA98');
}

// ── Перемещаем кнопки в панель ────────────────────────────
function processButtons(){
    if(!hasSidebar()) return;
    MOVED_IDS.forEach(function(id){
        var el = document.getElementById(id);
        if(!el || el._godjiSettingsMoved) return;
        el._godjiSettingsMoved = true;
        el.style.setProperty('display','none','important');
        if(_panelInner) addToPanel(el);
    });
}

function getLabelText(el){
    var lbl = el.querySelector('.mantine-NavLink-label,.m_1f6ac4c4');
    if(lbl) return lbl.textContent.trim();
    return el.title || el.textContent.trim() || el.id;
}

function getIconEl(el){
    var ico = el.querySelector('div[style*="border-radius:8px"],div[style*="border-radius: 8px"]');
    if(ico) return ico.cloneNode(true);
    var svg = el.querySelector('svg');
    if(svg){
        var w = document.createElement('div');
        w.style.cssText='width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        w.appendChild(svg.cloneNode(true));
        return w;
    }
    return null;
}

function addToPanel(origEl){
    if(!_panelInner) return;
    if(document.getElementById('_sc_'+origEl.id)) return;

    var row = document.createElement('div');
    row.id = '_sc_'+origEl.id;
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 14px 8px 12px;cursor:pointer;transition:background 0.12s;';
    row.addEventListener('mouseenter',function(){row.style.background='rgba(255,255,255,0.06)';});
    row.addEventListener('mouseleave',function(){row.style.background='';});

    var ico = getIconEl(origEl);
    if(ico){
        ico.style.cssText='width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
        row.appendChild(ico);
    }

    var lbl = document.createElement('span');
    lbl.style.cssText='font-size:13px;color:rgba(255,255,255,0.75);font-weight:500;flex:1;';
    lbl.textContent = getLabelText(origEl);
    row.appendChild(lbl);

    row.addEventListener('click',function(e){
        e.stopPropagation();
        origEl.click();
    });

    _panelInner.appendChild(row);
}

// ── Строим панель ─────────────────────────────────────────
function buildPanel(){
    if(_panel) return;
    _panel = document.createElement('div');
    _panel.id = 'godji-settings-panel';
    _panel.style.cssText = [
        'position:fixed',
        'left:280px',
        'bottom:0',
        'width:230px',
        'background:#1e1f24',
        'border:1px solid rgba(255,255,255,0.08)',
        'border-left:3px solid #cc0001',
        'border-radius:0 10px 10px 0',
        'box-shadow:4px 0 24px rgba(0,0,0,0.55)',
        'z-index:9998',
        'display:none',
        'flex-direction:column',
        'overflow:hidden',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var hdr = document.createElement('div');
    hdr.style.cssText='padding:10px 14px 8px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    var hIco = document.createElement('span');
    hIco.style.cssText='color:rgba(255,255,255,0.35);line-height:0;';
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';
    var hTxt = document.createElement('span');
    hTxt.style.cssText='font-size:11px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:1px;text-transform:uppercase;';
    hTxt.textContent='Настройки';
    hdr.appendChild(hIco); hdr.appendChild(hTxt);
    _panel.appendChild(hdr);

    _panelInner = document.createElement('div');
    _panelInner.id = 'godji-settings-inner';
    _panelInner.style.cssText='display:flex;flex-direction:column;padding:6px 0;';
    _panel.appendChild(_panelInner);

    document.body.appendChild(_panel);

    document.addEventListener('click',function(e){
        if(!_open) return;
        var btn = document.getElementById('godji-settings-btn');
        if(_panel && !_panel.contains(e.target) && (!btn||!btn.contains(e.target))){
            closePanel();
        }
    });
}

function alignPanel(){
    if(!_panel) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;
    var rect = footer.getBoundingClientRect();
    _panel.style.bottom = Math.max(0, window.innerHeight - rect.bottom) + 'px';
}

function openPanel(){
    buildPanel();
    processButtons();
    alignPanel();
    _panel.style.display = 'flex';
    _open = true;
    var btn = document.getElementById('godji-settings-btn');
    if(btn) btn.style.background = 'rgba(204,0,1,0.2)';
}
function closePanel(){
    if(_panel) _panel.style.display = 'none';
    _open = false;
    var btn = document.getElementById('godji-settings-btn');
    if(btn) btn.style.background = 'rgba(255,255,255,0.07)';
}

function togglePanel(){
    if(_open) closePanel(); else openPanel();
}

// ── Кнопка-шестерня в footer ──────────────────────────────
function createBtn(){
    if(!hasSidebar()) return;
    if(document.getElementById('godji-settings-btn')) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;

    footer.style.position = 'relative';
    var btn = document.createElement('button');
    btn.id = 'godji-settings-btn';
    btn.type = 'button';
    btn.title = 'Настройки';
    btn.style.cssText = 'position:absolute;right:10px;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:7px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.5);transition:background 0.15s,color 0.15s;z-index:200;padding:0;';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.addEventListener('mouseenter',function(){
        if(!_open){btn.style.background='rgba(255,255,255,0.13)';btn.style.color='rgba(255,255,255,0.85)';}
    });
    btn.addEventListener('mouseleave',function(){
        if(!_open){btn.style.background='rgba(255,255,255,0.07)';btn.style.color='rgba(255,255,255,0.5)';}
    });
    btn.addEventListener('click',function(e){e.stopPropagation();togglePanel();});
    footer.appendChild(btn);
}

// ── MutationObserver ──────────────────────────────────────
var _obs = new MutationObserver(function(muts){
    if(!hasSidebar()) return;
    if(!document.getElementById('godji-settings-btn')) createBtn();
    var needProcess = false;
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType!==1) return;
            if(MOVED_IDS.indexOf(n.id)!==-1) needProcess = true;
        });
    });
    if(needProcess) setTimeout(processButtons, 50);
});

window.addEventListener('resize', alignPanel);

if(document.body){
    _obs.observe(document.body,{childList:true,subtree:false});
    setTimeout(createBtn,1000); setTimeout(createBtn,3000);
    // Строим панель сразу и регулярно ищем кнопки для переноса
    setTimeout(buildPanel, 500);
    setInterval(function(){
        buildPanel();
        processButtons();
    }, 800);
} else {
    document.addEventListener('DOMContentLoaded',function(){
        _obs.observe(document.body,{childList:true,subtree:false});
        setTimeout(createBtn,1000);
        setTimeout(buildPanel, 500);
        setInterval(function(){
            buildPanel();
            processButtons();
        }, 800);
    });
}

})();

// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      3.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// ── IDs кнопок которые переносим в настройки ─────────────
var MOVED_IDS = ['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'];

var _open = false;
var _panel = null;
var _panelInner = null; // контейнер для кнопок внутри панели

// ── Скрываем кнопки из сайдбара и перемещаем в панель ────
function processButtons(){
    MOVED_IDS.forEach(function(id){
        var el = document.getElementById(id);
        if(!el) return;

        // Уже обработана
        if(el._godjiSettingsMoved) return;
        el._godjiSettingsMoved = true;

        // Скрываем оригинальную кнопку
        el.style.setProperty('display','none','important');

        // Добавляем в панель
        if(_panelInner) addBtnToPanel(el);
    });
}

function addBtnToPanel(origEl){
    if(!_panelInner) return;
    if(document.getElementById('_settings_clone_'+origEl.id)) return;

    var wrapper = document.createElement('div');
    wrapper.id = '_settings_clone_'+origEl.id;
    wrapper.style.cssText = 'display:flex;align-items:center;padding:4px 12px 4px 0;cursor:pointer;transition:background 0.12s;';
    wrapper.addEventListener('mouseenter',function(){wrapper.style.background='rgba(255,255,255,0.05)';});
    wrapper.addEventListener('mouseleave',function(){wrapper.style.background='';});

    // Клонируем содержимое кнопки
    var clone = origEl.cloneNode(true);
    // Убираем position:fixed и размеры
    clone.style.cssText = 'display:flex;align-items:center;gap:12px;padding:6px 12px 6px 16px;cursor:pointer;width:100%;box-sizing:border-box;text-decoration:none;';
    clone.style.removeProperty('position');
    clone.style.removeProperty('bottom');
    clone.style.removeProperty('top');
    clone.style.removeProperty('left');
    clone.style.removeProperty('z-index');
    clone.style.removeProperty('width');
    clone.id = '_settings_btn_clone_'+origEl.id;

    // При клике — кликаем оригинал
    clone.addEventListener('click',function(e){
        e.stopPropagation();
        origEl.click();
    });

    wrapper.appendChild(clone);
    _panelInner.appendChild(wrapper);
}

// ── Строим панель ─────────────────────────────────────────
function buildPanel(){
    _panel = document.createElement('div');
    _panel.id = 'godji-settings-panel';
    _panel.style.cssText = [
        'position:fixed',
        'left:280px',
        'bottom:0',
        'min-width:240px',
        'max-width:320px',
        'background:var(--mantine-color-body,#1a1b1e)',
        'border:1px solid rgba(255,255,255,0.09)',
        'border-left:none',
        'border-radius:0 12px 12px 0',
        'box-shadow:6px 0 24px rgba(0,0,0,0.5)',
        'z-index:9998',
        'display:none',
        'flex-direction:column',
        'overflow:hidden',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    // Заголовок
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:12px 16px 10px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    hdr.textContent = 'Настройки';
    _panel.appendChild(hdr);

    // Контейнер для кнопок
    _panelInner = document.createElement('div');
    _panelInner.id = 'godji-settings-inner';
    _panelInner.style.cssText = 'display:flex;flex-direction:column;padding:4px 0;';
    _panel.appendChild(_panelInner);

    document.body.appendChild(_panel);

    // Закрытие при клике вне
    document.addEventListener('click',function(e){
        if(!_open) return;
        var btn = document.getElementById('godji-settings-btn');
        if(_panel&&!_panel.contains(e.target)&&(!btn||!btn.contains(e.target))){
            closePanel();
        }
    });
}

function alignPanel(){
    if(!_panel) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;
    var rect = footer.getBoundingClientRect();
    var fromBottom = window.innerHeight - rect.bottom;
    _panel.style.bottom = (fromBottom > 0 ? fromBottom : 0) + 'px';
}

function openPanel(){
    if(!_panel) buildPanel();
    // Переносим кнопки если ещё не перенесены
    processButtons();
    alignPanel();
    _panel.style.display = 'flex';
    _open = true;
    var btn = document.getElementById('godji-settings-btn');
    if(btn){ btn.style.background='rgba(255,255,255,0.14)'; btn.style.color='rgba(255,255,255,0.9)'; }
}

function closePanel(){
    if(_panel) _panel.style.display = 'none';
    _open = false;
    var btn = document.getElementById('godji-settings-btn');
    if(btn){ btn.style.background='rgba(255,255,255,0.07)'; btn.style.color='rgba(255,255,255,0.45)'; }
}

function togglePanel(){
    if(_open) closePanel(); else openPanel();
}

// ── Кнопка-шестерёнка в footer ────────────────────────────
function createBtn(){
    if(document.getElementById('godji-settings-btn')) return;
    var footer = document.querySelector('.Sidebar_footer__1BA98');
    if(!footer) return;

    footer.style.position = 'relative';

    var btn = document.createElement('button');
    btn.id = 'godji-settings-btn';
    btn.type = 'button';
    btn.title = 'Настройки';
    btn.style.cssText = 'position:absolute;right:12px;top:0;bottom:0;margin:auto;width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.45);transition:background 0.15s,color 0.15s;z-index:200;padding:0;';
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';

    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.13)';btn.style.color='rgba(255,255,255,0.85)';});
    btn.addEventListener('mouseleave',function(){
        if(!_open){btn.style.background='rgba(255,255,255,0.07)';btn.style.color='rgba(255,255,255,0.45)';}
    });
    btn.addEventListener('click',function(e){e.stopPropagation();togglePanel();});
    footer.appendChild(btn);
}

// ── MutationObserver — ловим появление кнопок ────────────
var _obs = new MutationObserver(function(muts){
    if(!document.getElementById('godji-settings-btn')) createBtn();
    // Ловим появление перемещаемых кнопок
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
    setTimeout(createBtn,1000);
    setTimeout(createBtn,3000);
    // Периодически проверяем кнопки
    setInterval(processButtons, 1000);
}

})();

// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      2.2
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// Кнопка шестерёнки в footer сайдбара, рядом с "Гоголя Админ".
// Панель выезжает вправо в стиле сайдбара.
// Скрывает перенесённые кнопки и отображает их внутри панели
// в том же виде как они были — через proxy-клик.

var _open = false;
var _panel = null;

// ── Скрываем перенесённые кнопки ────────────────────────
var MOVED = ['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'];

function hideMovedButtons(){
    MOVED.forEach(function(id){
        var el=document.getElementById(id);
        if(el) el.style.setProperty('display','none','important');
    });
}

new MutationObserver(function(muts){
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType!==1)return;
            if(MOVED.indexOf(n.id)!==-1) n.style.setProperty('display','none','important');
        });
    });
}).observe(document.body,{childList:true,subtree:false});
setInterval(hideMovedButtons,800);

// ── Панель настроек ──────────────────────────────────────
function buildPanel(){
    _panel=document.createElement('div');
    _panel.id='godji-settings-panel';
    // Выезжает вправо от сайдбара, выравнивается по bottom footer
    _panel.style.cssText=[
        'position:fixed',
        'left:280px',
        'bottom:0',       // будет уточнён в alignPanel()
        'min-width:220px',
        'background:var(--mantine-color-body,#1a1b1e)',
        'border:1px solid rgba(255,255,255,0.09)',
        'border-left:2px solid rgba(255,255,255,0.06)',
        'border-radius:0 12px 12px 0',
        'box-shadow:6px 0 32px rgba(0,0,0,0.55)',
        'z-index:9998',
        'display:none',
        'flex-direction:column',
        'overflow:hidden',
        'padding-bottom:6px',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    // Заголовок
    var hdr=document.createElement('div');
    hdr.style.cssText='padding:12px 18px 10px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;user-select:none;';
    hdr.textContent='Настройки';
    _panel.appendChild(hdr);

    document.body.appendChild(_panel);

    // Наполняем пункты динамически (см. populatePanel)
    populatePanel();
}

// Список пунктов — функции из родных скриптов, вызываемые по клику
var _registeredItems=[];

function registerItem(label, onClick, iconPath){
    _registeredItems.push({label:label,onClick:onClick,iconPath:iconPath});
}

function populatePanel(){
    if(!_panel)return;
    // Удаляем всё кроме заголовка
    while(_panel.children.length>1) _panel.removeChild(_panel.lastChild);

    _registeredItems.forEach(function(item){
        addRow(item.label, item.onClick, item.iconPath);
    });

    // Если нет зарегистрированных — добавляем встроенные
    if(!_registeredItems.length){
        addRow('Сбросить подсветки', resetHighlights,
            'M4 7h16M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M10 12l4 4m0-4l-4 4');
        addRow('TV карта (оригинал)', openOrigTV,
            'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM8 21l4-4 4 4M12 17v4');
    }
}

function addRow(label, onClick, iconPath){
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;transition:background 0.12s;user-select:none;';
    row.addEventListener('mouseenter',function(){row.style.background='rgba(255,255,255,0.06)';});
    row.addEventListener('mouseleave',function(){row.style.background='';});

    if(iconPath){
        var ico=document.createElement('div');
        ico.style.cssText='width:28px;height:28px;border-radius:7px;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,0.55);';
        ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+iconPath+'"/></svg>';
        row.appendChild(ico);
    }

    var lbl=document.createElement('span');
    lbl.style.cssText='font-size:13px;color:rgba(255,255,255,0.82);font-weight:500;line-height:1.3;white-space:nowrap;';
    lbl.textContent=label;
    row.appendChild(lbl);

    row.addEventListener('click',function(e){ e.stopPropagation(); onClick(); });
    _panel.appendChild(row);
}

// ── Встроенные действия ──────────────────────────────────
function resetHighlights(){
    // Сначала пробуем кликнуть оригинальную кнопку
    var btn=document.getElementById('godji-reset-btn');
    if(btn){ btn.style.removeProperty('display'); btn.click(); btn.style.setProperty('display','none','important'); return; }
    // Fallback
    try{
        localStorage.removeItem('godji_cleanup_pcs');
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf,.gm-card').forEach(function(c){
            c.style.outline='';c.style.outlineOffset='';c.style.boxShadow='';
        });
        document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(r){r.style.backgroundColor='';});
        showToast('Подсветки сброшены ✓');
    }catch(e){}
}

function openOrigTV(){
    var mc=document.querySelector('.Map_mapContainer__a7ebY');
    if(!mc)return;
    var origEls=Array.from(mc.children).filter(function(ch){return ch.id!=='gm-wrap';});
    origEls.forEach(function(ch){ch.style.visibility='';ch.style.display='';ch.style.pointerEvents='';});
    var origBtn=null;
    mc.querySelectorAll('button').forEach(function(b){if(b.textContent.trim().toUpperCase().indexOf('TV')!==-1)origBtn=b;});
    if(origBtn)origBtn.click();
    origEls.forEach(function(ch){ch.style.display='none';ch.style.visibility='hidden';ch.style.pointerEvents='none';});
}

function showToast(msg){
    var old=document.getElementById('_gst');if(old)old.remove();
    var t=document.createElement('div');t.id='_gst';
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,22,32,0.97);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-family:inherit;font-weight:500;z-index:99999;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);';
    t.textContent=msg;document.body.appendChild(t);
    setTimeout(function(){t.style.transition='opacity 0.3s';t.style.opacity='0';},2000);
    setTimeout(function(){t.remove();},2400);
}

// ── Кнопка шестерёнки в footer ───────────────────────────
function createBtn(){
    if(document.getElementById('godji-settings-btn'))return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer)return;

    footer.style.position='relative';

    var btn=document.createElement('button');
    btn.id='godji-settings-btn';
    btn.type='button';
    btn.title='Настройки';
    // Абсолютно позиционируем внутри footer справа, вертикально центрируем
    // Используем Flexbox: footer уже flex-контейнер с кнопкой "Гоголя Админ"
    // Добавляем шестерёнку как абсолютный элемент справа
    btn.style.cssText='position:absolute;right:16px;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.4);transition:background 0.15s,color 0.15s;z-index:200;padding:0;';
    btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';

    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.13)';btn.style.color='rgba(255,255,255,0.85)';});
    btn.addEventListener('mouseleave',function(){
        btn.style.background=_open?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.07)';
        btn.style.color=_open?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.4)';
    });
    btn.addEventListener('click',function(e){e.stopPropagation();toggle();});
    footer.appendChild(btn);

    buildPanel();
    alignPanel();
}

function alignPanel(){
    if(!_panel)return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer)return;
    var r=footer.getBoundingClientRect();
    var fromBottom=window.innerHeight-r.bottom;
    _panel.style.bottom=fromBottom+'px';
}

function toggle(){
    if(!_panel)buildPanel();
    _open=!_open;
    alignPanel();
    _panel.style.display=_open?'flex':'none';
    var btn=document.getElementById('godji-settings-btn');
    if(btn){
        btn.style.background=_open?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.07)';
        btn.style.color=_open?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.4)';
    }
}

document.addEventListener('click',function(e){
    if(!_open)return;
    var btn=document.getElementById('godji-settings-btn');
    if(_panel&&!_panel.contains(e.target)&&(!btn||!btn.contains(e.target))){
        _open=false;
        if(_panel)_panel.style.display='none';
        if(btn){btn.style.background='rgba(255,255,255,0.07)';btn.style.color='rgba(255,255,255,0.4)';}
    }
});

window.addEventListener('resize',alignPanel);

new MutationObserver(function(){
    if(!document.getElementById('godji-settings-btn'))createBtn();
    else alignPanel();
}).observe(document.body,{childList:true,subtree:true});

setTimeout(createBtn,1000);
setTimeout(createBtn,3000);

})();

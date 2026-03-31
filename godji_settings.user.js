// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      2.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_settings.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

var _open = false;
var _panel = null;

// ── Скрываем перенесённые кнопки ─────────────
var HIDDEN_IDS = ['godji-reset-btn','godji-map-toggle','godji-colors-toggle','godji-tv-orig-btn'];

function hideMovedButtons(){
    HIDDEN_IDS.forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.style.setProperty('display','none','important');
    });
}
new MutationObserver(function(muts){
    muts.forEach(function(m){
        m.addedNodes.forEach(function(n){
            if(n.nodeType!==1)return;
            if(HIDDEN_IDS.indexOf(n.id)!==-1) n.style.setProperty('display','none','important');
        });
    });
    hideMovedButtons();
}).observe(document.body,{childList:true,subtree:false});
setInterval(hideMovedButtons,800);

// ── Панель настроек (выезжает вправо от сайдбара) ─────
function buildPanel(){
    _panel = document.createElement('div');
    _panel.id = 'godji-settings-panel';
    _panel.style.cssText = [
        'position:fixed',
        'left:280px',        // сразу правее сайдбара (280px ширина)
        'bottom:0',
        'width:240px',
        'background:var(--mantine-color-body,#1a1b1e)',
        'border:1px solid rgba(255,255,255,0.09)',
        'border-left:none',
        'border-radius:0 12px 12px 0',
        'box-shadow:4px 0 24px rgba(0,0,0,0.5)',
        'z-index:9998',
        'display:none',
        'flex-direction:column',
        'overflow:hidden',
        'padding:0 0 8px 0',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    // Заголовок — в стиле sidebar
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:14px 18px 12px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.35);letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    hdr.textContent = 'Настройки';
    _panel.appendChild(hdr);

    // ── Пункты ──────────────────────────────────

    // Карта посадки
    addActionRow('Сбросить подсветки',
        '<path d="M4 7h16M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7v-3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M10 12l4 4m0-4l-4 4"/>',
        resetHighlights);

    addActionRow('TV карта (оригинал)',
        '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21l4-4 4 4M12 17v4"/>',
        openOrigTV);

    document.body.appendChild(_panel);
}

function makeRow(){
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:11px 18px;cursor:pointer;transition:background 0.12s;';
    row.addEventListener('mouseenter',function(){ row.style.background='rgba(255,255,255,0.06)'; });
    row.addEventListener('mouseleave',function(){ row.style.background=''; });
    return row;
}

function addActionRow(label, svgPath, onClick){
    var row = makeRow();

    var ico = document.createElement('div');
    ico.style.cssText = 'width:30px;height:30px;border-radius:7px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgba(255,255,255,0.6);';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+svgPath+'</svg>';

    var lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.85);font-weight:500;line-height:1.3;';
    lbl.textContent = label;

    row.appendChild(ico); row.appendChild(lbl);
    row.addEventListener('click', onClick);
    _panel.appendChild(row);
}

function addDivider(){
    var d = document.createElement('div');
    d.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:4px 0;';
    _panel.appendChild(d);
}

function addSectionLabel(text){
    var s = document.createElement('div');
    s.style.cssText = 'padding:10px 18px 4px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:0.8px;text-transform:uppercase;';
    s.textContent = text;
    _panel.appendChild(s);
}

// ── Действия ──────────────────────────────────
function resetHighlights(){
    try{
        localStorage.removeItem('godji_cleanup_pcs');
        localStorage.removeItem('godji_cleanup_state');
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf,.gm-card').forEach(function(c){
            c.style.outline=''; c.style.outlineOffset=''; c.style.boxShadow='';
            var gt=c.querySelector('.gm-timer');
            if(gt){gt.textContent='';gt.style.color='';}
            var gmN=c.querySelector('.gm-nick');if(gmN)gmN.style.display='';
            var gmP=c.querySelector('.gm-pbw');if(gmP)gmP.style.display='';
            var tb=c.querySelector('.godji-timer-bottom');if(tb)tb.remove();
            var ti=c.querySelector('.godji-timer-inline');if(ti)ti.remove();
        });
        document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(r){
            r.style.backgroundColor='';
        });
        showToast('Подсветки сброшены ✓');
    }catch(e){}
}

function openOrigTV(){
    var mc = document.querySelector('.Map_mapContainer__a7ebY');
    if(!mc) return;
    var origEls = Array.from(mc.children).filter(function(ch){return ch.id!=='gm-wrap';});
    origEls.forEach(function(ch){ch.style.visibility='';ch.style.display='';ch.style.pointerEvents='';});
    var origBtn = null;
    mc.querySelectorAll('button').forEach(function(b){
        if(b.textContent.trim().toUpperCase().indexOf('TV')!==-1) origBtn=b;
    });
    if(origBtn) origBtn.click();
    origEls.forEach(function(ch){ch.style.display='none';ch.style.visibility='hidden';ch.style.pointerEvents='none';});
}

function showToast(msg){
    var old=document.getElementById('_settings_toast');
    if(old)old.remove();
    var t=document.createElement('div');
    t.id='_settings_toast';
    t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(25,28,38,0.96);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-family:inherit;font-weight:500;z-index:99999;white-space:nowrap;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);';
    t.textContent=msg;
    document.body.appendChild(t);
    setTimeout(function(){t.style.transition='opacity 0.3s';t.style.opacity='0';},2000);
    setTimeout(function(){t.remove();},2400);
}

// ── Кнопка шестерёнки — вставляем в footer sidebar ────
function createBtn(){
    if(document.getElementById('godji-settings-btn'))return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer)return;

    // Делаем footer position:relative для абсолютного позиционирования
    footer.style.position='relative';

    var btn=document.createElement('button');
    btn.id='godji-settings-btn';
    btn.type='button';
    btn.title='Настройки';
    // Позиция — правый нижний угол footer, на одном уровне с "Гоголя Админ"
    btn.style.cssText='position:absolute;right:12px;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.45);transition:background 0.15s,color 0.15s;z-index:200;padding:0;flex-shrink:0;';
    btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';

    btn.addEventListener('mouseenter',function(){btn.style.background='rgba(255,255,255,0.13)';btn.style.color='rgba(255,255,255,0.85)';});
    btn.addEventListener('mouseleave',function(){
        btn.style.background=_open?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.07)';
        btn.style.color=_open?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.45)';
    });
    btn.addEventListener('click',function(e){e.stopPropagation();togglePanel();});
    footer.appendChild(btn);

    buildPanel();

    // Выравниваем панель по высоте footer
    alignPanel();
}

function alignPanel(){
    if(!_panel)return;
    var footer=document.querySelector('.Sidebar_footer__1BA98');
    if(!footer)return;
    var rect=footer.getBoundingClientRect();
    // Панель выравнивается снизу по низу сайдбара
    var fromBottom = window.innerHeight - rect.bottom;
    _panel.style.bottom = fromBottom + 'px';
}

function togglePanel(){
    if(!_panel)buildPanel();
    _open=!_open;
    alignPanel();
    _panel.style.display=_open?'flex':'none';
    var btn=document.getElementById('godji-settings-btn');
    if(btn){
        btn.style.background=_open?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.07)';
        btn.style.color=_open?'rgba(255,255,255,0.85)':'rgba(255,255,255,0.45)';
    }
}

// Закрытие при клике вне
document.addEventListener('click',function(e){
    if(!_open)return;
    var btn=document.getElementById('godji-settings-btn');
    if(_panel&&!_panel.contains(e.target)&&(!btn||!btn.contains(e.target))){
        _open=false;
        _panel.style.display='none';
        if(btn){btn.style.background='rgba(255,255,255,0.07)';btn.style.color='rgba(255,255,255,0.45)';}
    }
});

// ── Init ──────────────────────────────────────
var _obs=new MutationObserver(function(){
    if(!document.getElementById('godji-settings-btn'))createBtn();
    else alignPanel();
});

if(document.body){
    _obs.observe(document.body,{childList:true,subtree:true});
    setTimeout(createBtn,1000);
    setTimeout(createBtn,3000);
}
window.addEventListener('resize',alignPanel);

})();

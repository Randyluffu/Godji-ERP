// ==UserScript==
// @name         Годжи — Настройки
// @namespace    http://tampermonkey.net/
// @version      3.5
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
        if(!el) return;
        // Скрываем оригинал
        el.style.setProperty('display','none','important');
        // Добавляем прокси в панель если ещё нет
        if(_panelInner && !document.getElementById('_sc_'+id)){
            addToPanel(el);
        }
    });
}

function addToPanel(origEl){
    if(!_panelInner) return;
    if(document.getElementById('_sc_'+origEl.id)) return;

    // Рендерим независимую кнопку в панели, которая проксирует клик на оригинал
    // Оригинал остаётся скрытым в DOM — React продолжает им управлять
    var row = document.createElement('div');
    row.id = '_sc_'+origEl.id;
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:0 12px;height:44px;cursor:pointer;transition:background 0.12s;';
    row.addEventListener('mouseenter',function(){row.style.background='rgba(255,255,255,0.06)';});
    row.addEventListener('mouseleave',function(){row.style.background='';});

    // Иконка — берём из оригинала
    var icoSrc = origEl.querySelector('div[style*="border-radius:8px"],div[style*="border-radius: 8px"],.LinksGroup_themeIcon__E9SRO,.mantine-ThemeIcon-root');
    if(icoSrc){
        var icoClone = icoSrc.cloneNode(true);
        icoClone.style.cssText='width:28px;height:28px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;justify-content:center;';
        row.appendChild(icoClone);
    }

    // Лейбл
    var lbl = document.createElement('span');
    lbl.style.cssText='font-size:13px;color:rgba(255,255,255,0.85);font-weight:500;flex:1;white-space:nowrap;';
    var lblSrc = origEl.querySelector('.mantine-NavLink-label,.m_1f6ac4c4');
    lbl.textContent = lblSrc ? lblSrc.textContent.trim() : (origEl.title || origEl.id);
    row.appendChild(lbl);

    // Тумблер — если в оригинале есть input[type=checkbox] или role=switch
    var toggle = origEl.querySelector('input[type="checkbox"],[role="switch"]');
    if(toggle){
        // Создаём визуальный тумблер который синхронизирован с оригиналом
        var tw = document.createElement('div');
        tw.style.cssText='width:36px;height:20px;border-radius:10px;background:rgba(255,255,255,0.2);flex-shrink:0;position:relative;transition:background 0.2s;cursor:pointer;';
        var th = document.createElement('div');
        th.style.cssText='position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 0.2s;';
        tw.appendChild(th);
        row.appendChild(tw);

        function syncToggle(){
            var checked = toggle.checked || toggle.getAttribute('aria-checked')==='true' || toggle.getAttribute('data-checked')!==null;
            tw.style.background = checked ? '#cc0001' : 'rgba(255,255,255,0.2)';
            th.style.transform = checked ? 'translateX(16px)' : 'translateX(0)';
        }
        syncToggle();
        // Синхронизируем каждые 300мс
        setInterval(syncToggle, 300);

        tw.addEventListener('click',function(e){
            e.stopPropagation();
            // Кликаем оригинальный тумблер
            var origToggle = document.getElementById(origEl.id);
            if(origToggle){
                var t = origToggle.querySelector('input[type="checkbox"],[role="switch"]');
                if(t) t.click();
                else origToggle.click();
            }
            setTimeout(syncToggle, 100);
        });
        // Клик по строке тоже переключает
        row.addEventListener('click',function(e){
            if(e.target===tw||tw.contains(e.target)) return; // уже обработано
            var origToggle = document.getElementById(origEl.id);
            if(origToggle){
                var t = origToggle.querySelector('input[type="checkbox"],[role="switch"]');
                if(t) t.click();
                else origToggle.click();
            }
            setTimeout(syncToggle, 100);
        });
    } else {
        // Обычная кнопка — просто кликаем оригинал
        row.addEventListener('click',function(e){
            e.stopPropagation();
            var orig = document.getElementById(origEl.id);
            if(orig) orig.click();
        });
    }

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
        'width:260px',
        'background:var(--mantine-color-body,#1a1b2e)',
        'border:1px solid rgba(255,255,255,0.08)',
        'border-left:2px solid rgba(255,255,255,0.1)',
        'border-radius:0 10px 10px 0',
        'box-shadow:6px 0 24px rgba(0,0,0,0.6)',
        'z-index:9998',
        'display:none',
        'flex-direction:column',
        'overflow:hidden',
        'font-family:var(--mantine-font-family,inherit)',
    ].join(';');

    var hdr = document.createElement('div');
    hdr.style.cssText='padding:8px 14px 6px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    var hIco = document.createElement('span');
    hIco.style.cssText='color:rgba(255,255,255,0.3);line-height:0;';
    hIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/></svg>';
    var hTxt = document.createElement('span');
    hTxt.style.cssText='font-size:10px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:1.2px;text-transform:uppercase;';
    hTxt.textContent='Настройки';
    hdr.appendChild(hIco); hdr.appendChild(hTxt);
    _panel.appendChild(hdr);

    _panelInner = document.createElement('div');
    _panelInner.id = 'godji-settings-inner';
    _panelInner.style.cssText='display:flex;flex-direction:column;padding:4px 0;';
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

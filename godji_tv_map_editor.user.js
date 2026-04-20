// ==UserScript==
// @name         Годжи — ТВ-карта редактор
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_tv_map_editor.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_tv_map_editor.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// ── Константы ─────────────────────────────────────────────
var STORAGE_KEY = 'godji_tv_editor';
var TV_URL = 'https://godji.cloud/tv/club-map?clubId=14';

// Дефолтные настройки
var DEFAULT = {
    targetW: 1080,
    targetH: 1920,
    rotate: 90,       // поворот карты (0 или 90)
    mapX: 0,          // смещение карты X
    mapY: 0,          // смещение карты Y
    mapScale: 1,      // доп. масштаб
    overlays: []      // наложенные изображения
};

function loadSettings(){
    try{ return Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')); }
    catch(e){ return Object.assign({}, DEFAULT); }
}
function saveSettings(s){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){}
}

var settings = loadSettings();

// ── Определяем где мы ─────────────────────────────────────
var isTV = location.pathname.indexOf('/tv/') !== -1;
var isDashboard = !isTV;

// ═══════════════════════════════════════════════════════════
// РЕЖИМ ТВ-СТРАНИЦЫ — применяем трансформации
// ═══════════════════════════════════════════════════════════
if(isTV){
    applyTVTransforms();
    return;
}

// ═══════════════════════════════════════════════════════════
// РЕЖИМ ДАШБОРДА — перехватываем кнопку ТВ
// ═══════════════════════════════════════════════════════════

function applyTVTransforms(){
    // Ждём загрузки карты
    var attempts = 0;
    var t = setInterval(function(){
        attempts++;
        var wrapper = document.querySelector('.TVMapCanvas_mapWrapper__9iHeN');
        var container = document.querySelector('.TVMapCanvas_tvMapContainer__ufg2s');
        var tvContainer = document.querySelector('.TVClubMap_tvContainer__2QaYx');
        if(wrapper || attempts > 60){ clearInterval(t); if(wrapper) doTransform(wrapper, container, tvContainer); }
    }, 500);
}

function doTransform(wrapper, container, tvContainer){
    var s = loadSettings();
    var tw = s.targetW, th = s.targetH;
    var rot = s.rotate;

    // Оригинальные размеры карты
    var mapW = 1920, mapH = 1133;

    // Масштаб чтобы карта влезла в экран при повороте
    var scaleX, scaleY, finalScale;
    if(rot === 90 || rot === 270){
        // При повороте на 90° ширина и высота меняются местами
        scaleX = th / mapW;
        scaleY = tw / mapH;
    } else {
        scaleX = tw / mapW;
        scaleY = th / mapH;
    }
    finalScale = Math.min(scaleX, scaleY) * s.mapScale;

    // Убираем существующие трансформации ERP
    if(wrapper){
        wrapper.style.transform = '';
        wrapper.style.transformOrigin = '';
    }

    // Создаём обёртку которая заполняет весь экран
    var screenDiv = document.getElementById('godji-tv-screen');
    if(!screenDiv){
        screenDiv = document.createElement('div');
        screenDiv.id = 'godji-tv-screen';
        screenDiv.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;overflow:hidden;background:#000;z-index:0;';
        if(tvContainer) tvContainer.parentNode.insertBefore(screenDiv, tvContainer);
        else document.body.insertBefore(screenDiv, document.body.firstChild);
    }

    // Перемещаем tvContainer внутрь нашего div
    if(tvContainer && tvContainer.parentNode !== screenDiv){
        screenDiv.appendChild(tvContainer);
    }

    // Скрываем скролл
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
    document.body.style.background = '#000';
    if(tvContainer){
        tvContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;';
    }
    if(container){
        container.style.cssText = 'position:relative;';
    }

    // Применяем трансформацию к wrapper
    if(wrapper){
        var tx = tw/2 + s.mapX;
        var ty = th/2 + s.mapY;
        wrapper.style.cssText += ';transform-origin:0 0;transform:translate('+tx+'px,'+ty+'px) rotate('+rot+'deg) scale('+finalScale+') translate(-'+(mapW/2)+'px,-'+(mapH/2)+'px);';
    }

    // Рендерим оверлеи
    renderOverlays(screenDiv, s);
}

function renderOverlays(screenDiv, s){
    // Удаляем старые
    var old = screenDiv.querySelectorAll('.godji-tv-overlay-item');
    old.forEach(function(el){ el.remove(); });

    (s.overlays||[]).forEach(function(ov){
        var el = document.createElement('div');
        el.className = 'godji-tv-overlay-item';
        el.style.cssText = 'position:absolute;z-index:10;'
            + 'left:'+ov.x+'px;top:'+ov.y+'px;'
            + 'width:'+ov.w+'px;height:'+ov.h+'px;'
            + 'pointer-events:none;';
        if(ov.type === 'img' || ov.type === 'gif'){
            var img = document.createElement('img');
            img.src = ov.src;
            img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
            el.appendChild(img);
        }
        screenDiv.appendChild(el);
    });
}

// ═══════════════════════════════════════════════════════════
// ДАШБОРД: перехват кнопки ТВ
// ═══════════════════════════════════════════════════════════

function interceptTVButton(){
    // Ищем кнопку по title
    var btn = document.querySelector('button[title="Открыть ТВ-карту в новом окне"]');
    if(!btn || btn._tvIntercepted) return;
    btn._tvIntercepted = true;

    btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        showTVMenu(btn);
    }, true);
}

function showTVMenu(anchorEl){
    // Закрываем если уже открыто
    var existing = document.getElementById('godji-tv-menu');
    if(existing){ existing.remove(); return; }

    var menu = document.createElement('div');
    menu.id = 'godji-tv-menu';
    var rect = anchorEl.getBoundingClientRect();
    menu.style.cssText = 'position:fixed;z-index:99999;'
        + 'left:'+(rect.left)+'px;top:'+(rect.bottom+6)+'px;'
        + 'background:#1a1b2e;border:1px solid rgba(255,255,255,0.12);'
        + 'border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.5);'
        + 'overflow:hidden;min-width:190px;font-family:var(--mantine-font-family,inherit);';

    function mkItem(icon, label, onClick){
        var item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 14px;'
            + 'cursor:pointer;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;'
            + 'transition:background 0.12s;';
        item.innerHTML = icon + '<span>'+label+'</span>';
        item.addEventListener('mouseenter',function(){ item.style.background='rgba(255,255,255,0.06)'; });
        item.addEventListener('mouseleave',function(){ item.style.background=''; });
        item.addEventListener('click',function(){ menu.remove(); onClick(); });
        return item;
    }

    var iconTV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7m0 2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 3l-4 4-4-4"/></svg>';
    var iconEdit = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

    menu.appendChild(mkItem(iconTV, 'Открыть ТВ-карту', function(){
        window.open(TV_URL, '_blank');
    }));

    var sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:2px 0;';
    menu.appendChild(sep);

    menu.appendChild(mkItem(iconEdit, 'Редактировать карту', function(){
        openEditor();
    }));

    document.body.appendChild(menu);

    // Закрываем по клику снаружи
    setTimeout(function(){
        document.addEventListener('click', function close(e){
            if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('click', close); }
        });
    }, 0);
}

// ═══════════════════════════════════════════════════════════
// РЕДАКТОР
// ═══════════════════════════════════════════════════════════

function openEditor(){
    if(document.getElementById('godji-tv-editor')) return;

    var s = loadSettings();

    var overlay = document.createElement('div');
    overlay.id = 'godji-tv-editor';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99998;display:flex;align-items:center;justify-content:center;';

    var panel = document.createElement('div');
    panel.style.cssText = 'background:#1a1b2e;border:1px solid rgba(255,255,255,0.1);border-radius:14px;'
        + 'width:520px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;'
        + 'overflow:hidden;box-shadow:0 16px 64px rgba(0,0,0,0.6);font-family:var(--mantine-font-family,inherit);';

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';
    hdr.innerHTML = '<div style="display:flex;align-items:center;gap:10px;">'
        + '<div style="width:32px;height:32px;background:#cc0001;border-radius:8px;display:flex;align-items:center;justify-content:center;">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M3 7m0 2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 3l-4 4-4-4"/></svg>'
        + '</div>'
        + '<span style="font-size:15px;font-weight:700;color:#fff;">Редактор ТВ-карты</span>'
        + '</div>'
        + '<button id="gdtv-close" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:20px;padding:0;line-height:1;">×</button>';
    panel.appendChild(hdr);

    // Тело
    var body = document.createElement('div');
    body.style.cssText = 'overflow-y:auto;flex:1;padding:20px;display:flex;flex-direction:column;gap:16px;';

    // Секция настроек экрана
    body.appendChild(mkSection('Размер экрана', [
        mkRow('Ширина (px)', mkNumInput('gdtv-tw', s.targetW, 320, 7680)),
        mkRow('Высота (px)', mkNumInput('gdtv-th', s.targetH, 320, 7680)),
        mkRow('Поворот карты', mkSelect('gdtv-rot', [['0','0°'],['90','90°'],['180','180°'],['270','270°']], String(s.rotate))),
    ]));

    // Секция позиции карты
    body.appendChild(mkSection('Позиция карты', [
        mkRow('Смещение X', mkNumInput('gdtv-mx', s.mapX, -2000, 2000)),
        mkRow('Смещение Y', mkNumInput('gdtv-my', s.mapY, -2000, 2000)),
        mkRow('Масштаб', mkNumInput('gdtv-ms', s.mapScale, 0.1, 5, 0.05)),
    ]));

    // Секция оверлеев
    var overlaySection = document.createElement('div');
    overlaySection.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;';
    overlaySection.innerHTML = '<div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Наложения (изображения / GIF)</div>';
    var overlayList = document.createElement('div');
    overlayList.id = 'gdtv-overlays';
    overlayList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    overlaySection.appendChild(overlayList);

    var addOvBtn = mkBtn('+ Добавить изображение', function(){
        s.overlays = s.overlays || [];
        s.overlays.push({ src:'', x:100, y:100, w:200, h:200, type:'img' });
        renderOverlayList(overlayList, s);
    });
    addOvBtn.style.marginTop = '10px';
    overlaySection.appendChild(addOvBtn);
    body.appendChild(overlaySection);

    renderOverlayList(overlayList, s);
    panel.appendChild(body);

    // Футер
    var footer = document.createElement('div');
    footer.style.cssText = 'padding:14px 20px;border-top:1px solid rgba(255,255,255,0.07);display:flex;gap:10px;flex-shrink:0;';

    var previewBtn = mkBtn('Предпросмотр (новая вкладка)', function(){
        var updated = collectSettings(s);
        saveSettings(updated);
        window.open(TV_URL, '_blank');
    });
    previewBtn.style.cssText += 'flex:1;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.8);';

    var saveBtn = mkBtn('Сохранить', function(){
        var updated = collectSettings(s);
        saveSettings(updated);
        settings = updated;
        overlay.remove();
        showToast('Настройки сохранены');
    });
    saveBtn.style.cssText += 'flex:1;';

    footer.appendChild(previewBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    document.getElementById('gdtv-close').addEventListener('click', function(){ overlay.remove(); });
    overlay.addEventListener('click', function(e){ if(e.target===overlay) overlay.remove(); });
}

function renderOverlayList(container, s){
    container.innerHTML = '';
    (s.overlays||[]).forEach(function(ov, idx){
        var row = document.createElement('div');
        row.style.cssText = 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;';
        row.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">'
            + '<span style="font-size:11px;color:rgba(255,255,255,0.4);font-weight:600;">Изображение '+(idx+1)+'</span>'
            + '<button data-del="'+idx+'" style="margin-left:auto;background:rgba(204,0,1,0.2);border:1px solid rgba(204,0,1,0.3);color:#f87171;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;">Удалить</button>'
            + '</div>'
            + mkFieldHtml('URL изображения / GIF', 'gdtv-ov-src-'+idx, ov.src||'', 'text')
            + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">'
            + mkFieldHtml('X', 'gdtv-ov-x-'+idx, ov.x, 'number')
            + mkFieldHtml('Y', 'gdtv-ov-y-'+idx, ov.y, 'number')
            + mkFieldHtml('Ширина', 'gdtv-ov-w-'+idx, ov.w, 'number')
            + mkFieldHtml('Высота', 'gdtv-ov-h-'+idx, ov.h, 'number')
            + '</div>';

        row.querySelector('[data-del]').addEventListener('click', function(){
            s.overlays.splice(idx, 1);
            renderOverlayList(container, s);
        });
        container.appendChild(row);
    });
}

function collectSettings(s){
    var updated = Object.assign({}, s);
    updated.targetW = parseInt(document.getElementById('gdtv-tw').value)||1080;
    updated.targetH = parseInt(document.getElementById('gdtv-th').value)||1920;
    updated.rotate  = parseInt(document.getElementById('gdtv-rot').value)||0;
    updated.mapX    = parseFloat(document.getElementById('gdtv-mx').value)||0;
    updated.mapY    = parseFloat(document.getElementById('gdtv-my').value)||0;
    updated.mapScale= parseFloat(document.getElementById('gdtv-ms').value)||1;

    // Собираем оверлеи
    updated.overlays = (s.overlays||[]).map(function(ov, idx){
        return {
            src:  (document.getElementById('gdtv-ov-src-'+idx)||{value:ov.src}).value,
            x:    parseFloat((document.getElementById('gdtv-ov-x-'+idx)||{value:ov.x}).value)||0,
            y:    parseFloat((document.getElementById('gdtv-ov-y-'+idx)||{value:ov.y}).value)||0,
            w:    parseFloat((document.getElementById('gdtv-ov-w-'+idx)||{value:ov.w}).value)||200,
            h:    parseFloat((document.getElementById('gdtv-ov-h-'+idx)||{value:ov.h}).value)||200,
            type: ov.type||'img',
        };
    });
    return updated;
}

// ── UI хелперы ────────────────────────────────────────────
var INPUT_CSS = 'width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:7px;padding:7px 10px;color:#fff;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;';

function mkSection(title, rows){
    var sec = document.createElement('div');
    sec.style.cssText = 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;';
    sec.innerHTML = '<div style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">'+title+'</div>';
    rows.forEach(function(r){ sec.appendChild(r); });
    return sec;
}

function mkRow(label, inputEl){
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;';
    var lbl = document.createElement('label');
    lbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.7);white-space:nowrap;';
    lbl.textContent = label;
    inputEl.style.width = '140px';
    row.appendChild(lbl); row.appendChild(inputEl);
    return row;
}

function mkNumInput(id, val, min, max, step){
    var inp = document.createElement('input');
    inp.type = 'number'; inp.id = id;
    inp.value = val; inp.min = min; inp.max = max;
    inp.step = step || 1;
    inp.style.cssText = INPUT_CSS;
    return inp;
}

function mkSelect(id, opts, val){
    var sel = document.createElement('select');
    sel.id = id;
    sel.style.cssText = INPUT_CSS;
    opts.forEach(function(o){
        var opt = document.createElement('option');
        opt.value = o[0]; opt.textContent = o[1];
        if(o[0] === val) opt.selected = true;
        sel.appendChild(opt);
    });
    return sel;
}

function mkFieldHtml(label, id, val, type){
    return '<div style="display:flex;flex-direction:column;gap:3px;">'
        + '<label style="font-size:10px;color:rgba(255,255,255,0.35);font-weight:600;">'+label+'</label>'
        + '<input id="'+id+'" type="'+type+'" value="'+val+'" style="'+INPUT_CSS+'">'
        + '</div>';
}

function mkBtn(label, onClick){
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:#cc0001;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;';
    btn.addEventListener('mouseenter',function(){ btn.style.opacity='.85'; });
    btn.addEventListener('mouseleave',function(){ btn.style.opacity='1'; });
    btn.addEventListener('click', onClick);
    return btn;
}

function showToast(msg){
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:999999;'
        + 'background:#1a1b2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;'
        + 'padding:10px 18px;color:#fff;font-size:13px;font-family:inherit;'
        + 'box-shadow:0 4px 20px rgba(0,0,0,0.4);';
    t.textContent = '✓ ' + msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2500);
}

// ── Init на дашборде ──────────────────────────────────────
var _obs = new MutationObserver(function(){
    interceptTVButton();
});
if(document.body){
    _obs.observe(document.body, {childList:true, subtree:true});
    setTimeout(interceptTVButton, 1000);
    setTimeout(interceptTVButton, 3000);
}

})();

// ==UserScript==
// @name         Годжи — Карта посадки v2 (overlay)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map.user_v2.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map.user_v2.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';
if(window.location.pathname!=='/'&&window.location.pathname!=='')return;

// ─── ПОЗИЦИИ ПК (canvas 1492×522) ────────────────────────────────────────────
// Карточки у которых CRM уже знает позицию — значения из HTML.
// Карточки с left:0;top:0 (CRM не размещает) — наши координаты по планировке.
var POS = {
    // CRM знает:
    '01':{x:698,  y:388},
    '02':{x:632,  y:390},
    '03':{x:632,  y:275},
    '04':{x:705,  y:273},
    '05':{x:780,  y:274},
    '08':{x:1142, y:346},
    '09':{x:1210, y:346},
    '10':{x:1014, y:48},
    '11':{x:1072, y:48},
    '12':{x:1131, y:48},
    '13':{x:1189, y:48},
    '14':{x:1107, y:179},
    '15':{x:1167, y:178},
    '16':{x:1210, y:281},
    '17':{x:1145, y:280},
    // Наши (CRM даёт 0,0):
    // Комната V
    '06':{x:750,  y:190},
    '07':{x:750,  y:230},
    // Комната S/граница
    '41':{x:620,  y:190},
    // TV 1 — комната W
    'TV 1':{x:1080, y:415},
    // Комната T
    '18':{x:510,  y:346},
    '19':{x:510,  y:415},
    // Комната R/E граница
    '20':{x:775,  y:415},
    '21':{x:775,  y:346},
    '22':{x:840,  y:346},
    // Комната E
    '23':{x:870,  y:346},
    '24':{x:870,  y:415},
    // Комната Y
    '25':{x:200,  y:380},
    '26':{x:150,  y:350},
    '27':{x:150,  y:415},
    '28':{x:270,  y:350},
    '29':{x:270,  y:415},
    // Комната O
    '30':{x:350,  y:165},
    '31':{x:350,  y:210},
    '32':{x:285,  y:210},
    '33':{x:145,  y:165},
    '34':{x:145,  y:210},
    '35':{x:210,  y:165},
    // Комната X
    '36':{x:285,  y:100},
    '37':{x:210,  y:100},
    '38':{x:145,  y:100},
    '39':{x:145,  y:50},
    '40':{x:210,  y:50},
};

// ─── SVG ПОДЛОЖКА (viewBox 760×520, растягивается под canvas) ─────────────────
var FLOOR = '701.5,267.0 701.5,476.5 236.5,476.5 72.5,438.5 72.5,260.5 36.5,153.0 36.5,36.0 229.0,36.0 229.0,15.0 555.0,15.0 555.0,161.5 430.5,161.5 430.5,265.0 298.0,265.0 298.0,166.5 430.5,166.5 430.5,267.0 555.0,267.0';
var SHAPES = {
    'Q':'701.3,269.0 699.1,266.8 630.3,266.8 628.1,269.0 628.1,271.2 632.5,275.5 632.5,300.6 628.1,305.0 628.1,459.8 630.2,462.0 699.1,462.0 701.3,459.8',
    'W':'622.0,324.9 622.0,319.5 620.1,317.5 553.0,317.5 549.2,321.4 527.8,321.4 524.0,317.5 521.2,319.5 521.2,460.0 523.2,462.0 620.1,462.0 622.0,460.0',
    'E':'514.2,324.9 514.2,319.5 512.2,317.5 462.2,317.5 458.3,321.4 437.0,321.4 433.1,317.5 430.4,319.5 430.4,459.9 432.4,461.9 512.2,461.9 514.2,459.9',
    'R':'423.5,324.9 423.5,319.7 421.3,317.5 418.2,317.5 414.0,321.8 391.1,321.8 386.8,317.5 341.7,319.7 341.7,459.8 343.8,461.9 421.3,461.9 423.4,459.8',
    'T':'334.6,324.9 334.6,319.7 332.5,317.5 326.3,317.5 322.0,321.8 299.1,321.8 294.9,317.5 236.5,319.7 236.5,474.3 238.6,476.5 332.4,476.5 334.6,474.3',
    'Y':'227.5,260.7 74.9,260.7 72.8,262.8 72.7,371.7 74.9,377.0 132.4,436.2 137.9,438.5 227.5,438.5 229.7,436.3 229.7,307.0 225.3,302.6 225.3,279.2 229.7,274.8 229.6,262.8',
    'L':'554.8,17.3 552.3,14.8 444.5,14.8 442.0,17.3 442.0,125.9 447.1,130.9 447.1,153.0 442.0,158.0 442.0,161.5 444.5,164.0 552.3,164.0 554.8,161.5',
    'V':'430.2,171.6 430.2,167.9 428.4,166.5 381.8,166.5 378.1,169.2 357.0,168.8 352.1,173.7 352.1,263.8 353.9,265.1 428.4,265.1 430.2,263.8',
    'S':'342.6,265.1 346.1,264.6 347.1,263.0 347.1,168.3 343.1,166.1 298.1,168.3 298.1,263.0 299.1,264.6 301.1,265.1',
    'O':'227.4,184.7 225.2,182.5 225.2,163.6 229.6,159.2 229.6,155.1 227.4,152.9 38.8,152.9 36.6,155.1 36.6,251.5 38.8,253.7 227.4,253.7 229.6,251.5 229.6,186.9',
    'X':'200.0,36.1 228.9,63.9 229.6,65.5 229.6,110.9 225.2,114.9 225.2,137.1 229.6,141.1 229.6,144.2 227.6,146.2 38.6,146.2 36.6,144.2 36.6,70.9 38.6,68.9 89.8,68.9 91.8,66.9 91.8,37.5 93.8,35.5 198.5,35.5',
};
var ROOMS = [
    {id:'Q',x:628,y:267,w:73,h:195},{id:'W',x:521,y:318,w:101,h:144},
    {id:'E',x:430,y:318,w:84,h:144},{id:'R',x:342,y:318,w:82,h:144},
    {id:'T',x:236,y:318,w:98,h:159},{id:'Y',x:73,y:261,w:157,h:178},
    {id:'L',x:442,y:15,w:113,h:149},{id:'V',x:352,y:166,w:78,h:99},
    {id:'S',x:298,y:166,w:49,h:99},{id:'O',x:37,y:153,w:193,h:101},
    {id:'X',x:37,y:36,w:193,h:111},
];

function buildSVG(w, h){
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 760 520');
    svg.setAttribute('preserveAspectRatio','none');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:'+w+'px;height:'+h+'px;pointer-events:none;z-index:0;overflow:visible;';

    function poly(pts,fill,stroke,sw,dx,dy){
        var el=document.createElementNS(ns,'polygon');
        el.setAttribute('points',pts); el.setAttribute('fill',fill);
        if(stroke){el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',sw||'1.5');}
        if(dx||dy)el.setAttribute('transform','translate('+(dx||0)+','+(dy||0)+')');
        return el;
    }
    // Пол
    svg.appendChild(poly(FLOOR,'rgba(0,0,0,0.12)',null,null,4,4));
    svg.appendChild(poly(FLOOR,'rgba(195,210,235,0.55)','rgba(155,175,215,0.5)','2'));
    // Комнаты
    ROOMS.forEach(function(r){
        svg.appendChild(poly(SHAPES[r.id],'rgba(0,0,0,0.09)',null,null,3,3));
        svg.appendChild(poly(SHAPES[r.id],'rgba(255,255,255,0.82)','rgba(170,188,220,0.65)','1.5'));
        var t=document.createElementNS(ns,'text');
        t.setAttribute('x',r.x+r.w+2); t.setAttribute('y',r.y+r.h);
        t.setAttribute('text-anchor','start');
        t.setAttribute('fill','rgba(60,85,150,0.85)');
        t.setAttribute('font-size','18'); t.setAttribute('font-weight','800');
        t.setAttribute('font-family','-apple-system,BlinkMacSystemFont,sans-serif');
        t.setAttribute('paint-order','stroke');
        t.setAttribute('stroke','rgba(255,255,255,0.75)'); t.setAttribute('stroke-width','3');
        t.setAttribute('pointer-events','none'); t.style.userSelect='none';
        t.textContent=r.id; svg.appendChild(t);
    });
    return svg;
}

// ─── ПОЗИЦИОНИРОВАНИЕ КАРТОЧЕК ────────────────────────────────────────────────
// Принудительно выставляем позицию для всех ПК из POS.
// Если у карточки нет записи в POS — не трогаем (пусть CRM решает).
function repositionCards(layer){
    layer.querySelectorAll('.DeviceItem_deviceContainer__jCrmD').forEach(function(el){
        var nameEl = el.querySelector('.DeviceItem_deviceName__yC1tT');
        if(!nameEl) return;
        var name = nameEl.textContent.trim();
        var pos = POS[name];
        if(!pos) return;
        el.style.left = pos.x+'px';
        el.style.top  = pos.y+'px';
        if(!el.style.zIndex) el.style.zIndex = '1';
    });
}

// ─── ИНЖЕКЦИЯ ────────────────────────────────────────────────────────────────
var _injected = false, _svg = null, _reposTimer = null;

function inject(){
    if(_injected) return;
    var layer = document.querySelector('.MapCanvas_devicesLayer__vzjYe');
    if(!layer || layer.getBoundingClientRect().width < 10) return;
    _injected = true;

    var w = parseInt(layer.style.width)  || layer.offsetWidth  || 1492;
    var h = parseInt(layer.style.height) || layer.offsetHeight || 522;

    // SVG — первым ребёнком (ниже всех карточек)
    _svg = buildSVG(w, h);
    layer.insertBefore(_svg, layer.firstChild);

    repositionCards(layer);

    // React добавляет/обновляет карточки → репозиционируем
    new MutationObserver(function(muts){
        var dirty = false;
        muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
                if(n.nodeType===1&&n.classList&&
                   n.classList.contains('DeviceItem_deviceContainer__jCrmD')) dirty=true;
            });
            if(m.type==='attributes'&&m.target.classList&&
               m.target.classList.contains('DeviceItem_deviceContainer__jCrmD')) dirty=true;
        });
        if(dirty){
            clearTimeout(_reposTimer);
            _reposTimer=setTimeout(function(){repositionCards(layer);},30);
        }
    }).observe(layer,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});

    // Страховочный polling (React иногда сбрасывает стили вне MO)
    setInterval(function(){repositionCards(layer);},1200);

    // Обновляем размер SVG при ресайзе canvas
    new ResizeObserver(function(){
        var nw=parseInt(layer.style.width)||layer.offsetWidth;
        var nh=parseInt(layer.style.height)||layer.offsetHeight;
        if(_svg){_svg.style.width=nw+'px';_svg.style.height=nh+'px';}
    }).observe(layer);
}

// ─── ЗАПУСК / SPA ────────────────────────────────────────────────────────────
new MutationObserver(function(){if(!_injected)inject();})
    .observe(document.body,{childList:true,subtree:true});
[300,1000,2500,5000].forEach(function(t){setTimeout(inject,t);});

var _op=history.pushState;
history.pushState=function(){
    _op.apply(this,arguments);
    _injected=false; _svg=null;
    setTimeout(inject,800);
};

})();

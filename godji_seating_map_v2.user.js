// ==UserScript==
// @name         Годжи — Карта посадки v2 (overlay)
// @namespace    http://tampermonkey.net/
// @version      2.4
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map_v2.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map_v2.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

// ── Позиции карточек в пикселях CRM-карты ─────────────────────────────
var POS = {
    '01':{x:698,y:388},'02':{x:632,y:390},'03':{x:632,y:275},'04':{x:705,y:273},'05':{x:780,y:274},
    '06':{x:870,y:475},'07':{x:946,y:477},
    '08':{x:1142,y:346},'09':{x:1210,y:346},
    '10':{x:1014,y:48},'11':{x:1072,y:48},'12':{x:1131,y:48},'13':{x:1189,y:48},
    '14':{x:1107,y:179},'15':{x:1167,y:178},'16':{x:1210,y:281},'17':{x:1145,y:280},
    '18':{x:1206,y:621},'19':{x:1269,y:621},
    '20':{x:1247,y:718},'21':{x:1181,y:718},'22':{x:1116,y:718},
    '23':{x:1105,y:782},'24':{x:1178,y:782},
    '25':{x:1191,y:908},'26':{x:1137,y:954},
    '27':{x:1004,y:905},'28':{x:1060,y:882},'29':{x:1003,y:852},
    '30':{x:933,y:838},'31':{x:933,y:899},'32':{x:934,y:963},
    '33':{x:839,y:1018},'34':{x:837,y:945},'35':{x:838,y:882},
    '36':{x:769,y:883},'37':{x:769,y:946},'38':{x:769,y:1017},
    '39':{x:642,y:931},'40':{x:642,y:865},
    '41':{x:859,y:615},
    'TV 1':{x:1173,y:492},
};

// ── Геометрия комнат (SVG-пространство 760×520) ────────────────────────
var FLOOR='701.5,267.0 701.5,476.5 236.5,476.5 72.5,438.5 72.5,260.5 36.5,153.0 36.5,36.0 229.0,36.0 229.0,15.0 555.0,15.0 555.0,161.5 430.5,161.5 430.5,265.0 298.0,265.0 298.0,166.5 430.5,166.5 430.5,267.0 555.0,267.0';
var SHAPES={
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

// Центры комнат для подписей (в SVG-координатах)
var ROOM_LABELS={
    'Q':{x:664,y:360},'W':{x:571,y:390},'E':{x:472,y:390},
    'R':{x:382,y:390},'T':{x:285,y:400},'Y':{x:150,y:350},
    'L':{x:498,y:88},'V':{x:390,y:215},'S':{x:322,y:215},
    'O':{x:132,y:203},'X':{x:132,y:91},
};

// ── SVG для ГЛАВНОЙ карты ─────────────────────────────────────────────
// Canvas CRM всегда 1492×522 (layer.style задаётся React).
// Карточки расположены в пространстве 1492×(до 1100, overflow).
// SVG-геометрия комнат: пространство 760×520.
//
// Задача: нарисовать SVG поверх так чтобы комнаты были НЕ искажены (uniform scale),
// и примерно совпадали с расположением карточек.
//
// Якорные точки (комната → карточки):
//   SVG L center (498, 88) → ПК 10-13 center (1101, 48)
//   SVG Q center (665, 364) → ПК 08-09 center (1176, 346)
//   SVG R center (383, 390) → ПК 01-02 center (665, 389)
//
// По X: (1101-665)/(498-383) = 436/115 = 3.79 — слишком большой (L и R рядом по X в SVG, далеко в POS)
// Значит комнаты в SVG X не соответствуют POS X напрямую.
//
// Смотрим иначе: SVG горизонтальный (760px), POS тоже горизонтальный (1492px).
// Карточки 10-13 (x~1100) — правый верх. SVG L (x~498) — правый верх. ОК.
// Карточки 01-02 (x~665) — левый центр. SVG R (x~383) — левый центр. ОК.
// Значит X масштаб: POS_x = SVG_x * kx + tx
//   kx = (1100-665)/(498-383) = 435/115 = 3.78 -- это неверно физически
//
// СТОП. Перечитаем: CRM layer — 1492px wide. Но карточки 01-02 сидят на x=665.
// Значит левый край карточек начинается примерно от x=632.
// SVG left edge: x=36. SVG right edge: x=702. Span = 666px.
// POS left: x=632, POS right: x=1269. Span = 637px.
// Это почти одинаково! kx ≈ 637/666 ≈ 0.957. tx = 632 - 36*0.957 = 597.
//
// По Y: POS top: y=48, POS bottom: y=1018. Span=970.
//   SVG top: y=15, SVG bottom: y=477. Span=462.
//   ky = 970/462 = 2.10. ty = 48 - 15*2.10 = 16.5
//
// Uniform scale = min(kx,ky) = 0.957, тогда высота SVG = 462*0.957+16 = 458px (не покроет y=1018).
// Значит uniform scale невозможен при таком диапазоне Y.
//
// РЕШЕНИЕ: использовать uniform scale = kx ≈ 0.957, tx=597, ty=16.
// SVG покроет y:[16, 16+477*0.957] = [16, 473] — только верхнюю часть canvas.
// Нижние карточки (18-41) окажутся ниже SVG-фона — это нормально, фон для верхней части.
// ИЛИ увеличить scale чтобы покрыть больше: scale=2.10, tx=597, ty=16 — но тогда искажение.
//
// КОМПРОМИСС: uniform scale = 1.5 (между 0.957 и 2.10).
// SVG покроет y:[16, 16+477*1.5] = [16, 732] — покрывает большинство карточек.
// По X: SVG покроет x:[597, 597+666*1.5] = [597, 1596] — немного шире нужного.
// Сдвинем: tx = 632 - 36*1.5 = 578.
//
// Финал: uniform scale = 1.5, tx=578, ty=16.

var SVG_SC = 1.5;   // единый масштаб — комнаты не искажаются
var SVG_TX = 578;   // сдвиг X: SVG(36) → canvas(632)
var SVG_TY = 16;    // сдвиг Y: SVG(15) → canvas(39)

function buildSVGMain(cw, ch){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 '+cw+' '+ch);
    svg.style.cssText='position:absolute;top:0;left:0;width:'+cw+'px;height:'+ch+'px;pointer-events:none;z-index:0;overflow:visible;';

    var sw=1.5/SVG_SC;

    var g=document.createElementNS(ns,'g');
    g.setAttribute('transform','translate('+SVG_TX+','+SVG_TY+') scale('+SVG_SC+')');

    function poly(pts,fill,stroke,strokeW,dx,dy){
        var el=document.createElementNS(ns,'polygon');
        el.setAttribute('points',pts);
        el.setAttribute('fill',fill);
        if(stroke){el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',strokeW||sw);}
        if(dx||dy)el.setAttribute('transform','translate('+(dx||0)+','+(dy||0)+')');
        return el;
    }

    g.appendChild(poly(FLOOR,'rgba(0,0,0,0.12)',null,null,4,4));
    g.appendChild(poly(FLOOR,'rgba(195,210,235,0.50)','rgba(130,155,200,0.45)',sw));

    Object.keys(SHAPES).forEach(function(id){
        g.appendChild(poly(SHAPES[id],'rgba(0,0,0,0.07)',null,null,2,2));
        g.appendChild(poly(SHAPES[id],'rgba(255,255,255,0.78)','rgba(160,180,215,0.60)',sw));
    });

    Object.keys(ROOM_LABELS).forEach(function(id){
        var lbl=ROOM_LABELS[id];
        var t=document.createElementNS(ns,'text');
        t.setAttribute('x',lbl.x);
        t.setAttribute('y',lbl.y);
        t.setAttribute('text-anchor','middle');
        t.setAttribute('dominant-baseline','middle');
        t.setAttribute('fill','rgba(50,75,140,0.90)');
        t.setAttribute('font-size',20/SVG_SC);
        t.setAttribute('font-weight','800');
        t.setAttribute('font-family','-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif');
        t.setAttribute('paint-order','stroke');
        t.setAttribute('stroke','rgba(255,255,255,0.85)');
        t.setAttribute('stroke-width',5/SVG_SC);
        t.setAttribute('pointer-events','none');
        t.setAttribute('letter-spacing',0.5/SVG_SC);
        t.style.userSelect='none';
        t.textContent=id;
        g.appendChild(t);
    });

    svg.appendChild(g);
    return svg;
}

// ── SVG для TV карты ──────────────────────────────────────────────────
function buildSVGTV(cw, ch){
    var ns='http://www.w3.org/2000/svg';
    var svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox','0 0 '+cw+' '+ch);
    svg.style.cssText='position:absolute;top:0;left:0;width:'+cw+'px;height:'+ch+'px;pointer-events:none;z-index:0;overflow:visible;';

    var sw=1.5/SVG_SC;
    var g=document.createElementNS(ns,'g');
    g.setAttribute('transform','translate('+SVG_TX+','+SVG_TY+') scale('+SVG_SC+')');

    function poly(pts,fill,stroke,strokeW,dx,dy){
        var el=document.createElementNS(ns,'polygon');
        el.setAttribute('points',pts);
        el.setAttribute('fill',fill);
        if(stroke){el.setAttribute('stroke',stroke);el.setAttribute('stroke-width',strokeW||sw);}
        if(dx||dy)el.setAttribute('transform','translate('+(dx||0)+','+(dy||0)+')');
        return el;
    }

    g.appendChild(poly(FLOOR,'rgba(0,0,0,0.30)',null,null,3,3));
    g.appendChild(poly(FLOOR,'rgba(30,40,65,0.70)','rgba(80,110,180,0.50)',sw));

    Object.keys(SHAPES).forEach(function(id){
        g.appendChild(poly(SHAPES[id],'rgba(0,0,0,0.20)',null,null,2,2));
        g.appendChild(poly(SHAPES[id],'rgba(20,30,55,0.75)','rgba(70,100,170,0.55)',sw));
    });

    Object.keys(ROOM_LABELS).forEach(function(id){
        var lbl=ROOM_LABELS[id];
        var t=document.createElementNS(ns,'text');
        t.setAttribute('x',lbl.x);
        t.setAttribute('y',lbl.y);
        t.setAttribute('text-anchor','middle');
        t.setAttribute('dominant-baseline','middle');
        t.setAttribute('fill','rgba(140,180,255,0.90)');
        t.setAttribute('font-size',20/SVG_SC);
        t.setAttribute('font-weight','800');
        t.setAttribute('font-family','-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif');
        t.setAttribute('paint-order','stroke');
        t.setAttribute('stroke','rgba(10,15,35,0.90)');
        t.setAttribute('stroke-width',5/SVG_SC);
        t.setAttribute('pointer-events','none');
        t.style.userSelect='none';
        t.textContent=id;
        g.appendChild(t);
    });

    svg.appendChild(g);
    return svg;
}

// ── Перемещение карточек CRM ──────────────────────────────────────────
function repositionCards(layer){
    layer.querySelectorAll('.DeviceItem_deviceContainer__jCrmD').forEach(function(el){
        var nameEl=el.querySelector('.DeviceItem_deviceName__yC1tT');
        if(!nameEl)return;
        var pos=POS[nameEl.textContent.trim()];
        if(!pos)return;
        el.style.left=pos.x+'px';
        el.style.top=pos.y+'px';
        if(!el.style.zIndex)el.style.zIndex='1';
    });
}

// ── TV inject ─────────────────────────────────────────────────────────
function injectTV(tvLayer){
    if(tvLayer._gmDone)return;

    var wrapper=tvLayer.closest('.TVMapCanvas_mapWrapper__9iHeN');
    var cw=wrapper?parseInt(wrapper.style.width)||1492:1492;
    var ch=wrapper?parseInt(wrapper.style.height)||800:800;
    ch=Math.max(ch,800);

    tvLayer.style.position='relative';

    // Ждём появления карточек чтобы точно подогнать SVG
    function doInject(){
        if(tvLayer._gmDone)return;
        var cards=tvLayer.querySelectorAll('.DeviceItem_deviceContainer__jCrmD');
        if(cards.length<2){
            setTimeout(doInject,300);
            return;
        }
        tvLayer._gmDone=true;
        var old=tvLayer.querySelector('svg[data-gm]');
        if(old)old.remove();
        var svg=buildSVGTV(cw,ch);
        svg.setAttribute('data-gm','1');
        tvLayer.insertBefore(svg,tvLayer.firstChild);
    }
    doInject();
}

// ── Главная карта inject ──────────────────────────────────────────────
var _injected=false,_svg=null;

function inject(){
    if(_injected)return;
    var layer=document.querySelector('.MapCanvas_devicesLayer__vzjYe');
    if(!layer)return;

    // Читаем ширину — CRM всегда выставляет "1492px" в style
    var cw=parseInt(layer.style.width);
    if(!cw||cw<100){
        // Style ещё не выставлен React'ом — подождём
        setTimeout(inject, 200);
        return;
    }
    _injected=true;

    var ch=1100; // overflow: карточки уходят до y≈1018+82px карточки
    layer.style.height=ch+'px';
    layer.style.overflow='visible';

    _svg=buildSVGMain(cw,ch);
    layer.insertBefore(_svg,layer.firstChild);
    repositionCards(layer);

    var rt=null;
    new MutationObserver(function(muts){
        var d=false;
        muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
                if(n.nodeType===1&&n.classList&&n.classList.contains('DeviceItem_deviceContainer__jCrmD'))d=true;
            });
            if(m.type==='attributes'&&m.target.classList&&m.target.classList.contains('DeviceItem_deviceContainer__jCrmD'))d=true;
        });
        if(d){clearTimeout(rt);rt=setTimeout(function(){repositionCards(layer);},30);}
    }).observe(layer,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
    setInterval(function(){repositionCards(layer);},1200);
}

    var rt=null;
    new MutationObserver(function(muts){
        var d=false;
        muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
                if(n.nodeType===1&&n.classList&&n.classList.contains('DeviceItem_deviceContainer__jCrmD'))d=true;
            });
            if(m.type==='attributes'&&m.target.classList&&m.target.classList.contains('DeviceItem_deviceContainer__jCrmD'))d=true;
        });
        if(d){clearTimeout(rt);rt=setTimeout(function(){repositionCards(layer);},30);}
    }).observe(layer,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
    setInterval(function(){repositionCards(layer);},1200);
}

function tryAll(){
    if(!_injected)inject();
    var tv=document.querySelector('.TVMapCanvas_devicesLayer__4NfZg');
    if(tv&&!tv._gmDone)injectTV(tv);
}

new MutationObserver(tryAll).observe(document.body,{childList:true,subtree:true});
[300,1000,2500,5000].forEach(function(t){setTimeout(tryAll,t);});
var _op=history.pushState;
history.pushState=function(){_op.apply(this,arguments);_injected=false;_svg=null;setTimeout(tryAll,800);};

})();

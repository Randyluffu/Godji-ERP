// ==UserScript==
// @name         Годжи — Карта посадки v2.5
// @version      2.5
// @match        https://godji.cloud/*
// @grant        none
// ==/UserScript==
(function(){
'use strict';
if(window.location.pathname!=='/' && !window.location.pathname.includes('/tv/')) return;

const POS = {'01':{x:698,y:388},'02':{x:632,y:390},'03':{x:632,y:275},'04':{x:705,y:273},'05':{x:780,y:274},'06':{x:870,y:475},'07':{x:946,y:477},'08':{x:1142,y:346},'09':{x:1210,y:346},'10':{x:1014,y:48},'11':{x:1072,y:48},'12':{x:1131,y:48},'13':{x:1189,y:48},'14':{x:1107,y:179},'15':{x:1167,y:178},'16':{x:1210,y:281},'17':{x:1145,y:280},'18':{x:1206,y:621},'19':{x:1269,y:621},'20':{x:1247,y:718},'21':{x:1181,y:718},'22':{x:1116,y:718},'23':{x:1105,y:782},'24':{x:1178,y:782},'25':{x:1191,y:908},'26':{x:1137,y:954},'27':{x:1004,y:905},'28':{x:1060,y:882},'29':{x:1003,y:852},'30':{x:933,y:838},'31':{x:933,y:899},'32':{x:934,y:963},'33':{x:839,y:1018},'34':{x:837,y:945},'35':{x:838,y:882},'36':{x:769,y:883},'37':{x:769,y:946},'38':{x:769,y:1017},'39':{x:642,y:931},'40':{x:642,y:865},'41':{x:859,y:615},'TV 1':{x:1173,y:492}};
const FLOOR='701.5,267.0 701.5,476.5 236.5,476.5 72.5,438.5 72.5,260.5 36.5,153.0 36.5,36.0 229.0,36.0 229.0,15.0 555.0,15.0 555.0,161.5 430.5,161.5 430.5,265.0 298.0,265.0 298.0,166.5 430.5,166.5 430.5,267.0 555.0,267.0';
const SHAPES={'Q':'701.3,269.0 699.1,266.8 630.3,266.8 628.1,269.0 628.1,271.2 632.5,275.5 632.5,300.6 628.1,305.0 628.1,459.8 630.2,462.0 699.1,462.0 701.3,459.8','W':'622.0,324.9 622.0,319.5 620.1,317.5 553.0,317.5 549.2,321.4 527.8,321.4 524.0,317.5 521.2,319.5 521.2,460.0 523.2,462.0 620.1,462.0 622.0,460.0','E':'514.2,324.9 514.2,319.5 512.2,317.5 462.2,317.5 458.3,321.4 437.0,321.4 433.1,317.5 430.4,319.5 430.4,459.9 432.4,461.9 512.2,461.9 514.2,459.9','R':'423.5,324.9 423.5,319.7 421.3,317.5 418.2,317.5 414.0,321.8 391.1,321.8 386.8,317.5 341.7,319.7 341.7,459.8 343.8,461.9 421.3,461.9 423.4,459.8','T':'334.6,324.9 334.6,319.7 332.5,317.5 326.3,317.5 322.0,321.8 299.1,321.8 294.9,317.5 236.5,319.7 236.5,474.3 238.6,476.5 332.4,476.5 334.6,474.3','Y':'227.5,260.7 74.9,260.7 72.8,262.8 72.7,371.7 74.9,377.0 132.4,436.2 137.9,438.5 227.5,438.5 229.7,436.3 229.7,307.0 225.3,302.6 225.3,279.2 229.7,274.8 229.6,262.8','L':'554.8,17.3 552.3,14.8 444.5,14.8 442.0,17.3 442.0,125.9 447.1,130.9 447.1,153.0 442.0,158.0 442.0,161.5 444.5,164.0 552.3,164.0 554.8,161.5','V':'430.2,171.6 430.2,167.9 428.4,166.5 381.8,166.5 378.1,169.2 357.0,168.8 352.1,173.7 352.1,263.8 353.9,265.1 428.4,265.1 430.2,263.8','S':'342.6,265.1 346.1,264.6 347.1,263.0 347.1,168.3 343.1,166.1 298.1,168.3 298.1,263.0 299.1,264.6 301.1,265.1','O':'227.4,184.7 225.2,182.5 225.2,163.6 229.6,159.2 229.6,155.1 227.4,152.9 38.8,152.9 36.6,155.1 36.6,251.5 38.8,253.7 227.4,253.7 229.6,251.5 229.6,186.9','X':'200.0,36.1 228.9,63.9 229.6,65.5 229.6,110.9 225.2,114.9 225.2,137.1 229.6,141.1 229.6,144.2 227.6,146.2 38.6,146.2 36.6,144.2 36.6,70.9 38.6,68.9 89.8,68.9 91.8,66.9 91.8,37.5 93.8,35.5 198.5,35.5'};

function buildSVG(cw, ch){
    let ns='http://www.w3.org/2000/svg';
    let svg=document.createElementNS(ns,'svg');
    svg.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
    svg.style.cssText='position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';

    let g=document.createElementNS(ns,'g');
    // Динамический подгон масштаба под область карточек
    let sx = cw / 850, sy = ch / 500; 
    g.setAttribute('transform', `scale(${sx},${sy}) translate(-20, 10)`);

    function poly(pts, fill, stroke){
        let p=document.createElementNS(ns,'polygon');
        p.setAttribute('points', pts);
        p.setAttribute('fill', fill);
        if(stroke) { p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', '1'); }
        return p;
    }

    g.appendChild(poly(FLOOR, 'rgba(195,210,235,0.3)', 'rgba(155,175,215,0.4)'));
    Object.values(SHAPES).forEach(s => g.appendChild(poly(s, 'rgba(255,255,255,0.8)', 'rgba(170,188,220,0.5)')));
    
    svg.appendChild(g);
    return svg;
}

function reposition(layer){
    layer.querySelectorAll('.DeviceItem_deviceContainer__jCrmD').forEach(el => {
        let name = el.querySelector('.DeviceItem_deviceName__yC1tT')?.textContent.trim();
        if(POS[name]){
            el.style.left = POS[name].x + 'px';
            el.style.top = POS[name].y + 'px';
            el.style.position = 'absolute';
        }
    });
}

function init(){
    let layer = document.querySelector('.MapCanvas_devicesLayer__vzjYe') || document.querySelector('.TVMapCanvas_devicesLayer__4NfZg');
    if(!layer || layer._done) return;
    layer._done = true;
    
    let cw = layer.offsetWidth || 1500;
    let ch = layer.offsetHeight || 1000;
    layer.style.position = 'relative';
    layer.insertBefore(buildSVG(cw, ch), layer.firstChild);
    
    reposition(layer);
    new MutationObserver(() => reposition(layer)).observe(layer, {childList:true, subtree:true});
}

setInterval(init, 1000);
})();

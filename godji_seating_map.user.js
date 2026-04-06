// ==UserScript==
// @name         Годжи — Карта посадки
// @namespace    http://tampermonkey.net/
// @version      13.2
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_seating_map.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';
if(window.location.pathname!=='/'&&window.location.pathname!=='')return;

var SK='godji_map_v12';
var CW=42,CH=42;
var SNAP=8; // сетка выравнивания (Shift)

var ROOMS_ADM=[
    {id:'Q',x:628,y:267,w:73, h:195},
    {id:'W',x:521,y:318,w:101,h:144},
    {id:'E',x:430,y:318,w:84, h:144},
    {id:'R',x:342,y:318,w:82, h:144},
    {id:'T',x:236,y:318,w:98, h:159},
    {id:'Y',x:73, y:261,w:157,h:178},
    {id:'L',x:442,y:15, w:113,h:149},
    {id:'V',x:352,y:166,w:78, h:99},
    {id:'S',x:298,y:166,w:49, h:99},
    {id:'O',x:37, y:153,w:193,h:101},
    {id:'X',x:37, y:36, w:193,h:111},
];
var ROOM_SHAPES={
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
var FLOOR='701.5,267.0 701.5,476.5 236.5,476.5 72.5,438.5 72.5,260.5 36.5,153.0 36.5,36.0 229.0,36.0 229.0,15.0 555.0,15.0 555.0,161.5 430.5,161.5 430.5,265.0 298.0,265.0 298.0,166.5 430.5,166.5 430.5,267.0 555.0,267.0';
var DEFAULT_POS={
    '10':{x:650,y:270},'11':{x:650,y:316},'12':{x:650,y:360},'13':{x:650,y:406},
    '14':{x:572,y:321},'15':{x:572,y:366},'16':{x:524,y:411},'17':{x:524,y:366},
    '08':{x:463,y:343},'09':{x:463,y:388},'TV 1':{x:358,y:368},
    '18':{x:284,y:380},'19':{x:284,y:425},
    '20':{x:240,y:411},'21':{x:240,y:366},'22':{x:240,y:321},
    '23':{x:179,y:321},'24':{x:179,y:366},
    '25':{x:110,y:385},'29':{x:150,y:261},'26':{x:78,y:352},'28':{x:107,y:261},'27':{x:74,y:300},
    '03':{x:504,y:18},'04':{x:504,y:63},'05':{x:504,y:108},
    '01':{x:445,y:64},'02':{x:445,y:18},
    '06':{x:380,y:169},'07':{x:380,y:214},'41':{x:300,y:169},
    '30':{x:176,y:203},'35':{x:132,y:156},'31':{x:132,y:203},
    '34':{x:86,y:156},'32':{x:86,y:203},'33':{x:42,y:156},
    '40':{x:140,y:38},'36':{x:130,y:95},'39':{x:95,y:38},'37':{x:85,y:95},'38':{x:40,y:95},
};

var _pos={},_injected=false,_dragMode=false,_shiftDown=false;
var _vx=0,_vy=0,_lastX=0,_lastY=0,_raf=null;
var _dragging=null,_dsx,_dsy,_dox,_doy;
var _panning=false,_psx,_psy,_ptx,_pty;
var _sc=0.88,_tx=15,_ty=12;
var _layer=null,_wrap=null,_cards={},_timer=null;

function snapVal(v){return Math.round(v/SNAP)*SNAP;}
function loadPos(){try{_pos=Object.assign({},DEFAULT_POS,JSON.parse(localStorage.getItem(SK)||'{}'));}catch(e){_pos=Object.assign({},DEFAULT_POS);}}
function savePos(){try{localStorage.setItem(SK,JSON.stringify(_pos));}catch(e){}}
function sess(){return window._godjiSessionsData||{};}
function applyT(){if(_layer)_layer.style.transform='translate('+_tx+'px,'+_ty+'px) scale('+_sc+')';}

// Shift tracking
document.addEventListener('keydown',function(e){if(e.key==='Shift')_shiftDown=true;});
document.addEventListener('keyup',function(e){if(e.key==='Shift')_shiftDown=false;});

// --- SVG фон ---
function buildSVG(){
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.style.cssText='position:absolute;top:0;left:0;width:760px;height:520px;pointer-events:none;overflow:visible;user-select:none;-webkit-user-select:none;';

    // Тень подложки
    var fpsh=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    fpsh.setAttribute('points',FLOOR);
    fpsh.setAttribute('transform','translate(4,4)');
    fpsh.setAttribute('fill','rgba(0,0,0,0.12)');
    svg.appendChild(fpsh);

    // Подложка здания
    var fp=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    fp.setAttribute('points',FLOOR);
    fp.setAttribute('fill','rgba(195,210,235,0.65)');
    fp.setAttribute('stroke','rgba(155,175,215,0.55)');
    fp.setAttribute('stroke-width','2');
    svg.appendChild(fp);

    // Комнаты
    ROOMS_ADM.forEach(function(r){
        var pts=ROOM_SHAPES[r.id];
        // Тень
        var sh=document.createElementNS('http://www.w3.org/2000/svg','polygon');
        sh.setAttribute('points',pts);
        sh.setAttribute('transform','translate(3,3)');
        sh.setAttribute('fill','rgba(0,0,0,0.1)');
        svg.appendChild(sh);
        // Комната
        var el=document.createElementNS('http://www.w3.org/2000/svg','polygon');
        el.setAttribute('points',pts);
        el.setAttribute('fill','rgba(255,255,255,0.90)');
        el.setAttribute('stroke','rgba(170,188,220,0.7)');
        el.setAttribute('stroke-width','1.5');
        svg.appendChild(el);
        // Метка
        // Метка ВНЕ комнаты — справа снизу от её bbox
        var txt=document.createElementNS('http://www.w3.org/2000/svg','text');
        txt.setAttribute('x',r.x+r.w+2); txt.setAttribute('y',r.y+r.h);
        txt.setAttribute('text-anchor','start');
        txt.setAttribute('fill','rgba(60,85,150,0.85)');
        txt.setAttribute('font-size','18'); txt.setAttribute('font-weight','800');
        txt.setAttribute('font-family','sans-serif');
        txt.setAttribute('paint-order','stroke');
        txt.setAttribute('stroke','rgba(255,255,255,0.7)');
        txt.setAttribute('stroke-width','3');
        txt.style.userSelect='none';
        txt.style.webkitUserSelect='none';
        txt.setAttribute('pointer-events','none');
        txt.textContent=r.id; svg.appendChild(txt);
    });
    return svg;
}

// --- Карточка ПК (стиль как на скрине: цвет фон, номер, 3 точки, ник) ---
function makeCard(name){
    var el=document.createElement('div');
    el.className='gm-card';
    el.setAttribute('data-pc',name);
    el.style.cssText=[
        'position:absolute','width:'+CW+'px','height:'+CH+'px',
        'border-radius:8px','cursor:pointer','user-select:none',
        'box-sizing:border-box','display:flex','flex-direction:column',
        'align-items:center','justify-content:flex-start',
        'padding:5px 4px 4px','gap:2px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'box-shadow:0 2px 6px rgba(0,0,0,0.25)',
        'border:2.5px solid transparent',
        'z-index:2',
    ].join(';');

    // Номер ПК (крупный, сверху)
    var num=document.createElement('div');
    num.className='gm-num';
    num.style.cssText='font-size:12px;font-weight:800;line-height:1;pointer-events:none;letter-spacing:-0.3px;';
    num.textContent=name==='TV 1'?'TV1':name.replace(/^0/,'');

    // 3 точки-индикатора
    var dotsRow=document.createElement('div');
    dotsRow.style.cssText='display:flex;gap:5px;align-items:center;margin-top:1px;';
    var dotTips=['Питание','Сеанс','Статус'];
    for(var i=0;i<3;i++){
        var dw=document.createElement('span');
        dw.style.cssText='position:relative;display:inline-flex;pointer-events:auto;';
        var d=document.createElement('span');
        d.className='gm-dot';
        d.style.cssText='width:6px;height:6px;border-radius:50%;display:block;';
        var tip=document.createElement('span');
        tip.textContent=dotTips[i];
        tip.style.cssText='position:absolute;bottom:calc(100%+5px);left:50%;transform:translateX(-50%);background:rgba(10,10,25,0.88);color:#fff;font-size:9px;font-weight:500;padding:2px 7px;border-radius:4px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity 0.1s;z-index:999;box-shadow:0 1px 4px rgba(0,0,0,0.3);';
        dw.appendChild(d); dw.appendChild(tip);
        (function(t){dw.addEventListener('mouseenter',function(){t.style.opacity='1';});dw.addEventListener('mouseleave',function(){t.style.opacity='0';});})(tip);
        dotsRow.appendChild(dw);
    }

    // Нижняя полоса — ник или таймер (место зарезервировано)
    var nick=document.createElement('div');
    nick.className='gm-nick';
    nick.style.cssText='font-size:7px;font-weight:600;max-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;min-height:9px;line-height:1;';

    // Прогрессбар времени
    var pbWrap=document.createElement('div');
    pbWrap.className='gm-pbw';
    pbWrap.style.cssText='width:calc(100% - 8px);height:3px;background:rgba(0,0,0,0.12);border-radius:2px;overflow:hidden;margin:0 4px;flex-shrink:0;display:none;';
    var pb=document.createElement('div');
    pb.className='gm-pb';
    pb.style.cssText='height:100%;width:0%;border-radius:2px;transition:width 0.5s;';
    pbWrap.appendChild(pb);

    el.appendChild(num); el.appendChild(dotsRow); el.appendChild(nick); el.appendChild(pbWrap);

    // Hover
    el.addEventListener('mouseenter',function(){if(!_dragMode)el.style.filter='brightness(1.08)';});
    el.addEventListener('mouseleave',function(){el.style.filter='';});

    // CRM меню
    function openMenu(e){
        if(_dragMode)return;
        e.preventDefault();e.stopPropagation();
        var all=document.querySelectorAll('.DeviceItem_deviceBox__pzNUf');
        for(var j=0;j<all.length;j++){
            var ne=all[j].querySelector('.DeviceItem_deviceName__yC1tT');
            if(ne&&ne.textContent.trim()===name){
                all[j].dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
                var cx=e.clientX,cy=e.clientY;
                setTimeout(function(){all[j].dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:cx,clientY:cy,button:2,buttons:2}));},10);
                return;
            }
        }
    }
    // Только ПКМ открывает меню (ЛКМ не используется)
    el.addEventListener('contextmenu',openMenu);
    el.addEventListener('mousedown',function(e){
        if(!_dragMode)return;
        e.stopPropagation();e.preventDefault();
        _dragging=name;_dsx=e.clientX;_dsy=e.clientY;
        _dox=_pos[name].x;_doy=_pos[name].y;
    });
    return el;
}

function applyState(el,occ,nick,powered,waiting,progress){
    var bg,brd,numC,dotC,nickTxt,nickC;
    if(!powered&&!occ){
        // Выключен, нет сеанса — красный
        bg='#c62828';brd='transparent';numC='#fff';
        dotC=['#ef9a9a','#888','#888'];nickTxt='';nickC='rgba(255,255,255,0.7)';
    }else if(!powered&&occ){
        // Выключен + сеанс — серый, красная обводка
        bg='#3d3d3d';brd='#ef5350';numC='#fff';
        dotC=['#888','#ef5350','#888'];nickTxt=nick||'';nickC='#ef9a9a';
    }else if(powered&&!occ){
        // Включён, свободен — зелёный
        bg='#2e7d32';brd='transparent';numC='#fff';
        dotC=['#a5d6a7','#888','#888'];nickTxt='';nickC='rgba(255,255,255,0.7)';
    }else if(powered&&occ&&waiting){
        // Ожидание — серый, синяя обводка
        bg='#3d3d3d';brd='#42a5f5';numC='#fff';
        dotC=['#a5d6a7','#42a5f5','#ffa726'];nickTxt=nick||'';nickC='#90caf9';
    }else{
        // Активный сеанс, включён — серый, зелёная обводка
        bg='#3d3d3d';brd='#43a047';numC='#fff';
        dotC=['#a5d6a7','#66bb6a','#888'];nickTxt=nick||'';nickC='#a5d6a7';
    }
    el.style.backgroundColor=bg;
    el.style.borderColor=brd;
    var numEl=el.querySelector('.gm-num');
    if(numEl)numEl.style.color=numC;
    var dots=el.querySelectorAll('.gm-dot');
    for(var i=0;i<dots.length&&i<dotC.length;i++)dots[i].style.backgroundColor=dotC[i];
    var nk=el.querySelector('.gm-nick');
    if(nk){nk.textContent=nickTxt;nk.style.color=nickC;}
    // Прогрессбар — только у активных сеансов
    var pbWrap=el.querySelector('.gm-pbw');
    var pb=el.querySelector('.gm-pb');
    if(pbWrap) pbWrap.style.display=occ?'block':'none';
    if(pb&&occ){
        var pct=progress||0;
        pb.style.width=pct+'%';
        var pbC=pct<70?'rgba(255,255,255,0.8)':pct<90?'#ffa726':'#ef5350';
        pb.style.backgroundColor=pbC;
    }
}

function parseMins(s){
    // "1 ч 12 мин" или "45 мин" или "2 ч" → минуты
    if(!s||s==='—')return 0;
    var h=0,m=0;
    var hm=s.match(/(\d+)\s*ч/);var mm=s.match(/(\d+)\s*мин/);
    if(hm)h=parseInt(hm[1]);if(mm)m=parseInt(mm[1]);
    return h*60+m;
}
function getTableData(){
    var r={};
    document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(row){
        var c=row.querySelectorAll('td');
        var n=c[0]&&c[0].textContent.trim();
        if(!n)return;
        var elapsed=parseMins(c[6]&&c[6].textContent.trim());
        var remain=parseMins(c[7]&&c[7].textContent.trim());
        var total=elapsed+remain;
        r[n]={
            powered:(c[2]&&c[2].textContent.trim())==='Доступен',
            sessionStatus:c[8]&&c[8].textContent.trim(),
            elapsed:elapsed,
            remain:remain,
            progress:total>0?Math.round(elapsed/total*100):0,
        };
    });
    return r;
}
function getDevSt(){
    var r={};
    document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(row){
        var c=row.querySelectorAll('td');
        var n=c[0]&&c[0].textContent.trim();
        var s=c[2]&&c[2].textContent.trim();
        if(n)r[n]=s;
    });
    return r;
}
function getSessSt(){
    var r={};
    document.querySelectorAll('tr.mantine-Table-tr[data-index]').forEach(function(row){
        var c=row.querySelectorAll('td');
        var n=c[0]&&c[0].textContent.trim();
        var b=c[7]&&c[7].textContent.trim();
        if(n)r[n]=b;
    });
    return r;
}

function updCard(name){
    var el=_cards[name];if(!el)return;
    var p=_pos[name];if(!p)return;
    el.style.left=p.x+'px';el.style.top=p.y+'px';
    var td=getTableData();
    var row=td[name]||{powered:true,sessionStatus:'',elapsed:0,remain:0,progress:0};
    var ss=row.sessionStatus||'';
    var occByTable=ss.length>0&&ss!=='—'&&ss.indexOf('УШЁ')===-1&&ss.indexOf('УШЕЛ')===-1;
    var waiting=occByTable&&(ss.indexOf('ОЖИД')!==-1||ss.indexOf('жид')!==-1);
    // Ник и факт занятости — из _godjiSessionsData (приоритет над таблицей)
    var s=sess()[name];
    var occBySess=!!(s&&s.sessionId);
    var occ=occByTable||occBySess;
    var nick=occ&&s&&s.nickname?s.nickname:'';
    applyState(el,occ,nick,row.powered,waiting,row.progress);
}
function updAll(){Object.keys(_cards).forEach(updCard);}

var _sv={},_bc=null;
try{_bc=new BroadcastChannel('godji_map');}catch(e){}
Object.defineProperty(window,'_godjiSessionsData',{
    set:function(v){
        _sv=v||{};
        clearTimeout(window._gmT);
        window._gmT=setTimeout(function(){
            updAll();
            // Передаём прогресс
            var td2=getTableData();
            var enriched={};
            Object.keys(_sv).forEach(function(n){enriched[n]=Object.assign({},_sv[n],{progress:td2[n]?td2[n].progress:0});});
            // BroadcastChannel + localStorage для надёжности
            if(_bc)try{_bc.postMessage({type:'sessions',sess:enriched});}catch(e){}
            try{localStorage.setItem('godji_tv_sess',JSON.stringify({t:Date.now(),sess:enriched}));}catch(e){}
            window._gmLastEnriched=enriched;
        },30);
    },
    get:function(){return _sv;},
    configurable:true
});

function inject(mc){
    if(_injected)return;_injected=true;
    loadPos();
    mc.style.setProperty('background','#c8d0e8','important');
    mc.style.position='relative';
    mc.style.overflow='hidden';

    function hideOrig(){
        mc.style.setProperty('background','#c8d0e8','important');
        Array.from(mc.children).forEach(function(c){
            if(c.id==='gm-wrap')return;
            c.style.setProperty('display','none','important');
            c.style.setProperty('visibility','hidden','important');
        });
    }
    hideOrig();
    new MutationObserver(function(muts){
        muts.forEach(function(m){
            m.addedNodes.forEach(function(n){
                if(n.nodeType===1&&n.id!=='gm-wrap')n.style.setProperty('display','none','important');
            });
        });
    }).observe(mc,{childList:true});
    new ResizeObserver(function(){mc.style.setProperty('background','#c8d0e8','important');}).observe(mc);

    function fixH(){
        var sp=mc.closest('[class*="SplitPane"]');
        if(sp&&sp.getBoundingClientRect().height<50){
            [sp].concat(Array.from(sp.children).filter(function(c){return c.contains(mc);}))
            .concat([mc.closest('.mantine-Paper-root'),mc])
            .forEach(function(e){if(e){
                e.style.setProperty('min-height','400px','important');
                e.style.setProperty('height','400px','important');
                e.style.setProperty('background','#c8d0e8','important');
            }});
        }
    }
    fixH();setTimeout(fixH,600);setTimeout(fixH,2000);

    // Враппер
    var wrap=document.createElement('div');
    wrap.id='gm-wrap';
    wrap.style.cssText='position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:#c8d0e8;z-index:100;cursor:grab;';
    _wrap=wrap;

    // --- Анимированный фон в стиле Godji ---
    var bgSt=document.createElement('style');
    bgSt.textContent='[class*="Layout_mainContentDash"]{background-color:#c8d0e8!important;}';
    document.head.appendChild(bgSt);


    // Слой карты
    var layer=document.createElement('div');
    layer.id='gm-layer';
    layer.style.cssText='position:absolute;top:0;left:0;width:760px;height:520px;transform-origin:0 0;';
    _layer=layer;applyT();
    layer.appendChild(buildSVG());

    Object.keys(_pos).forEach(function(name){
        var c=makeCard(name);_cards[name]=c;
        layer.appendChild(c);updCard(name);
    });
    wrap.appendChild(layer);

    // Тулбар
    var tb=document.createElement('div');
    tb.style.cssText='position:absolute;top:10px;left:10px;z-index:200;display:flex;gap:8px;';
    function mkBtn(t){
        var b=document.createElement('button');
        b.style.cssText='padding:7px 14px;border-radius:7px;border:none;background:rgba(255,255,255,0.92);color:#333;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);white-space:nowrap;transition:background 0.15s;';
        b.textContent=t;return b;
    }
    var dBtn=mkBtn('✎ Переместить');
    dBtn.addEventListener('click',function(){
        _dragMode=!_dragMode;
        dBtn.style.background=_dragMode?'#c62828':'rgba(255,255,255,0.92)';
        dBtn.style.color=_dragMode?'#fff':'#333';
        wrap.style.cursor=_dragMode?'default':'grab';
        if(_dragMode){
            var hint=document.createElement('span');
            hint.style.cssText='font-size:10px;color:rgba(0,0,0,0.5);align-self:center;';
            hint.textContent='Shift — выравнивание';
            hint.id='gm-shift-hint';
            tb.appendChild(hint);
        } else {
            var h=document.getElementById('gm-shift-hint');
            if(h)h.remove();
        }
    });
    var rBtn=mkBtn('↺ Сбросить');
    rBtn.addEventListener('click',function(){
        if(confirm('Сбросить позиции ПК?')){_pos=Object.assign({},DEFAULT_POS);savePos();updAll();}
    });
    var tvBtn=mkBtn('📺 TV');
    tvBtn.addEventListener('click',openTV);
    // Кнопка TV оригинальной карты — в тулбаре нашей карты
    var tvOrigBtn=mkBtn('📺 TV (ориг)');
    tvOrigBtn.addEventListener('click',function(){
        // Ищем кнопку TV в оригинальном интерфейсе CRM
        // Временно показываем оригинальную карту, кликаем TV, скрываем обратно
        var mc2=document.querySelector('.Map_mapContainer__a7ebY');
        if(!mc2)return;
        // Показываем оригинальные элементы на миг
        var origEls=Array.from(mc2.children).filter(function(ch){return ch.id!=='gm-wrap';});
        origEls.forEach(function(ch){ch.style.visibility='';ch.style.display='';});
        // Ищем кнопку TV в оригинальной карте
        var origTvBtn=null;
        mc2.querySelectorAll('button').forEach(function(b){
            if(b.textContent.trim().toUpperCase().indexOf('TV')!==-1)origTvBtn=b;
        });
        if(origTvBtn){
            origTvBtn.click();
        }
        // Скрываем обратно
        origEls.forEach(function(ch){
            ch.style.display='none';
            ch.style.visibility='hidden';
            ch.style.pointerEvents='none';
        });
    });
    tb.appendChild(dBtn);tb.appendChild(rBtn);tb.appendChild(tvBtn);tb.appendChild(tvOrigBtn);
    wrap.appendChild(tb);
    mc.appendChild(wrap);
    // Применяем сохранённое состояние карты при загрузке
    try{
        var _initMapOn = localStorage.getItem('godji_map_enabled');
        if(_initMapOn === '0') wrap.style.display = 'none';
    }catch(e){}

    // --- Кнопка включения/выключения нашей карты ---
    if(!document.getElementById('godji-map-toggle')){
        // Загружаем сохранённое состояние
        var _mapOn = true;
        try { var _saved = localStorage.getItem('godji_map_enabled'); if(_saved !== null) _mapOn = _saved === '1'; } catch(e){}

        var mapToggle=document.createElement('div');
        mapToggle.id='godji-map-toggle';
        mapToggle.style.cssText='position:fixed;bottom:260px;left:0;z-index:150;display:flex;align-items:center;gap:8px;width:140px;height:46px;padding:8px 8px 8px 18px;background:transparent;cursor:default;user-select:none;font-family:inherit;box-sizing:border-box;';

        var mapIco=document.createElement('div');
        mapIco.style.cssText='width:26px;height:26px;border-radius:6px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;';
        mapIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>';

        var mapRight=document.createElement('div');
        mapRight.style.cssText='display:flex;align-items:center;justify-content:space-between;flex:1;min-width:0;';

        var mapLabel=document.createElement('span');
        mapLabel.style.cssText='font-size:11px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.1px;flex:1;';
        mapLabel.textContent='Карта';

        var mapTrack=document.createElement('div');
        mapTrack.style.cssText='width:36px;height:20px;border-radius:10px;position:relative;flex-shrink:0;transition:background 0.25s;cursor:pointer;';
        var mapThumb=document.createElement('div');
        mapThumb.style.cssText='width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.25s;box-shadow:0 1px 4px rgba(0,0,0,0.35);';
        mapTrack.appendChild(mapThumb);

        function updMapToggle(){
            if(_mapOn){mapTrack.style.background='#cc0001';mapThumb.style.left='19px';}
            else{mapTrack.style.background='rgba(255,255,255,0.25)';mapThumb.style.left='3px';}
        }

        function applyMapState(){
            // Скрываем/показываем нашу карту
            if(wrap) wrap.style.display = _mapOn ? '' : 'none';
            // Оригинальные дети контейнера (React-карта CRM)
            var mc2=document.querySelector('.Map_mapContainer__a7ebY');
            if(mc2){
                Array.from(mc2.children).forEach(function(ch){
                    if(ch.id==='gm-wrap') return;
                    ch.style.display = _mapOn ? 'none' : '';
                    ch.style.visibility = _mapOn ? 'hidden' : '';
                    ch.style.pointerEvents = _mapOn ? 'none' : '';
                });
            }
            // TV кнопки в тулбаре — видны только когда карта включена (тулбар внутри wrap)
            updMapToggle();
            try { localStorage.setItem('godji_map_enabled', _mapOn ? '1' : '0'); } catch(e){}
        }

        mapTrack.addEventListener('click',function(e){
            e.stopPropagation();
            _mapOn=!_mapOn;
            applyMapState();
        });

        // Применяем начальное состояние
        applyMapState();

        // TV кнопка оригинала теперь в тулбаре карты

        mapRight.appendChild(mapLabel);
        mapRight.appendChild(mapTrack);
        mapToggle.appendChild(mapIco);
        mapToggle.appendChild(mapRight);
        // Прячем fixed-элемент — теперь управление через панель настроек
        mapToggle.style.display = 'none';
        document.body.appendChild(mapToggle);

        // Регистрируем в панели настроек
        function registerMapInSettings(){
            if(typeof window.__godjiRegisterSetting !== 'function'){
                setTimeout(registerMapInSettings, 300);
                return;
            }
            window.__godjiRegisterSetting({
                id: 'godji-map-toggle',
                label: 'Карта',
                iconBg: '#cc0001',
                icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
                type: 'toggle',
                getState: function(){ return _mapOn; },
                onToggle: function(val){
                    _mapOn = val;
                    applyMapState();
                }
            });
        }
        registerMapInSettings();
    }

    // Зум (поведение как в оригинальной карте)
    wrap.addEventListener('wheel',function(e){
        e.preventDefault();
        var r=wrap.getBoundingClientRect();
        var mx=e.clientX-r.left,my=e.clientY-r.top;
        var delta=e.deltaY<0?1.12:0.89;
        var ns=Math.max(0.2,Math.min(5,_sc*delta));
        _tx=mx-(mx-_tx)*(ns/_sc);
        _ty=my-(my-_ty)*(ns/_sc);
        _sc=ns;applyT();
    },{passive:false});

    // Пан
    wrap.addEventListener('mousedown',function(e){
        if(_dragMode||e.button!==0)return;
        // Пан работает везде включая карточки ПК (меню только по ПКМ)
        _panning=true;_psx=e.clientX;_psy=e.clientY;_ptx=_tx;_pty=_ty;
        _vx=0;_vy=0;
        wrap.style.cursor='grabbing';
    });
    document.addEventListener('mousemove',function(e){
        _lastX=e.clientX;_lastY=e.clientY;
        if(_dragging){
            var nx=_dox+(e.clientX-_dsx)/_sc;
            var ny=_doy+(e.clientY-_dsy)/_sc;
            if(_shiftDown){nx=snapVal(nx);ny=snapVal(ny);}
            _pos[_dragging]={x:nx,y:ny};
            updCard(_dragging);
        }else if(_panning){
            _tx=_ptx+(e.clientX-_psx);
            _ty=_pty+(e.clientY-_psy);
            applyT();
        }
    });
    var _vx=0,_vy=0,_lastX=0,_lastY=0,_raf=null;
    document.addEventListener('mousemove',function(e){
        if(_panning){
            _vx=e.clientX-_lastX; _vy=e.clientY-_lastY;
            _lastX=e.clientX; _lastY=e.clientY;
        }
    },true);
    document.addEventListener('mouseup',function(){
        if(_dragging){savePos();_dragging=null;}
        if(_panning){
            _panning=false;
            if(_wrap)_wrap.style.cursor=_dragMode?'default':'grab';
            // Инерция
            if(Math.abs(_vx)>1||Math.abs(_vy)>1){
                cancelAnimationFrame(_raf);
                (function momentum(){
                    _vx*=0.88;_vy*=0.88;
                    if(Math.abs(_vx)<0.3&&Math.abs(_vy)<0.3)return;
                    _tx+=_vx;_ty+=_vy;applyT();
                    _raf=requestAnimationFrame(momentum);
                })();
            }
        }
    });

    clearInterval(_timer);
    updAll();
    // Быстрый polling каждые 800ms — таблица обновляется без событий
    _timer=setInterval(updAll,800);
    // Принудительно шлём данные в TV каждые 5 сек
    setInterval(function(){
        var enriched=window._gmLastEnriched||sess();
        if(_bc)try{_bc.postMessage({type:'sessions',sess:enriched});}catch(e){}
        try{localStorage.setItem('godji_tv_sess',JSON.stringify({t:Date.now(),sess:enriched}));}catch(e){}
    },5000);

    // Наблюдаем за изменениями в tbody таблицы
    function attachTableObs(){
        var tbody=document.querySelector('.mantine-Table-tbody, tbody.mrt-table-body');
        if(!tbody)return false;
        new MutationObserver(function(){
            clearTimeout(window._gmTableT);
            window._gmTableT=setTimeout(updAll,50);
        }).observe(tbody,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','data-status']});
        return true;
    }
    if(!attachTableObs()){
        var retryObs=new MutationObserver(function(){if(attachTableObs())retryObs.disconnect();});
        retryObs.observe(document.body,{childList:true,subtree:true});
    }
}

// TV версия — вертикальная (карта повёрнута 90° CW)
function openTV(){
    var w=window.open('','godji_tv12','width=540,height=960');
    if(!w)return;

    var TV_ROOM_SHAPES={
        'Q': '269.0,58.7 266.8,60.9 266.8,129.7 269.0,131.9 271.2,131.9 275.5,127.5 300.6,127.5 305.0,131.9 459.8,131.9 462.0,129.8 462.0,60.9 459.8,58.7',
        'W': '324.9,138.0 319.5,138.0 317.5,139.9 317.5,207.0 321.4,210.8 321.4,232.2 317.5,236.0 319.5,238.8 460.0,238.8 462.0,236.8 462.0,139.9 460.0,138.0',
        'E': '324.9,245.8 319.5,245.8 317.5,247.8 317.5,297.8 321.4,301.7 321.4,323.0 317.5,326.9 319.5,329.6 459.9,329.6 461.9,327.6 461.9,247.8 459.9,245.8',
        'R': '324.9,336.5 319.7,336.5 317.5,338.7 317.5,341.8 321.8,346.0 321.8,368.9 317.5,373.2 319.7,418.3 459.8,418.3 461.9,416.2 461.9,338.7 459.8,336.6',
        'T': '324.9,425.4 319.7,425.4 317.5,427.5 317.5,433.7 321.8,438.0 321.8,460.9 317.5,465.1 319.7,523.5 474.3,523.5 476.5,521.4 476.5,427.6 474.3,425.4',
        'Y': '260.7,532.5 260.7,685.1 262.8,687.2 371.7,687.3 377.0,685.1 436.2,627.6 438.5,622.1 438.5,532.5 436.3,530.3 307.0,530.3 302.6,534.7 279.2,534.7 274.8,530.3 262.8,530.4',
        'L': '17.3,205.2 14.8,207.7 14.8,315.5 17.3,318.0 125.9,318.0 130.9,312.9 153.0,312.9 158.0,318.0 161.5,318.0 164.0,315.5 164.0,207.7 161.5,205.2',
        'V': '171.6,329.8 167.9,329.8 166.5,331.6 166.5,378.2 169.2,381.9 168.8,403.0 173.7,407.9 263.8,407.9 265.1,406.1 265.1,331.6 263.8,329.8',
        'S': '265.1,417.4 264.6,413.9 263.0,412.9 168.3,412.9 166.1,416.9 168.3,461.9 263.0,461.9 264.6,460.9 265.1,458.9',
        'O': '184.7,532.6 182.5,534.8 163.6,534.8 159.2,530.4 155.1,530.4 152.9,532.6 152.9,721.2 155.1,723.4 251.5,723.4 253.7,721.2 253.7,532.6 251.5,530.4 186.9,530.4',
        'X': '36.1,560.0 63.9,531.1 65.5,530.4 110.9,530.4 114.9,534.8 137.1,534.8 141.1,530.4 144.2,530.4 146.2,532.4 146.2,721.4 144.2,723.4 70.9,723.4 68.9,721.4 68.9,670.2 66.9,668.2 37.5,668.2 35.5,666.2 35.5,561.5',
    };

    var TV_ROOMS_ADM=[
        {id:'Q',x:267,y:59,w:195,h:73},
        {id:'W',x:318,y:138,w:144,h:101},
        {id:'E',x:318,y:246,w:144,h:84},
        {id:'R',x:318,y:336,w:144,h:82},
        {id:'T',x:318,y:426,w:159,h:98},
        {id:'Y',x:261,y:530,w:178,h:157},
        {id:'L',x:15,y:205,w:149,h:113},
        {id:'V',x:166,y:330,w:99,h:78},
        {id:'S',x:166,y:413,w:99,h:49},
        {id:'O',x:153,y:530,w:101,h:193},
        {id:'X',x:36,y:530,w:111,h:193},
    ];

    var TV_POS={
        '01':{x:64,y:273},
        '02':{x:18,y:273},
        '03':{x:18,y:214},
        '04':{x:63,y:214},
        '05':{x:108,y:214},
        '06':{x:169,y:338},
        '07':{x:214,y:338},
        '08':{x:343,y:255},
        '09':{x:388,y:255},
        '10':{x:270,y:68},
        '11':{x:316,y:68},
        '12':{x:360,y:68},
        '13':{x:406,y:68},
        '14':{x:321,y:146},
        '15':{x:366,y:146},
        '16':{x:411,y:194},
        '17':{x:366,y:194},
        '18':{x:380,y:434},
        '19':{x:425,y:434},
        '20':{x:411,y:478},
        '21':{x:366,y:478},
        '22':{x:321,y:478},
        '23':{x:321,y:539},
        '24':{x:366,y:539},
        '25':{x:385,y:608},
        '26':{x:352,y:640},
        '27':{x:300,y:644},
        '28':{x:261,y:611},
        '29':{x:261,y:568},
        '30':{x:203,y:542},
        '31':{x:203,y:586},
        '32':{x:203,y:632},
        '33':{x:156,y:676},
        '34':{x:156,y:632},
        '35':{x:156,y:586},
        '36':{x:95,y:588},
        '37':{x:95,y:633},
        '38':{x:95,y:678},
        '39':{x:38,y:623},
        '40':{x:38,y:578},
        '41':{x:169,y:418},
        'TV 1':{x:368,y:360},
    };

    var TV_FLOOR='267.0,58.5 476.5,58.5 476.5,523.5 438.5,687.5 260.5,687.5 153.0,723.5 36.0,723.5 36.0,531.0 15.0,531.0 15.0,205.0 161.5,205.0 161.5,329.5 265.0,329.5 265.0,462.0 166.5,462.0 166.5,329.5 267.0,329.5 267.0,205.0';

    var roomsSVG='';
    TV_ROOMS_ADM.forEach(function(r){
        var pts=TV_ROOM_SHAPES[r.id];
        roomsSVG+='<polygon points="'+pts+'" transform="translate(2,2)" fill="rgba(0,0,0,0.08)"/>';
        roomsSVG+='<polygon points="'+pts+'" fill="rgba(255,255,255,0.88)" stroke="rgba(170,188,220,0.7)" stroke-width="1.5"/>';
        roomsSVG+='<text x="'+(r.x+r.w+2)+'" y="'+(r.y+r.h)+'" fill="rgba(60,85,150,0.85)" font-size="20" font-weight="800" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" paint-order="stroke" stroke="rgba(255,255,255,0.7)" stroke-width="3" style="user-select:none;-webkit-user-select:none" pointer-events="none">'+r.id+'</text>';
    });

    var sJ=JSON.stringify(sess());
    var CWtv=CW;
    var posJ=JSON.stringify(TV_POS);

    var html='<!DOCTYPE html><html><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>GODJI TV</title>'+
    '<style>'+
    '*{margin:0;padding:0;box-sizing:border-box;}'+
    'body{background:#c8d0e8;overflow:hidden;width:100vw;height:100vh;'+
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}'+
    '#w{position:absolute;inset:0;overflow:hidden;cursor:grab;background:#c8d0e8;}'+
    '#l{position:absolute;top:0;left:0;width:490px;height:760px;transform-origin:0 0;}'+
    '.c{position:absolute;border-radius:8px;display:flex;align-items:center;justify-content:center;'+
    '  box-shadow:0 2px 6px rgba(0,0,0,0.25);}'+
    '.cn{font-size:11px;font-weight:800;color:#fff;'+
    '  user-select:none;-webkit-user-select:none;pointer-events:none;}'+
    '.hd{position:fixed;top:0;left:0;right:0;z-index:99;'+
    '  background:rgba(200,210,232,0.95);backdrop-filter:blur(6px);'+
    '  padding:6px 14px;display:flex;align-items:center;gap:10px;'+
    '  border-bottom:1px solid rgba(155,175,215,0.5);}'+
    '.dot{width:10px;height:10px;border-radius:50%;}'+
    '.lb{font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#444;}'+
    '</style></head><body>'+
    '<div class="hd">'+
    '  <div class="dot" style="background:#2e7d32"></div>'+
    '  <span class="lb">Свободно</span>'+
    '  <div class="dot" style="background:#c62828;margin-left:8px"></div>'+
    '  <span class="lb">Занято</span>'+
    '  <span class="lb" style="margin-left:auto;font-weight:700" id="ctr"></span>'+
    '</div>'+
    '<div id="w">'+
    ''+  // no animated bg
    '<div id="l">'+
    '<svg style="position:absolute;top:0;left:0;width:490px;height:760px;pointer-events:none;user-select:none;" viewBox="0 0 490 760">'+
    '<polygon points="'+TV_FLOOR+'" fill="rgba(195,210,235,0.65)" stroke="rgba(155,175,215,0.55)" stroke-width="2"/>'+
    roomsSVG+'</svg>'+
    '</div></div>'+
    '<script>'+
    'var pos='+posJ+',sess='+sJ+',CW='+CWtv+';'+
    'var l=document.getElementById("l"),w=document.getElementById("w");'+
    'var sc=Math.min(window.innerWidth/490,(window.innerHeight-36)/760)*0.97;'+
    'var tx=Math.round((window.innerWidth-490*sc)/2);'+
    'var ty=Math.round(36+(window.innerHeight-36-760*sc)/2);'+
    'var pan=false,px,py,ptx,pty,vx=0,vy=0,raf;'+
    'function aT(){l.style.transform="translate("+tx+"px,"+ty+"px) scale("+sc+")";}aT();'+
    'Object.keys(pos).forEach(function(n){'+
    '  var d=document.createElement("div");d.className="c";d.id="c_"+n.replace(/ /g,"_");'+
    '  d.style.width=CW+"px";d.style.height=CW+"px";'+
    '  d.style.left=pos[n].x+"px";d.style.top=pos[n].y+"px";'+
    '  var cn=document.createElement("div");cn.className="cn";'+
    '  cn.textContent=n==="TV 1"?"TV1":n.replace(/^0/,"");d.appendChild(cn);'+
    '  l.appendChild(d);'+
    '});'+
    'function updC(n,s){'+
    '  var el=document.getElementById("c_"+n.replace(/ /g,"_"));if(!el)return;'+
    '  var occ=!!(s&&s.sessionId);'+
    '  el.style.backgroundColor=occ?"#c62828":"#2e7d32";'+
    '}'+
    'var _bc=null;try{_bc=new BroadcastChannel("godji_map");}catch(e){}'+
    'if(_bc)_bc.onmessage=function(e){'+
    '  if(e.data&&e.data.type==="sessions"){'+
    '    sess=e.data.sess;'+
    '    try{localStorage.setItem("godji_tv_sess",JSON.stringify({t:Date.now(),sess:sess}));}catch(ex){}'+
    '    upd();'+
    '  }'+
    '};'+
    'function loadSess(){'+
    '  try{if(window.opener&&window.opener._godjiSessionsData)sess=window.opener._godjiSessionsData;}catch(e){}'+
    '  try{var raw=localStorage.getItem("godji_tv_sess");if(raw){var ld=JSON.parse(raw);if(ld&&ld.sess&&Date.now()-ld.t<300000)sess=ld.sess;}}catch(e){}'+
    '}'+
    'function upd(){'+
    '  loadSess();'+
    '  var occ=0;'+
    '  Object.keys(pos).forEach(function(n){var s=sess[n];updC(n,s);if(s&&s.sessionId)occ++;});'+
    '  var c=document.getElementById("ctr");if(c)c.textContent="Занято: "+occ+"/"+Object.keys(pos).length;'+
    '}'+
    'upd();setInterval(upd,1500);'+
    'w.addEventListener("wheel",function(e){e.preventDefault();'+
    '  var r=w.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;'+
    '  var d=e.deltaY<0?1.12:0.89,ns=Math.max(0.2,Math.min(5,sc*d));'+
    '  tx=mx-(mx-tx)*(ns/sc);ty=my-(my-ty)*(ns/sc);sc=ns;aT();},{passive:false});'+
    'var lx=0,ly=0;'+
    'w.addEventListener("mousedown",function(e){pan=true;px=e.clientX;py=e.clientY;ptx=tx;pty=ty;lx=e.clientX;ly=e.clientY;vx=0;vy=0;cancelAnimationFrame(raf);w.style.cursor="grabbing";});'+
    'document.addEventListener("mousemove",function(e){if(!pan)return;vx=e.clientX-lx;vy=e.clientY-ly;lx=e.clientX;ly=e.clientY;tx=ptx+(e.clientX-px);ty=pty+(e.clientY-py);aT();});'+
    'document.addEventListener("mouseup",function(){if(!pan)return;pan=false;w.style.cursor="grab";'+
    '  (function m(){vx*=0.88;vy*=0.88;if(Math.abs(vx)<0.3&&Math.abs(vy)<0.3)return;tx+=vx;ty+=vy;aT();raf=requestAnimationFrame(m);})();});'+
    'var lt=null;'+
    'w.addEventListener("touchstart",function(e){if(e.touches.length===1){pan=true;px=e.touches[0].clientX;py=e.touches[0].clientY;ptx=tx;pty=ty;lx=px;ly=py;}lt=e.touches;},{passive:true});'+
    'w.addEventListener("touchmove",function(e){e.preventDefault();'+
    '  if(e.touches.length===1&&pan){vx=e.touches[0].clientX-lx;vy=e.touches[0].clientY-ly;lx=e.touches[0].clientX;ly=e.touches[0].clientY;tx=ptx+(lx-px);ty=pty+(ly-py);aT();}'+
    '  if(e.touches.length===2&&lt&&lt.length===2){'+
    '    var d0=Math.hypot(lt[0].clientX-lt[1].clientX,lt[0].clientY-lt[1].clientY);'+
    '    var d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);'+
    '    var ns=Math.max(0.2,Math.min(5,sc*(d1/d0)));sc=ns;aT();}'+
    '  lt=e.touches;},{passive:false});'+
    'w.addEventListener("touchend",function(){pan=false;});'+
    '<\/script></body></html>';
    w.document.open();w.document.write(html);w.document.close();
}


function tryInject(){
    if(_injected)return;
    if(window.location.pathname!=='/'&&window.location.pathname!=='')return;
    var mc=document.querySelector('.Map_mapContainer__a7ebY');
    if(mc&&mc.getBoundingClientRect().width>0)inject(mc);
}
var obs=new MutationObserver(tryInject);
obs.observe(document.body,{childList:true,subtree:true});
[800,2000,4500,8000].forEach(function(t){setTimeout(tryInject,t);});
var _op=history.pushState;
history.pushState=function(){_op.apply(this,arguments);setTimeout(function(){_injected=false;tryInject();},600);};

})();

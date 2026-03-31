// ==UserScript==
// @name         Годжи — История сеансов
// @namespace    http://tampermonkey.net/
// @version      4.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_history.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_history.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_session_history';
var MAX_MS = 72 * 3600000;

// ── Хранилище ─────────────────────────────────
function loadHistory(){
    try{
        var raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
        var cut=Date.now()-MAX_MS;
        return raw.filter(function(r){return r.ts>cut;});
    }catch(e){return[];}
}
function saveHistory(data){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){}
}

// ── Сканирование таблицы ──────────────────────
var _state={};

function getCell(row,idx){
    return row.querySelector('td[data-index="'+idx+'"]')||
           row.querySelector('td[style*="col-deviceName-size"]');
}

function scan(){
    var rows=document.querySelectorAll('tr.mantine-Table-tr[data-index]');
    if(!rows.length)return;
    var now=Date.now();
    var current={};

    rows.forEach(function(row){
        var pcCell=row.querySelector('td[data-index="0"]')||row.querySelector('td[style*="col-deviceName"]');
        if(!pcCell)return;
        var pc=pcCell.textContent.trim();
        if(!pc||pc==='№ ПК')return;

        // Статус сессии
        var statusCell=row.querySelector('td[data-index="8"]')||row.querySelector('td[style*="col-sessionStatus"]');
        var status=(statusCell&&statusCell.querySelector('.mantine-Badge-label'))?
            statusCell.querySelector('.mantine-Badge-label').textContent.trim():
            (statusCell?statusCell.textContent.trim():'');

        // Клиент
        var clientCell=row.querySelector('td[data-index="10"]')||row.querySelector('td[style*="col-clientName"]');
        var client=clientCell?clientCell.textContent.trim():'';

        // Ник
        var nickCell=row.querySelector('td[data-index="11"]')||row.querySelector('td[style*="col-nickName"]');
        var nick=nickCell?nickCell.textContent.trim().replace(/^@/,''):'';

        // Телефон
        var phoneCell=row.querySelector('td[data-index="12"]')||row.querySelector('td[style*="col-phone"]');
        var phone=phoneCell?phoneCell.textContent.trim():'';

        // Время сеанса
        var timeCell=row.querySelector('td[data-index="6"]')||row.querySelector('td[style*="col-sessionPastTime"]');
        var elapsed=timeCell?timeCell.textContent.trim():'';

        if(pc&&status) current[pc]={status:status,client:client,nick:nick,phone:phone,elapsed:elapsed};
    });

    // Сравниваем с предыдущим состоянием
    Object.keys(current).forEach(function(pc){
        var cur=current[pc];
        var prev=_state[pc]||{};

        if(prev.status===cur.status)return; // Без изменений

        var type='',label='';
        if(!prev.status&&cur.status){
            type='start';label='Запуск сеанса';
        } else if(cur.status==='УШЁЛ'||cur.status==='ЗАВЕРШЁН'){
            type='finish';label='Завершение сеанса';
        } else if(cur.status==='ОЖИДАНИЕ'){
            type='wait';label='Переход в ожидание';
        } else {
            type='change';label='Изменение: '+cur.status;
        }

        addEntry({ts:now,type:type,label:label,
            pc:pc,client:cur.client,nick:cur.nick,phone:cur.phone,elapsed:cur.elapsed});
    });

    // Завершение — если ПК пропал из активных
    Object.keys(_state).forEach(function(pc){
        if(!current[pc]&&_state[pc].status&&_state[pc].status!=='УШЁЛ'&&_state[pc].status!=='ЗАВЕРШЁН'){
            addEntry({ts:now,type:'finish',label:'Завершение сеанса',
                pc:pc,client:_state[pc].client,nick:_state[pc].nick,
                phone:_state[pc].phone,elapsed:_state[pc].elapsed});
        }
    });

    _state=current;
}

function addEntry(entry){
    var history=loadHistory();
    var now=Date.now();
    var isDup=history.some(function(r){
        return r.pc===entry.pc&&r.type===entry.type&&now-r.ts<8000;
    });
    if(isDup)return;
    history.unshift(entry);
    saveHistory(history.filter(function(r){return r.ts>now-MAX_MS;}));
    updateModalIfOpen();
}

// ── Модалка ───────────────────────────────────
var _modal=null,_overlay=null,_isOpen=false;
var _fText='',_fNick='',_fFrom=0,_fTo=0;

function buildModal(){
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99997;display:none;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);

    _modal=document.createElement('div');
    _modal.id='godji-history-modal';
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:860px;max-width:96vw;max-height:85vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';
    var titleWrap=document.createElement('div');
    titleWrap.style.cssText='display:flex;align-items:center;gap:10px;';
    var tIco=document.createElement('div');
    tIco.style.cssText='width:32px;height:32px;border-radius:8px;background:#1565c0;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    tIco.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    var tTxt=document.createElement('span');
    tTxt.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;';
    tTxt.textContent='История сеансов (72 ч)';
    titleWrap.appendChild(tIco);titleWrap.appendChild(tTxt);
    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    closeBtn.innerHTML='&times;';
    closeBtn.addEventListener('click',hideModal);
    hdr.appendChild(titleWrap);hdr.appendChild(closeBtn);

    // Фильтры — одна строка
    var fb=document.createElement('div');
    fb.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;white-space:nowrap;overflow-x:auto;';

    function mkInput(ph,w,fn){
        var i=document.createElement('input');
        i.type='text';i.placeholder=ph;
        i.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;width:'+w+';flex-shrink:0;';
        i.addEventListener('input',function(){fn(this.value.toLowerCase());renderTable();});
        return i;
    }
    function mkDate(lbl,fn){
        var wrap=document.createElement('span');
        wrap.style.cssText='display:flex;align-items:center;gap:4px;flex-shrink:0;';
        var l=document.createElement('span');
        l.style.cssText='font-size:11px;color:#999;font-weight:600;';l.textContent=lbl;
        var d=document.createElement('input');
        d.type='date';
        d.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:3px 5px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;flex-shrink:0;';
        d.addEventListener('change',function(){fn(this.value?new Date(this.value).getTime():0);renderTable();});
        wrap.appendChild(l);wrap.appendChild(d);return wrap;
    }

    // Динамический ник-селектор
    var nickSel=document.createElement('select');
    nickSel.id='godji-hist-nick-sel';
    nickSel.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;max-width:130px;';
    nickSel.addEventListener('change',function(){_fNick=this.value;renderTable();});

    // ПК-селектор
    var pcSel=document.createElement('select');
    pcSel.id='godji-hist-pc-sel';
    pcSel.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;width:70px;';
    pcSel.addEventListener('change',function(){_fPc=this.value;renderTable();});

    fb.appendChild(nickSel);fb.appendChild(pcSel);
    fb.appendChild(mkInput('Поиск...','120px',function(v){_fText=v;}));
    fb.appendChild(mkDate('С:',function(v){_fFrom=v;}));
    fb.appendChild(mkDate('По:',function(v){_fTo=v?v+86399999:0;}));

    // Таблица
    var tw=document.createElement('div');
    tw.id='godji-history-table-wrap';
    tw.style.cssText='overflow-y:auto;flex:1;min-height:0;';

    _modal.appendChild(hdr);_modal.appendChild(fb);_modal.appendChild(tw);
    document.body.appendChild(_modal);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_isOpen)hideModal();});
}

var _fPc='';

function updateSelectors(history){
    // Ники
    var ns=document.getElementById('godji-hist-nick-sel');
    if(ns){
        var curN=ns.value;
        var nicks=[''];
        history.forEach(function(r){if(r.nick&&nicks.indexOf(r.nick)===-1)nicks.push(r.nick);});
        ns.innerHTML='';
        var o0=document.createElement('option');o0.value='';o0.textContent='Все ники';ns.appendChild(o0);
        nicks.slice(1).sort().forEach(function(n){
            var o=document.createElement('option');o.value=n;o.textContent='@'+n;
            if(n===curN)o.selected=true;ns.appendChild(o);
        });
    }
    // ПК
    var ps=document.getElementById('godji-hist-pc-sel');
    if(ps){
        var curP=ps.value;
        var pcs=[''];
        history.forEach(function(r){if(r.pc&&pcs.indexOf(r.pc)===-1)pcs.push(r.pc);});
        ps.innerHTML='';
        var p0=document.createElement('option');p0.value='';p0.textContent='Все ПК';ps.appendChild(p0);
        pcs.slice(1).sort().forEach(function(p){
            var o=document.createElement('option');o.value=p;o.textContent='ПК '+p;
            if(p===curP)o.selected=true;ps.appendChild(o);
        });
    }
}

function renderTable(){
    if(!_modal)return;
    var tw=document.getElementById('godji-history-table-wrap');
    if(!tw)return;

    var history=loadHistory();

    // Для селекторов — только по дате
    var forSel=history;
    if(_fFrom)forSel=forSel.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)forSel=forSel.filter(function(r){return r.ts<=_fTo;});
    updateSelectors(forSel);

    // Все фильтры
    if(_fNick)history=history.filter(function(r){return (r.nick||'')===_fNick;});
    if(_fPc)history=history.filter(function(r){return (r.pc||'')===_fPc;});
    if(_fText){
        history=history.filter(function(r){
            var h=[r.client,r.nick,r.pc,r.phone,r.label].join(' ').toLowerCase();
            return h.indexOf(_fText)!==-1;
        });
    }
    if(_fFrom)history=history.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)history=history.filter(function(r){return r.ts<=_fTo;});

    if(!history.length){
        tw.innerHTML='<div style="text-align:center;color:#aaa;padding:48px;font-size:14px;">Нет сеансов за 72 часа</div>';
        return;
    }

    // Цвета по типу
    var TCLR={
        'start':{bg:'#e0f0ff',color:'#0066cc'},
        'finish':{bg:'#fde8e8',color:'#cc2200'},
        'wait':{bg:'#f0f0f0',color:'#666666'},
        'change':{bg:'#fff4e0',color:'#c87800'},
    };

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Время','95px'],['Событие','160px'],['ПК','55px'],['Клиент','140px'],['Ник','120px'],['Телефон','115px'],['Прошло','80px']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent=c[0];hr.appendChild(th);
    });
    thead.appendChild(hr);table.appendChild(thead);

    var tbody=document.createElement('tbody');
    history.forEach(function(rec){
        var cfg=TCLR[rec.type]||{bg:'#f5f5f5',color:'#555'};
        var tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});

        function td(content,style,isEl){
            var cell=document.createElement('td');
            cell.style.cssText='padding:9px 12px;'+(style||'');
            if(isEl) cell.appendChild(content);
            else cell.textContent=content||'—';
            return cell;
        }

        // Время
        var d=new Date(rec.ts);
        var timeStr=('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
            ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
        tr.appendChild(td(timeStr,'color:#999;font-size:12px;white-space:nowrap;'));

        // Событие
        var badge=document.createElement('span');
        badge.style.cssText='background:'+cfg.bg+';color:'+cfg.color+';border-radius:5px;padding:3px 7px;font-size:11px;font-weight:700;white-space:nowrap;';
        badge.textContent=rec.label||rec.type;
        tr.appendChild(td(badge,'',true));

        // ПК
        if(rec.pc){
            var pcB=document.createElement('span');
            pcB.style.cssText='background:rgba(0,160,230,0.12);color:#0066aa;border-radius:4px;padding:2px 6px;font-weight:700;font-size:12px;';
            pcB.textContent=rec.pc;
            tr.appendChild(td(pcB,'',true));
        } else tr.appendChild(td('','color:#ccc;'));

        // Клиент
        tr.appendChild(td(rec.client||'','font-size:13px;'));

        // Ник — кликабельный
        if(rec.nick){
            var na=document.createElement('a');
            na.href='javascript:void(0)';
            na.style.cssText='color:#0066aa;font-size:12px;text-decoration:none;cursor:pointer;';
            na.textContent='@'+rec.nick;
            na.addEventListener('click',function(e){
                e.stopPropagation();
                var sb=document.getElementById('godji-search-btn');
                if(sb){sb.click();setTimeout(function(){
                    var inp=document.getElementById('godji-search-input');
                    if(inp){inp.value=rec.nick;inp.dispatchEvent(new Event('input'));}
                },100);}
            });
            tr.appendChild(td(na,'',true));
        } else tr.appendChild(td('','color:#ccc;'));

        // Телефон
        tr.appendChild(td(rec.phone||'','color:#666;font-size:12px;'));
        // Прошло
        tr.appendChild(td(rec.elapsed||'','color:#888;font-size:12px;'));

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tw.innerHTML='';tw.appendChild(table);
}

function showModal(){
    if(!_modal)buildModal();
    renderTable();
    _modal.style.display='flex';
    _overlay.style.display='block';
    _isOpen=true;
}
function hideModal(){
    if(!_modal)return;
    _modal.style.display='none';
    _overlay.style.display='none';
    _isOpen=false;
}
function updateModalIfOpen(){if(_isOpen)renderTable();}

// ── Кнопка сайдбара ───────────────────────────
function createBtn(){
    if(document.getElementById('godji-history-btn'))return;
    var btn=document.createElement('a');
    btn.id='godji-history-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    btn.style.cssText='position:fixed;bottom:426px;left:0;z-index:150;display:flex;align-items:center;gap:12px;width:280px;height:46px;padding:8px 12px 8px 18px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

    var ico=document.createElement('div');
    ico.style.cssText='width:32px;height:32px;border-radius:8px;background:#1565c0;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';

    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.style.cssText='font-size:14px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.1px;';
    lbl.textContent='История сеансов';

    btn.appendChild(ico);btn.appendChild(lbl);
    document.body.appendChild(btn);
    btn.addEventListener('click',function(e){
        e.preventDefault();
        if(_isOpen)hideModal();else showModal();
    });
}

// ── Init ─────────────────────────────────────
function tryInit(){
    if(document.querySelector('tr.mantine-Table-tr[data-index]'))scan();
}

new MutationObserver(function(){
    if(!document.getElementById('godji-history-btn'))createBtn();
}).observe(document.body||document.documentElement,{childList:true,subtree:false});

setTimeout(createBtn,500);
setTimeout(tryInit,3000);
setInterval(scan,2000);

})();

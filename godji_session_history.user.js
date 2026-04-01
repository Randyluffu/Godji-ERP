// ==UserScript==
// @name         Годжи — История сеансов
// @namespace    http://tampermonkey.net/
// @version      4.1
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
function addEntry(entry){
    var history=loadHistory();
    var now=Date.now();
    var isDup=history.some(function(r){
        return r.pc===entry.pc&&now-r.ts<10000;
    });
    if(isDup)return;
    history.unshift(entry);
    saveHistory(history.filter(function(r){return r.ts>now-MAX_MS;}));
    updateModalIfOpen();
}

// Кэш активных сеансов — данные сохраняем пока сеанс активен
var _cache={};

function scan(){
    var rows=document.querySelectorAll('tr.mantine-Table-tr[data-index]');
    if(!rows.length)return;
    var now=Date.now();
    var seen={};

    rows.forEach(function(row){
        // ПК
        var pcCell=row.querySelector('td[data-index="0"]');
        if(!pcCell)return;
        var pc=pcCell.textContent.trim();
        if(!pc||pc==='№ ПК')return;
        seen[pc]=true;

        // Статус сессии (col 8)
        var stCell=row.querySelector('td[data-index="8"]');
        var status='';
        if(stCell){
            var badge=stCell.querySelector('.mantine-Badge-label');
            status=badge?badge.textContent.trim():stCell.textContent.trim();
        }

        // Клиент (col 10)
        var clientCell=row.querySelector('td[data-index="10"]');
        var client=clientCell?clientCell.textContent.trim():'';

        // Ник (col 11)
        var nickCell=row.querySelector('td[data-index="11"]');
        var nick=nickCell?nickCell.textContent.trim().replace(/^@/,''):'';

        // Телефон (col 12)
        var phoneCell=row.querySelector('td[data-index="12"]');
        var phone=phoneCell?phoneCell.textContent.trim():'';

        // Тариф (col 9)
        var tariffCell=row.querySelector('td[data-index="9"]');
        var tariff=tariffCell?tariffCell.textContent.trim():'';

        // Прошло (col 6)
        var pastCell=row.querySelector('td[data-index="6"]');
        var elapsed=pastCell?pastCell.textContent.trim():'';

        // Старт (col 4)
        var startCell=row.querySelector('td[data-index="4"]');
        var startTime=startCell?startCell.textContent.trim():'';

        // Кэшируем если есть данные
        if(client||nick){
            _cache[pc]={client:client,nick:nick,phone:phone,tariff:tariff,
                        elapsed:elapsed,startTime:startTime,status:status};
        }

        // Если был активен — теперь УШЁЛ
        var prev=_cache[pc]||{};
        if((status==='УШЁЛ'||status==='ЗАВЕРШЁН')&&prev.status&&
           prev.status!=='УШЁЛ'&&prev.status!=='ЗАВЕРШЁН'&&prev.status!==''){
            var rec=_cache[pc]||{};
            addEntry({ts:now,pc:pc,
                client:rec.client||client,
                nick:rec.nick||nick,
                phone:rec.phone||phone,
                tariff:rec.tariff||tariff,
                elapsed:rec.elapsed||elapsed,
                startTime:rec.startTime||startTime});
        }
    });

    // ПК пропал из таблицы — сеанс завершён
    Object.keys(_cache).forEach(function(pc){
        if(!seen[pc]&&_cache[pc]&&_cache[pc].status&&
           _cache[pc].status!=='УШЁЛ'&&_cache[pc].status!=='ЗАВЕРШЁН'){
            var rec=_cache[pc];
            if(rec.client||rec.nick){
                addEntry({ts:now,pc:pc,
                    client:rec.client,nick:rec.nick,phone:rec.phone,
                    tariff:rec.tariff,elapsed:rec.elapsed,startTime:rec.startTime});
            }
            delete _cache[pc];
        }
    });
}

// ── Модалка ───────────────────────────────────
var _modal=null,_overlay=null,_isOpen=false;
var _fNick='',_fPc='',_fText='',_fFrom=0,_fTo=0;

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
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var tw=document.createElement('div');tw.style.cssText='display:flex;align-items:center;gap:10px;';
    var ti=document.createElement('div');
    ti.style.cssText='width:32px;height:32px;border-radius:8px;background:#1565c0;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ti.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    var tt=document.createElement('span');
    tt.style.cssText='font-size:15px;font-weight:700;color:#1a1a1a;';
    tt.textContent='История сеансов (72 ч)';
    tw.appendChild(ti);tw.appendChild(tt);
    var cb=document.createElement('button');
    cb.style.cssText='background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    cb.innerHTML='&times;';cb.addEventListener('click',hideModal);
    hdr.appendChild(tw);hdr.appendChild(cb);

    // Фильтры — одна строка
    var fb=document.createElement('div');
    fb.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;overflow-x:auto;';

    function mkSel(id,onChange){
        var s=document.createElement('select');
        s.id=id;
        s.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;max-width:135px;';
        s.addEventListener('change',function(){onChange(this.value);renderTable();});
        return s;
    }
    function mkInp(ph,w,fn){
        var i=document.createElement('input');i.type='text';i.placeholder=ph;
        i.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;width:'+w+';flex-shrink:0;';
        i.addEventListener('input',function(){fn(this.value.toLowerCase());renderTable();});
        return i;
    }
    function mkDT(lbl,fn){
        var w=document.createElement('span');
        w.style.cssText='display:flex;align-items:center;gap:3px;flex-shrink:0;';
        var l=document.createElement('span');
        l.style.cssText='font-size:11px;color:#999;font-weight:600;';l.textContent=lbl;
        var d=document.createElement('input');d.type='datetime-local';
        d.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:3px 5px;font-size:11px;font-family:inherit;background:#fff;color:#444;outline:none;flex-shrink:0;';
        d.addEventListener('change',function(){fn(this.value?new Date(this.value).getTime():0);renderTable();});
        w.appendChild(l);w.appendChild(d);return w;
    }

    var nickSel=mkSel('godji-hist-nick',function(v){_fNick=v;});
    var pcSel=mkSel('godji-hist-pc',function(v){_fPc=v;});
    var searchInp=mkInp('Поиск...','100px',function(v){_fText=v;});
    var dtFrom=mkDT('С:',function(v){_fFrom=v;});
    var dtTo=mkDT('По:',function(v){_fTo=v;});

    fb.appendChild(nickSel);fb.appendChild(pcSel);
    fb.appendChild(searchInp);fb.appendChild(dtFrom);fb.appendChild(dtTo);

    var tableWrap=document.createElement('div');
    tableWrap.id='godji-history-table-wrap';
    tableWrap.style.cssText='overflow-y:auto;flex:1;min-height:0;';

    _modal.appendChild(hdr);_modal.appendChild(fb);_modal.appendChild(tableWrap);
    document.body.appendChild(_modal);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_isOpen)hideModal();});
}

function updateSelectors(data){
    var ns=document.getElementById('godji-hist-nick');
    if(ns){
        var cn=ns.value;var nicks=[];
        data.forEach(function(r){if(r.nick&&nicks.indexOf(r.nick)===-1)nicks.push(r.nick);});
        ns.innerHTML='<option value="">Все ники</option>';
        nicks.sort().forEach(function(n){
            var o=document.createElement('option');o.value=n;o.textContent='@'+n;
            if(n===cn)o.selected=true;ns.appendChild(o);
        });
    }
    var ps=document.getElementById('godji-hist-pc');
    if(ps){
        var cp=ps.value;var pcs=[];
        data.forEach(function(r){if(r.pc&&pcs.indexOf(r.pc)===-1)pcs.push(r.pc);});
        ps.innerHTML='<option value="">Все ПК</option>';
        pcs.sort().forEach(function(p){
            var o=document.createElement('option');o.value=p;o.textContent='ПК '+p;
            if(p===cp)o.selected=true;ps.appendChild(o);
        });
    }
}

function openClient(nick){
    // Открываем карточку клиента через поиск
    var searchBtn=document.getElementById('godji-search-btn');
    if(searchBtn){
        searchBtn.click();
        setTimeout(function(){
            var inp=document.getElementById('godji-search-input');
            if(inp){inp.value=nick;inp.dispatchEvent(new Event('input'));}
        },100);
    }
}

function renderTable(){
    if(!_modal)return;
    var tw=document.getElementById('godji-history-table-wrap');
    if(!tw)return;

    var history=loadHistory();

    // Для селекторов — по текущему диапазону дат
    var forSel=history;
    if(_fFrom)forSel=forSel.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)forSel=forSel.filter(function(r){return r.ts<=_fTo;});
    updateSelectors(forSel);

    // Все фильтры
    if(_fNick)history=history.filter(function(r){return (r.nick||'')===_fNick;});
    if(_fPc)history=history.filter(function(r){return (r.pc||'')===_fPc;});
    if(_fFrom)history=history.filter(function(r){return r.ts>=_fFrom;});
    if(_fTo)history=history.filter(function(r){return r.ts<=_fTo;});
    if(_fText){
        history=history.filter(function(r){
            var h=[r.client,r.nick,r.pc,r.phone,r.tariff].join(' ').toLowerCase();
            return h.indexOf(_fText)!==-1;
        });
    }

    if(!history.length){
        tw.innerHTML='<div style="text-align:center;color:#aaa;padding:48px;font-size:14px;">Нет завершённых сеансов за 72 ч</div>';
        return;
    }

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Дата и время','110px'],['ПК','55px'],['Клиент','150px'],['Ник','120px'],['Телефон','115px'],['Тариф','140px'],['Время сеанса','100px']].forEach(function(c){
        var th=document.createElement('th');
        th.style.cssText='padding:9px 12px;text-align:left;color:#888;font-weight:600;font-size:11px;border-bottom:2px solid #eee;white-space:nowrap;width:'+c[1]+';text-transform:uppercase;letter-spacing:0.3px;';
        th.textContent=c[0];hr.appendChild(th);
    });
    thead.appendChild(hr);table.appendChild(thead);

    var tbody=document.createElement('tbody');
    history.forEach(function(rec){
        var tr=document.createElement('tr');
        tr.style.cssText='border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
        tr.addEventListener('mouseenter',function(){tr.style.background='#f7f9ff';});
        tr.addEventListener('mouseleave',function(){tr.style.background='';});

        function mkTd(content,style){
            var td=document.createElement('td');
            td.style.cssText='padding:9px 12px;'+(style||'');
            if(typeof content==='string') td.textContent=content||'—';
            else if(content) td.appendChild(content);
            else { td.textContent='—'; td.style.color='#ccc'; }
            return td;
        }

        // Время
        var d=new Date(rec.ts);
        var timeStr=('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
            ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
        tr.appendChild(mkTd(timeStr,'color:#999;font-size:12px;white-space:nowrap;'));

        // ПК
        if(rec.pc){
            var pcB=document.createElement('span');
            pcB.style.cssText='background:rgba(0,160,230,0.12);color:#0066aa;border-radius:4px;padding:2px 6px;font-weight:700;font-size:12px;';
            pcB.textContent=rec.pc;
            tr.appendChild(mkTd(pcB));
        } else tr.appendChild(mkTd(''));

        // Клиент
        tr.appendChild(mkTd(rec.client||'','font-size:13px;'));

        // Ник — кликабельный → открывает карточку клиента
        if(rec.nick){
            var na=document.createElement('a');
            na.href='javascript:void(0)';
            na.style.cssText='color:#0066aa;font-size:12px;text-decoration:none;cursor:pointer;font-weight:600;';
            na.textContent='@'+rec.nick;
            (function(nick){
                na.addEventListener('click',function(e){
                    e.stopPropagation();
                    openClient(nick);
                });
            })(rec.nick);
            tr.appendChild(mkTd(na));
        } else tr.appendChild(mkTd(''));

        tr.appendChild(mkTd(rec.phone||'','color:#666;font-size:12px;'));
        tr.appendChild(mkTd(rec.tariff||'','font-size:12px;color:#555;'));
        tr.appendChild(mkTd(rec.elapsed||'','color:#888;font-size:12px;'));

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);tw.innerHTML='';tw.appendChild(table);
}

function showModal(){if(!_modal)buildModal();renderTable();_modal.style.display='flex';_overlay.style.display='block';_isOpen=true;}
function hideModal(){if(!_modal)return;_modal.style.display='none';_overlay.style.display='none';_isOpen=false;}
function updateModalIfOpen(){if(_isOpen)renderTable();}

// ── Кнопка ───────────────────────────────────
function createBtn(){
    if(document.getElementById('godji-history-btn'))return;
    var btn=document.createElement('a');
    btn.id='godji-history-btn';
    btn.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    btn.href='javascript:void(0)';
    // Позиция управляется из godji_client_search через updateHistoryPos
    // Ставим начальное значение top:380px
    btn.style.cssText='position:fixed;top:380px;left:0;z-index:150;display:flex;align-items:center;gap:12px;width:280px;height:46px;padding:8px 12px 8px 18px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

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

new MutationObserver(function(){
    if(!document.getElementById('godji-history-btn'))createBtn();
}).observe(document.body||document.documentElement,{childList:true,subtree:false});

setTimeout(createBtn,500);
setTimeout(function(){if(document.querySelector('tr.mantine-Table-tr[data-index]'))scan();},3000);
setInterval(scan,2000);

})();

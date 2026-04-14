// ==UserScript==
// @name         Годжи — История сеансов
// @namespace    http://tampermonkey.net/
// @version      4.6
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
var MAX_HOURS = 72;
var state = {};
var initialized = false;

function loadHistory(){
    try{
        var raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
        var cutoff=Date.now()-MAX_HOURS*3600000;
        return raw.filter(function(r){return r.ts>cutoff;});
    }catch(e){return[];}
}
function saveHistory(data){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch(e){}
}
function formatDate(ts){
    var d=new Date(ts);
    return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+
           ' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}

// Читаем состояние таблицы — оригинальные col-*-size селекторы из v3.4
function getTableState(){
    var result={};
    var rows=document.querySelectorAll('tr.mantine-Table-tr');
    for(var i=0;i<rows.length;i++){
        var nameCell=rows[i].querySelector('td[style*="col-deviceName-size"]');
        if(!nameCell)continue;
        var pcName=nameCell.textContent.trim();
        if(!pcName)continue;

        var sessionCell=rows[i].querySelector('td[style*="col-sessionStatus-size"]');
        if(!sessionCell)continue;
        var badge=sessionCell.querySelector('.mantine-Badge-label');
        var sessionStatus=badge?badge.textContent.trim():sessionCell.textContent.trim();

        var pastCell=rows[i].querySelector('td[style*="col-sessionPastTime-size"]');
        var pastTime=pastCell?pastCell.textContent.trim():'';

        // Ник — берём href из ссылки (как в v3.4)
        var nickCell=rows[i].querySelector('td[style*="col-userNickname-size"]');
        var nickLink=nickCell?nickCell.querySelector('a'):null;
        var nick=nickLink?nickLink.textContent.trim().replace(/^@+/,''):'';
        var clientUrl=nickLink?nickLink.getAttribute('href'):'';

        // Имя клиента
        var userCell=rows[i].querySelector('td[style*="col-userName-size"]');
        var userLink=userCell?userCell.querySelector('a'):null;
        var userName=userLink?userLink.textContent.trim():'';
        if(!clientUrl&&userLink) clientUrl=userLink.getAttribute('href')||'';

        var phoneCell=rows[i].querySelector('td[style*="col-userPhone-size"]');
        var phone=phoneCell?phoneCell.textContent.trim():'';

        result[pcName]={session:sessionStatus,pastTime:pastTime,
            userName:userName,nick:nick,clientUrl:clientUrl,phone:phone};
    }
    return result;
}

function scan(){
    if(!initialized)return;
    var current=getTableState();
    if(Object.keys(state).length===0&&Object.keys(current).length>0){
        for(var pcX in current)state[pcX]=current[pcX];
        return;
    }
    var history=loadHistory();
    var changed=false;
    for(var pc in current){
        var oldSession=state[pc]?state[pc].session:undefined;
        var newSession=current[pc].session;
        if(oldSession==='Играет'&&newSession!=='Играет'){
            var prev=state[pc];
            var now=Date.now();
            var isDup=history.some(function(r){return r.pc===pc&&now-r.ts<10000;});
            if(!isDup){
                history.unshift({ts:now,pc:pc,
                    userName:prev.userName||'',nick:prev.nick,
                    clientUrl:prev.clientUrl,phone:prev.phone,pastTime:prev.pastTime});
                var cutoff=Date.now()-MAX_HOURS*3600000;
                history=history.filter(function(r){return r.ts>cutoff;});
                changed=true;
            }
        }
        state[pc]=current[pc];
    }
    if(changed){
        saveHistory(history);updateModal();
        // Уведомляем историю операций о событиях сеансов
        try{ localStorage.setItem('godji_session_events', JSON.stringify({
            ts: Date.now(),
            events: history.filter(function(r){return Date.now()-r.ts<15000;}).slice(0,5)
        })); } catch(e){}
    }
}

function tryInit(){
    var current=getTableState();
    var keys=Object.keys(current);
    var hasData=false;
    for(var i=0;i<keys.length;i++){if(current[keys[i]].session){hasData=true;break;}}
    if(keys.length===0||!hasData){setTimeout(tryInit,1000);return;}
    setTimeout(function(){
        var final=getTableState();
        for(var pc in final)state[pc]=final[pc];
        initialized=true;
    },1500);
}

// ── Модальное окно ────────────────────────────
var modal=null,modalVisible=false;
var filterPc='',filterNick='',filterText='',filterFrom=0,filterTo=0;

function createModal(){
    modal=document.createElement('div');
    modal.id='godji-history-modal';
    modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;width:780px;max-width:96vw;max-height:85vh;background:#fff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);display:none;flex-direction:column;font-family:inherit;overflow:hidden;';

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';
    var tw=document.createElement('div');tw.style.cssText='display:flex;align-items:center;gap:10px;';
    var ti=document.createElement('div');
    ti.style.cssText='width:32px;height:32px;border-radius:8px;background:#1565c0;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ti.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
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
    fb.style.cssText='display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fafafa;overflow-x:auto;white-space:nowrap;';

    function mkSel(id,placeholder,onChange){
        var s=document.createElement('select');s.id=id;
        s.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 6px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;cursor:pointer;flex-shrink:0;max-width:130px;';
        s.addEventListener('change',function(){onChange(this.value);updateModal();});
        return s;
    }
    function mkInp(ph,w,fn){
        var i=document.createElement('input');i.type='text';i.placeholder=ph;
        i.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;background:#fff;color:#444;outline:none;width:'+w+';flex-shrink:0;';
        i.addEventListener('input',function(){fn(this.value.toLowerCase());updateModal();});
        return i;
    }
    function mkDT(lbl,fn){
        var w=document.createElement('span');
        w.style.cssText='display:flex;align-items:center;gap:3px;flex-shrink:0;';
        var l=document.createElement('span');
        l.style.cssText='font-size:11px;color:#999;font-weight:600;';l.textContent=lbl;
        var d=document.createElement('input');d.type='datetime-local';
        d.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:3px 4px;font-size:11px;font-family:inherit;background:#fff;color:#444;outline:none;flex-shrink:0;';
        d.addEventListener('change',function(){fn(this.value?new Date(this.value).getTime():0);updateModal();});
        w.appendChild(l);w.appendChild(d);return w;
    }

    var pcSel=mkSel('godji-hist-pc','',function(v){filterPc=v;});
    var nickSel=mkSel('godji-hist-nick','',function(v){filterNick=v;});
    var searchInp=mkInp('Поиск...','100px',function(v){filterText=v;});
    var dtFrom=mkDT('С:',function(v){filterFrom=v;});
    var dtTo=mkDT('По:',function(v){filterTo=v;});

    // Кнопка сброса фильтров
    var resetBtn=document.createElement('button');
    resetBtn.style.cssText='border:1px solid #e0e0e0;border-radius:6px;padding:4px 10px;font-size:12px;font-family:inherit;background:#fff;color:#888;outline:none;cursor:pointer;flex-shrink:0;white-space:nowrap;';
    resetBtn.textContent='Сбросить';
    resetBtn.addEventListener('click',function(){
        filterPc='';filterNick='';filterText='';filterFrom=0;filterTo=0;
        fb.querySelectorAll('select').forEach(function(s){s.value='';});
        fb.querySelectorAll('input[type="text"]').forEach(function(i){i.value='';});
        fb.querySelectorAll('input[type="datetime-local"]').forEach(function(i){i.value='';});
        updateModal();
    });

    fb.appendChild(pcSel);fb.appendChild(nickSel);
    fb.appendChild(searchInp);fb.appendChild(dtFrom);fb.appendChild(dtTo);
    fb.appendChild(resetBtn);

    var tableWrap=document.createElement('div');
    tableWrap.id='godji-history-table-wrap';
    tableWrap.style.cssText='overflow-y:auto;flex:1;min-height:0;';

    modal.appendChild(hdr);modal.appendChild(fb);modal.appendChild(tableWrap);
    document.body.appendChild(modal);

    var overlay=document.createElement('div');
    overlay.id='godji-history-overlay';
    overlay.style.cssText='position:fixed;inset:0;z-index:99997;display:none;background:rgba(0,0,0,0.45);';
    overlay.addEventListener('click',hideModal);
    document.body.appendChild(overlay);

    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modalVisible)hideModal();});
}

function updateModal(){
    if(!modal)return;
    var wrap=document.getElementById('godji-history-table-wrap');
    if(!wrap)return;

    var history=loadHistory();

    // Обновляем селекторы по текущему периоду (до применения других фильтров)
    var forSel=history;
    if(filterFrom)forSel=forSel.filter(function(r){return r.ts>=filterFrom;});
    if(filterTo)forSel=forSel.filter(function(r){return r.ts<=filterTo;});

    var pcSel=document.getElementById('godji-hist-pc');
    if(pcSel){
        var curPc=pcSel.value||filterPc;
        var pcs=[];
        forSel.forEach(function(r){if(r.pc&&pcs.indexOf(r.pc)===-1)pcs.push(r.pc);});
        pcs.sort();
        pcSel.innerHTML='<option value="">Все ПК</option>';
        pcs.forEach(function(p){
            var o=document.createElement('option');o.value=p;o.textContent='ПК '+p;
            if(p===curPc)o.selected=true;pcSel.appendChild(o);
        });
    }
    var nickSel=document.getElementById('godji-hist-nick');
    if(nickSel){
        var curNick=nickSel.value||filterNick;
        var nicks=[];
        forSel.forEach(function(r){if(r.nick&&nicks.indexOf(r.nick)===-1)nicks.push(r.nick);});
        nicks.sort();
        nickSel.innerHTML='<option value="">Все ники</option>';
        nicks.forEach(function(n){
            var o=document.createElement('option');o.value=n;o.textContent=n;
            if(n===curNick)o.selected=true;nickSel.appendChild(o);
        });
    }

    // Применяем все фильтры
    if(filterPc)history=history.filter(function(r){return r.pc===filterPc;});
    if(filterNick)history=history.filter(function(r){return r.nick===filterNick;});
    if(filterFrom)history=history.filter(function(r){return r.ts>=filterFrom;});
    if(filterTo)history=history.filter(function(r){return r.ts<=filterTo;});
    if(filterText){
        history=history.filter(function(r){
            var h=[r.userName,r.nick,r.pc,r.phone].join(' ').toLowerCase();
            return h.indexOf(filterText)!==-1;
        });
    }

    if(!history.length){
        wrap.innerHTML='<div style="text-align:center;color:#aaa;padding:48px;font-size:14px;">Нет завершённых сеансов за 72 ч</div>';
        return;
    }

    var table=document.createElement('table');
    table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

    var thead=document.createElement('thead');
    thead.style.cssText='position:sticky;top:0;background:#f9f9f9;z-index:1;';
    var hr=document.createElement('tr');
    [['Дата и время','110px'],['ПК','55px'],['Клиент','150px'],['Ник','130px'],['Телефон','115px'],['Время сеанса','95px']].forEach(function(c){
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

        // Дата
        var tdD=document.createElement('td');
        tdD.style.cssText='padding:9px 12px;color:#999;font-size:12px;white-space:nowrap;';
        tdD.textContent=formatDate(rec.ts);

        // ПК
        var tdPc=document.createElement('td');
        tdPc.style.cssText='padding:9px 12px;';
        var pcB=document.createElement('span');
        pcB.style.cssText='background:rgba(0,160,230,0.12);color:#0066aa;border-radius:4px;padding:2px 6px;font-weight:700;font-size:12px;';
        pcB.textContent=rec.pc||'—';tdPc.appendChild(pcB);

        // Клиент — ссылка на карточку (clientUrl из DOM)
        var tdN=document.createElement('td');
        tdN.style.cssText='padding:9px 12px;';
        if(rec.userName&&rec.clientUrl){
            var aU=document.createElement('a');
            aU.href=rec.clientUrl;
            aU.style.cssText='color:#1a1a1a;text-decoration:none;font-weight:500;';
            aU.textContent=rec.userName;
            aU.addEventListener('mouseenter',function(){aU.style.textDecoration='underline';});
            aU.addEventListener('mouseleave',function(){aU.style.textDecoration='none';});
            tdN.appendChild(aU);
        } else { tdN.style.color='#ccc'; tdN.textContent='—'; }

        // Ник — ссылка на карточку
        var tdNk=document.createElement('td');
        tdNk.style.cssText='padding:9px 12px;';
        if(rec.nick&&rec.clientUrl){
            var aNk=document.createElement('a');
            aNk.href=rec.clientUrl;
            aNk.style.cssText='color:#0066aa;text-decoration:none;font-weight:600;font-size:12px;';
            aNk.textContent='@'+rec.nick;
            aNk.addEventListener('mouseenter',function(){aNk.style.textDecoration='underline';});
            aNk.addEventListener('mouseleave',function(){aNk.style.textDecoration='none';});
            tdNk.appendChild(aNk);
        } else { tdNk.style.color='#ccc'; tdNk.textContent='—'; }

        // Телефон
        var tdPh=document.createElement('td');
        tdPh.style.cssText='padding:9px 12px;color:#666;font-size:12px;';
        tdPh.textContent=rec.phone||'—';

        // Время
        var tdT=document.createElement('td');
        tdT.style.cssText='padding:9px 12px;color:#888;font-size:12px;';
        tdT.textContent=rec.pastTime||'—';

        [tdD,tdPc,tdN,tdNk,tdPh,tdT].forEach(function(td){tr.appendChild(td);});
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);wrap.innerHTML='';wrap.appendChild(table);
}

function showModal(){
    if(!modal)createModal();
    updateModal();
    modal.style.display='flex';
    document.getElementById('godji-history-overlay').style.display='block';
    modalVisible=true;
}
function hideModal(){
    if(!modal)return;
    modal.style.display='none';
    document.getElementById('godji-history-overlay').style.display='none';
    modalVisible=false;
}

// ── Кнопка в сайдбаре ────────────────────────────────────
function hasSidebar(){
    return !!document.querySelector('.Sidebar_linksInner__oTy_4');
}

function createSidebarButton(){
    if(!hasSidebar()) return;
    if(document.getElementById('godji-history-btn')) return;
    var sb = document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb) return;

    var wrap=document.createElement('a');
    wrap.id='godji-history-btn';
    wrap.className='mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
    wrap.href='javascript:void(0)';

    // Точная структура оригинального NavLink
    var sec=document.createElement('span');
    sec.className='m_690090b5 mantine-NavLink-section';
    sec.setAttribute('data-position','left');
    var ico=document.createElement('div');
    ico.className='LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:#1565c0;--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    sec.appendChild(ico);

    var body=document.createElement('div');
    body.className='m_f07af9d2 mantine-NavLink-body';
    var lbl=document.createElement('span');
    lbl.className='m_1f6ac4c4 mantine-NavLink-label';
    lbl.textContent='История сеансов';
    body.appendChild(lbl);

    wrap.appendChild(sec); wrap.appendChild(body);
    wrap.addEventListener('click',function(e){
        e.stopPropagation();
        if(modalVisible) hideModal(); else showModal();
    });

    // Вставляем сразу после opj-btn, иначе перед первым display:none
    var opj = sb.querySelector('#godji-opj-btn');
    if(opj && opj.nextSibling){
        sb.insertBefore(wrap, opj.nextSibling);
    } else if(opj){
        sb.appendChild(wrap);
    } else {
        var allCh=sb.children, anch=null;
        for(var ci=0;ci<allCh.length;ci++){
            if(allCh[ci].style&&allCh[ci].style.display==='none'){anch=allCh[ci];break;}
        }
        if(anch) sb.insertBefore(wrap,anch);
        else sb.appendChild(wrap);
    }
}

setTimeout(tryInit,5000);
setInterval(scan,2000);
function tryCreateHistBtn(){
    if(document.getElementById('godji-history-btn')) return;
    var sb=document.querySelector('.Sidebar_linksInner__oTy_4');
    if(!sb){ setTimeout(tryCreateHistBtn,500); return; }
    createSidebarButton();
}
setTimeout(tryCreateHistBtn,1000);
new MutationObserver(function(){
    if(!document.getElementById('godji-history-btn')) tryCreateHistBtn();
}).observe(document.body||document.documentElement,{childList:true,subtree:false});

})();

// ==UserScript==
// @name         Годжи — Напоминания
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Менеджер напоминаний в стиле ERP
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

var STORAGE_KEY = 'godji_reminders_v2';

function load(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch(e){return[];} }
function save(d){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch(e){} }
function genId(){ return 'r'+Date.now()+Math.random().toString(36).slice(2,5); }
function pad(n){ return String(n).padStart(2,'0'); }
function toLocalISO(d){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString(); }
function fmtDt(iso){ var d=new Date(iso); return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }

// ── Звук ──────────────────────────────────────────────────
function playSound(){
    try{
        var ctx=new(window.AudioContext||window.webkitAudioContext)();
        [[0,660],[0.2,880],[0.4,1100]].forEach(function(pair){
            var osc=ctx.createOscillator(), gain=ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value=pair[1]; osc.type='sine';
            var t=ctx.currentTime+pair[0];
            gain.gain.setValueAtTime(0,t);
            gain.gain.linearRampToValueAtTime(0.5,t+0.05);
            gain.gain.linearRampToValueAtTime(0,t+0.35);
            osc.start(t); osc.stop(t+0.4);
        });
    }catch(e){}
}

// ── Уведомление (висит пока не закроешь) ─────────────────
var _notifyQueue=[];
function showNotify(title){
    playSound();
    var existing=document.querySelectorAll('.godji-rem-toast');
    var offset=existing.length*80;

    var box=document.createElement('div');
    box.className='godji-rem-toast';
    box.style.cssText='position:fixed;top:'+(20+offset)+'px;right:20px;z-index:999999;'+
        'background:#1a1b2e;border:1px solid rgba(255,255,255,0.12);border-left:3px solid #cc0001;'+
        'border-radius:10px;padding:12px 16px;min-width:280px;max-width:340px;'+
        'box-shadow:0 8px 32px rgba(0,0,0,0.6);font-family:inherit;'+
        'display:flex;align-items:flex-start;gap:10px;animation:remSlide 0.3s ease;';

    var style=document.getElementById('godji-rem-style');
    if(!style){
        style=document.createElement('style');
        style.id='godji-rem-style';
        style.textContent='@keyframes remSlide{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}';
        document.head.appendChild(style);
    }

    var ico=document.createElement('div');
    ico.className='m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant','filled');
    ico.style.cssText='width:32px;height:32px;min-width:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>';

    var txt=document.createElement('div');
    txt.style.cssText='flex:1;';
    var lbl=document.createElement('div');
    lbl.style.cssText='font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px;';
    lbl.textContent='Напоминание';
    var msg=document.createElement('div');
    msg.style.cssText='font-size:13px;font-weight:600;color:#fff;line-height:1.4;';
    msg.textContent=title;
    txt.appendChild(lbl); txt.appendChild(msg);

    var closeBtn=document.createElement('button');
    closeBtn.style.cssText='background:none;border:none;color:rgba(255,255,255,0.3);font-size:18px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;transition:color 0.15s;';
    closeBtn.textContent='×';
    closeBtn.addEventListener('mouseenter',function(){closeBtn.style.color='rgba(255,255,255,0.7)';});
    closeBtn.addEventListener('mouseleave',function(){closeBtn.style.color='rgba(255,255,255,0.3)';});
    closeBtn.addEventListener('click',function(){box.remove();});

    box.appendChild(ico); box.appendChild(txt); box.appendChild(closeBtn);
    document.body.appendChild(box);
}

// ── Проверка (каждую секунду для точности) ───────────────
var _firedKeys={};
setInterval(function(){
    var now=new Date();
    var hhmm=pad(now.getHours())+':'+pad(now.getMinutes());
    var ss=now.getSeconds();
    var dayOfWeek=now.getDay();
    var dayOfMonth=now.getDate();
    var dateMin=now.toISOString().slice(0,16);

    var reminders=load(), changed=false;
    reminders=reminders.filter(function(rem){
        if(rem.type==='once'){
            var remMin=rem.datetime?rem.datetime.slice(0,16):'';
            if(remMin===dateMin && !rem.fired){
                if(!_firedKeys[rem.id]){ _firedKeys[rem.id]=true; showNotify(rem.title); }
                rem.fired=true; changed=true;
                return false;
            }
            // Чистим уже прошедшие
            if(rem.datetime && new Date(rem.datetime)<now && rem.fired) return false;
            return true;
        }
        if(rem.type==='schedule'){
            // Проверяем только в начале минуты (секунда 0-2)
            if(ss>2) return true;
            var times=rem.times||[];
            if(times.indexOf(hhmm)===-1) return true;
            var dayOk=false;
            if(rem.repeat==='daily') dayOk=true;
            else if(rem.repeat==='weekdays') dayOk=(rem.weekdays||[]).indexOf(dayOfWeek)!==-1;
            else if(rem.repeat==='dates') dayOk=(rem.dates||[]).indexOf(dayOfMonth)!==-1;
            if(!dayOk) return true;

            var fireKey=rem.id+'_'+dateMin;
            if(_firedKeys[fireKey]) return true;
            _firedKeys[fireKey]=true;
            rem.firedTimes=rem.firedTimes||[];
            rem.firedTimes.push(dateMin);
            // Чистим старые (>24ч)
            var cutoff=new Date(Date.now()-86400000).toISOString().slice(0,16);
            rem.firedTimes=rem.firedTimes.filter(function(t){return t>cutoff;});
            showNotify(rem.title);
            changed=true;
            if(!rem.permanent) return false;
            return true;
        }
        return true;
    });
    if(changed) save(reminders);
},1000);

// ── Модальное окно (стиль ERP — тёмный) ──────────────────
var _modal=null,_overlay=null,_open=false;

function inp(ph,type){
    var el=document.createElement('input');
    el.type=type||'text'; el.placeholder=ph||'';
    el.style.cssText='width:100%;padding:8px 11px;background:rgba(255,255,255,0.07);'+
        'border:1px solid rgba(255,255,255,0.12);border-radius:7px;font-size:13px;'+
        'font-family:inherit;color:#fff;outline:none;box-sizing:border-box;transition:border-color 0.15s;';
    el.addEventListener('focus',function(){el.style.borderColor='rgba(204,0,1,0.7)';});
    el.addEventListener('blur',function(){el.style.borderColor='rgba(255,255,255,0.12)';});
    return el;
}
function sel(opts){
    var el=document.createElement('select');
    el.style.cssText='width:100%;padding:8px 11px;background:#2a2b3e;'+
        'border:1px solid rgba(255,255,255,0.12);border-radius:7px;font-size:13px;'+
        'font-family:inherit;color:#fff;outline:none;box-sizing:border-box;cursor:pointer;';
    opts.forEach(function(o){
        var opt=document.createElement('option');
        opt.value=o[0]; opt.textContent=o[1]; opt.style.background='#2a2b3e'; opt.style.color='#fff';
        el.appendChild(opt);
    });
    return el;
}
function lbl(text){
    var el=document.createElement('div');
    el.style.cssText='font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;';
    el.textContent=text; return el;
}
function section(){ var el=document.createElement('div'); el.style.cssText='display:flex;flex-direction:column;gap:4px;'; return el; }
function typeBtn(text,active){
    var el=document.createElement('button'); el.type='button';
    el.style.cssText='flex:1;padding:7px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;'+
        'border:1px solid rgba(255,255,255,0.12);font-family:inherit;transition:all 0.15s;'+
        'background:'+(active?'#cc0001':'rgba(255,255,255,0.07)')+';color:'+(active?'#fff':'rgba(255,255,255,0.5)')+';';
    el.textContent=text; return el;
}
function dayBtn(text,i,arr){
    var active=arr.indexOf(i)!==-1;
    var el=document.createElement('button'); el.type='button';
    el.style.cssText='padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;'+
        'border:1px solid rgba(255,255,255,0.12);font-family:inherit;transition:all 0.15s;'+
        'background:'+(active?'#cc0001':'rgba(255,255,255,0.07)')+';color:'+(active?'#fff':'rgba(255,255,255,0.45)')+';';
    el.textContent=text; return el;
}

function buildModal(){
    _overlay=document.createElement('div');
    _overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99997;display:none;';
    _overlay.addEventListener('click',hideModal);
    document.body.appendChild(_overlay);
    _modal=document.createElement('div');
    _modal.style.cssText='position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99998;'+
        'width:460px;max-width:96vw;max-height:88vh;background:#1a1b2e;'+
        'border:1px solid rgba(255,255,255,0.1);border-radius:14px;'+
        'box-shadow:0 8px 40px rgba(0,0,0,0.7);display:none;flex-direction:column;'+
        'font-family:inherit;overflow:hidden;';
    document.body.appendChild(_modal);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_open)hideModal();});
}

function descRem(rem){
    if(rem.type==='once') return 'Разово: '+fmtDt(rem.datetime);
    var parts=[(rem.times||[]).join(', ')];
    if(rem.repeat==='daily') parts.push('ежедневно');
    else if(rem.repeat==='weekdays'){var dn=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];parts.push((rem.weekdays||[]).map(function(i){return dn[i];}).join(', '));}
    else if(rem.repeat==='dates') parts.push('числа: '+(rem.dates||[]).sort(function(a,b){return a-b;}).join(', '));
    if(rem.interval&&rem.interval>1) parts.push('каждые '+rem.interval+' мин');
    return parts.join(' · ');
}

function renderModal(){
    if(!_modal) return;
    _modal.innerHTML='';

    // Шапка
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';
    var hL=document.createElement('div'); hL.style.cssText='display:flex;align-items:center;gap:9px;';
    var hI=document.createElement('div'); hI.style.cssText='width:28px;height:28px;border-radius:7px;background:#cc0001;display:flex;align-items:center;justify-content:center;';
    hI.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>';
    var hT=document.createElement('span'); hT.style.cssText='font-size:14px;font-weight:700;color:#fff;'; hT.textContent='Напоминания';
    hL.appendChild(hI); hL.appendChild(hT);
    var xB=document.createElement('button'); xB.style.cssText='background:none;border:none;color:rgba(255,255,255,0.35);font-size:20px;cursor:pointer;padding:0;line-height:1;';
    xB.textContent='×'; xB.addEventListener('click',hideModal);
    hdr.appendChild(hL); hdr.appendChild(xB); _modal.appendChild(hdr);

    var body=document.createElement('div');
    body.style.cssText='overflow-y:auto;flex:1;padding:14px 18px;display:flex;flex-direction:column;gap:10px;';
    _modal.appendChild(body);

    // Список активных
    var rems=load();
    if(rems.length){
        var lt=document.createElement('div'); lt.style.cssText='font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;';
        lt.textContent='Активные ('+rems.length+')'; body.appendChild(lt);
        rems.forEach(function(rem){
            var row=document.createElement('div');
            row.style.cssText='display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:9px 11px;';
            var info=document.createElement('div'); info.style.cssText='flex:1;min-width:0;';
            var rt=document.createElement('div'); rt.style.cssText='font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'; rt.textContent=rem.title;
            var rs=document.createElement('div'); rs.style.cssText='font-size:11px;color:rgba(255,255,255,0.35);margin-top:2px;'; rs.textContent=descRem(rem);
            info.appendChild(rt); info.appendChild(rs);
            if(rem.permanent){
                var pt=document.createElement('span'); pt.style.cssText='font-size:10px;font-weight:700;color:#cc0001;background:rgba(204,0,1,0.12);padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;';
                pt.textContent='∞'; row.appendChild(info); row.appendChild(pt);
            } else { row.appendChild(info); }
            var del=document.createElement('button'); del.style.cssText='background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.3);font-size:14px;cursor:pointer;width:24px;height:24px;border-radius:5px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
            del.textContent='×';
            del.addEventListener('click',function(){save(load().filter(function(r){return r.id!==rem.id;}));renderModal();});
            row.appendChild(del); body.appendChild(row);
        });
    }

    // Разделитель
    var sep=document.createElement('div'); sep.style.cssText='border-top:1px solid rgba(255,255,255,0.07);margin:2px 0;'; body.appendChild(sep);

    // Форма
    var ft=document.createElement('div'); ft.style.cssText='font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.8px;'; ft.textContent='Новое напоминание'; body.appendChild(ft);

    // Название
    var titleSec=section(); titleSec.appendChild(lbl('Текст'));
    var titleInp=inp('Текст напоминания'); titleSec.appendChild(titleInp); body.appendChild(titleSec);

    // Тип
    var typeRow=document.createElement('div'); typeRow.style.cssText='display:flex;gap:6px;';
    var btnOnce=typeBtn('Разовое',true), btnSched=typeBtn('По расписанию',false);
    typeRow.appendChild(btnOnce); typeRow.appendChild(btnSched); body.appendChild(typeRow);

    // Блок разового
    var onceBlock=section();
    var dtSec=section(); dtSec.appendChild(lbl('Дата и время'));
    var dtInp=inp('','datetime-local'); dtInp.style.colorScheme='dark';
    var now=new Date();
    dtInp.min=toLocalISO(now).slice(0,16);
    dtInp.max=toLocalISO(new Date(now.getTime()+30*86400000)).slice(0,16);
    dtInp.value=toLocalISO(now).slice(0,16);
    dtSec.appendChild(dtInp); onceBlock.appendChild(dtSec); body.appendChild(onceBlock);

    // Блок расписания
    var schedBlock=document.createElement('div'); schedBlock.style.cssText='display:none;flex-direction:column;gap:8px;';

    // Времена
    var timesSec=section(); timesSec.appendChild(lbl('Время срабатывания'));
    var timesWrap=document.createElement('div'); timesWrap.style.cssText='display:flex;flex-wrap:wrap;gap:5px;align-items:center;';
    var timesList=[];
    function renderTimes(){
        timesWrap.innerHTML='';
        timesList.forEach(function(t){
            var tag=document.createElement('span');
            tag.style.cssText='background:rgba(204,0,1,0.2);color:#ff6666;border-radius:5px;padding:3px 7px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:3px;cursor:pointer;';
            tag.innerHTML=t+' <span style="opacity:0.6;font-size:13px;">×</span>';
            tag.addEventListener('click',function(){timesList=timesList.filter(function(x){return x!==t;});renderTimes();});
            timesWrap.appendChild(tag);
        });
        var addI=inp('','time'); addI.style.width='90px'; addI.style.padding='4px 8px';
        addI.addEventListener('change',function(){
            if(addI.value&&timesList.indexOf(addI.value)===-1){timesList.push(addI.value);timesList.sort();renderTimes();}
        });
        timesWrap.appendChild(addI);
    }
    renderTimes();
    timesSec.appendChild(timesWrap); schedBlock.appendChild(timesSec);

    // Периодичность (интервал)
    var intervalSec=section(); intervalSec.appendChild(lbl('Периодичность'));
    var intervalSel=sel([['0','Без периодичности (только в заданное время)'],['5','Каждые 5 минут'],['10','Каждые 10 минут'],['15','Каждые 15 минут'],['30','Каждые 30 минут'],['60','Каждый час']]);
    intervalSec.appendChild(intervalSel); schedBlock.appendChild(intervalSec);

    // Повторение
    var repeatSec=section(); repeatSec.appendChild(lbl('Повторение'));
    var repeatSel=sel([['daily','Ежедневно'],['weekdays','По дням недели'],['dates','По числам месяца']]);
    repeatSec.appendChild(repeatSel); schedBlock.appendChild(repeatSec);

    // Дни недели
    var wdBlock=document.createElement('div'); wdBlock.style.cssText='display:none;flex-wrap:wrap;gap:5px;';
    var wdSelected=[];
    ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'].forEach(function(name,i){
        var b=dayBtn(name,i,wdSelected);
        b.addEventListener('click',function(){
            var idx=wdSelected.indexOf(i);
            if(idx===-1){wdSelected.push(i);b.style.background='#cc0001';b.style.color='#fff';b.style.borderColor='#cc0001';}
            else{wdSelected.splice(idx,1);b.style.background='rgba(255,255,255,0.07)';b.style.color='rgba(255,255,255,0.45)';b.style.borderColor='rgba(255,255,255,0.12)';}
        });
        wdBlock.appendChild(b);
    });
    schedBlock.appendChild(wdBlock);

    // Числа месяца
    var datesBlock=document.createElement('div'); datesBlock.style.cssText='display:none;flex-wrap:wrap;gap:4px;';
    var datesSelected=[];
    for(var d=1;d<=31;d++){(function(day){
        var b=dayBtn(day,day,datesSelected); b.style.width='30px'; b.style.padding='4px 0'; b.style.textAlign='center';
        b.addEventListener('click',function(){
            var idx=datesSelected.indexOf(day);
            if(idx===-1){datesSelected.push(day);b.style.background='#cc0001';b.style.color='#fff';b.style.borderColor='#cc0001';}
            else{datesSelected.splice(idx,1);b.style.background='rgba(255,255,255,0.07)';b.style.color='rgba(255,255,255,0.45)';b.style.borderColor='rgba(255,255,255,0.12)';}
        });
        datesBlock.appendChild(b);
    })(d);}
    schedBlock.appendChild(datesBlock);

    repeatSel.addEventListener('change',function(){
        wdBlock.style.display=this.value==='weekdays'?'flex':'none';
        datesBlock.style.display=this.value==='dates'?'flex':'none';
    });

    // Постоянное
    var permRow=document.createElement('div'); permRow.style.cssText='display:flex;align-items:center;gap:7px;';
    var permCb=document.createElement('input'); permCb.type='checkbox'; permCb.style.cssText='cursor:pointer;accent-color:#cc0001;width:14px;height:14px;';
    var permLbl=document.createElement('label'); permLbl.style.cssText='font-size:12px;color:rgba(255,255,255,0.6);cursor:pointer;'; permLbl.textContent='Постоянное (не удалять после срабатывания)';
    permCb.id='rem-perm-cb'; permLbl.htmlFor='rem-perm-cb';
    permRow.appendChild(permCb); permRow.appendChild(permLbl); schedBlock.appendChild(permRow);

    body.appendChild(schedBlock);

    // Переключение типа
    var isOnce=true;
    function setType(once){
        isOnce=once;
        btnOnce.style.background=once?'#cc0001':'rgba(255,255,255,0.07)'; btnOnce.style.color=once?'#fff':'rgba(255,255,255,0.5)';
        btnSched.style.background=!once?'#cc0001':'rgba(255,255,255,0.07)'; btnSched.style.color=!once?'#fff':'rgba(255,255,255,0.5)';
        onceBlock.style.display=once?'flex':'none';
        schedBlock.style.display=!once?'flex':'none';
    }
    btnOnce.addEventListener('click',function(){setType(true);});
    btnSched.addEventListener('click',function(){setType(false);});

    // Кнопка добавить
    var addBtn=document.createElement('button');
    addBtn.style.cssText='width:100%;padding:10px;background:#cc0001;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:2px;transition:background 0.15s;';
    addBtn.textContent='+ Добавить';
    addBtn.addEventListener('mouseenter',function(){addBtn.style.background='#aa0001';});
    addBtn.addEventListener('mouseleave',function(){addBtn.style.background='#cc0001';});
    addBtn.addEventListener('click',function(){
        var title=titleInp.value.trim();
        if(!title){titleInp.style.borderColor='#cc0001';titleInp.focus();return;}
        var rem={id:genId(),title:title};
        if(isOnce){
            if(!dtInp.value){dtInp.style.borderColor='#cc0001';dtInp.focus();return;}
            rem.type='once'; rem.datetime=new Date(dtInp.value).toISOString();
        } else {
            if(!timesList.length){return;}
            rem.type='schedule'; rem.times=timesList.slice();
            rem.repeat=repeatSel.value; rem.permanent=permCb.checked; rem.firedTimes=[];
            var iv=parseInt(intervalSel.value)||0;
            if(iv>0) rem.interval=iv;
            if(rem.repeat==='weekdays') rem.weekdays=wdSelected.slice();
            if(rem.repeat==='dates') rem.dates=datesSelected.slice();
        }
        var all=load(); all.push(rem); save(all); renderModal();
    });
    body.appendChild(addBtn);
}

function showModal(){if(!_modal)buildModal();renderModal();_modal.style.display='flex';_overlay.style.display='block';_open=true;}
function hideModal(){if(!_modal)return;_modal.style.display='none';_overlay.style.display='none';_open=false;}

// ── Кнопка + на колокольчике ──────────────────────────────
function createPlusBtn(){
    if(document.getElementById('godji-rem-plus')) return;
    // Ищем индикатор вокруг колокольчика
    var indicator=document.querySelector('.mantine-Indicator-root');
    if(!indicator) return;

    var btn=document.createElement('button');
    btn.id='godji-rem-plus';
    btn.type='button'; btn.title='Напоминания';
    // Стилизуем как маленькую кнопку ERP рядом с колокольчиком
    btn.style.cssText=[
        'position:absolute','top:-4px','right:-4px','z-index:10',
        'width:16px','height:16px','border-radius:50%',
        'background:#cc0001','border:2px solid var(--mantine-color-body,#1a1b2e)',
        'color:#fff','font-size:11px','font-weight:900','line-height:1',
        'display:flex','align-items:center','justify-content:center',
        'cursor:pointer','padding:0','transition:transform 0.15s,background 0.15s'
    ].join(';');
    btn.textContent='+';
    btn.addEventListener('mouseenter',function(){btn.style.transform='scale(1.25)';btn.style.background='#aa0001';});
    btn.addEventListener('mouseleave',function(){btn.style.transform='';btn.style.background='#cc0001';});
    btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(_open)hideModal();else showModal();});

    // Indicator уже position:relative — добавляем внутрь
    indicator.style.position='relative';
    indicator.appendChild(btn);
}

// Интервальные напоминания — доп. срабатывания
setInterval(function(){
    var now=new Date();
    var min=now.getMinutes(), ss=now.getSeconds();
    if(ss>2) return;
    var rems=load(), changed=false;
    rems.forEach(function(rem){
        if(rem.type!=='schedule'||!rem.interval||rem.interval<=0) return;
        var iv=rem.interval;
        if(min%iv!==0) return;
        var dayOk=false;
        var dayOfWeek=now.getDay(), dayOfMonth=now.getDate();
        if(rem.repeat==='daily') dayOk=true;
        else if(rem.repeat==='weekdays') dayOk=(rem.weekdays||[]).indexOf(dayOfWeek)!==-1;
        else if(rem.repeat==='dates') dayOk=(rem.dates||[]).indexOf(dayOfMonth)!==-1;
        if(!dayOk) return;
        var fireKey=rem.id+'_iv_'+now.toISOString().slice(0,16);
        if(_firedKeys[fireKey]) return;
        _firedKeys[fireKey]=true;
        showNotify(rem.title);
        changed=true;
        if(!rem.permanent){
            rem._ivFired=(rem._ivFired||0)+1;
        }
    });
    if(changed) save(rems);
},1000);

new MutationObserver(function(){if(!document.getElementById('godji-rem-plus'))createPlusBtn();})
    .observe(document.body,{childList:true,subtree:true});
setTimeout(createPlusBtn,1500); setTimeout(createPlusBtn,3000);

})();

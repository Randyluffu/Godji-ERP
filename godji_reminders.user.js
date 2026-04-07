// ==UserScript==
// @name         Годжи — Напоминания
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Менеджер напоминаний с поддержкой расписаний и звуковых оповещений
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

var STORAGE_KEY = 'godji_reminders';

// ── Хранилище ─────────────────────────────────────────────
// reminder = {
//   id: string,
//   title: string,
//   type: 'once' | 'schedule',
//   // once: { datetime: ISO string }
//   // schedule: {
//   //   times: ['HH:MM', ...],       — моменты срабатывания
//   //   repeat: 'daily'|'weekdays'|'dates',
//   //   weekdays: [0-6],              — если repeat='weekdays'
//   //   dates: [1-31],               — если repeat='dates'
//   //   permanent: bool              — не удалять после срабатывания
//   // }
//   firedTimes: [ISO string],        — уже сработавшие моменты
// }

function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) { return []; }
}
function save(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
}
function genId() { return 'r' + Date.now() + Math.random().toString(36).slice(2, 6); }

// ── Звук уведомления ──────────────────────────────────────
function playSound() {
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var times = [0, 0.15, 0.3];
        times.forEach(function(t) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0, ctx.currentTime + t);
            gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + t + 0.05);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t + 0.18);
            osc.start(ctx.currentTime + t);
            osc.stop(ctx.currentTime + t + 0.2);
        });
    } catch(e) {}
}

// ── Показ уведомления ─────────────────────────────────────
function showNotification(title) {
    playSound();

    // Убираем старые если есть
    var old = document.getElementById('godji-rem-notify');
    if (old) old.remove();

    var box = document.createElement('div');
    box.id = 'godji-rem-notify';
    box.style.cssText = [
        'position:fixed', 'top:20px', 'right:20px', 'z-index:999999',
        'background:#1a1b2e', 'border:1px solid rgba(255,255,255,0.15)',
        'border-left:3px solid #cc0001', 'border-radius:10px',
        'padding:14px 18px', 'min-width:280px', 'max-width:340px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)', 'font-family:inherit',
        'display:flex', 'align-items:flex-start', 'gap:12px',
        'animation:godji-rem-slide 0.3s ease'
    ].join(';');

    var style = document.createElement('style');
    style.textContent = '@keyframes godji-rem-slide{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
    document.head.appendChild(style);

    var ico = document.createElement('div');
    ico.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>';

    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1;';
    var ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:12px;font-weight:700;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:3px;';
    ttl.textContent = 'Напоминание';
    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;font-weight:600;color:#fff;line-height:1.4;';
    msg.textContent = title;
    txt.appendChild(ttl); txt.appendChild(msg);

    var close = document.createElement('button');
    close.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.3);font-size:18px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;';
    close.textContent = '×';
    close.addEventListener('click', function() { box.remove(); });

    box.appendChild(ico); box.appendChild(txt); box.appendChild(close);
    document.body.appendChild(box);

    setTimeout(function() { if (box.parentNode) box.remove(); }, 10000);
}

// ── Проверка напоминаний (каждую минуту) ──────────────────
function checkReminders() {
    var now = new Date();
    var hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var dateStr = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
    var dayOfWeek = now.getDay(); // 0=вс, 1=пн...
    var dayOfMonth = now.getDate();

    var reminders = load();
    var changed = false;

    reminders = reminders.filter(function(rem) {
        if (rem.type === 'once') {
            // Сравниваем до минуты
            if (rem.datetime && rem.datetime.slice(0, 16) === dateStr) {
                if (!rem.fired) {
                    rem.fired = true;
                    showNotification(rem.title);
                    changed = true;
                    return false; // удаляем после срабатывания
                }
            }
            return true;
        }

        if (rem.type === 'schedule') {
            var times = rem.times || [];
            var shouldFire = times.indexOf(hhmm) !== -1;
            if (!shouldFire) return true;

            // Проверяем день
            var dayOk = false;
            if (rem.repeat === 'daily') {
                dayOk = true;
            } else if (rem.repeat === 'weekdays') {
                dayOk = (rem.weekdays || []).indexOf(dayOfWeek) !== -1;
            } else if (rem.repeat === 'dates') {
                dayOk = (rem.dates || []).indexOf(dayOfMonth) !== -1;
            }
            if (!dayOk) return true;

            // Проверяем не сработало ли уже в эту минуту
            var fireKey = now.toISOString().slice(0, 16);
            rem.firedTimes = rem.firedTimes || [];
            if (rem.firedTimes.indexOf(fireKey) !== -1) return true;

            rem.firedTimes.push(fireKey);
            // Чистим старые fired (старше 24ч)
            var cutoff = new Date(Date.now() - 86400000).toISOString().slice(0, 16);
            rem.firedTimes = rem.firedTimes.filter(function(t) { return t > cutoff; });

            showNotification(rem.title);
            changed = true;

            if (!rem.permanent) return false; // удаляем если не постоянное
            return true;
        }

        return true;
    });

    if (changed) save(reminders);
}

function pad(n) { return String(n).padStart(2, '0'); }

setInterval(checkReminders, 15000);
setTimeout(checkReminders, 3000);

// ── Модальное окно менеджера ──────────────────────────────
var _modal = null, _overlay = null, _open = false;

function buildModal() {
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99997;display:none;';
    _overlay.addEventListener('click', hideModal);
    document.body.appendChild(_overlay);

    _modal = document.createElement('div');
    _modal.style.cssText = [
        'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
        'z-index:99998', 'width:520px', 'max-width:96vw', 'max-height:85vh',
        'background:#1a1b2e', 'border:1px solid rgba(255,255,255,0.1)',
        'border-radius:14px', 'box-shadow:0 8px 40px rgba(0,0,0,0.6)',
        'display:none', 'flex-direction:column', 'font-family:inherit', 'overflow:hidden'
    ].join(';');
    document.body.appendChild(_modal);

    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && _open) hideModal(); });
}

function renderModal() {
    if (!_modal) return;
    _modal.innerHTML = '';

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';
    var hL = document.createElement('div');
    hL.style.cssText = 'display:flex;align-items:center;gap:10px;';
    var hIco = document.createElement('div');
    hIco.style.cssText = 'width:30px;height:30px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;';
    hIco.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg>';
    var hTit = document.createElement('span');
    hTit.style.cssText = 'font-size:15px;font-weight:700;color:#fff;';
    hTit.textContent = 'Напоминания';
    hL.appendChild(hIco); hL.appendChild(hTit);
    var xBtn = document.createElement('button');
    xBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;padding:0;line-height:1;';
    xBtn.textContent = '×'; xBtn.addEventListener('click', hideModal);
    hdr.appendChild(hL); hdr.appendChild(xBtn);
    _modal.appendChild(hdr);

    // Список + форма добавления
    var body = document.createElement('div');
    body.style.cssText = 'overflow-y:auto;flex:1;padding:16px 20px;display:flex;flex-direction:column;gap:12px;';
    _modal.appendChild(body);

    // Существующие напоминания
    var reminders = load();
    if (reminders.length) {
        var listTitle = document.createElement('div');
        listTitle.style.cssText = 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;';
        listTitle.textContent = 'Активные напоминания';
        body.appendChild(listTitle);

        reminders.forEach(function(rem) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);border-radius:8px;padding:10px 12px;border:1px solid rgba(255,255,255,0.07);';

            var info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            var rtitle = document.createElement('div');
            rtitle.style.cssText = 'font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
            rtitle.textContent = rem.title;
            var rsub = document.createElement('div');
            rsub.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;';
            rsub.textContent = describeReminder(rem);
            info.appendChild(rtitle); info.appendChild(rsub);

            if (rem.permanent) {
                var permTag = document.createElement('span');
                permTag.style.cssText = 'font-size:10px;font-weight:700;color:#cc0001;background:rgba(204,0,1,0.15);padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;';
                permTag.textContent = '∞';
                row.appendChild(info); row.appendChild(permTag);
            } else {
                row.appendChild(info);
            }

            var del = document.createElement('button');
            del.style.cssText = 'background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.4);font-size:15px;cursor:pointer;width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
            del.textContent = '×';
            del.addEventListener('click', function() {
                var all = load();
                save(all.filter(function(r) { return r.id !== rem.id; }));
                renderModal();
            });
            row.appendChild(del);
            body.appendChild(row);
        });
    }

    // Форма добавления
    var formTitle = document.createElement('div');
    formTitle.style.cssText = 'font-size:11px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:1px;margin-top:'+(reminders.length?'8':'0')+'px;margin-bottom:4px;';
    formTitle.textContent = 'Новое напоминание';
    body.appendChild(formTitle);

    // Название
    var titleInp = mkInput('Текст напоминания');
    body.appendChild(titleInp);

    // Тип: разовое / расписание
    var typeRow = document.createElement('div');
    typeRow.style.cssText = 'display:flex;gap:8px;';
    var typeOnce = mkTypeBtn('Разовое', true);
    var typeSched = mkTypeBtn('По расписанию', false);
    typeRow.appendChild(typeOnce); typeRow.appendChild(typeSched);
    body.appendChild(typeRow);

    // Блок разового
    var onceBlock = document.createElement('div');
    onceBlock.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    var dtInp = mkInput('', 'datetime-local');
    // Ограничим до месяца вперёд
    var now = new Date();
    var maxDt = new Date(now.getTime() + 30 * 86400000);
    dtInp.min = toLocalISO(now).slice(0, 16);
    dtInp.max = toLocalISO(maxDt).slice(0, 16);
    dtInp.value = toLocalISO(now).slice(0, 16);
    onceBlock.appendChild(dtInp);
    body.appendChild(onceBlock);

    // Блок расписания
    var schedBlock = document.createElement('div');
    schedBlock.style.cssText = 'display:none;flex-direction:column;gap:8px;';

    // Время срабатывания (несколько)
    var timesLabel = mkLabel('Время срабатывания (можно добавить несколько)');
    schedBlock.appendChild(timesLabel);
    var timesContainer = document.createElement('div');
    timesContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;';
    var timesList = []; // ['HH:MM', ...]

    function renderTimes() {
        timesContainer.innerHTML = '';
        timesList.forEach(function(t) {
            var tag = document.createElement('span');
            tag.style.cssText = 'background:rgba(204,0,1,0.2);color:#ff6666;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:4px;cursor:pointer;';
            tag.innerHTML = t + ' <span style="opacity:0.6;font-size:14px;line-height:1;">×</span>';
            tag.addEventListener('click', function() {
                timesList = timesList.filter(function(x) { return x !== t; });
                renderTimes();
            });
            timesContainer.appendChild(tag);
        });
        // Инпут для добавления
        var addTime = document.createElement('input');
        addTime.type = 'time';
        addTime.style.cssText = inputStyle();
        addTime.style.width = '100px';
        addTime.addEventListener('change', function() {
            if (addTime.value && timesList.indexOf(addTime.value) === -1) {
                timesList.push(addTime.value);
                timesList.sort();
                renderTimes();
            }
        });
        timesContainer.appendChild(addTime);
    }
    renderTimes();
    schedBlock.appendChild(timesContainer);

    // Повторение
    var repeatLabel = mkLabel('Повторение');
    schedBlock.appendChild(repeatLabel);
    var repeatSel = document.createElement('select');
    repeatSel.style.cssText = inputStyle();
    [['daily','Ежедневно'],['weekdays','По дням недели'],['dates','По числам месяца']].forEach(function(o) {
        var opt = document.createElement('option'); opt.value = o[0]; opt.textContent = o[1];
        repeatSel.appendChild(opt);
    });
    schedBlock.appendChild(repeatSel);

    // Дни недели
    var wdBlock = document.createElement('div');
    wdBlock.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;';
    var wdNames = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    var wdSelected = [];
    wdNames.forEach(function(name, i) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.5);font-family:inherit;transition:all 0.15s;';
        btn.textContent = name;
        btn.addEventListener('click', function() {
            var idx = wdSelected.indexOf(i);
            if (idx === -1) { wdSelected.push(i); btn.style.background='#cc0001'; btn.style.color='#fff'; btn.style.borderColor='#cc0001'; }
            else { wdSelected.splice(idx,1); btn.style.background='transparent'; btn.style.color='rgba(255,255,255,0.5)'; btn.style.borderColor='rgba(255,255,255,0.15)'; }
        });
        wdBlock.appendChild(btn);
    });
    schedBlock.appendChild(wdBlock);

    // Числа месяца
    var datesBlock = document.createElement('div');
    datesBlock.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;';
    var datesSelected = [];
    for (var d = 1; d <= 31; d++) {
        (function(day) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.style.cssText = 'width:30px;height:30px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:transparent;color:rgba(255,255,255,0.5);font-family:inherit;transition:all 0.15s;';
            btn.textContent = day;
            btn.addEventListener('click', function() {
                var idx = datesSelected.indexOf(day);
                if (idx === -1) { datesSelected.push(day); btn.style.background='#cc0001'; btn.style.color='#fff'; btn.style.borderColor='#cc0001'; }
                else { datesSelected.splice(idx,1); btn.style.background='transparent'; btn.style.color='rgba(255,255,255,0.5)'; btn.style.borderColor='rgba(255,255,255,0.15)'; }
            });
            datesBlock.appendChild(btn);
        })(d);
    }
    schedBlock.appendChild(datesBlock);

    repeatSel.addEventListener('change', function() {
        wdBlock.style.display = this.value === 'weekdays' ? 'flex' : 'none';
        datesBlock.style.display = this.value === 'dates' ? 'flex' : 'none';
    });

    // Постоянное
    var permRow = document.createElement('div');
    permRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var permCb = document.createElement('input');
    permCb.type = 'checkbox'; permCb.id = 'godji-rem-perm';
    permCb.style.cssText = 'cursor:pointer;accent-color:#cc0001;width:14px;height:14px;';
    var permLbl = document.createElement('label');
    permLbl.htmlFor = 'godji-rem-perm';
    permLbl.style.cssText = 'font-size:13px;color:rgba(255,255,255,0.7);cursor:pointer;';
    permLbl.textContent = 'Постоянное (не удалять после срабатывания)';
    permRow.appendChild(permCb); permRow.appendChild(permLbl);
    schedBlock.appendChild(permRow);

    body.appendChild(schedBlock);

    // Переключение типа
    var isOnce = true;
    function setType(once) {
        isOnce = once;
        typeOnce.style.background = once ? '#cc0001' : 'rgba(255,255,255,0.07)';
        typeOnce.style.color = once ? '#fff' : 'rgba(255,255,255,0.5)';
        typeSched.style.background = !once ? '#cc0001' : 'rgba(255,255,255,0.07)';
        typeSched.style.color = !once ? '#fff' : 'rgba(255,255,255,0.5)';
        onceBlock.style.display = once ? 'flex' : 'none';
        schedBlock.style.display = !once ? 'flex' : 'none';
    }
    typeOnce.addEventListener('click', function() { setType(true); });
    typeSched.addEventListener('click', function() { setType(false); });

    // Кнопка добавить
    var addBtn = document.createElement('button');
    addBtn.style.cssText = 'width:100%;padding:10px;background:#cc0001;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:4px;';
    addBtn.textContent = '+ Добавить напоминание';
    addBtn.addEventListener('click', function() {
        var title = titleInp.value.trim();
        if (!title) { titleInp.style.borderColor='#cc0001'; titleInp.focus(); return; }

        var rem = { id: genId(), title: title };

        if (isOnce) {
            if (!dtInp.value) { dtInp.style.borderColor='#cc0001'; dtInp.focus(); return; }
            rem.type = 'once';
            rem.datetime = new Date(dtInp.value).toISOString();
        } else {
            if (!timesList.length) { return; }
            rem.type = 'schedule';
            rem.times = timesList.slice();
            rem.repeat = repeatSel.value;
            if (rem.repeat === 'weekdays') rem.weekdays = wdSelected.slice();
            if (rem.repeat === 'dates') rem.dates = datesSelected.slice();
            rem.permanent = permCb.checked;
            rem.firedTimes = [];
        }

        var all = load();
        all.push(rem);
        save(all);
        renderModal();
    });
    body.appendChild(addBtn);
}

function describeReminder(rem) {
    if (rem.type === 'once') {
        var d = new Date(rem.datetime);
        return 'Разово: ' + d.toLocaleDateString('ru-RU') + ' в ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    if (rem.type === 'schedule') {
        var parts = [];
        var times = (rem.times || []).join(', ');
        parts.push(times);
        if (rem.repeat === 'daily') parts.push('ежедневно');
        else if (rem.repeat === 'weekdays') {
            var days = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
            parts.push((rem.weekdays || []).map(function(i) { return days[i]; }).join(', '));
        } else if (rem.repeat === 'dates') {
            parts.push('числа: ' + (rem.dates || []).sort(function(a,b){return a-b;}).join(', '));
        }
        return parts.join(' · ');
    }
    return '';
}

function mkInput(placeholder, type) {
    var inp = document.createElement('input');
    inp.type = type || 'text';
    inp.placeholder = placeholder || '';
    inp.style.cssText = inputStyle();
    inp.addEventListener('focus', function() { inp.style.borderColor = 'rgba(204,0,1,0.6)'; });
    inp.addEventListener('blur', function() { inp.style.borderColor = 'rgba(255,255,255,0.1)'; });
    return inp;
}

function mkLabel(text) {
    var lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.6px;';
    lbl.textContent = text;
    return lbl;
}

function mkTypeBtn(text, active) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'flex:1;padding:7px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.1);font-family:inherit;transition:all 0.15s;background:'+(active?'#cc0001':'rgba(255,255,255,0.07)')+';color:'+(active?'#fff':'rgba(255,255,255,0.5)')+';';
    btn.textContent = text;
    return btn;
}

function inputStyle() {
    return 'width:100%;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;font-size:13px;font-family:inherit;color:#fff;outline:none;box-sizing:border-box;';
}

function toLocalISO(date) {
    var off = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - off).toISOString();
}

function showModal() {
    if (!_modal) buildModal();
    renderModal();
    _modal.style.display = 'flex'; _overlay.style.display = 'block'; _open = true;
}
function hideModal() {
    if (!_modal) return;
    _modal.style.display = 'none'; _overlay.style.display = 'none'; _open = false;
}

// ── Кнопка «+» рядом с колокольчиком ─────────────────────
function createPlusBtn() {
    if (document.getElementById('godji-rem-plus')) return;

    // Ищем контейнер с колокольчиком
    var bell = document.querySelector('.NotificationIcon_button__wURku');
    if (!bell) return;
    var container = bell.closest('[style*="position: relative"]');
    if (!container) return;

    var btn = document.createElement('button');
    btn.id = 'godji-rem-plus';
    btn.type = 'button';
    btn.title = 'Добавить напоминание';
    btn.style.cssText = [
        'position:absolute', 'top:-6px', 'right:-10px', 'z-index:10',
        'width:18px', 'height:18px', 'border-radius:50%',
        'background:#cc0001', 'border:2px solid var(--mantine-color-body,#1a1b2e)',
        'color:#fff', 'font-size:13px', 'font-weight:700', 'line-height:1',
        'display:flex', 'align-items:center', 'justify-content:center',
        'cursor:pointer', 'padding:0', 'transition:transform 0.15s',
    ].join(';');
    btn.textContent = '+';
    btn.addEventListener('mouseenter', function() { btn.style.transform = 'scale(1.2)'; });
    btn.addEventListener('mouseleave', function() { btn.style.transform = ''; });
    btn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (_open) hideModal(); else showModal();
    });

    container.appendChild(btn);
}

// ── Init ──────────────────────────────────────────────────
new MutationObserver(function() {
    if (!document.getElementById('godji-rem-plus')) createPlusBtn();
}).observe(document.body, { childList: true, subtree: true });

setTimeout(createPlusBtn, 1500);
setTimeout(createPlusBtn, 3000);

})();

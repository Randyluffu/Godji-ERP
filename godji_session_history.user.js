// ==UserScript==
// @name         Годжи — История сеансов
// @namespace    http://tampermonkey.net/
// @version      3.5
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_history.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_session_history.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var STORAGE_KEY = 'godji_session_history';
    var MAX_HOURS = 72;

    var state = {};
    var initialized = false;

    // --- localStorage ---
    function loadHistory() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            var cutoff = Date.now() - MAX_HOURS * 60 * 60 * 1000;
            return raw.filter(function(r) { return r.ts > cutoff; });
        } catch(e) { return []; }
    }
    function saveHistory(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
    }

    // --- Форматирование даты ---
    function formatDate(ts) {
        var d = new Date(ts);
        var dd = String(d.getDate()).padStart(2, '0');
        var mm = String(d.getMonth() + 1).padStart(2, '0');
        var hh = String(d.getHours()).padStart(2, '0');
        var min = String(d.getMinutes()).padStart(2, '0');
        return dd + '.' + mm + ' ' + hh + ':' + min;
    }

    // --- Читаем состояние таблицы ---
    function getTableState() {
        var result = {};
        var rows = document.querySelectorAll('tr.mantine-Table-tr');
        for (var i = 0; i < rows.length; i++) {
            var nameCell = rows[i].querySelector('td[style*="col-deviceName-size"]');
            if (!nameCell) continue;
            var pcName = nameCell.textContent.trim();
            if (!pcName) continue;

            var sessionCell = rows[i].querySelector('td[style*="col-sessionStatus-size"]');
            if (!sessionCell) continue;
            var sessionBadge = sessionCell.querySelector('.mantine-Badge-label');
            var sessionStatus = sessionBadge ? sessionBadge.textContent.trim() : sessionCell.textContent.trim();

            var pastCell = rows[i].querySelector('td[style*="col-sessionPastTime-size"]');
            var pastTime = pastCell ? pastCell.textContent.trim() : '';

            var nickCell = rows[i].querySelector('td[style*="col-userNickname-size"]');
            var nickLink = nickCell ? nickCell.querySelector('a') : null;
            var nick = nickLink ? nickLink.textContent.trim() : '';
            var clientUrl = nickLink ? nickLink.getAttribute('href') : '';

            var nameCell = rows[i].querySelector('td[style*="col-userName-size"]');
            var nameLink = nameCell ? nameCell.querySelector('a') : null;
            var userName = nameLink ? nameLink.textContent.trim() : '';

            var phoneCell = rows[i].querySelector('td[style*="col-userPhone-size"]');
            var phone = phoneCell ? phoneCell.textContent.trim() : '';

            result[pcName] = {
                session: sessionStatus,
                pastTime: pastTime,
                userName: userName,
                nick: nick,
                clientUrl: clientUrl,
                phone: phone
            };
        }
        return result;
    }

    // --- Сканирование ---
    function scan() {
        if (!initialized) return;
        var current = getTableState();

        if (Object.keys(state).length === 0 && Object.keys(current).length > 0) {
            for (var pcX in current) state[pcX] = current[pcX];
            return;
        }

        var history = loadHistory();
        var changed = false;

        for (var pc in current) {
            var oldSession = state[pc] ? state[pc].session : undefined;
            var newSession = current[pc].session;

            if (oldSession === 'Играет' && newSession !== 'Играет') {
                var prev = state[pc];
                // Защита от дублей — проверяем не записан ли уже этот ПК за последние 10 секунд
                var now = Date.now();
                var isDuplicate = history.some(function(r) { return r.pc === pc && now - r.ts < 10000; });
                if (!isDuplicate) {
                history.unshift({
                    ts: now,
                    pc: pc,
                    userName: prev.userName || '',
                    nick: prev.nick,
                    clientUrl: prev.clientUrl,
                    phone: prev.phone,
                    pastTime: prev.pastTime
                });
                // Чистим записи старше 72 часов
                var cutoff = Date.now() - MAX_HOURS * 60 * 60 * 1000;
                history = history.filter(function(r) { return r.ts > cutoff; });
                changed = true;
                } // end isDuplicate check
            }

            state[pc] = current[pc];
        }

        if (changed) {
            saveHistory(history);
            updateModal();
        }
    }

    // --- Инициализация ---
    function tryInit() {
        var current = getTableState();
        var keys = Object.keys(current);
        var hasData = false;
        for (var i = 0; i < keys.length; i++) {
            if (current[keys[i]].session) { hasData = true; break; }
        }
        if (keys.length === 0 || !hasData) { setTimeout(tryInit, 1000); return; }
        setTimeout(function() {
            var final = getTableState();
            for (var pc in final) state[pc] = final[pc];
            initialized = true;
        }, 1500);
    }

    // --- Модальное окно ---
    var modal = null;
    var modalVisible = false;
    var filterPc = '';
    var filterNick = '';

    function createModal() {
        modal = document.createElement('div');
        modal.id = 'godji-history-modal';
        modal.style.cssText = [
            'position:fixed',
            'top:50%',
            'left:50%',
            'transform:translate(-50%,-50%)',
            'z-index:99998',
            'width:700px',
            'max-width:95vw',
            'max-height:80vh',
            'background:#ffffff',
            'border-radius:12px',
            'box-shadow:0 4px 24px rgba(0,0,0,0.18)',
            'display:none',
            'flex-direction:column',
            'font-family:inherit',
            'overflow:hidden',
        ].join(';');

        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;';

        var title = document.createElement('span');
        title.style.cssText = 'font-size:16px;font-weight:700;color:#1a1a1a;';
        title.textContent = '\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0441\u0435\u0430\u043d\u0441\u043e\u0432 (\u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 72 \u0447)';

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:#999;font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '\u00d7';
        closeBtn.addEventListener('click', hideModal);

        header.appendChild(title);
        header.appendChild(closeBtn);

        var tableWrap = document.createElement('div');
        tableWrap.id = 'godji-history-table-wrap';
        tableWrap.style.cssText = 'overflow-y:auto;flex:1;padding:0;';

        modal.appendChild(header);
        modal.appendChild(tableWrap);
        document.body.appendChild(modal);

        var overlay = document.createElement('div');
        overlay.id = 'godji-history-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99997;display:none;background:rgba(0,0,0,0.5);';
        overlay.addEventListener('click', hideModal);
        document.body.appendChild(overlay);
    }

    function updateModal() {
        if (!modal) return;
        var wrap = document.getElementById('godji-history-table-wrap');
        if (!wrap) return;

        var history = loadHistory();

        // Собираем уникальные значения для фильтров
        var allPcs = [''];
        var allNicks = [''];
        history.forEach(function(r) {
            if (r.pc && allPcs.indexOf(r.pc) === -1) allPcs.push(r.pc);
            if (r.nick && allNicks.indexOf(r.nick) === -1) allNicks.push(r.nick);
        });
        allPcs.sort(function(a,b){ return a > b ? 1 : -1; });
        allNicks.sort(function(a,b){ return a > b ? 1 : -1; });

        // Применяем фильтры
        if (filterPc) history = history.filter(function(r) { return r.pc === filterPc; });
        if (filterNick) history = history.filter(function(r) { return r.nick === filterNick; });

        if (history.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;color:#999;padding:40px;font-size:14px;">\u041d\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d\u043d\u044b\u0445 \u0441\u0435\u0430\u043d\u0441\u043e\u0432 \u0437\u0430 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 72 \u0447</div>';
            return;
        }

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;color:#1a1a1a;';

        var thead = document.createElement('thead');
        thead.style.cssText = 'position:sticky;top:0;background:#f9f9f9;z-index:1;';
        var hrow = document.createElement('tr');
        var thData = [
            { text: '\u0414\u0430\u0442\u0430 \u0438 \u0432\u0440\u0435\u043c\u044f', filter: null },
            { text: '\u041f\u041a', filter: 'pc' },
            { text: '\u041a\u043b\u0438\u0435\u043d\u0442', filter: null },
            { text: '\u041d\u0438\u043a', filter: 'nick' },
            { text: '\u0422\u0435\u043b\u0435\u0444\u043e\u043d', filter: null },
            { text: '\u0412\u0440\u0435\u043c\u044f \u0441\u0435\u0430\u043d\u0441\u0430', filter: null },
        ];
        thData.forEach(function(col) {
            var th = document.createElement('th');
            th.style.cssText = 'padding:10px 14px;text-align:left;color:#888;font-weight:600;font-size:12px;border-bottom:2px solid #f0f0f0;white-space:nowrap;';

            if (col.filter === 'pc') {
                th.style.cssText += 'padding:6px 14px;';
                var label = document.createElement('div');
                label.style.cssText = 'display:flex;align-items:center;gap:0;';
                var span = document.createElement('span');
                span.textContent = col.text;
                var sel = document.createElement('select');
                sel.id = 'godji-filter-pc';
                sel.style.cssText = 'background:#f0f0f0;color:#555;border:none;border-radius:4px;padding:2px 4px;font-size:11px;cursor:pointer;font-family:inherit;outline:none;margin-left:6px;font-weight:400;max-width:60px;';
                allPcs.forEach(function(v) {
                    var opt = document.createElement('option');
                    opt.value = v;
                    opt.textContent = v === '' ? '\u0412\u0441\u0435' : v;
                    if (v === filterPc) opt.selected = true;
                    sel.appendChild(opt);
                });
                sel.addEventListener('change', function() { filterPc = this.value; updateModal(); });
                label.appendChild(span);
                label.appendChild(sel);
                th.appendChild(label);
            } else if (col.filter === 'nick') {
                th.style.cssText += 'padding:6px 14px;';
                var label2 = document.createElement('div');
                label2.style.cssText = 'display:flex;align-items:center;gap:0;';
                var span2 = document.createElement('span');
                span2.textContent = col.text;
                var sel2 = document.createElement('select');
                sel2.id = 'godji-filter-nick';
                sel2.style.cssText = 'background:#f0f0f0;color:#555;border:none;border-radius:4px;padding:2px 4px;font-size:11px;cursor:pointer;font-family:inherit;outline:none;margin-left:6px;font-weight:400;max-width:90px;';
                allNicks.forEach(function(v) {
                    var opt2 = document.createElement('option');
                    opt2.value = v;
                    opt2.textContent = v === '' ? '\u0412\u0441\u0435' : v;
                    if (v === filterNick) opt2.selected = true;
                    sel2.appendChild(opt2);
                });
                sel2.addEventListener('change', function() { filterNick = this.value; updateModal(); });
                label2.appendChild(span2);
                label2.appendChild(sel2);
                th.appendChild(label2);
            } else {
                th.textContent = col.text;
            }

            hrow.appendChild(th);
        });
        thead.appendChild(hrow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        history.forEach(function(rec) {
            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid #f5f5f5;transition:background 0.1s;';
            tr.addEventListener('mouseenter', function() { tr.style.background = '#f5f5f5'; });
            tr.addEventListener('mouseleave', function() { tr.style.background = ''; });

            var tdDate = document.createElement('td');
            tdDate.style.cssText = 'padding:10px 14px;color:#666;white-space:nowrap;';
            tdDate.textContent = formatDate(rec.ts);

            var tdPc = document.createElement('td');
            tdPc.style.cssText = 'padding:10px 14px;vertical-align:middle;text-align:left;';
            var pcBadge = document.createElement('span');
            pcBadge.style.cssText = 'background:rgba(0,175,255,0.2);color:#00afff;border-radius:6px;padding:2px 8px;font-weight:700;font-size:12px;display:inline-block;position:relative;top:2px;';
            pcBadge.textContent = rec.pc;
            tdPc.appendChild(pcBadge);

            var tdName = document.createElement('td');
            tdName.style.cssText = 'padding:10px 14px;';
            if (rec.userName && rec.clientUrl) {
                var nameLink2 = document.createElement('a');
                nameLink2.href = rec.clientUrl;
                nameLink2.textContent = rec.userName;
                nameLink2.style.cssText = 'text-decoration:none;font-weight:500;';
                nameLink2.addEventListener('mouseenter', function() { nameLink2.style.textDecoration = 'underline'; nameLink2.style.opacity = '0.8'; });
                nameLink2.addEventListener('mouseleave', function() { nameLink2.style.textDecoration = 'none'; nameLink2.style.opacity = '1'; });
                tdName.appendChild(nameLink2);
            } else {
                tdName.style.color = '#ccc';
                tdName.textContent = '\u2014';
            }

            var tdNick = document.createElement('td');
            tdNick.style.cssText = 'padding:10px 14px;';
            if (rec.nick && rec.clientUrl) {
                var link = document.createElement('a');
                link.href = rec.clientUrl;
                link.textContent = rec.nick;
                link.style.cssText = 'text-decoration:none;font-weight:500;';
                link.addEventListener('mouseenter', function() { link.style.textDecoration = 'underline'; link.style.opacity = '0.8'; });
                link.addEventListener('mouseleave', function() { link.style.textDecoration = 'none'; link.style.opacity = '1'; });
                tdNick.appendChild(link);
            } else {
                tdNick.style.color = '#ccc';
                tdNick.textContent = '\u2014';
            }

            var tdPhone = document.createElement('td');
            tdPhone.style.cssText = 'padding:10px 14px;color:#333;white-space:nowrap;';
            tdPhone.textContent = rec.phone || '\u2014';

            var tdTime = document.createElement('td');
            tdTime.style.cssText = 'padding:10px 14px;color:#333;white-space:nowrap;';
            tdTime.textContent = rec.pastTime || '\u2014';

            tr.appendChild(tdDate);
            tr.appendChild(tdPc);
            tr.appendChild(tdName);
            tr.appendChild(tdNick);
            tr.appendChild(tdPhone);
            tr.appendChild(tdTime);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrap.innerHTML = '';
        wrap.appendChild(table);
    }

    function showModal() {
        if (!modal) createModal();
        updateModal();
        modal.style.display = 'flex';
        document.getElementById('godji-history-overlay').style.display = 'block';
        modalVisible = true;
        var btn = document.getElementById('godji-history-btn');
        if (btn) btn.setAttribute('data-active', '');
    }

    function hideModal() {
        if (!modal) return;
        modal.style.display = 'none';
        document.getElementById('godji-history-overlay').style.display = 'none';
        modalVisible = false;
        var btn = document.getElementById('godji-history-btn');
        if (btn) btn.removeAttribute('data-active');
    }

    // --- Кнопка в сайдбаре ---
    function createSidebarButton() {
        if (document.getElementById('godji-history-btn')) return;
        var footer = document.querySelector('.Sidebar_footer__1BA98');
        var divider = footer && footer.querySelector('.mantine-Divider-root');
        if (!footer || !divider) { setTimeout(createSidebarButton, 500); return; }

        var wrap = document.createElement('a');
        wrap.id = 'godji-history-btn';
        wrap.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        wrap.href = 'javascript:void(0)';
        wrap.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;height:46px;padding:8px 16px 8px 12px;cursor:pointer;user-select:none;font-family:inherit;box-sizing:border-box;text-decoration:none;';

        var iconWrap = document.createElement('div');
        iconWrap.className = 'LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
        iconWrap.setAttribute('data-variant','filled');
        iconWrap.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8l0 4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></svg>';

        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'm_f07af9d2 mantine-NavLink-body';
        var label = document.createElement('span');
        label.className = 'm_1f6ac4c4 mantine-NavLink-label';
        label.style.cssText = 'font-size:14px;font-weight:600;color:var(--mantine-color-white,#fff);white-space:nowrap;';
        label.textContent = '\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0441\u0435\u0430\u043d\u0441\u043e\u0432';
        bodyDiv.appendChild(label);

        wrap.appendChild(iconWrap);
        wrap.appendChild(bodyDiv);

        wrap.addEventListener('mouseenter', function() { wrap.style.background='rgba(255,255,255,0.05)'; });
        wrap.addEventListener('mouseleave', function() { wrap.style.background=''; });
        wrap.addEventListener('click', function(e) {
            e.stopPropagation();
            if (modalVisible) hideModal(); else showModal();
        });

        // Вставляем ПЕРЕД divider — выше блока с временем
        footer.insertBefore(wrap, divider);
    }

    var _histObs = new MutationObserver(function() {
        if (!document.getElementById('godji-history-btn')) createSidebarButton();
    });
    if (document.body) _histObs.observe(document.body, { childList: true, subtree: false });

    setTimeout(tryInit, 5000);
    setInterval(scan, 2000);
    setTimeout(createSidebarButton, 1200);

})();

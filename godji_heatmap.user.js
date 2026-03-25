// ==UserScript==
// @name         Годжи — Тепловая карта загруженности
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_heatmap.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_heatmap.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    var STORAGE_KEY = 'godji_heatmap_v1';
    var SAMPLE_INTERVAL = 5 * 60 * 1000; // каждые 5 минут

    // Зоны
    var ZONES = {
        'X': { name: 'VIP Plus (X)', color: '#cc0001' },
        'L': { name: 'VIP Plus (L)', color: '#e03131' },
        'V': { name: 'DUO (V)',       color: '#1971c2' },
        'E': { name: 'DUO (E)',       color: '#1864ab' },
        'S': { name: 'Solo',          color: '#2f9e44' },
        'R': { name: 'PS5 (R)',       color: '#6741d9' },
        'PC': { name: 'Прочие ПК',   color: '#f76707' },
    };

    // Маппинг ПК по зонам (имена ПК)
    var ZONE_MAP = {
        'TV 1': 'R',
        '41':   'S',
    };
    // VIP Plus зоны X и L — ПК 01-09 (нужно уточнить)
    // Duo зоны V и E — ПК с надписью DUO в тарифе
    // Определяем по первым двум буквам имени ПК или по расположению
    function getZone(pcName) {
        if (ZONE_MAP[pcName]) return ZONE_MAP[pcName];
        // Определяем по номеру — примерная маппировка по скринам карты
        var n = parseInt(pcName);
        if (isNaN(n)) return 'PC';
        if (n >= 3 && n <= 5)   return 'X';  // 03,04,05
        if (n >= 17 && n <= 21) return 'X';  // 17-21
        if (n >= 1 && n <= 2)   return 'L';  // 01,02
        if (n >= 6 && n <= 9)   return 'E';  // 06-09
        if (n >= 22 && n <= 24) return 'V';  // 22-24
        return 'PC';
    }

    // Загрузка / сохранение данных
    function loadData() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch(e) { return {}; }
    }

    function saveData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch(e) {}
    }

    // Запись снапшота текущего состояния
    function recordSnapshot() {
        var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
        if (!rows.length) return;

        var now = new Date();
        var hour = now.getHours();
        var dow = now.getDay(); // 0=вс, 1=пн...
        var key = dow + '_' + hour;

        var data = loadData();
        if (!data[key]) data[key] = {};

        rows.forEach(function(row) {
            var nameCell = row.querySelector('td[data-index="0"]');
            if (!nameCell) return;
            var pcName = nameCell.textContent.trim();
            var zone = getZone(pcName);
            var statusCell = row.querySelector('td[data-index="8"] .mantine-Badge-label');
            var isOccupied = statusCell && statusCell.textContent.trim() !== '';

            if (!data[key][zone]) data[key][zone] = { samples: 0, occupied: 0 };
            data[key][zone].samples++;
            if (isOccupied) data[key][zone].occupied++;
        });

        saveData(data);
    }

    // --- UI ---
    var _modal = null;

    function openHeatmap() {
        if (_modal) { _modal.remove(); _modal = null; return; }

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) { overlay.remove(); _modal = null; }
        });

        var modal = document.createElement('div');
        modal.style.cssText = [
            'background:#1a1b1e', 'border:1px solid rgba(255,255,255,0.09)',
            'border-radius:12px', 'width:100%', 'max-width:680px',
            'max-height:85vh', 'display:flex', 'flex-direction:column',
            'font-family:inherit', 'box-shadow:0 24px 64px rgba(0,0,0,0.55)',
            'overflow:hidden',
        ].join(';');

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';

        var titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';
        var titleIcon = document.createElement('div');
        titleIcon.style.cssText = 'width:30px;height:30px;border-radius:7px;background:#cc0001;display:flex;align-items:center;justify-content:center;';
        titleIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
        var titleText = document.createElement('span');
        titleText.style.cssText = 'color:#fff;font-size:15px;font-weight:700;';
        titleText.textContent = 'Тепловая карта загруженности';
        titleWrap.appendChild(titleIcon);
        titleWrap.appendChild(titleText);

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.35);font-size:20px;cursor:pointer;padding:0;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() { overlay.remove(); _modal = null; });
        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        // Вкладки
        var tabs = document.createElement('div');
        tabs.style.cssText = 'display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;padding:0 22px;';

        var body = document.createElement('div');
        body.style.cssText = 'overflow-y:auto;padding:20px 22px;flex:1;';

        var DOW_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
        var views = ['Все время', 'По дням недели'];
        var activeView = 0;

        function makeTab(label, idx) {
            var tab = document.createElement('button');
            tab.style.cssText = [
                'padding:10px 16px', 'border:none', 'background:transparent',
                'color:' + (idx === activeView ? '#fff' : 'rgba(255,255,255,0.4)'),
                'font-size:13px', 'font-weight:' + (idx === activeView ? '600' : '400'),
                'cursor:pointer', 'font-family:inherit', 'border-bottom:2px solid ' + (idx === activeView ? '#cc0001' : 'transparent'),
                'transition:color 0.15s',
            ].join(';');
            tab.textContent = label;
            tab.addEventListener('click', function() {
                activeView = idx;
                tabs.innerHTML = '';
                views.forEach(function(l, i) { tabs.appendChild(makeTab(l, i)); });
                renderView();
            });
            return tab;
        }

        views.forEach(function(l, i) { tabs.appendChild(makeTab(l, i)); });

        function renderView() {
            body.innerHTML = '';
            var data = loadData();

            if (Object.keys(data).length === 0) {
                body.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;text-align:center;padding:40px 0;">Данных пока нет — статистика накапливается каждые 5 минут пока открыт дашборд.</div>';
                return;
            }

            if (activeView === 0) {
                renderAllTime(data, body);
            } else {
                renderByDow(data, body);
            }
        }

        function renderAllTime(data, container) {
            // Агрегируем по зонам за всё время
            var zoneStats = {};
            Object.keys(data).forEach(function(key) {
                Object.keys(data[key]).forEach(function(zone) {
                    if (!zoneStats[zone]) zoneStats[zone] = { samples: 0, occupied: 0 };
                    zoneStats[zone].samples += data[key][zone].samples;
                    zoneStats[zone].occupied += data[key][zone].occupied;
                });
            });

            var title = document.createElement('div');
            title.style.cssText = 'color:rgba(255,255,255,0.5);font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:14px;';
            title.textContent = 'Средняя загруженность по зонам';
            container.appendChild(title);

            Object.keys(ZONES).forEach(function(zoneKey) {
                var stats = zoneStats[zoneKey];
                if (!stats || !stats.samples) return;
                var pct = Math.round(stats.occupied / stats.samples * 100);
                renderZoneBar(container, ZONES[zoneKey], pct, stats.samples);
            });

            // Тепловая сетка по часам за всё время
            renderHourGrid(data, container);
        }

        function renderByDow(data, container) {
            var dowSelect = document.createElement('div');
            dowSelect.style.cssText = 'display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;';

            var activeDow = new Date().getDay();

            DOW_LABELS.forEach(function(label, idx) {
                var btn = document.createElement('button');
                btn.style.cssText = [
                    'padding:5px 12px', 'border-radius:6px', 'border:none',
                    'background:' + (idx === activeDow ? '#cc0001' : 'rgba(255,255,255,0.07)'),
                    'color:' + (idx === activeDow ? '#fff' : 'rgba(255,255,255,0.6)'),
                    'font-size:12px', 'font-family:inherit', 'cursor:pointer',
                ].join(';');
                btn.textContent = label;
                btn.addEventListener('click', function() {
                    activeDow = idx;
                    dowSelect.querySelectorAll('button').forEach(function(b, i) {
                        b.style.background = i === idx ? '#cc0001' : 'rgba(255,255,255,0.07)';
                        b.style.color = i === idx ? '#fff' : 'rgba(255,255,255,0.6)';
                    });
                    dowBody.innerHTML = '';
                    renderDowContent(data, activeDow, dowBody);
                });
                dowSelect.appendChild(btn);
            });
            container.appendChild(dowSelect);

            var dowBody = document.createElement('div');
            container.appendChild(dowBody);
            renderDowContent(data, activeDow, dowBody);
        }

        function renderDowContent(data, dow, container) {
            container.innerHTML = '';
            var zoneStats = {};
            Object.keys(data).forEach(function(key) {
                if (parseInt(key.split('_')[0]) !== dow) return;
                Object.keys(data[key]).forEach(function(zone) {
                    if (!zoneStats[zone]) zoneStats[zone] = { samples: 0, occupied: 0 };
                    zoneStats[zone].samples += data[key][zone].samples;
                    zoneStats[zone].occupied += data[key][zone].occupied;
                });
            });

            if (!Object.keys(zoneStats).length) {
                container.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;padding:20px 0;">Нет данных за этот день.</div>';
                return;
            }

            Object.keys(ZONES).forEach(function(zoneKey) {
                var stats = zoneStats[zoneKey];
                if (!stats || !stats.samples) return;
                var pct = Math.round(stats.occupied / stats.samples * 100);
                renderZoneBar(container, ZONES[zoneKey], pct, stats.samples);
            });

            // Тепловая сетка по часам для этого дня
            var dowData = {};
            Object.keys(data).forEach(function(key) {
                if (parseInt(key.split('_')[0]) === dow) dowData[key] = data[key];
            });
            renderHourGrid(dowData, container);
        }

        function renderZoneBar(container, zone, pct, samples) {
            var wrap = document.createElement('div');
            wrap.style.cssText = 'margin-bottom:10px;';

            var info = document.createElement('div');
            info.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px;';

            var nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-size:12px;font-weight:600;color:rgba(255,255,255,0.8);';
            nameEl.textContent = zone.name;

            var pctEl = document.createElement('span');
            pctEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.45);';
            pctEl.textContent = pct + '% (' + samples + ' замеров)';

            info.appendChild(nameEl);
            info.appendChild(pctEl);

            var track = document.createElement('div');
            track.style.cssText = 'height:8px;border-radius:4px;background:rgba(255,255,255,0.07);overflow:hidden;';

            var fill = document.createElement('div');
            fill.style.cssText = 'height:100%;border-radius:4px;background:' + zone.color + ';width:' + pct + '%;transition:width 0.3s;';

            track.appendChild(fill);
            wrap.appendChild(info);
            wrap.appendChild(track);
            container.appendChild(wrap);
        }

        function renderHourGrid(data, container) {
            var title = document.createElement('div');
            title.style.cssText = 'color:rgba(255,255,255,0.5);font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin:20px 0 12px;';
            title.textContent = 'По часам';
            container.appendChild(title);

            // Агрегируем все зоны по часам
            var hourStats = {};
            for (var h = 0; h < 24; h++) hourStats[h] = { samples: 0, occupied: 0 };

            Object.keys(data).forEach(function(key) {
                var hour = parseInt(key.split('_')[1]);
                Object.keys(data[key]).forEach(function(zone) {
                    hourStats[hour].samples += data[key][zone].samples;
                    hourStats[hour].occupied += data[key][zone].occupied;
                });
            });

            var grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(24, 1fr);gap:2px;';

            for (var h = 0; h < 24; h++) {
                var stats = hourStats[h];
                var pct = stats.samples > 0 ? stats.occupied / stats.samples : 0;
                var cell = document.createElement('div');
                cell.title = h + ':00 — ' + Math.round(pct * 100) + '%';
                var intensity = Math.round(pct * 255);
                cell.style.cssText = [
                    'height:32px', 'border-radius:3px',
                    'background:rgba(' + intensity + ',' + Math.round(intensity * 0.3) + ',0,' + (stats.samples > 0 ? '0.8' : '0.15') + ')',
                    'cursor:default',
                ].join(';');

                var hourLabel = document.createElement('div');
                hourLabel.style.cssText = 'font-size:9px;color:rgba(255,255,255,0.4);text-align:center;padding-top:3px;';
                hourLabel.textContent = h;
                cell.appendChild(hourLabel);

                grid.appendChild(cell);
            }
            container.appendChild(grid);

            var hint = document.createElement('div');
            hint.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.25);margin-top:6px;';
            hint.textContent = 'Тёмный = мало посетителей, Ярко-оранжевый = полная загрузка';
            container.appendChild(hint);
        }

        renderView();

        modal.appendChild(header);
        modal.appendChild(tabs);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        _modal = overlay;
    }

    // Кнопка в боковой панели
    function createButton() {
        if (document.getElementById('godji-heatmap-btn')) return;

        var btn = document.createElement('a');
        btn.id = 'godji-heatmap-btn';
        btn.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        btn.href = 'javascript:void(0)';
        btn.style.cssText = [
            'position:fixed', 'bottom:454px', 'left:0', 'z-index:150',
            'display:flex', 'align-items:center', 'gap:12px',
            'width:280px', 'height:46px', 'padding:8px 12px 8px 18px',
            'cursor:pointer', 'user-select:none', 'font-family:inherit',
            'box-sizing:border-box', 'text-decoration:none',
        ].join(';');

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;';
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

        var label = document.createElement('span');
        label.textContent = 'Тепловая карта';
        label.style.cssText = 'font-size:14px;font-weight:600;color:#fff;white-space:nowrap;letter-spacing:0.1px;';

        btn.appendChild(iconWrap);
        btn.appendChild(label);
        document.body.appendChild(btn);
        btn.addEventListener('click', openHeatmap);
    }

    // Запускаем сбор данных
    setInterval(recordSnapshot, SAMPLE_INTERVAL);
    setTimeout(recordSnapshot, 10000);

    var observer = new MutationObserver(function() {
        if (!document.getElementById('godji-heatmap-btn')) createButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(createButton, 2000);

})();

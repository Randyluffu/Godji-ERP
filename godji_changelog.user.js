// ==UserScript==
// @name         Годжи — Changelog
// @namespace    http://tampermonkey.net/
// @version      1.2
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_changelog.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_changelog.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var CHANGELOG = [
        {
            date: '19 марта 2026',
            entries: [
                {
                    title: 'Мультивыбор ПК на карте',
                    text: 'Ctrl + клик по карточкам на карте выделяет несколько ПК. Правый клик в любом месте при наличии выделения открывает командное меню: включить, выключить, перезагрузить, управление защитой, добавить бесплатное время, завершить сеансы, убрать подсветку уборки.',
                },
                {
                    title: 'Синхронизация карты и таблицы',
                    text: 'Клик по строке таблицы перемещает карту к нужному ПК и подсвечивает его карточку. Клик по карточке на карте подсвечивает строку в таблице.',
                },
                {
                    title: 'Уведомление об окончании сеанса на TV 1',
                    text: 'При завершении сеанса или переходе в ожидание на TV 1 появляется уведомление в углу экрана. Висит до ручного закрытия.',
                },
                {
                    title: 'Заметки в карточке клиента',
                    text: 'В карточке клиента рядом с его именем добавлено поле для заметок с поддержкой базового форматирования. Сохраняется отдельно для каждого клиента.',
                },
                {
                    title: 'Changelog',
                    text: 'Кнопка в боковой панели с историей всех изменений.',
                },
                {
                    title: 'Счётчик занятых ПК',
                    text: 'Под часами в боковой панели отображается количество ПК с активными сеансами.',
                },
            ],
        },
        {
            date: '18 марта 2026',
            entries: [
                {
                    title: 'Таблица дашборда',
                    text: 'Иконки щита в колонке защиты вместо текстовых бейджей. Исправлен порядок колонок. Колонка переименована в "№ ПК". Ширины колонок скорректированы. Исправлен вылет дашборда при обновлении данных таблицы.',
                },
                {
                    title: 'Цвета меню ПК',
                    text: 'Кнопки контекстного меню ПК переработаны: полупрозрачные фоны, единая палитра по группам, иерархия насыщенности.',
                },
                {
                    title: 'Подсветка уборки',
                    text: 'Устранена ошибка ложных срабатываний подсветки из-за виртуализации таблицы.',
                },
            ],
        },
        {
            date: '15 марта 2026',
            entries: [
                {
                    title: 'Подсветка уборки',
                    text: 'Карточка ПК подсвечивается 30 минут после завершения сеанса с таймером обратного отсчёта. Кнопка сброса в боковой панели.',
                },
                {
                    title: 'История сеансов',
                    text: 'История всех сеансов за 72 часа, доступна из боковой панели.',
                },
                {
                    title: 'Добавление бесплатного времени',
                    text: 'В меню ПК с активным сеансом — кнопка добавления времени с выбором минут и комментарием. Бонусы начисляются автоматически по тарифу.',
                },
                {
                    title: 'Цвета меню ПК',
                    text: 'Первая версия цветовой разметки кнопок контекстного меню.',
                },
                {
                    title: 'Время в часах',
                    text: 'Продолжительность сеансов в таблице отображается в часах и минутах вместо минут.',
                },
            ],
        },
    ];

    var _modal = null;

    function openChangelog() {
        if (_modal) { _modal.remove(); _modal = null; return; }

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) { overlay.remove(); _modal = null; }
        });

        var modal = document.createElement('div');
        modal.style.cssText = [
            'background:#1a1b1e',
            'border:1px solid rgba(255,255,255,0.09)',
            'border-radius:12px',
            'width:100%',
            'max-width:560px',
            'max-height:82vh',
            'display:flex',
            'flex-direction:column',
            'font-family:inherit',
            'box-shadow:0 24px 64px rgba(0,0,0,0.55)',
            'overflow:hidden',
        ].join(';');

        // Шапка
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 22px 14px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;';

        var titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;';

        var titleIcon = document.createElement('div');
        titleIcon.style.cssText = 'width:30px;height:30px;border-radius:7px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        titleIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 9l1 0"/><path d="M9 13l6 0"/><path d="M9 17l6 0"/></svg>';

        var titleText = document.createElement('span');
        titleText.style.cssText = 'color:#fff;font-size:15px;font-weight:700;';
        titleText.textContent = 'История обновлений';

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.35);font-size:20px;cursor:pointer;padding:0;line-height:1;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('mouseenter', function() { closeBtn.style.color = '#fff'; });
        closeBtn.addEventListener('mouseleave', function() { closeBtn.style.color = 'rgba(255,255,255,0.35)'; });
        closeBtn.addEventListener('click', function() { overlay.remove(); _modal = null; });

        titleWrap.appendChild(titleIcon);
        titleWrap.appendChild(titleText);
        header.appendChild(titleWrap);
        header.appendChild(closeBtn);

        // Скроллируемый контент
        var body = document.createElement('div');
        body.style.cssText = 'overflow-y:auto;padding:14px 20px 20px;flex:1;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.12) transparent;';

        if (!document.getElementById('godji-changelog-style')) {
            var st = document.createElement('style');
            st.id = 'godji-changelog-style';
            st.textContent = '#godji-changelog-body::-webkit-scrollbar{width:4px}#godji-changelog-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px}';
            document.head.appendChild(st);
        }
        body.id = 'godji-changelog-body';

        CHANGELOG.forEach(function(day, di) {
            var dayWrap = document.createElement('div');
            dayWrap.style.cssText = 'margin-bottom:6px;border:1px solid rgba(255,255,255,0.07);border-radius:8px;overflow:hidden;';

            var dayBtn = document.createElement('button');
            dayBtn.style.cssText = [
                'display:flex',
                'align-items:center',
                'justify-content:space-between',
                'width:100%',
                'padding:10px 14px',
                'background:rgba(255,255,255,0.03)',
                'border:none',
                'cursor:pointer',
                'font-family:inherit',
            ].join(';');

            var dayLeft = document.createElement('div');
            dayLeft.style.cssText = 'display:flex;align-items:center;gap:10px;';

            var dot = document.createElement('div');
            dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + (di === 0 ? '#cc0001' : 'rgba(255,255,255,0.2)') + ';';

            var dateLabel = document.createElement('span');
            dateLabel.style.cssText = 'color:' + (di === 0 ? '#fff' : 'rgba(255,255,255,0.5)') + ';font-size:13px;font-weight:600;';
            dateLabel.textContent = day.date;

            var countLabel = document.createElement('span');
            countLabel.style.cssText = 'color:rgba(255,255,255,0.25);font-size:11px;';
            countLabel.textContent = day.entries.length + ' изм.';

            var arrow = document.createElement('span');
            arrow.style.cssText = 'color:rgba(255,255,255,0.25);font-size:11px;transition:transform 0.18s;';
            arrow.textContent = '▼';

            dayLeft.appendChild(dot);
            dayLeft.appendChild(dateLabel);
            dayLeft.appendChild(countLabel);
            dayBtn.appendChild(dayLeft);
            dayBtn.appendChild(arrow);

            var dayContent = document.createElement('div');
            dayContent.style.cssText = 'padding:0 14px;display:' + (di === 0 ? 'block' : 'none') + ';';
            if (di !== 0) arrow.style.transform = 'rotate(-90deg)';

            dayBtn.addEventListener('mouseenter', function() { dayBtn.style.background = 'rgba(255,255,255,0.06)'; });
            dayBtn.addEventListener('mouseleave', function() { dayBtn.style.background = 'rgba(255,255,255,0.03)'; });
            dayBtn.addEventListener('click', function() {
                var open = dayContent.style.display !== 'none';
                dayContent.style.display = open ? 'none' : 'block';
                arrow.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
            });

            day.entries.forEach(function(entry, ei) {
                var item = document.createElement('div');
                item.style.cssText = 'padding:10px 0;' + (ei < day.entries.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : '');

                var t = document.createElement('div');
                t.style.cssText = 'color:rgba(255,255,255,0.85);font-size:12px;font-weight:600;margin-bottom:4px;';
                t.textContent = entry.title;

                var d = document.createElement('div');
                d.style.cssText = 'color:rgba(255,255,255,0.38);font-size:12px;line-height:1.55;';
                d.textContent = entry.text;

                item.appendChild(t);
                item.appendChild(d);
                dayContent.appendChild(item);
            });

            dayWrap.appendChild(dayBtn);
            dayWrap.appendChild(dayContent);
            body.appendChild(dayWrap);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        _modal = overlay;
    }

    // Кнопка — точный стиль как у "Сбросить подсветки"
    function createButton() {
        var btn = document.createElement('a');
        btn.id = 'godji-changelog-btn';
        btn.className = 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';
        btn.href = 'javascript:void(0)';
        btn.style.cssText = [
            'position:fixed',
            'bottom:360px',
            'left:0',
            'z-index:150',
            'display:flex',
            'align-items:center',
            'gap:12px',
            'width:280px',
            'height:46px',
            'padding:8px 12px 8px 18px',
            'cursor:pointer',
            'user-select:none',
            'font-family:inherit',
            'box-sizing:border-box',
            'text-decoration:none',
        ].join(';');

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText = [
            'width:32px', 'height:32px', 'border-radius:8px',
            'background:#cc0001',
            'display:flex', 'align-items:center', 'justify-content:center',
            'flex-shrink:0', 'color:#ffffff',
        ].join(';');
        iconWrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 9l1 0"/><path d="M9 13l6 0"/><path d="M9 17l6 0"/></svg>';

        var label = document.createElement('span');
        label.textContent = 'Changelog';
        label.style.cssText = 'font-size:14px;font-weight:600;color:#ffffff;white-space:nowrap;letter-spacing:0.1px;';

        btn.appendChild(iconWrap);
        btn.appendChild(label);
        document.body.appendChild(btn);

        btn.addEventListener('click', openChangelog);
    }

    createButton();

})();
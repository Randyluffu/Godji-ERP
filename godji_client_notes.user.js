// ==UserScript==
// @name         Годжи — Заметки о клиенте
// @namespace    http://tampermonkey.net/
// @version      3.6
// @match        https://godji.cloud/clients/*
// @match        https://*.godji.cloud/clients/*
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @include      https://godji.cloud/clients/*
// @include      https://*.godji.cloud/clients/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_client_notes.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_client_notes.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    function getClientId() {
        var match = window.location.pathname.match(/\/clients\/([a-f0-9-]+)/);
        return match ? match[1] : null;
    }

    function storageKey(clientId) {
        return 'godji_note_v2_' + clientId;
    }

    var DEFAULT_COLOR = 'var(--mantine-color-text)';

    function loadNote(clientId) {
        var data = localStorage.getItem(storageKey(clientId));
        if (!data) return { html: '', fontSize: 13, bold: false, italic: false, color: DEFAULT_COLOR };
        try { return JSON.parse(data); } catch(e) { return { html: data, fontSize: 13, bold: false, italic: false, color: DEFAULT_COLOR }; }
    }

    function saveNote(clientId, data) {
        if (!data.html.trim() && !data.bold && !data.italic && data.fontSize === 13 && data.color === DEFAULT_COLOR) {
            localStorage.removeItem(storageKey(clientId));
        } else {
            localStorage.setItem(storageKey(clientId), JSON.stringify(data));
        }
    }

    function injectNote() {
        if (document.getElementById('godji-client-note')) return;

        var clientId = getClientId();
        if (!clientId) return;

        var h2 = document.querySelector('h2.PageHeader_desktopTitle__ffB_Z');
        if (!h2) return;

        // Родитель h2 — flex-колонка (Breadcrumbs + h2)
        // Делаем его flex-row и вставляем заметку справа от h2
        var h2Parent = h2.parentElement;
        if (!h2Parent) return;

        // Не трогаем стили родителя — это ломает React
        // Заметку вставляем как inline-элемент прямо в h2
        var saved = loadNote(clientId);

        // Состояние форматирования
        var state = {
            fontSize: saved.fontSize || 13,
            bold:     saved.bold     || false,
            italic:   saved.italic   || false,
            color:    saved.color    || DEFAULT_COLOR,
        };

        // Цвета для выбора
        var COLORS = [
            { value: 'var(--mantine-color-text)',   label: 'Основной' },
            { value: 'var(--mantine-color-dimmed)', label: 'Приглушённый' },
            { value: '#e03131',                     label: 'Красный' },
            { value: '#f76707',                     label: 'Оранжевый' },
            { value: '#f59f00',                     label: 'Жёлтый' },
            { value: '#2f9e44',                     label: 'Зелёный' },
            { value: '#1971c2',                     label: 'Синий' },
            { value: '#ae3ec9',                     label: 'Фиолетовый' },
        ];

        // Обёртка
        var noteBlock = document.createElement('div');
        noteBlock.id = 'godji-client-note';
        noteBlock.style.cssText = 'display:flex;align-items:center;gap:6px;';

        // Иконка карандаша — видна только при наведении
        var pencilIcon = document.createElement('div');
        pencilIcon.style.cssText = 'flex-shrink:0;opacity:0;transition:opacity 0.15s;line-height:0;';
        pencilIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--mantine-color-dimmed)"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"></path><path d="M13.5 6.5l4 4"></path></svg>';

        // Панель инструментов
        var toolbar = document.createElement('div');
        toolbar.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:3px',
            'padding:3px 6px',
            'background:var(--mantine-color-default)',
            'border:1px solid var(--mantine-color-default-border)',
            'border-radius:var(--mantine-radius-sm)',
            'flex-shrink:0',
            'opacity:0',
            'transition:opacity 0.15s',
            'box-shadow:var(--mantine-shadow-xs)',
            'pointer-events:none',
        ].join(';');

        function btnStyle(active) {
            return [
                'width:24px',
                'height:24px',
                'border:none',
                'border-radius:4px',
                'cursor:pointer',
                'font-size:12px',
                'font-family:inherit',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'transition:background 0.15s',
                active ? 'background:rgba(0,0,0,0.18);font-weight:700;' : 'background:transparent;',
            ].join(';');
        }

        // Кнопка Жирный
        var btnBold = document.createElement('button');
        btnBold.innerHTML = '<b>B</b>';
        btnBold.title = 'Жирный';
        btnBold.style.cssText = btnStyle(state.bold);

        // Кнопка Курсив
        var btnItalic = document.createElement('button');
        btnItalic.innerHTML = '<i>I</i>';
        btnItalic.title = 'Курсив';
        btnItalic.style.cssText = btnStyle(state.italic);

        // Разделитель
        function sep() {
            var d = document.createElement('div');
            d.style.cssText = 'width:1px;height:16px;background:rgba(0,0,0,0.15);margin:0 2px;';
            return d;
        }

        // Кнопки размера шрифта
        var btnMinus = document.createElement('button');
        btnMinus.textContent = '−';
        btnMinus.title = 'Уменьшить шрифт';
        btnMinus.style.cssText = btnStyle(false) + 'font-size:16px;';

        var btnPlus = document.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.title = 'Увеличить шрифт';
        btnPlus.style.cssText = btnStyle(false) + 'font-size:14px;';

        // Цвета
        var colorWrap = document.createElement('div');
        colorWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';

        var colorBtns = [];
        COLORS.forEach(function(c) {
            var dot = document.createElement('div');
            dot.title = c.label;
            dot.style.cssText = [
                'width:14px',
                'height:14px',
                'border-radius:50%',
                'background:' + c.value,
                'cursor:pointer',
                'flex-shrink:0',
                'border:2px solid ' + (state.color === c.value ? 'rgba(0,0,0,0.5)' : 'transparent'),
                'transition:border-color 0.15s',
            ].join(';');
            colorBtns.push({ el: dot, value: c.value });
            colorWrap.appendChild(dot);
        });

        toolbar.appendChild(btnBold);
        toolbar.appendChild(btnItalic);
        toolbar.appendChild(sep());
        toolbar.appendChild(btnMinus);
        toolbar.appendChild(btnPlus);
        toolbar.appendChild(sep());
        toolbar.appendChild(colorWrap);

        // Поле ввода (contenteditable)
        var editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.innerHTML = saved.html || '';
        editor.setAttribute('data-placeholder', 'Нажмите чтобы добавить заметку...');
        editor.style.cssText = [
            'min-width:280px',
            'max-width:700px','width:700px',
            'min-height:26px',
            'padding:4px 8px',
            'font-size:' + state.fontSize + 'px',
            'font-family:inherit',
            'font-weight:' + (state.bold ? '700' : '600'),
            'font-style:' + (state.italic ? 'italic' : 'normal'),
            'color:' + state.color,
            'line-height:1.4',
            'border:1.5px solid transparent',
            'border-radius:var(--mantine-radius-sm)',
            'background:transparent',
            'outline:none',
            'transition:border-color 0.15s, background 0.15s',
            'word-break:break-word',
            'box-sizing:border-box',
        ].join(';');

        // Placeholder через CSS — полупрозрачный но заметный
        var styleEl = document.createElement('style');
        styleEl.textContent = [
            '#godji-client-note [contenteditable]:empty:before {',
            '  content: attr(data-placeholder);',
            '  color: rgba(0,0,0,0.45);',
            '  pointer-events: none;',
            '  font-style: italic;',
            '}',
        ].join('\n');
        document.head.appendChild(styleEl);

        function applyStyle() {
            editor.style.fontSize = state.fontSize + 'px';
            editor.style.fontWeight = state.bold ? '700' : '600';
            editor.style.fontStyle = state.italic ? 'italic' : 'normal';
            editor.style.color = state.color;
            // Убираем inline font-size у вложенных spans чтобы они наследовали родительский
            editor.querySelectorAll('span[style*="font-size"]').forEach(function(sp){
                sp.style.fontSize = '';
                if (!sp.style.cssText.trim()) sp.removeAttribute('style');
            });
            btnBold.style.cssText = btnStyle(state.bold);
            btnItalic.style.cssText = btnStyle(state.italic);
            colorBtns.forEach(function(cb) {
                cb.el.style.border = '2px solid ' + (state.color === cb.value ? 'rgba(0,0,0,0.5)' : 'transparent');
            });
        }

        function doSave() {
            saveNote(clientId, {
                html:     editor.innerHTML,
                fontSize: state.fontSize,
                bold:     state.bold,
                italic:   state.italic,
                color:    state.color,
            });
        }

        // Обработчики кнопок
        btnBold.addEventListener('click', function() {
            state.bold = !state.bold;
            applyStyle();
            doSave();
        });

        btnItalic.addEventListener('click', function() {
            state.italic = !state.italic;
            applyStyle();
            doSave();
        });

        btnMinus.addEventListener('click', function() {
            if (state.fontSize > 9) { state.fontSize -= 2; applyStyle(); doSave(); }
        });

        btnPlus.addEventListener('click', function() {
            if (state.fontSize < 28) { state.fontSize += 2; applyStyle(); doSave(); }
        });

        colorBtns.forEach(function(cb) {
            cb.el.addEventListener('click', function() {
                state.color = cb.value;
                applyStyle();
                doSave();
            });
        });

        // Фокус/блур редактора
        editor.addEventListener('focus', function() {
            editor.style.borderColor = 'var(--mantine-color-gg_primary-filled)';
            editor.style.background = 'var(--mantine-color-default)';
            editor.style.boxShadow = 'var(--mantine-shadow-xs)';
            toolbar.style.opacity = '1';
            pencilIcon.style.opacity = '0.5';
        });
        editor.addEventListener('blur', function() {
            editor.style.borderColor = 'transparent';
            editor.style.background = 'transparent';
            editor.style.boxShadow = 'none';
            doSave();
            // Скрываем тулбар с задержкой чтобы не мигал при клике по кнопкам
            setTimeout(function() {
                if (document.activeElement !== editor) {
                    toolbar.style.opacity = '0';
                    toolbar.style.pointerEvents = 'none';
                }
            }, 200);
        });

        var saveTimer;
        editor.addEventListener('input', function() {
            // Если редактор содержит только <br> — считаем пустым
            if (editor.innerHTML === '<br>' || editor.innerHTML === '<br/>' || editor.innerHTML === '<br />') {
                editor.innerHTML = '';
            }
            clearTimeout(saveTimer);
            saveTimer = setTimeout(doSave, 800);
        });

        editor.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') editor.blur();
        });

        // Hover — показываем карандаш и тулбар
        noteBlock.addEventListener('mouseenter', function() {
            pencilIcon.style.opacity = '0.5';
            toolbar.style.opacity = '1';
            toolbar.style.pointerEvents = 'auto';
            if (document.activeElement !== editor) {
                editor.style.background = 'var(--mantine-color-default)';
                editor.style.borderColor = 'var(--mantine-color-default-border)';
                editor.style.boxShadow = 'var(--mantine-shadow-xs)';
            }
        });
        noteBlock.addEventListener('mouseleave', function() {
            pencilIcon.style.opacity = '0';
            if (document.activeElement !== editor) {
                toolbar.style.opacity = '0';
                toolbar.style.pointerEvents = 'none';
                editor.style.background = 'transparent';
                editor.style.borderColor = 'transparent';
                editor.style.boxShadow = 'none';
            }
        });

        // Горизонтальная компоновка: иконка | редактор | тулбар
        noteBlock.appendChild(pencilIcon);
        noteBlock.appendChild(editor);
        noteBlock.appendChild(toolbar);

        noteBlock.style.position = 'fixed';
        noteBlock.style.zIndex = '9000';
        noteBlock.style.display = 'flex';
        noteBlock.style.alignItems = 'center';
        noteBlock.style.gap = '6px';
        // toolbar перекрывает содержимое ERP — скрываем пока не наведение
        document.body.appendChild(noteBlock);

        function repositionNote() {
            var r = h2.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return;

            // Левая граница — правый край h2 (заголовок "Клиент @...")
            var leftBound = Math.round(r.right + 12);

            // Правая граница:
            // — на полной странице: левый край кнопки «Бронирование» в сайдбаре
            // — в iframe модалки поиска: правый край viewport минус отступ
            var bookingsEl = document.querySelector('a[href="/bookings"].LinksGroup_navLink__qvSOI');
            var isInModal  = !!window.frameElement; // запущены в iframe
            var rightBound;
            if (bookingsEl && !isInModal) {
                rightBound = Math.round(bookingsEl.getBoundingClientRect().left - 10);
            } else {
                // Без сайдбара — ограничиваем до 80% ширины viewport
                rightBound = Math.round(window.innerWidth * 0.80);
            }

            // Верхняя граница — низ breadcrumbs + отступ (или верх h2 в iframe)
            var breadcrumb = document.querySelector('.mantine-Breadcrumbs-root');
            var topBound = breadcrumb
                ? Math.round(breadcrumb.getBoundingClientRect().bottom + 6)
                : Math.round(r.top);

            // Нижняя граница — верх табов (Покупки, Бронирования и т.д.)
            var tabs = document.querySelector('.mantine-Tabs-list');
            var bottomBound = tabs
                ? Math.round(tabs.getBoundingClientRect().top - 6)
                : Math.round(r.bottom + 200);

            // Вертикаль: выравниваем по вертикальному центру h2
            var noteH = noteBlock.offsetHeight || 60;
            var topPos = Math.round(r.top + (r.height / 2) - (noteH / 2));
            topPos = Math.max(topBound, Math.min(topPos, bottomBound - noteH));

            noteBlock.style.top  = topPos + 'px';
            noteBlock.style.left = leftBound + 'px';

            // Ширина: от leftBound до rightBound минус иконка(20) минус тулбар(~120) минус зазоры
            var toolbarW = toolbar.offsetWidth || 120;
            var iconW    = pencilIcon.offsetWidth || 20;
            var maxW = Math.max(60, rightBound - leftBound - toolbarW - iconW - 24);
            editor.style.maxWidth = maxW + 'px';
            editor.style.width    = Math.min(700, maxW) + 'px';
        }
        repositionNote();

        // Перепозиционируем при изменении layout
        window.addEventListener('resize', repositionNote);
        window.addEventListener('scroll', repositionNote, true);
        var _repoTimer = setInterval(repositionNote, 800);

        // Останавливаем интервал при удалении
        var _mutRemove = new MutationObserver(function() {
            if (!document.getElementById('godji-client-note')) {
                clearInterval(_repoTimer);
                _mutRemove.disconnect();
            }
        });
        _mutRemove.observe(document.body, {childList: true, subtree: false});
    }

    // Следим за URL — при смене вкладки без перезагрузки убираем заметку
    var _lastNoteUrl = window.location.href;
    function checkUrlChange() {
        var cur = window.location.href;
        if (cur !== _lastNoteUrl) {
            _lastNoteUrl = cur;
            var note = document.getElementById('godji-client-note');
            if (note) note.remove();
            // Пробуем заново если всё ещё на странице клиента
            setTimeout(injectNote, 400);
        }
    }

    var observer = new MutationObserver(function(mutations) {
        checkUrlChange();
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiNoteTimer);
                window._godjiNoteTimer = setTimeout(function() {
                    if (!document.getElementById('godji-client-note')) {
                        injectNote();
                    }
                }, 300);
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: false });
    setTimeout(injectNote, 1000);
    setTimeout(injectNote, 2500);
    setTimeout(injectNote, 5000);

})();

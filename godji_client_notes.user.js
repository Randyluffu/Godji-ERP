// ==UserScript==
// @name         Годжи — Заметки о клиенте
// @namespace    http://tampermonkey.net/
// @version      3.7
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
        // Обычная страница
        var match = window.location.pathname.match(/\/clients\/([a-f0-9-]+)/);
        if (match) return match[1];
        // Внутри iframe быстрого поиска
        try {
            var frames = document.querySelectorAll('iframe[src*="/clients/"]');
            if (frames.length) {
                var m = frames[0].src.match(/\/clients\/([a-f0-9-]+)/);
                if (m) return m[1];
            }
        } catch(e) {}
        return null;
    }

    function getClientIdFromPath(path) {
        var match = (path || window.location.pathname).match(/\/clients\/([a-f0-9-]+)/);
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

        var clientId = getClientIdFromPath();
        if (!clientId) return;

        var h2 = document.querySelector('h2.PageHeader_desktopTitle__ffB_Z');
        if (!h2) return;

        // Родитель h2 — flex-колонка (Breadcrumbs + h2)
        // Дед h2 — flex-row (колонка с h2 + блок кнопок)
        var h2Col = h2.parentElement;
        if (!h2Col) return;
        var headerRow = h2Col.parentElement;
        if (!headerRow) return;

        var saved = loadNote(clientId);
        var state = {
            fontSize: saved.fontSize || 13,
            bold:     saved.bold     || false,
            italic:   saved.italic   || false,
            color:    saved.color    || DEFAULT_COLOR,
        };

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

        // Вставляем заметку прямо в DOM — как ещё один дочерний элемент h2Col
        // Делаем h2Col flex-row если он ещё не такой
        // Но не трогаем существующие стили h2Col чтобы не сломать React
        // Вместо этого вставляем noteBlock как следующий sibling после h2Col внутри headerRow
        // headerRow = flex-row: [h2Col | кнопки]
        // Мы вставляем между ними: [h2Col | noteBlock | кнопки]

        var noteBlock = document.createElement('div');
        noteBlock.id = 'godji-client-note';
        noteBlock.style.cssText = [
            'display:flex',
            'align-items:flex-start',
            'gap:6px',
            'flex:1',
            'min-width:0',
            'padding-top:4px',
            'margin-left:12px',
            'margin-right:12px',
        ].join(';');

        // Кнопки (второй child headerRow) — вставляем noteBlock перед ними
        var buttonsEl = h2Col.nextElementSibling;

        // Иконка карандаша
        var pencilIcon = document.createElement('div');
        pencilIcon.style.cssText = 'flex-shrink:0;opacity:0;transition:opacity 0.15s;line-height:0;padding-top:2px;';
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
                'width:24px', 'height:24px', 'border:none', 'border-radius:4px',
                'cursor:pointer', 'font-size:12px', 'font-family:inherit',
                'display:flex', 'align-items:center', 'justify-content:center',
                'transition:background 0.15s',
                active ? 'background:rgba(0,0,0,0.18);font-weight:700;' : 'background:transparent;',
            ].join(';');
        }

        var btnBold = document.createElement('button');
        btnBold.innerHTML = '<b>B</b>';
        btnBold.title = 'Жирный';
        btnBold.style.cssText = btnStyle(state.bold);

        var btnItalic = document.createElement('button');
        btnItalic.innerHTML = '<i>I</i>';
        btnItalic.title = 'Курсив';
        btnItalic.style.cssText = btnStyle(state.italic);

        function sep() {
            var d = document.createElement('div');
            d.style.cssText = 'width:1px;height:16px;background:rgba(0,0,0,0.15);margin:0 2px;';
            return d;
        }

        var btnMinus = document.createElement('button');
        btnMinus.textContent = '−';
        btnMinus.title = 'Уменьшить шрифт';
        btnMinus.style.cssText = btnStyle(false) + 'font-size:16px;';

        var btnPlus = document.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.title = 'Увеличить шрифт';
        btnPlus.style.cssText = btnStyle(false) + 'font-size:14px;';

        var colorWrap = document.createElement('div');
        colorWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';

        var colorBtns = [];
        COLORS.forEach(function(c) {
            var dot = document.createElement('div');
            dot.title = c.label;
            dot.style.cssText = [
                'width:14px', 'height:14px', 'border-radius:50%',
                'background:' + c.value, 'cursor:pointer', 'flex-shrink:0',
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

        var editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.innerHTML = saved.html || '';
        editor.setAttribute('data-placeholder', 'Нажмите чтобы добавить заметку...');
        editor.style.cssText = [
            'min-width:200px',
            'max-width:600px',
            'width:100%',
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

        var styleEl = document.createElement('style');
        styleEl.textContent = '#godji-client-note [contenteditable]:empty:before { content: attr(data-placeholder); color: rgba(128,128,128,0.6); pointer-events: none; font-style: italic; }';
        document.head.appendChild(styleEl);

        function applyStyle() {
            editor.style.fontSize = state.fontSize + 'px';
            editor.style.fontWeight = state.bold ? '700' : '600';
            editor.style.fontStyle = state.italic ? 'italic' : 'normal';
            editor.style.color = state.color;
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
            saveNote(clientId, { html: editor.innerHTML, fontSize: state.fontSize, bold: state.bold, italic: state.italic, color: state.color });
        }

        btnBold.addEventListener('click', function() { state.bold = !state.bold; applyStyle(); doSave(); });
        btnItalic.addEventListener('click', function() { state.italic = !state.italic; applyStyle(); doSave(); });
        btnMinus.addEventListener('click', function() { if (state.fontSize > 9) { state.fontSize -= 2; applyStyle(); doSave(); } });
        btnPlus.addEventListener('click', function() { if (state.fontSize < 28) { state.fontSize += 2; applyStyle(); doSave(); } });
        colorBtns.forEach(function(cb) {
            cb.el.addEventListener('click', function() { state.color = cb.value; applyStyle(); doSave(); });
        });

        editor.addEventListener('focus', function() {
            editor.style.borderColor = 'var(--mantine-color-gg_primary-filled)';
            editor.style.background = 'var(--mantine-color-default)';
            editor.style.boxShadow = 'var(--mantine-shadow-xs)';
            toolbar.style.opacity = '1';
            toolbar.style.pointerEvents = 'auto';
            pencilIcon.style.opacity = '0.5';
        });
        editor.addEventListener('blur', function() {
            editor.style.borderColor = 'transparent';
            editor.style.background = 'transparent';
            editor.style.boxShadow = 'none';
            doSave();
            setTimeout(function() {
                if (document.activeElement !== editor) {
                    toolbar.style.opacity = '0';
                    toolbar.style.pointerEvents = 'none';
                }
            }, 200);
        });

        var saveTimer;
        editor.addEventListener('input', function() {
            if (editor.innerHTML === '<br>' || editor.innerHTML === '<br/>' || editor.innerHTML === '<br />') editor.innerHTML = '';
            clearTimeout(saveTimer);
            saveTimer = setTimeout(doSave, 800);
        });
        editor.addEventListener('keydown', function(e) { if (e.ctrlKey && e.key === 'Enter') editor.blur(); });

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

        var noteInner = document.createElement('div');
        noteInner.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;';
        noteInner.appendChild(toolbar);
        noteInner.appendChild(editor);

        noteBlock.appendChild(pencilIcon);
        noteBlock.appendChild(noteInner);

        // Вставляем в headerRow между h2Col и кнопками
        // Нужно чтобы headerRow был flex-row — проверяем и принудительно ставим
        // Не меняем существующие стили React, просто вставляем элемент
        if (buttonsEl) {
            headerRow.insertBefore(noteBlock, buttonsEl);
        } else {
            headerRow.appendChild(noteBlock);
        }

        // Адаптируем ширину: если в iframe — меньше места
        function adjustWidth() {
            var isInModal = !!window.frameElement;
            if (isInModal) {
                editor.style.maxWidth = '300px';
                editor.style.minWidth = '150px';
            } else {
                editor.style.maxWidth = '600px';
                editor.style.minWidth = '200px';
            }
        }
        adjustWidth();
        window.addEventListener('resize', adjustWidth);
    }

    // Следим за URL при SPA-навигации
    var _lastNoteUrl = window.location.href;
    function checkUrlChange() {
        var cur = window.location.href;
        if (cur !== _lastNoteUrl) {
            _lastNoteUrl = cur;
            var note = document.getElementById('godji-client-note');
            if (note) note.remove();
            setTimeout(injectNote, 400);
        }
    }

    var observer = new MutationObserver(function(mutations) {
        checkUrlChange();
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiNoteTimer);
                window._godjiNoteTimer = setTimeout(function() {
                    if (!document.getElementById('godji-client-note')) injectNote();
                }, 300);
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: false });
    setTimeout(injectNote, 800);
    setTimeout(injectNote, 2000);
    setTimeout(injectNote, 4000);

    // Также слушаем iframe с карточкой клиента
    function tryInjectIntoFrame() {
        var frames = document.querySelectorAll('iframe[src*="/clients/"]');
        frames.forEach(function(frame) {
            try {
                var idoc = frame.contentDocument;
                if (!idoc) return;
                if (idoc.getElementById('godji-client-note')) return;
                var h2 = idoc.querySelector('h2.PageHeader_desktopTitle__ffB_Z');
                if (!h2) return;
                // Запускаем injectNote в контексте iframe
                if (frame._godjiNoteInjected) return;
                frame._godjiNoteInjected = true;
                // Создаём script в iframe или вызываем через contentWindow
                var clientId = (frame.src.match(/\/clients\/([a-f0-9-]+)/) || [])[1];
                if (!clientId) return;
                // Наблюдаем за iframe и делаем inject напрямую в его document
                injectNoteInDocument(idoc, clientId);
            } catch(e) {}
        });
    }

    function injectNoteInDocument(doc, clientId) {
        if (doc.getElementById('godji-client-note')) return;

        var h2 = doc.querySelector('h2.PageHeader_desktopTitle__ffB_Z');
        if (!h2) return;

        var h2Col = h2.parentElement;
        if (!h2Col) return;
        var headerRow = h2Col.parentElement;
        if (!headerRow) return;

        var saved = loadNote(clientId);
        var state = {
            fontSize: saved.fontSize || 13,
            bold:     saved.bold     || false,
            italic:   saved.italic   || false,
            color:    saved.color    || DEFAULT_COLOR,
        };

        var COLORS = [
            { value: 'var(--mantine-color-text)',   label: 'Основной' },
            { value: 'var(--mantine-color-dimmed)', label: 'Приглушённый' },
            { value: '#e03131', label: 'Красный' },
            { value: '#f76707', label: 'Оранжевый' },
            { value: '#f59f00', label: 'Жёлтый' },
            { value: '#2f9e44', label: 'Зелёный' },
            { value: '#1971c2', label: 'Синий' },
            { value: '#ae3ec9', label: 'Фиолетовый' },
        ];

        var noteBlock = doc.createElement('div');
        noteBlock.id = 'godji-client-note';
        noteBlock.style.cssText = 'display:flex;align-items:flex-start;gap:6px;flex:1;min-width:0;padding-top:4px;margin-left:12px;margin-right:12px;';

        var pencilIcon = doc.createElement('div');
        pencilIcon.style.cssText = 'flex-shrink:0;opacity:0;transition:opacity 0.15s;line-height:0;padding-top:2px;';
        pencilIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--mantine-color-dimmed)"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4"></path><path d="M13.5 6.5l4 4"></path></svg>';

        var toolbar = doc.createElement('div');
        toolbar.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 6px;background:var(--mantine-color-default);border:1px solid var(--mantine-color-default-border);border-radius:var(--mantine-radius-sm);flex-shrink:0;opacity:0;transition:opacity 0.15s;box-shadow:var(--mantine-shadow-xs);pointer-events:none;';

        function btnStyle(active) {
            return 'width:24px;height:24px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:background 0.15s;' + (active ? 'background:rgba(0,0,0,0.18);font-weight:700;' : 'background:transparent;');
        }

        var btnBold = doc.createElement('button');
        btnBold.innerHTML = '<b>B</b>';
        btnBold.style.cssText = btnStyle(state.bold);

        var btnItalic = doc.createElement('button');
        btnItalic.innerHTML = '<i>I</i>';
        btnItalic.style.cssText = btnStyle(state.italic);

        function sep() { var d = doc.createElement('div'); d.style.cssText = 'width:1px;height:16px;background:rgba(0,0,0,0.15);margin:0 2px;'; return d; }

        var btnMinus = doc.createElement('button');
        btnMinus.textContent = '−';
        btnMinus.style.cssText = btnStyle(false) + 'font-size:16px;';

        var btnPlus = doc.createElement('button');
        btnPlus.textContent = '+';
        btnPlus.style.cssText = btnStyle(false) + 'font-size:14px;';

        var colorWrap = doc.createElement('div');
        colorWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';
        var colorBtns = [];
        COLORS.forEach(function(c) {
            var dot = doc.createElement('div');
            dot.title = c.label;
            dot.style.cssText = 'width:14px;height:14px;border-radius:50%;background:' + c.value + ';cursor:pointer;flex-shrink:0;border:2px solid ' + (state.color === c.value ? 'rgba(0,0,0,0.5)' : 'transparent') + ';transition:border-color 0.15s;';
            colorBtns.push({ el: dot, value: c.value });
            colorWrap.appendChild(dot);
        });

        toolbar.appendChild(btnBold); toolbar.appendChild(btnItalic);
        toolbar.appendChild(sep()); toolbar.appendChild(btnMinus); toolbar.appendChild(btnPlus);
        toolbar.appendChild(sep()); toolbar.appendChild(colorWrap);

        var editor = doc.createElement('div');
        editor.contentEditable = 'true';
        editor.innerHTML = saved.html || '';
        editor.setAttribute('data-placeholder', 'Нажмите чтобы добавить заметку...');
        editor.style.cssText = 'min-width:150px;max-width:300px;width:100%;min-height:26px;padding:4px 8px;font-size:' + state.fontSize + 'px;font-family:inherit;font-weight:' + (state.bold ? '700' : '600') + ';font-style:' + (state.italic ? 'italic' : 'normal') + ';color:' + state.color + ';line-height:1.4;border:1.5px solid transparent;border-radius:var(--mantine-radius-sm);background:transparent;outline:none;transition:border-color 0.15s,background 0.15s;word-break:break-word;box-sizing:border-box;';

        var styleEl = doc.createElement('style');
        styleEl.textContent = '#godji-client-note [contenteditable]:empty:before { content: attr(data-placeholder); color: rgba(128,128,128,0.6); pointer-events: none; font-style: italic; }';
        doc.head.appendChild(styleEl);

        function applyStyle() {
            editor.style.fontSize = state.fontSize + 'px';
            editor.style.fontWeight = state.bold ? '700' : '600';
            editor.style.fontStyle = state.italic ? 'italic' : 'normal';
            editor.style.color = state.color;
            btnBold.style.cssText = btnStyle(state.bold);
            btnItalic.style.cssText = btnStyle(state.italic);
            colorBtns.forEach(function(cb) { cb.el.style.border = '2px solid ' + (state.color === cb.value ? 'rgba(0,0,0,0.5)' : 'transparent'); });
        }

        function doSave() { saveNote(clientId, { html: editor.innerHTML, fontSize: state.fontSize, bold: state.bold, italic: state.italic, color: state.color }); }

        btnBold.addEventListener('click', function() { state.bold = !state.bold; applyStyle(); doSave(); });
        btnItalic.addEventListener('click', function() { state.italic = !state.italic; applyStyle(); doSave(); });
        btnMinus.addEventListener('click', function() { if (state.fontSize > 9) { state.fontSize -= 2; applyStyle(); doSave(); } });
        btnPlus.addEventListener('click', function() { if (state.fontSize < 28) { state.fontSize += 2; applyStyle(); doSave(); } });
        colorBtns.forEach(function(cb) { cb.el.addEventListener('click', function() { state.color = cb.value; applyStyle(); doSave(); }); });

        editor.addEventListener('focus', function() {
            editor.style.borderColor = 'var(--mantine-color-gg_primary-filled)';
            editor.style.background = 'var(--mantine-color-default)';
            editor.style.boxShadow = 'var(--mantine-shadow-xs)';
            toolbar.style.opacity = '1'; toolbar.style.pointerEvents = 'auto';
            pencilIcon.style.opacity = '0.5';
        });
        editor.addEventListener('blur', function() {
            editor.style.borderColor = 'transparent';
            editor.style.background = 'transparent';
            editor.style.boxShadow = 'none';
            doSave();
            setTimeout(function() { if (doc.activeElement !== editor) { toolbar.style.opacity = '0'; toolbar.style.pointerEvents = 'none'; } }, 200);
        });

        var saveTimer;
        editor.addEventListener('input', function() {
            if (editor.innerHTML === '<br>' || editor.innerHTML === '<br/>') editor.innerHTML = '';
            clearTimeout(saveTimer); saveTimer = setTimeout(doSave, 800);
        });
        editor.addEventListener('keydown', function(e) { if (e.ctrlKey && e.key === 'Enter') editor.blur(); });

        noteBlock.addEventListener('mouseenter', function() {
            pencilIcon.style.opacity = '0.5'; toolbar.style.opacity = '1'; toolbar.style.pointerEvents = 'auto';
            if (doc.activeElement !== editor) { editor.style.background = 'var(--mantine-color-default)'; editor.style.borderColor = 'var(--mantine-color-default-border)'; editor.style.boxShadow = 'var(--mantine-shadow-xs)'; }
        });
        noteBlock.addEventListener('mouseleave', function() {
            pencilIcon.style.opacity = '0';
            if (doc.activeElement !== editor) { toolbar.style.opacity = '0'; toolbar.style.pointerEvents = 'none'; editor.style.background = 'transparent'; editor.style.borderColor = 'transparent'; editor.style.boxShadow = 'none'; }
        });

        var noteInner = doc.createElement('div');
        noteInner.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0;';
        noteInner.appendChild(toolbar);
        noteInner.appendChild(editor);
        noteBlock.appendChild(pencilIcon);
        noteBlock.appendChild(noteInner);

        var buttonsEl = h2Col.nextElementSibling;
        if (buttonsEl) headerRow.insertBefore(noteBlock, buttonsEl);
        else headerRow.appendChild(noteBlock);
    }

    // Слушаем появление iframe с карточкой клиента
    var _frameObs = new MutationObserver(function() {
        var frames = document.querySelectorAll('iframe[src*="/clients/"]');
        frames.forEach(function(frame) {
            if (frame._godjiNoteInjected) return;
            frame.addEventListener('load', function() {
                try {
                    var idoc = frame.contentDocument;
                    var clientId = (frame.src.match(/\/clients\/([a-f0-9-]+)/) || [])[1];
                    if (!clientId || !idoc) return;
                    frame._godjiNoteInjected = true;
                    setTimeout(function() { injectNoteInDocument(idoc, clientId); }, 500);
                    setTimeout(function() { injectNoteInDocument(idoc, clientId); }, 1500);
                } catch(e) {}
            });
        });
    });
    _frameObs.observe(document.body, { childList: true, subtree: true });

})();

// ==UserScript==
// @name         Годжи — Синхронизация карты и таблицы
// @namespace    http://tampermonkey.net/
// @version      3.4
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_map_sync.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_map_sync.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    var HIGHLIGHT_MS     = 5000;
    var _highlightedRow  = null;
    var _highlightedCard = null;
    var _clearTimer      = null;
    var _tableContainer  = null;

    // Экспортируем выбранный ПК для других скриптов (горячие клавиши и т.д.)
    window._godjiSelectedPc = null;

    // ─── Поиск элементов ──────────────────────────────────────────────────────

    function findCardsByPcName(pcName) {
        var result = [];
        var gm = document.querySelector('.gm-card[data-pc="' + pcName + '"]');
        if (gm) result.push(gm);
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf').forEach(function(c) {
            var el = c.querySelector('.DeviceItem_deviceName__yC1tT');
            if (el && el.textContent.trim() === pcName) result.push(c);
        });
        return result;
    }

    function findRowByPcName(pcName) {
        var rows = document.querySelectorAll('tr.mantine-Table-tr');
        for (var i = 0; i < rows.length; i++) {
            var cell = rows[i].querySelector('td[data-index="0"]') || rows[i].querySelector('td');
            if (cell && cell.textContent.trim() === pcName) return rows[i];
        }
        return null;
    }

    function getPcNameFromRow(row) {
        var cell = row.querySelector('td[data-index="0"]') || row.querySelector('td');
        return cell ? cell.textContent.trim() : null;
    }

    // ─── Подсветка ────────────────────────────────────────────────────────────

    function clearHighlight() {
        if (_highlightedRow) {
            _highlightedRow.style.backgroundColor = '';
            _highlightedRow.style.outline = '';
            _highlightedRow.style.boxShadow = '';
            _highlightedRow = null;
        }
        if (_highlightedCard) {
            _highlightedCard.style.outline = '';
            _highlightedCard.style.outlineOffset = '';
            _highlightedCard.style.boxShadow = '';
            _highlightedCard = null;
        }
        window._godjiSelectedPc = null;
    }

    function highlightRow(row) {
        document.querySelectorAll('tr.mantine-Table-tr').forEach(function(r) {
            r.style.backgroundColor = '';
            r.style.outline = '';
            r.style.boxShadow = '';
        });
        row.style.backgroundColor = 'rgba(99, 102, 241, 0.12)';
        row.style.outline = '2px solid rgba(99, 102, 241, 0.6)';
        row.style.outlineOffset = '-1px';
        row.style.boxShadow = 'inset 0 0 0 1px rgba(99, 102, 241, 0.3)';
        _highlightedRow = row;
    }

    function highlightCards(pcName) {
        document.querySelectorAll('.gm-card, .DeviceItem_deviceBox__pzNUf').forEach(function(c) {
            c.style.outline = '';
            c.style.outlineOffset = '';
            c.style.boxShadow = '';
        });
        findCardsByPcName(pcName).forEach(function(c) {
            c.style.outline = '3px solid rgba(99, 102, 241, 0.85)';
            c.style.outlineOffset = '2px';
            c.style.boxShadow = '0 0 0 6px rgba(99, 102, 241, 0.15)';
            _highlightedCard = c;
        });
    }

    function scheduleUnhighlight() {
        clearTimeout(_clearTimer);
        _clearTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
    }

    // ─── Скролл ───────────────────────────────────────────────────────────────

    function scrollToRow(row) {
        var container = document.querySelector('.mrt-table-container');
        if (!container) return;
        var cRect   = container.getBoundingClientRect();
        var rRect   = row.getBoundingClientRect();
        var rowTop  = rRect.top - cRect.top + container.scrollTop;
        var visTop  = container.scrollTop;
        var visBot  = visTop + container.clientHeight;
        if (rowTop >= visTop && rowTop + rRect.height <= visBot) return;
        container.scrollTo({ top: rowTop - container.clientHeight / 2 + rRect.height / 2, behavior: 'smooth' });
    }

    function scrollToCard(card) {
        if (!card) return;
        if (card.classList.contains('gm-card')) {
            var layer = document.getElementById('gm-layer');
            var wrap  = document.getElementById('gm-wrap');
            if (!layer || !wrap) return;
            var cx = parseFloat(card.style.left) + 21;
            var cy = parseFloat(card.style.top)  + 21;
            var sc = 1.4;
            layer.style.transform = 'translate(' + (wrap.clientWidth/2 - cx*sc) + 'px,' + (wrap.clientHeight/2 - cy*sc) + 'px) scale(' + sc + ')';
            return;
        }
        var transformEl = document.querySelector('.react-transform-component');
        var wrapperEl   = document.querySelector('.react-transform-wrapper');
        if (transformEl && wrapperEl) {
            var dc = card.closest('.DeviceItem_deviceContainer__jCrmD');
            if (dc) {
                var sc2 = 1.4;
                var cx2 = parseFloat(dc.style.left || 0) + 24;
                var cy2 = parseFloat(dc.style.top  || 0) + 24;
                var wr  = wrapperEl.getBoundingClientRect();
                var vw  = Math.min(wrapperEl.clientWidth,  window.innerWidth  - Math.max(0, wr.left));
                var vh  = Math.min(wrapperEl.clientHeight, window.innerHeight - Math.max(0, wr.top));
                transformEl.style.transform = 'translate(' + (vw/2 - cx2*sc2) + 'px,' + (vh/2 - cy2*sc2) + 'px) scale(' + sc2 + ')';
                return;
            }
        }
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ─── Основное действие выбора ПК ──────────────────────────────────────────

    function selectPc(pcName, source) {
        if (!pcName) return;
        window._godjiSelectedPc = pcName;

        if (source !== 'card') {
            var cards = findCardsByPcName(pcName);
            if (cards.length) { highlightCards(pcName); scrollToCard(cards[0]); }
        }
        if (source !== 'row') {
            var row = findRowByPcName(pcName);
            if (row) { highlightRow(row); scrollToRow(row); }
        }
        scheduleUnhighlight();
    }

    // Публичный метод для использования из других скриптов
    window._godjiSelectPc = selectPc;

    // ─── Карточки карты — mousedown/mouseup (отличаем клик от пана) ───────────

    var _downX = 0, _downY = 0, _downCard = null;

    document.addEventListener('mousedown', function(e) {
        var card = e.target.closest('.gm-card[data-pc]');
        if (!card) return;
        _downX = e.clientX; _downY = e.clientY; _downCard = card;
    }, true);

    document.addEventListener('mouseup', function(e) {
        if (!_downCard) return;
        var card = _downCard; _downCard = null;
        if (e.ctrlKey || e.metaKey) return;
        if (Math.abs(e.clientX - _downX) > 5 || Math.abs(e.clientY - _downY) > 5) return;
        var pcName = card.getAttribute('data-pc');
        if (pcName) selectPc(pcName, 'card');
    }, true);

    // ─── Оригинальные карточки CRM ────────────────────────────────────────────

    function attachOrigCards() {
        document.querySelectorAll('.DeviceItem_deviceBox__pzNUf').forEach(function(card) {
            if (card.getAttribute('data-godji-sync')) return;
            card.setAttribute('data-godji-sync', '1');
            card.addEventListener('click', function(e) {
                if (e.ctrlKey || e.metaKey) return;
                var el = card.querySelector('.DeviceItem_deviceName__yC1tT');
                if (el) selectPc(el.textContent.trim(), 'card');
            });
        });
    }

    // ─── Таблица — делегирование, переустанавливается при смене контейнера ────

    function attachTableDelegate() {
        // Ищем контейнер таблицы — несколько возможных классов
        var container = document.querySelector('.mrt-table-container') ||
                        document.querySelector('.MRT_TableContainer-module_root__JIsGB');
        if (!container || container === _tableContainer) return;
        _tableContainer = container;

        container.addEventListener('click', function(e) {
            if (e.ctrlKey || e.metaKey) return;
            var row = e.target.closest('tr.mantine-Table-tr');
            if (!row) return;
            var pcName = getPcNameFromRow(row);
            if (pcName) selectPc(pcName, 'row');
        });
    }

    // ─── MutationObserver ─────────────────────────────────────────────────────

    var _obsTimer = null;
    new MutationObserver(function(mutations) {
        var hasNew = false;
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length) { hasNew = true; break; }
        }
        if (!hasNew) return;
        clearTimeout(_obsTimer);
        _obsTimer = setTimeout(function() {
            attachOrigCards();
            attachTableDelegate();
            // Переподсвечиваем строку если она была перерисована React
            if (window._godjiSelectedPc && _highlightedRow) {
                var newRow = findRowByPcName(window._godjiSelectedPc);
                if (newRow && newRow !== _highlightedRow) highlightRow(newRow);
            }
        }, 150);
    }).observe(document.body, { childList: true, subtree: true });

    setTimeout(function() { attachOrigCards(); attachTableDelegate(); }, 2000);
    setTimeout(function() { attachOrigCards(); attachTableDelegate(); }, 5000);

})();

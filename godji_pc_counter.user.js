// ==UserScript==
// @name         Годжи — Счётчик ПК
// @namespace    http://tampermonkey.net/
// @version      1.4
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_pc_counter.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_pc_counter.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    function findClockEl() {
        var divs = document.querySelectorAll('div');
        for (var i = 0; i < divs.length; i++) {
            if (/^\d{2}:\d{2}:\d{2}$/.test(divs[i].textContent.trim())) {
                return divs[i];
            }
        }
        return null;
    }

    function findDateEl() {
        // Ищем элемент с датой — типа "Четверг, 19 марта"
        var divs = document.querySelectorAll('div, p, span');
        for (var i = 0; i < divs.length; i++) {
            var t = divs[i].textContent.trim();
            if (/[а-я]+,\s+\d+\s+[а-я]+/i.test(t) && divs[i].children.length === 0) {
                return divs[i];
            }
        }
        return null;
    }

    function createCounter(clockEl) {
        if (document.getElementById('godji-pc-counter')) return;

        // Структура: Shifts_shiftsPaper > mantine-Flex-root (column) >
        //   [0] mantine-Flex-root (row) — колокольчик + время
        //   [1] ... дата
        // Нам нужно вставить между [0] и [1] без сдвига макета
        // Используем position:absolute на обёртке строки с часами

        var clockRow = clockEl.closest('.mantine-Flex-root');
        if (!clockRow) clockRow = clockEl.parentElement;

        // Делаем строку с часами position:relative
        var rowPos = window.getComputedStyle(clockRow).position;
        if (rowPos === 'static') clockRow.style.position = 'relative';

        var el = document.createElement('div');
        el.id = 'godji-pc-counter';
        el.style.cssText = [
            'position:absolute',
            'bottom:-16px',
            'left:0',
            'right:0',
            'font-size:11px',
            'font-weight:500',
            'color:rgba(255,255,255,0.55)',
            'letter-spacing:0.1px',
            'font-family:inherit',
            'white-space:nowrap',
            'pointer-events:none',
            'text-align:left',
            'padding-left:4px',
        ].join(';');
        el.textContent = '';

        clockRow.appendChild(el);
        return el;
    }

    var counterEl = null;

    function updateCounter() {
        if (!counterEl) return;

        var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
        if (!rows.length) return;

        var total = 0;
        var occupied = 0;

        rows.forEach(function(row) {
            var nameCell = row.querySelector('td[data-index="0"]');
            if (!nameCell || !nameCell.textContent.trim()) return;
            total++;

            var statusCell = row.querySelector('td[data-index="8"] .mantine-Badge-label');
            if (statusCell && statusCell.textContent.trim()) {
                occupied++;
            }
        });

        if (total > 0) {
            counterEl.textContent = 'занято ' + occupied + ' из ' + total;
        }
    }

    function init() {
        var clockEl = findClockEl();
        if (!clockEl) return;
        if (!counterEl) counterEl = createCounter(clockEl);
        updateCounter();
    }

    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                if (!counterEl) init();
                clearTimeout(window._godjiCounterTimer);
                window._godjiCounterTimer = setTimeout(updateCounter, 300);
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(init, 3000);
    setTimeout(init, 5000);

})();

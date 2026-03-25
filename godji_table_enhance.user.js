// ==UserScript==
// @name         Годжи — Таблица
// @namespace    http://tampermonkey.net/
// @version      2.5
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_table_enhance.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_table_enhance.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Только на дашборде — корневая страница godji.cloud
    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    // SVG щит целый (зелёный)
    var SHIELD_OK = '<div title="Защищен" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:28px;border-radius:20px;background:var(--mantine-color-green-filled);cursor:default;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"></path><path d="M9 12l2 2l4 -4"></path></svg></div>';

    // SVG щит треснувший (красный)
    var SHIELD_BROKEN = '<div title="Незащищен" style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:28px;border-radius:20px;background:var(--mantine-color-red-filled);cursor:default;"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"></path><path d="M12 7l1.5 3.5l-2.5 1l2 4.5"></path></svg></div>';

    // CSS — только центрирование и перенос, никакого flex на строках
    function injectStyle() {
        if (document.getElementById('godji-table-style')) return;
        var styleEl = document.createElement('style');
        styleEl.id = 'godji-table-style';
        styleEl.textContent = [
            // Центрирование заголовков
            '.mrt-table-paper .MRT_TableHeadCell-module_content-wrapper__py6aJ {',
            '  justify-content: center !important;',
            '  white-space: nowrap !important;',
            '  overflow: visible !important;',
            '}',
            '.mrt-table-paper .MRT_TableHeadCell-module_content-wrapper-nowrap__-4aIg {',
            '  white-space: nowrap !important;',
            '  overflow: visible !important;',
            '}',
            '.mrt-table-paper th.mantine-Table-th .mantine-Flex-root {',
            '  justify-content: center !important;',
            '}',
            '.mrt-table-paper th.mantine-Table-th .MRT_TableHeadCell-module_labels__oiMSr {',
            '  justify-content: center !important;',
            '  overflow: visible !important;',
            '}',
            '.mrt-table-paper th.mantine-Table-th {',
            '  vertical-align: middle !important;',
            '  overflow: visible !important;',
            '}',
            // Центрирование бейджей статуса устройства
            '.mrt-table-paper td[style*="col-deviceStatus-size"] .mantine-Flex-root {',
            '  justify-content: center !important;',
            '}',
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    function applyChanges() {
        var table = document.querySelector('table.mrt-table');
        if (!table) return;

        injectStyle();

        var tableStyle = table.getAttribute('style') || '';

        // Ширины колонок
        var expansions = {
            '--header-deviceStatus-size: 150':    '--header-deviceStatus-size: 175',
            '--col-deviceStatus-size: 150':       '--col-deviceStatus-size: 175',
            '--header-deviceProtected-size: 150': '--header-deviceProtected-size: 75',
            '--col-deviceProtected-size: 150':    '--col-deviceProtected-size: 75',
            '--header-userNickname-size: 80':     '--header-userNickname-size: 120',
            '--col-userNickname-size: 80':        '--col-userNickname-size: 120',
            '--header-sessionPastTime-size: 120': '--header-sessionPastTime-size: 110',
            '--col-sessionPastTime-size: 120':    '--col-sessionPastTime-size: 110',
            '--header-sessionLeftTime-size: 120': '--header-sessionLeftTime-size: 110',
            '--col-sessionLeftTime-size: 120':    '--col-sessionLeftTime-size: 110',
            '--header-sessionStatus-size: 120':   '--header-sessionStatus-size: 130',
            '--col-sessionStatus-size: 120':      '--col-sessionStatus-size: 130',
            '--header-sessionEnd-size: 120':      '--header-sessionEnd-size: 115',
            '--col-sessionEnd-size: 120':         '--col-sessionEnd-size: 115',
        };
        var changed = false;
        for (var key in expansions) {
            if (tableStyle.indexOf(key) !== -1) {
                tableStyle = tableStyle.replace(key, expansions[key]);
                changed = true;
            }
        }
        if (changed) table.setAttribute('style', tableStyle);

        // Переименовываем "Имя ПК" → "№ ПК"
        var headers = table.querySelectorAll('th');
        for (var h = 0; h < headers.length; h++) {
            var wrapper = headers[h].querySelector('.MRT_TableHeadCell-module_content-wrapper__py6aJ');
            if (wrapper && wrapper.textContent.trim() === 'Имя ПК') {
                wrapper.textContent = '№ ПК';
            }
        }

        // Иконки щитов — скрываем бейдж, добавляем иконку
        var protectedCells = table.querySelectorAll('td[style*="col-deviceProtected-size"]');
        for (var p = 0; p < protectedCells.length; p++) {
            var td = protectedCells[p];
            var badge = td.querySelector('.mantine-Badge-root');
            if (!badge) continue;
            var labelEl = td.querySelector('.mantine-Badge-label');
            if (!labelEl) continue;
            var isProtected = labelEl.textContent.trim() === 'Защищен';
            var flex = td.querySelector('.mantine-Flex-root');
            if (!flex) continue;

            // Удаляем старые иконки перед вставкой новой
            var oldIcons = flex.querySelectorAll('.godji-shield-icon');
            for (var oi = 0; oi < oldIcons.length; oi++) {
                oldIcons[oi].parentNode.removeChild(oldIcons[oi]);
            }

            // Скрываем оригинальный бейдж
            badge.style.display = 'none';

            // Вставляем иконку
            var iconDiv = document.createElement('div');
            iconDiv.className = 'godji-shield-icon';
            iconDiv.innerHTML = isProtected ? SHIELD_OK : SHIELD_BROKEN;
            iconDiv.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;';
            flex.appendChild(iconDiv);
            flex.style.justifyContent = 'center';
        }
    }

    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(window._godjiTableTimer);
                window._godjiTableTimer = setTimeout(applyChanges, 150);
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(applyChanges, 3000);

})();

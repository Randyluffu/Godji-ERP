// ==UserScript==
// @name         Годжи — Таблица
// @namespace    http://tampermonkey.net/
// @version      3.0
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

    // -------------------------------------------------------------------------
    // Попап подтверждения — та же структура что в godji_session_restart
    // -------------------------------------------------------------------------
    function showConfirm(title, text, confirmLabel, onConfirm, onCancel) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:299;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';

        var section = document.createElement('section');
        section.className = 'm_fd1ab0aa m_54c44539 mantine-Modal-content m_1b7284a3 mantine-Paper-root';
        section.setAttribute('role', 'dialog');
        section.setAttribute('tabindex', '-1');
        section.style.cssText = 'opacity:1;transform:translateY(0px);min-width:calc(25rem * var(--mantine-scale));max-width:90vw;';

        var header = document.createElement('header');
        header.className = 'm_b5489c3c m_d0e2b9cd mantine-Modal-header';
        var h2 = document.createElement('h2');
        h2.className = 'm_615af6c9 mantine-Modal-title';
        h2.textContent = title;
        var xBtn = document.createElement('button');
        xBtn.className = 'mantine-focus-auto mantine-active m_220c80f2 m_606cb269 mantine-Modal-close m_86a44da5 mantine-CloseButton-root m_87cf2631 mantine-UnstyledButton-root';
        xBtn.setAttribute('data-variant', 'subtle');
        xBtn.setAttribute('type', 'button');
        xBtn.innerHTML = '<svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:70%;height:70%;"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"></path></svg>';
        xBtn.addEventListener('click', function () { overlay.remove(); if (onCancel) onCancel(); });
        header.appendChild(h2);
        header.appendChild(xBtn);

        var body = document.createElement('div');
        body.className = 'm_5df29311 mantine-Modal-body';
        var stack = document.createElement('div');
        stack.className = 'm_6d731127 mantine-Stack-root';
        stack.style.cssText = '--stack-gap:var(--mantine-spacing-lg);--stack-align:stretch;--stack-justify:flex-start;';
        var p = document.createElement('p');
        p.className = 'mantine-focus-auto m_b6d8b162 mantine-Text-root';
        p.innerHTML = text;
        stack.appendChild(p);

        var flex = document.createElement('div');
        flex.className = 'm_8bffd616 mantine-Flex-root';
        flex.style.cssText = 'width:100%;justify-content:flex-end;align-items:center;gap:calc(0.25rem * var(--mantine-scale));margin-top:var(--mantine-spacing-lg);';

        var okBtn = document.createElement('button');
        okBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        okBtn.setAttribute('data-variant', 'filled');
        okBtn.setAttribute('type', 'button');
        okBtn.style.cssText = '--button-bg:var(--mantine-color-red-filled);--button-hover:var(--mantine-color-red-filled-hover);--button-color:var(--mantine-color-white);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;margin-top:calc(2rem * var(--mantine-scale));';
        okBtn.innerHTML = '<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">' + confirmLabel + '</span></span>';
        okBtn.addEventListener('click', function () { overlay.remove(); onConfirm(); });

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'mantine-focus-auto mantine-active m_77c9d27d mantine-Button-root m_87cf2631 mantine-UnstyledButton-root';
        cancelBtn.setAttribute('data-variant', 'default');
        cancelBtn.setAttribute('type', 'button');
        cancelBtn.style.cssText = '--button-bg:var(--mantine-color-default);--button-hover:var(--mantine-color-default-hover);--button-color:var(--mantine-color-default-color);--button-bd:calc(0.0625rem * var(--mantine-scale)) solid var(--mantine-color-default-border);margin-top:calc(2rem * var(--mantine-scale));';
        cancelBtn.innerHTML = '<span class="m_80f1301b mantine-Button-inner"><span class="m_811560b9 mantine-Button-label">Отмена</span></span>';
        cancelBtn.addEventListener('click', function () { overlay.remove(); if (onCancel) onCancel(); });

        flex.appendChild(okBtn);
        flex.appendChild(cancelBtn);
        body.appendChild(stack);
        body.appendChild(flex);
        section.appendChild(header);
        section.appendChild(body);
        overlay.appendChild(section);

        overlay.addEventListener('click', function (e) { if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); } });
        document.body.appendChild(overlay);
    }

    // -------------------------------------------------------------------------
    // Имя ПК из строки таблицы (нужно для текста попапа)
    // -------------------------------------------------------------------------
    function getPcNameFromRow(row) {
        var nc = row.querySelector('td[data-index="0"]') ||
                 row.querySelector('td[style*="col-deviceName-size"]');
        return nc ? nc.textContent.trim() : '';
    }

    function getNicknameFromRow(row) {
        var nc = row.querySelector('td[style*="col-userNickname-size"]');
        return nc ? nc.textContent.trim() : '';
    }

    // -------------------------------------------------------------------------
    // Перехват кликов — вешаем один capture-делегат на document.
    // Сохраняем сам menuItem и кликаем его напрямую после подтверждения —
    // меню намеренно НЕ закрываем, прячем через opacity чтобы ERP его не убрал.
    // -------------------------------------------------------------------------
    var _pendingConfirm = false;

    document.addEventListener('click', function (e) {
        if (_pendingConfirm) return;

        var menuItem = e.target.closest('[role="menuitem"]');
        if (!menuItem) {
            var labelParent = e.target.closest('.mantine-Menu-itemLabel');
            if (labelParent) menuItem = labelParent.closest('[role="menuitem"]');
        }
        if (!menuItem) return;

        var labelEl = menuItem.querySelector('.mantine-Menu-itemLabel');
        if (!labelEl) return;
        var label = labelEl.textContent.trim();

        var isFinish  = label === 'Завершить сессию';
        var isPowerOff = label === 'Выключить';
        if (!isFinish && !isPowerOff) return;

        var pcName   = window._godjiLastContextPc || '';
        var nickname = '';
        if (pcName && window._godjiSessionsData && window._godjiSessionsData[pcName]) {
            nickname = window._godjiSessionsData[pcName].nickname || '';
        }

        // Блокируем оригинальное действие
        e.stopPropagation();
        e.preventDefault();

        _pendingConfirm = true;

        // Прячем меню — pointer-events:none + opacity:0, но оставляем в DOM
        var menuDropdown = document.querySelector('[data-menu-dropdown="true"]');
        if (menuDropdown) {
            menuDropdown.style.setProperty('opacity', '0', 'important');
            menuDropdown.style.setProperty('pointer-events', 'none', 'important');
        }

        // Сохраняем ссылку на menuItem пока он точно в DOM
        var savedMenuItem = menuItem;
        var savedLabel = label;

        var title, text, confirmLabel;
        if (isFinish) {
            title        = 'Завершить сессию';
            text         = 'Завершить сессию на ПК <strong>' + (pcName || '?') + '</strong>?';
            confirmLabel = 'Завершить';
        } else {
            title        = 'Выключить ПК';
            text         = 'Выключить ПК <strong>' + (pcName || '?') + '</strong>?';
            confirmLabel = 'Выключить';
        }
        if (nickname) {
            text += '<br><span style="color:var(--mantine-color-dimmed);font-size:0.85em;">' + nickname + '</span>';
        }

        showConfirm(title, text, confirmLabel,
            function () {
                _pendingConfirm = false;
                // Восстанавливаем меню перед кликом
                if (menuDropdown) {
                    menuDropdown.style.removeProperty('opacity');
                    menuDropdown.style.removeProperty('pointer-events');
                }
                if (savedMenuItem && savedMenuItem.isConnected) {
                    savedMenuItem.click();
                }
            },
            function () {
                // Отмена — восстанавливаем меню
                _pendingConfirm = false;
                if (menuDropdown) {
                    menuDropdown.style.removeProperty('opacity');
                    menuDropdown.style.removeProperty('pointer-events');
                }
            }
        );

    }, true);

    // -------------------------------------------------------------------------
    // MutationObserver для обновления таблицы — subtree:false на body
    // -------------------------------------------------------------------------
    var observer = new MutationObserver(function (mutations) {
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

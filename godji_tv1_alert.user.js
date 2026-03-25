// ==UserScript==
// @name         Годжи — Уведомление TV1
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_tv1_alert.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-CRM/main/godji_tv1_alert.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname !== '/' && window.location.pathname !== '') return;

    var TV1_NAME = 'TV 1';
    var _wasActive = false;
    var _alertShown = false;

    function findTV1Row() {
        var rows = document.querySelectorAll('tr.mantine-Table-tr[data-index]');
        for (var i = 0; i < rows.length; i++) {
            var cell = rows[i].querySelector('td[data-index="0"]');
            if (!cell) continue;
            var name = cell.textContent.trim();
            // Проверяем разные варианты написания
            if (name === TV1_NAME || name === 'TV1' || name === 'tv1' || name === 'ТВ 1' || name === 'ТВ1') {
                return rows[i];
            }
        }
        return null;
    }



    function getSessionStatus(row) {
        // Статус сессии — data-index="8"
        var cell = row.querySelector('td[data-index="8"]');
        if (!cell) return null;
        var badge = cell.querySelector('.mantine-Badge-label');
        if (badge) return badge.textContent.trim();
        var text = cell.textContent.trim();
        return text === '—' ? null : text;
    }

    function getSessionStatus(row) {
        var cell = row.querySelector('td[data-index="8"]');
        if (!cell) return null;
        var label = cell.querySelector('.mantine-Badge-label');
        return label ? label.textContent.trim() : null;
    }

    function isActiveOrWaiting(status) {
        if (!status || status === '—' || status === '') return false;
        return true; // любой бейдж = активный или ожидание
    }

    function showAlert() {
        if (document.getElementById('godji-tv1-alert')) return;

        // Уведомление в стиле CRM — небольшой тост в углу экрана
        var toast = document.createElement('div');
        toast.id = 'godji-tv1-alert';
        toast.style.cssText = [
            'position:fixed',
            'bottom:24px',
            'right:24px',
            'z-index:99999',
            'background:var(--mantine-color-body)',
            'border:1px solid var(--mantine-color-default-border)',
            'border-left:4px solid #b71c1c',
            'border-radius:var(--mantine-radius-md)',
            'padding:14px 16px',
            'min-width:280px',
            'max-width:340px',
            'box-shadow:var(--mantine-shadow-lg)',
            'font-family:inherit',
            'display:flex',
            'flex-direction:column',
            'gap:8px',
            'animation:godjiTV1SlideIn 0.25s ease',
        ].join(';');

        if (!document.getElementById('godji-tv1-style')) {
            var style = document.createElement('style');
            style.id = 'godji-tv1-style';
            style.textContent = '@keyframes godjiTV1SlideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }';
            document.head.appendChild(style);
        }

        var topRow = document.createElement('div');
        topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

        var left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:8px;';

        var icon = document.createElement('span');
        icon.textContent = '📺';
        icon.style.fontSize = '16px';

        var title = document.createElement('span');
        title.style.cssText = 'font-size:13px;font-weight:700;color:var(--mantine-color-text);';
        title.textContent = 'Сеанс TV 1 завершён';

        var closeBtn = document.createElement('button');
        closeBtn.style.cssText = 'background:none;border:none;color:var(--mantine-color-dimmed);font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            _alertShown = false;
        });

        left.appendChild(icon);
        left.appendChild(title);
        topRow.appendChild(left);
        topRow.appendChild(closeBtn);

        toast.appendChild(topRow);
        document.body.appendChild(toast);
    }

    function check() {
        var row = findTV1Row();
        if (!row) return;

        var status = getSessionStatus(row);
        var isActive = isActiveOrWaiting(status);

        // Сеанс был активен/в ожидании и теперь завершился
        if (_wasActive && !isActive && !_alertShown) {
            _alertShown = true;
            showAlert();
        }

        // Новый сеанс — сбрасываем флаг
        if (isActive) _alertShown = false;

        _wasActive = isActive;
    }

    // Проверяем каждые 10 секунд
    setInterval(check, 10000);
    // Первая проверка после загрузки таблицы
    setTimeout(check, 6000);

})();
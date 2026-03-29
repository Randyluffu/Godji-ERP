// ==UserScript==
// @name         Годжи — Цвета меню + VNC v7.9
// @version      7.9
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    let lastPc = null;

    // Перехват номера ПК
    document.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        let card = e.target.closest('.DeviceItem_deviceContainer__jCrmD') || e.target.closest('tr');
        if (card) {
            let nameEl = card.querySelector('.DeviceItem_deviceName__yC1tT') || card.querySelector('td');
            lastPc = nameEl ? nameEl.textContent.trim() : null;
        }
    }, true);

    const COLORS = {
        'Посадить за ПК': { color: '#1b5e20', bg: 'rgba(46, 125, 50, 0.13)' },
        'Бронирование': { color: '#bf360c', bg: 'rgba(191, 54, 12, 0.10)' },
        'Запустить сессию': { color: '#1b5e20', bg: 'rgba(46, 125, 50, 0.13)' },
        'Завершить сессию': { color: '#c62828', bg: 'rgba(198, 40, 40, 0.11)' },
        'Добавить время': { color: '#1565c0', bg: 'rgba(21, 101, 192, 0.08)' }
    };

    function injectVnc(menu) {
        if (!lastPc || menu.querySelector('[data-vnc]')) return;
        let firstItem = menu.querySelector('[role="menuitem"]');
        if (!firstItem) return;

        let vnc = firstItem.cloneNode(true);
        vnc.setAttribute('data-vnc', '1');
        vnc.style.cssText = 'color:#1565c0 !important; background:rgba(21,101,192,0.1) !important; font-weight:700; border-bottom:1px solid rgba(21,101,192,0.2); margin-bottom:4px;';
        vnc.innerHTML = `<div class="m_8b75e504 mantine-Menu-itemSection" data-position="left">🖥️</div>
                         <div class="m_5476e0d3 mantine-Menu-itemLabel">VNC Просмотр (${lastPc})</div>`;
        
        vnc.onclick = (e) => {
            e.preventDefault();
            fetch(`http://localhost:6080/connect?pc=${lastPc}`).catch(() => alert('Ошибка прокси!'));
            document.body.click();
        };
        menu.querySelector('.mantine-Menu-dropdown').prepend(vnc);
    }

    const observer = new MutationObserver(() => {
        let menu = document.querySelector('[role="menu"]');
        if (menu) {
            injectVnc(menu);
            menu.querySelectorAll('[role="menuitem"]').forEach(item => {
                let text = item.textContent.trim();
                for (let key in COLORS) {
                    if (text.includes(key)) {
                        item.style.color = COLORS[key].color;
                        item.style.backgroundColor = COLORS[key].bg;
                    }
                }
            });
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();

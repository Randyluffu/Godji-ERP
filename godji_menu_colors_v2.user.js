// ==UserScript==
// @name         Годжи — Цвета меню + VNC v7.8
// @version      7.8
// @match        https://godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
    'use strict';
    let lastPc = null;

    // Запоминаем имя ПК при правом клике
    document.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return;
        let card = e.target.closest('.DeviceItem_deviceContainer__jCrmD') || e.target.closest('tr');
        if (card) {
            let nameEl = card.querySelector('.DeviceItem_deviceName__yC1tT') || card.querySelector('td');
            lastPc = nameEl ? nameEl.textContent.trim() : null;
        }
    }, true);

    const COLORS = {
        'Посадить за ПК': { color: '#1b5e20', bg: 'rgba(46,125,50,0.1)' },
        'Запустить сессию': { color: '#1b5e20', bg: 'rgba(46,125,50,0.1)' },
        'Завершить сессию': { color: '#c62828', bg: 'rgba(198,40,40,0.1)' }
    };

    function apply() {
        let menu = document.querySelector('[role="menu"]');
        if (!menu || menu._vnc) return;
        menu._vnc = true;

        // Красим пункты
        menu.querySelectorAll('[role="menuitem"]').forEach(item => {
            let text = item.textContent.trim();
            if (COLORS[text]) {
                item.style.color = COLORS[text].color;
                item.style.backgroundColor = COLORS[text].bg;
            }
        });

        // Добавляем VNC
        if (lastPc) {
            let vnc = document.createElement('button');
            vnc.className = menu.querySelector('[role="menuitem"]').className;
            vnc.style.cssText = 'color:#1565c0; background:rgba(21,101,192,0.1); font-weight:bold;';
            vnc.innerHTML = `<span>🖥️ VNC Просмотр (${lastPc})</span>`;
            vnc.onclick = () => {
                fetch(`http://localhost:6080/vnc?pc=${lastPc}`).catch(() => alert('Запустите VNC прокси!'));
                document.body.click();
            };
            menu.prepend(vnc);
        }
    }

    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
})();

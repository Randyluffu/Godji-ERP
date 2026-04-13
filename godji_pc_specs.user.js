// ==UserScript==
// @name         Godji — Характеристики ПК
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Показывает характеристики ПК в компактной модалке
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // === ДАННЫЕ (вынесены отдельно) ===
    const PC_SPECS = {
        // VIP зона (Комната O)
        '30': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        '31': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        '32': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        '33': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        '34': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        '35': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        
        // DUO зона (Комната V)
        '06': { cpu: 'i5-14600KF', gpu: '5070 12GB', ram: '32GB 6000MHz', monitor: 'Asus TUF/AOC 2K 300Hz', keyboard: 'AKKO 5087S', mouse: 'Dark Project x VGN F1 Pro Max', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
        '07': { cpu: 'i5-14600KF', gpu: '5070 12GB', ram: '32GB 6000MHz', monitor: 'Asus TUF/AOC 2K 300Hz', keyboard: 'AKKO 5087S', mouse: 'Dark Project x VGN F1 Pro Max', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
        
        // DUO зона (Комната E)
        '08': { cpu: 'i5-14600KF', gpu: '5070 12GB', ram: '32GB 6000MHz', monitor: 'Asus TUF/AOC 2K 300Hz', keyboard: 'AKKO 5087S', mouse: 'Dark Project x VGN F1 Pro Max', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
        '09': { cpu: 'i5-14600KF', gpu: '5070 12GB', ram: '32GB 6000MHz', monitor: 'Asus TUF/AOC 2K 300Hz', keyboard: 'AKKO 5087S', mouse: 'Dark Project x VGN F1 Pro Max', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
        
        // Solo (Комната S)
        '41': { cpu: 'i5-14600KF', gpu: '5070 Ti 16GB', ram: '32GB 6000MHz', monitor: 'Samsung G6 2K 350Hz', keyboard: 'AKKO 5087S', mouse: 'Logitech Superlight 2', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
    };

    // Шаблоны для групп ПК с одинаковыми характеристиками
    const PC_TEMPLATES = {
        'vip_standard': { cpu: 'i5-12400F', gpu: '4060 Ti 8GB', ram: '32GB 3200MHz', monitor: 'AOC 27" 280Hz', keyboard: 'Dark Project KD87A', mouse: 'ARDOR Phantom PRO V2', headset: 'HyperX Cloud II', psu: 'PROTON 600W', case: 'ZALMAN N4', mb: 'MSI B760M MORTAR WIFI II', ssd: 'MSI 256GB', chair: 'DXRacer/ZONE51' },
        'duo': { cpu: 'i5-14600KF', gpu: '5070 12GB', ram: '32GB 6000MHz', monitor: 'Asus TUF/AOC 2K 300Hz', keyboard: 'AKKO 5087S', mouse: 'Dark Project x VGN F1 Pro Max', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
        'solo': { cpu: 'i5-14600KF', gpu: '5070 Ti 16GB', ram: '32GB 6000MHz', monitor: 'Samsung G6 2K 350Hz', keyboard: 'AKKO 5087S', mouse: 'Logitech Superlight 2', headset: 'HyperX Cloud II', psu: 'DEXP 650W', case: 'MONTECH X3 MESH', mb: 'MSI B760M MORTAR II', ssd: 'MSI 256GB', chair: 'ZONE51' },
    };

    // === ФУНКЦИИ ===
    
    function getSpecs(pcName) {
        return PC_SPECS[pcName] || null;
    }

    function createModal(pcName) {        const specs = getSpecs(pcName);
        if (!specs) return;

        // Удаляем старую модалку если есть
        const old = document.getElementById('godji-specs-modal');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'godji-specs-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;';
        overlay.onclick = () => overlay.remove();

        const modal = document.createElement('div');
        modal.id = 'godji-specs-modal';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:12px;width:90%;max-width:720px;max-height:85vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,0.4);font-family:inherit;';
        modal.onclick = e => e.stopPropagation();

        // Шапка
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f0f0f0;position:sticky;top:0;background:#fff;z-index:1;';
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:30px;height:30px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>
                </div>
                <span style="font-size:15px;font-weight:700;">Характеристики ПК ${pcName}</span>
            </div>
            <button onclick="this.closest('#godji-specs-overlay').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#868e96;">×</button>
        `;

        // Контент
        const body = document.createElement('div');
        body.style.cssText = 'padding:16px;';

        const categories = [
            { title: 'Основные компоненты', fields: ['cpu', 'gpu', 'ram', 'mb', 'ssd'] },
            { title: 'Периферия', fields: ['monitor', 'keyboard', 'mouse', 'headset'] },
            { title: 'Прочее', fields: ['psu', 'case', 'chair'] }
        ];

        categories.forEach(cat => {
            const section = document.createElement('div');
            section.style.cssText = 'margin-bottom:16px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;';
            
            const header = document.createElement('div');
            header.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 14px;background:#f9f9f9;cursor:pointer;';
            header.innerHTML = `<span style="font-size:13px;font-weight:700;">${cat.title}</span>`;
            
            const content = document.createElement('div');
            content.style.cssText = 'padding:10px;background:#fff;';            
            cat.fields.forEach(field => {
                if (specs[field]) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:12px;';
                    row.innerHTML = `
                        <span style="color:#868e96;min-width:120px;font-weight:600;">${getFieldLabel(field)}:</span>
                        <span style="color:#495057;flex:1;">${specs[field]}</span>
                    `;
                    content.appendChild(row);
                }
            });
            
            section.appendChild(header);
            section.appendChild(content);
            body.appendChild(section);
        });

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    function getFieldLabel(field) {
        const labels = {
            cpu: 'Процессор', gpu: 'Видеокарта', ram: 'Оперативная память',
            monitor: 'Монитор', keyboard: 'Клавиатура', mouse: 'Мышь',
            headset: 'Наушники', psu: 'Блок питания', case: 'Корпус',
            mb: 'Материнская плата', ssd: 'SSD M.2', chair: 'Кресло'
        };
        return labels[field] || field;
    }

    // === ИНИЦИАЛИЗАЦИЯ ===
    
    // Добавляем кнопку в контекстное меню карты
    function injectMenuButton(pcName) {
        const menu = document.querySelector('[data-menu-dropdown="true"]');
        if (!menu || menu.querySelector('[data-godji-specs]')) return;

        const btn = document.createElement('button');
        btn.setAttribute('data-godji-specs', '1');
        btn.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:7px 14px;background:#f3e8ff;color:#7c3aed;border:none;cursor:pointer;font-size:13px;';
        btn.innerHTML = '<span>📊</span><span>Характеристики</span>';
        btn.onclick = (e) => { e.preventDefault(); createModal(pcName); };
        
        menu.insertBefore(btn, menu.firstChild);
    }
    // Отслеживаем открытие меню
    document.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('.gm-card[data-pc], .DeviceItem_deviceBox__pzNUf');
        if (card) {
            const pcName = card.getAttribute('data-pc') || card.querySelector('.DeviceItem_deviceName__yC1tT')?.textContent.trim();
            setTimeout(() => {
                if (pcName && getSpecs(pcName)) injectMenuButton(pcName);
            }, 50);
        }
    }, true);

    console.log('[Godji Specs] Скрипт загружен. Размер: ~150 строк вместо 1000+');
})();
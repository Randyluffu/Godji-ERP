// ==UserScript==
// @name         Годжи — Просмотр экрана
// @namespace    http://tampermonkey.net/
// @version      3.5
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_tightvnc.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_tightvnc.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
'use strict';

// ── Конфиг VNC ──────────────────────────────────────────
var VNC_BASE = 'http://192.168.1.'; // базовый IP — последний октет = номер ПК
var VNC_PORT = 5800;                // порт веб-интерфейса TightVNC

// ── Координаты ПК на карте (из реальной карты godji.cloud) ──
// Формат: 'имяПК': {x, y}  — координаты в % от размера карты
var PC_POS = {
    '01':{x:14.5,y:8},  '02':{x:19,y:8},   '03':{x:87,y:88},
    '04':{x:14.5,y:16}, '05':{x:19,y:16},  '06':{x:25,y:8},
    '07':{x:25,y:16},   '08':{x:30,y:8},   '09':{x:30,y:16},
    '10':{x:36,y:8},    '11':{x:36,y:16},  '12':{x:42,y:8},
    '13':{x:42,y:16},   '14':{x:14.5,y:25},'15':{x:19,y:25},
    '16':{x:25,y:25},   '17':{x:30,y:25},  '18':{x:36,y:25},
    '19':{x:42,y:25},   '20':{x:48,y:8},   '21':{x:48,y:16},
    '22':{x:48,y:25},   '23':{x:54,y:8},   '24':{x:54,y:16},
    '25':{x:54,y:25},   '26':{x:60,y:8},   '27':{x:60,y:16},
    '28':{x:60,y:25},   '29':{x:66,y:8},   '30':{x:66,y:16},
    '31':{x:66,y:25},   '32':{x:72,y:8},   '33':{x:72,y:16},
    '34':{x:72,y:25},   '35':{x:78,y:8},   '36':{x:78,y:16},
    '37':{x:78,y:25},   '38':{x:84,y:8},   '39':{x:84,y:16},
    '40':{x:84,y:25},   '41':{x:91,y:8},
    'TV 1':{x:91,y:20}
};

// ── Статусы ПК из getDashboardDevices ───────────────────
var _pcStatus = {}; // имя → {status, nick, sessionStatus}

function updatePcStatus() {
    document.querySelectorAll('tr.mantine-Table-tr').forEach(function(row) {
        var nameCell = row.querySelector('td[style*="col-deviceName-size"]');
        if (!nameCell) return;
        var name = nameCell.textContent.trim();
        if (!name) return;
        var statusCell = row.querySelector('td[style*="col-sessionStatus-size"]');
        var badge = statusCell && statusCell.querySelector('.mantine-Badge-label');
        var sessionStatus = badge ? badge.textContent.trim() : '';
        var nickCell = row.querySelector('td[style*="col-userNickname-size"]');
        var nick = nickCell ? nickCell.textContent.trim().replace(/^@+/, '') : '';
        _pcStatus[name] = { sessionStatus: sessionStatus, nick: nick };
    });
}

// ── Модальное окно с картой ──────────────────────────────
var _modal = null, _modalVisible = false;
var _selectedPc = null;

function createMapModal() {
    _modal = document.createElement('div');
    _modal.id = 'gj-vnc-modal';
    _modal.style.cssText = [
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
        'z-index:99998;width:900px;max-width:96vw;',
        'background:#1a1a2e;border-radius:12px;',
        'box-shadow:0 8px 40px rgba(0,0,0,0.55);',
        'display:none;flex-direction:column;font-family:inherit;overflow:hidden;',
        'max-height:90vh;'
    ].join('');

    // Шапка
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';
    var tw = document.createElement('div');
    tw.style.cssText = 'display:flex;align-items:center;gap:10px;';
    var ico = document.createElement('div');
    ico.style.cssText = 'width:30px;height:30px;border-radius:7px;background:var(--mantine-color-gg_primary-filled,#cc0001);display:flex;align-items:center;justify-content:center;flex-shrink:0;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
    var ttl = document.createElement('span');
    ttl.style.cssText = 'font-size:14px;font-weight:700;color:#fff;';
    ttl.textContent = 'Просмотр экрана — выберите ПК';
    tw.appendChild(ico); tw.appendChild(ttl);
    var cb = document.createElement('button');
    cb.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;padding:0 4px;line-height:1;';
    cb.innerHTML = '&times;';
    cb.addEventListener('click', hideMapModal);
    hdr.appendChild(tw); hdr.appendChild(cb);

    // Карта
    var mapWrap = document.createElement('div');
    mapWrap.style.cssText = 'position:relative;width:100%;overflow:hidden;flex-shrink:0;background:#12121f;';

    var mapCanvas = document.createElement('div');
    mapCanvas.id = 'gj-vnc-map-canvas';
    mapCanvas.style.cssText = 'position:relative;width:100%;padding-bottom:55%;'; // соотношение ~1920:1060

    // Фон — светло-серые зоны комнат (упрощённо, по структуре оригинала)
    var bg = document.createElement('div');
    bg.style.cssText = 'position:absolute;inset:0;background:#1e1e30;';
    mapCanvas.appendChild(bg);

    // Подписи комнат
    var rooms = [
        {label:'L', x:28, y:48},{label:'E', x:58, y:48},{label:'V', x:58, y:62},
        {label:'R', x:64, y:55},{label:'T', x:64, y:68},{label:'W', x:74, y:25},
        {label:'Q', x:74, y:10},{label:'X', x:48, y:75},{label:'O', x:54, y:75},
        {label:'Y', x:74, y:58},{label:'ВХОД', x:42, y:82}
    ];
    rooms.forEach(function(r) {
        var rl = document.createElement('div');
        rl.style.cssText = 'position:absolute;color:rgba(255,255,255,0.18);font-size:18px;font-weight:800;pointer-events:none;user-select:none;left:'+r.x+'%;top:'+r.y+'%;transform:translate(-50%,-50%);';
        rl.textContent = r.label;
        mapCanvas.appendChild(rl);
    });

    // Карточки ПК
    Object.keys(PC_POS).forEach(function(pcName) {
        var pos = PC_POS[pcName];
        var card = document.createElement('div');
        card.id = 'gj-vnc-pc-' + pcName.replace(/\s/g,'_');
        card.dataset.pc = pcName;
        card.style.cssText = [
            'position:absolute;',
            'left:' + pos.x + '%;top:' + pos.y + '%;',
            'transform:translate(-50%,-50%);',
            'width:38px;height:38px;',
            'background:#cc0001;border-radius:6px;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;',
            'cursor:pointer;border:2px solid transparent;',
            'transition:border-color 0.15s,transform 0.1s;',
            'box-shadow:0 2px 6px rgba(0,0,0,0.4);',
            'font-family:inherit;'
        ].join('');
        var pcLbl = document.createElement('div');
        pcLbl.style.cssText = 'color:#fff;font-size:9px;font-weight:800;line-height:1.1;text-align:center;pointer-events:none;';
        pcLbl.textContent = pcName;
        var nickLbl = document.createElement('div');
        nickLbl.id = 'gj-vnc-nick-' + pcName.replace(/\s/g,'_');
        nickLbl.style.cssText = 'color:rgba(255,255,255,0.7);font-size:7px;line-height:1;text-align:center;pointer-events:none;max-width:34px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        card.appendChild(pcLbl); card.appendChild(nickLbl);
        card.addEventListener('mouseenter', function() {
            card.style.transform = 'translate(-50%,-50%) scale(1.1)';
            card.style.borderColor = '#fff';
        });
        card.addEventListener('mouseleave', function() {
            if(_selectedPc !== pcName) {
                card.style.transform = 'translate(-50%,-50%)';
                card.style.borderColor = 'transparent';
            }
        });
        card.addEventListener('click', function() {
            openVnc(pcName);
        });
        mapCanvas.appendChild(card);
    });

    mapWrap.appendChild(mapCanvas);

    // VNC iframe панель
    var vncPanel = document.createElement('div');
    vncPanel.id = 'gj-vnc-panel';
    vncPanel.style.cssText = 'width:100%;height:480px;background:#000;display:none;position:relative;flex-shrink:0;';

    var vncBar = document.createElement('div');
    vncBar.id = 'gj-vnc-bar';
    vncBar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:32px;background:#0d0d1a;display:flex;align-items:center;padding:0 12px;gap:8px;z-index:2;font-size:12px;color:#aaa;';

    var vncTitle = document.createElement('span');
    vncTitle.id = 'gj-vnc-title';
    vncTitle.style.cssText = 'font-weight:600;color:#fff;';
    vncTitle.textContent = '';

    var vncClose = document.createElement('button');
    vncClose.style.cssText = 'margin-left:auto;background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:0 4px;';
    vncClose.innerHTML = '&times;';
    vncClose.addEventListener('click', function() {
        closeVncPanel();
    });

    vncBar.appendChild(vncTitle); vncBar.appendChild(vncClose);

    var vncFrame = document.createElement('iframe');
    vncFrame.id = 'gj-vnc-frame';
    vncFrame.style.cssText = 'position:absolute;top:32px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 32px);border:none;background:#000;';
    vncFrame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');

    vncPanel.appendChild(vncBar);
    vncPanel.appendChild(vncFrame);

    _modal.appendChild(hdr);
    _modal.appendChild(mapWrap);
    _modal.appendChild(vncPanel);
    document.body.appendChild(_modal);

    var overlay = document.createElement('div');
    overlay.id = 'gj-vnc-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99997;display:none;background:rgba(0,0,0,0.55);';
    overlay.addEventListener('click', hideMapModal);
    document.body.appendChild(overlay);

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && _modalVisible) hideMapModal();
    });
}

function refreshMapCards() {
    updatePcStatus();
    Object.keys(PC_POS).forEach(function(pcName) {
        var card = document.getElementById('gj-vnc-pc-' + pcName.replace(/\s/g,'_'));
        if (!card) return;
        var st = _pcStatus[pcName] || {};
        var isPlaying = st.sessionStatus === 'Играет';
        card.style.background = isPlaying ? '#cc0001' : '#2a2a3e';
        var nickEl = document.getElementById('gj-vnc-nick-' + pcName.replace(/\s/g,'_'));
        if (nickEl) nickEl.textContent = st.nick || '';
    });
}

function openVnc(pcName) {
    _selectedPc = pcName;
    // Подсвечиваем выбранный
    Object.keys(PC_POS).forEach(function(n) {
        var c = document.getElementById('gj-vnc-pc-' + n.replace(/\s/g,'_'));
        if (!c) return;
        c.style.borderColor = (n === pcName) ? '#ffcc00' : 'transparent';
        c.style.transform = (n === pcName) ? 'translate(-50%,-50%) scale(1.12)' : 'translate(-50%,-50%)';
    });

    var panel = document.getElementById('gj-vnc-panel');
    var frame = document.getElementById('gj-vnc-frame');
    var title = document.getElementById('gj-vnc-title');
    if (!panel || !frame) return;

    var pcNum = parseInt(pcName, 10);
    var url = VNC_BASE + pcNum + ':' + VNC_PORT;
    title.textContent = 'ПК ' + pcName + ' — ' + url;
    frame.src = 'http://' + VNC_BASE.replace('http://', '') + pcNum + ':' + VNC_PORT;
    panel.style.display = 'block';
    // Обновляем заголовок модалки
    var ttlEl = _modal.querySelector('span');
    if (ttlEl) ttlEl.textContent = 'Просмотр экрана — ПК ' + pcName;
}

function closeVncPanel() {
    var panel = document.getElementById('gj-vnc-panel');
    var frame = document.getElementById('gj-vnc-frame');
    if (panel) panel.style.display = 'none';
    if (frame) frame.src = 'about:blank';
    _selectedPc = null;
    // Снимаем выделение
    Object.keys(PC_POS).forEach(function(n) {
        var c = document.getElementById('gj-vnc-pc-' + n.replace(/\s/g,'_'));
        if (c) { c.style.borderColor = 'transparent'; c.style.transform = 'translate(-50%,-50%)'; }
    });
    var ttlEl = _modal && _modal.querySelector('span');
    if (ttlEl) ttlEl.textContent = 'Просмотр экрана — выберите ПК';
}

function showMapModal() {
    if (!_modal) createMapModal();
    refreshMapCards();
    _modal.style.display = 'flex';
    document.getElementById('gj-vnc-overlay').style.display = 'block';
    _modalVisible = true;
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if (btn) btn.setAttribute('data-active', 'true');
    // Обновляем карточки каждые 5 сек пока открыто
    _refreshInterval = setInterval(refreshMapCards, 5000);
}

function hideMapModal() {
    if (!_modal) return;
    closeVncPanel();
    _modal.style.display = 'none';
    document.getElementById('gj-vnc-overlay').style.display = 'none';
    _modalVisible = false;
    var btn = document.getElementById('gj-vnc-sidebar-btn');
    if (btn) btn.removeAttribute('data-active');
    if (_refreshInterval) { clearInterval(_refreshInterval); _refreshInterval = null; }
}

var _refreshInterval = null;

// ── Кнопка в сайдбаре — под "Поиск клиента" (fixed) ────
function getSearchBtn() {
    return document.getElementById('godji-search-btn');
}

function createSidebarButton() {
    if (document.getElementById('gj-vnc-sidebar-btn')) return;

    // Ждём кнопку поиска
    var searchBtn = getSearchBtn();
    if (!searchBtn) return;

    var nativeLink = document.querySelector('a[href="/bookings"]') ||
                     document.querySelector('a.mantine-NavLink-root');
    var btnCls = nativeLink ? nativeLink.className
        : 'mantine-focus-auto LinksGroup_navLink__qvSOI m_f0824112 mantine-NavLink-root m_87cf2631 mantine-UnstyledButton-root';

    var btn = document.createElement('a');
    btn.id = 'gj-vnc-sidebar-btn';
    btn.className = btnCls;
    btn.href = 'javascript:void(0)';
    btn.style.cssText = 'position:fixed;bottom:408px;left:0;z-index:500;width:280px;box-sizing:border-box;';

    var sec = document.createElement('span');
    sec.className = 'm_690090b5 mantine-NavLink-section';
    sec.setAttribute('data-position', 'left');
    var ico = document.createElement('div');
    ico.className = 'LinksGroup_themeIcon__E9SRO m_7341320d mantine-ThemeIcon-root';
    ico.setAttribute('data-variant', 'filled');
    ico.style.cssText = '--ti-size:calc(1.875rem * var(--mantine-scale));--ti-bg:var(--mantine-color-gg_primary-filled);--ti-color:var(--mantine-color-white);--ti-bd:calc(0.0625rem * var(--mantine-scale)) solid transparent;';
    ico.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
    sec.appendChild(ico);

    var body = document.createElement('div');
    body.className = 'm_f07af9d2 mantine-NavLink-body';
    var lbl = document.createElement('span');
    lbl.className = 'm_1f6ac4c4 mantine-NavLink-label';
    lbl.textContent = 'Просмотр экрана';
    body.appendChild(lbl);
    btn.appendChild(sec); btn.appendChild(body);

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (_modalVisible) { hideMapModal(); }
        else { showMapModal(); }
    });

    document.body.appendChild(btn);
}

function tryCreateBtn() {
    if (document.getElementById('gj-vnc-sidebar-btn')) return;
    if (!document.getElementById('godji-search-btn')) { setTimeout(tryCreateBtn, 600); return; }
    createSidebarButton();
}

setTimeout(tryCreateBtn, 1500);
setTimeout(tryCreateBtn, 3000);
setTimeout(tryCreateBtn, 6000);

// Observer только на body childList — без subtree
new MutationObserver(function(muts) {
    muts.forEach(function(m) {
        if (m.addedNodes.length && !document.getElementById('gj-vnc-sidebar-btn')) {
            tryCreateBtn();
        }
    });
}).observe(document.body || document.documentElement, { childList: true, subtree: false });

// Обновляем статусы ПК каждые 5 сек
setInterval(updatePcStatus, 5000);

})();


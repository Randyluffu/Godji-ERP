// ==UserScript==
// @name         Годжи — Характеристики ПК
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Карта характеристик ПК по комнатам с редактором
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_pc_specs.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_pc_specs.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
'use strict';

var STORAGE_KEY = 'godji_pc_specs_v1';

// ─────────────────────────────────────────────────────────
// СТРУКТУРА ПО УМОЛЧАНИЮ
// ─────────────────────────────────────────────────────────
var DEFAULT_DATA = {
    zones: [
        {
            id: 'vip', label: 'VIP', color: '#7c3aed',
            specs: [
                {label:'Процессор', value:'Intel Core i5-12400F', url:''},
                {label:'Видеокарта', value:'GeForce RTX 4060 Ti 8GB', url:''},
                {label:'Монитор', value:'AOC 27" 240 Гц VA', url:''},
                {label:'Наушники', value:'HyperX Cloud v2', url:''},
                {label:'Клавиатура', value:'Dark Project KD87A Gateron Teal Cap', url:''},
                {label:'Мышь', value:'ARDOR GAMING Phantom PRO V2', url:''},
                {label:'ОЗУ', value:'ADATA XPG SPECTRIX D50 32GB 3200 МГц / Kingston FURY Beast 32GB 6000 МГц', url:''},
                {label:'Материнская плата', value:'GIGABYTE B760M DS3H DDR4 LGA1700 / MSI MAG B760M MORTAR WIFI II', url:''},
                {label:'Кресло', value:'DXRacer Gladiator / ZONE 51 SOFA RIDER', url:''},
            ],
            rooms: [
                { id: 'O', pcs: ['30','31','32','33','34','35'], specs: [] },
                { id: 'Y', pcs: ['23','24','25','26','27','28','29'], specs: [] },
                { id: 'T', pcs: ['18','19','20','21','22'], specs: [] },
                { id: 'Q', pcs: ['10','11','12','13'], specs: [] },
            ]
        },
        {
            id: 'vipplus', label: 'VIP+', color: '#b45309',
            specs: [
                {label:'Процессор', value:'Intel Core i5-14600K', url:''},
                {label:'Видеокарта', value:'GeForce RTX 4070 SUPER 12GB', url:''},
                {label:'Монитор', value:'Titan Army 24.5" 360 Гц IPS / Acer Nitro 360 Гц', url:''},
                {label:'Наушники', value:'HyperX Cloud v2', url:''},
                {label:'Клавиатура', value:'Dark Project KD87A Gateron Teal Cap', url:''},
                {label:'Мышь', value:'ARDOR GAMING Phantom PRO Nordic', url:''},
                {label:'ОЗУ', value:'Kingston FURY Beast Black 32GB 6000 МГц', url:''},
                {label:'Материнская плата', value:'MSI MAG B760M MORTAR WIFI II LGA1700', url:''},
                {label:'Кресло', value:'DXRacer Gladiator / ZONE 51 SOFA RIDER', url:''},
            ],
            rooms: [
                { id: 'L', pcs: ['1','2','3','4','5'], specs: [] },
                { id: 'X', pcs: ['36','37','38','39','40'], specs: [] },
                { id: 'W', pcs: ['14','15','16','17'], specs: [] },
            ]
        },
        {
            id: 'duo', label: 'DUO', color: '#0369a1',
            specs: [
                {label:'Процессор', value:'Intel Core i5-14600KF', url:''},
                {label:'Видеокарта', value:'GeForce RTX 4070 SUPER 12GB', url:''},
                {label:'Монитор', value:'Acer 2K 300 Гц', url:''},
                {label:'Наушники', value:'HyperX Cloud v2', url:''},
                {label:'Клавиатура', value:'Dark Project KD87A', url:''},
                {label:'Мышь', value:'ARDOR GAMING Phantom PRO V2', url:''},
                {label:'ОЗУ', value:'32GB 6000 МГц', url:''},
                {label:'Материнская плата', value:'GIGABYTE B760M DS3H DDR4 LGA1700', url:''},
                {label:'Кресло', value:'DXRacer Gladiator / ZONE 51 SOFA RIDER', url:''},
            ],
            rooms: [
                { id: 'V', pcs: ['6','7'], specs: [] },
                { id: 'E', pcs: ['8','9'], specs: [] },
            ]
        },
        {
            id: 'solo', label: 'SOLO', color: '#166534',
            specs: [
                {label:'Процессор', value:'Intel Core i5-14600KF', url:''},
                {label:'Видеокарта', value:'GeForce RTX 5070 Ti 16GB', url:''},
                {label:'Монитор', value:'Samsung G6 2K 350 Гц', url:''},
                {label:'Наушники', value:'Logitech G PRO X', url:''},
                {label:'Клавиатура', value:'AKKO 5087S', url:''},
                {label:'Мышь', value:'Razer DeathAdder V3 Pro', url:''},
                {label:'ОЗУ', value:'32GB 6000 МГц', url:''},
                {label:'Материнская плата', value:'MSI MAG B760M MORTAR WIFI II LGA1700', url:''},
                {label:'Кресло', value:'DXRacer Gladiator / ZONE 51 SOFA RIDER', url:''},
            ],
            rooms: [
                { id: 'S', pcs: ['41'], specs: [] },
            ]
        }
    ],
    pcSpecs: {}
};

// ─────────────────────────────────────────────────────────
// ХРАНИЛИЩЕ
// ─────────────────────────────────────────────────────────
function loadData() {
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DATA));
        var parsed = JSON.parse(raw);
        // Если нет zones или не массив — сбрасываем повреждённые данные
        if (!parsed || !Array.isArray(parsed.zones)) {
            localStorage.removeItem(STORAGE_KEY);
            return JSON.parse(JSON.stringify(DEFAULT_DATA));
        }
        if (!parsed.pcSpecs) parsed.pcSpecs = {};
        parsed.zones.forEach(function(z) {
            if (!z.specs) z.specs = [];
            if (!Array.isArray(z.rooms)) z.rooms = [];
            z.rooms.forEach(function(r) {
                if (!r.specs) r.specs = [];
                if (!Array.isArray(r.pcs)) r.pcs = [];
            });
        });
        return parsed;
    } catch (e) {
        localStorage.removeItem(STORAGE_KEY);
        return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
}
function saveData(d) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) {}
}

// ─────────────────────────────────────────────────────────
// SVG ИКОНКИ
// ─────────────────────────────────────────────────────────
function svg(paths, size) {
    size = size || 16;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
}
var ICO = {
    pencil:   svg('<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>'),
    info:     svg('<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
    chevron:  svg('<polyline points="6 9 12 15 18 9"/>'),
    plus:     svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    trash:    svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    close:    svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    link:     svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    drag:     svg('<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>'),
};

// ─────────────────────────────────────────────────────────
// СОСТОЯНИЕ UI
// ─────────────────────────────────────────────────────────
var _modal = null, _overlay = null, _open = false;
var _editMode = false;
var _expandedZones = {}, _expandedRooms = {}, _expandedPcs = {};

// ─────────────────────────────────────────────────────────
// ГЛАВНОЕ МОДАЛЬНОЕ ОКНО
// ─────────────────────────────────────────────────────────
function openModal() {
    if (!_modal) buildModal();
    // Сбрасываем раскрытые разделы при каждом открытии
    _expandedZones = {};
    _expandedRooms = {};
    _expandedPcs = {};
    renderContent();
    _modal.style.display = 'flex';
    _overlay.style.display = 'block';
    _open = true;
}
function closeModal() {
    if (_modal) _modal.style.display = 'none';
    if (_overlay) _overlay.style.display = 'none';
    _open = false;
    _editMode = false;
}

function buildModal() {
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99996;display:none;';
    _overlay.addEventListener('click', closeModal);
    document.body.appendChild(_overlay);

    _modal = document.createElement('div');
    _modal.id = 'godji-pcspecs-modal';
    _modal.style.cssText = [
        'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
        'z-index:99997','width:680px','max-width:96vw','max-height:88vh',
        'background:#ffffff','color:#1a1a1a',
        'border:none',
        'border-radius:12px','box-shadow:0 8px 40px rgba(0,0,0,0.22)',
        'display:none','flex-direction:column','font-family:inherit','overflow:hidden',
    ].join(';');
    document.body.appendChild(_modal);

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && _open) closeModal();
    });
}

function renderContent() {
    if (!_modal) return;
    _modal.innerHTML = '';

    var data = loadData();

    // ── Header ──────────────────────────────────────────
    var hdr = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0;');

    var hL = el('div', 'display:flex;align-items:center;gap:10px;');
    var hIco = el('div', 'width:32px;height:32px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;');
    hIco.innerHTML = svg('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', 16);
    hIco.style.color = '#fff';
    var hTxt = el('div');
    hTxt.innerHTML = '<div style="font-size:15px;font-weight:700;color:#1a1a1a;">Характеристики ПК</div>';
    hL.appendChild(hIco); hL.appendChild(hTxt);

    var hR = el('div', 'display:flex;align-items:center;gap:8px;');

    // Кнопка редактирования
    var editBtn = el('button', 'background:'+(_editMode ? '#fff0f0' : '#f5f5f5')+';border:1px solid '+(_editMode ? '#fca5a5' : '#e0e0e0')+';border-radius:7px;padding:5px 10px;color:'+(_editMode ? '#cc2200' : '#666')+';cursor:pointer;font-size:12px;display:flex;align-items:center;gap:5px;font-family:inherit;transition:all .15s;');
    editBtn.innerHTML = ICO.pencil + '<span>' + (_editMode ? 'Готово' : 'Редактировать') + '</span>';
    editBtn.addEventListener('click', function () {
        _editMode = !_editMode;
        renderContent();
    });

    var closeBtn = el('button', 'background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;padding:0 4px;line-height:1;');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', closeModal);

    hR.appendChild(editBtn); hR.appendChild(closeBtn);
    hdr.appendChild(hL); hdr.appendChild(hR);
    _modal.appendChild(hdr);

    // ── Тело ────────────────────────────────────────────
    var body = el('div', 'overflow-y:auto;flex:1;min-height:0;padding:12px 16px;');

    data.zones.forEach(function (zone) {
        body.appendChild(buildZoneBlock(zone, data));
    });

    // Кнопка добавить зону (в режиме редактирования)
    if (_editMode) {
        var addZoneBtn = mkTextBtn('+ Добавить зону', function () {
            showAddZoneDialog(data);
        });
        addZoneBtn.style.marginTop = '8px';
        body.appendChild(addZoneBtn);
    }

    _modal.appendChild(body);
}

// ── Блок зоны ───────────────────────────────────────────
function buildZoneBlock(zone, data) {
    var wrap = el('div', 'margin-bottom:6px;border-radius:8px;border:1px solid #efefef;overflow:hidden;background:#fff;');

    // Заголовок зоны
    var zHdr = el('div', 'display:flex;align-items:center;gap:0;background:#f9f9f9;cursor:pointer;user-select:none;border-radius:8px 8px 0 0;transition:background 0.12s;');

    var zChev = el('span', 'padding:10px 6px 10px 12px;color:#bbb;transition:transform .2s;display:flex;align-items:center;flex-shrink:0;');
    zChev.innerHTML = ICO.chevron;
    if (_expandedZones[zone.id]) zChev.style.transform = 'rotate(180deg)';

    var zDot = el('span', 'width:10px;height:10px;border-radius:50%;background:'+zone.color+';flex-shrink:0;margin-right:8px;');

    var zLbl = el('span', 'font-size:13px;font-weight:700;color:#1a1a1a;flex:1;padding:10px 0;');
    zLbl.textContent = zone.label;

    var zR = el('div', 'display:flex;align-items:center;gap:4px;padding-right:10px;');

    // Инфо-кнопка
    var infoBtn = mkIconBtn(ICO.info, '#efefef', function (e) {
        e.stopPropagation();
        showSpecsInfo(zone, null, data);
    });
    zR.appendChild(infoBtn);

    if (_editMode) {
        // Кнопка добавить характеристику зоне
        var editZoneBtn = mkIconBtn(ICO.pencil, '#efefef', function (e) {
            e.stopPropagation();
            showEditSpecs(zone.id, null, null, data, function () { renderContent(); });
        });
        zR.appendChild(editZoneBtn);
    }

    zHdr.appendChild(zChev); zHdr.appendChild(zDot); zHdr.appendChild(zLbl); zHdr.appendChild(zR);

    var zContent = el('div', 'display:'+(_expandedZones[zone.id] ? 'block' : 'none')+';');

    zHdr.addEventListener('click', function () {
        _expandedZones[zone.id] = !_expandedZones[zone.id];
        zContent.style.display = _expandedZones[zone.id] ? 'block' : 'none';
        zChev.style.transform = _expandedZones[zone.id] ? 'rotate(180deg)' : '';
    });

    // Комнаты
    zone.rooms.forEach(function (room) {
        zContent.appendChild(buildRoomBlock(room, zone, data));
    });

    if (_editMode) {
        var addRoomBtn = mkTextBtn('+ Добавить комнату в ' + zone.label, function () {
            showAddRoomDialog(zone, data);
        });
        addRoomBtn.style.cssText += 'margin:4px 8px 8px;';
        zContent.appendChild(addRoomBtn);
    }

    wrap.appendChild(zHdr); wrap.appendChild(zContent);
    return wrap;
}

// ── Блок комнаты ─────────────────────────────────────────
function buildRoomBlock(room, zone, data) {
    var rKey = zone.id + '_' + room.id;
    var wrap = el('div', 'margin:4px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);overflow:hidden;');

    var rHdr = el('div', 'display:flex;align-items:center;background:transparent;cursor:pointer;user-select:none;border-top:1px solid #f5f5f5;transition:background 0.1s;');

    var rChev = el('span', 'padding:8px 6px 8px 10px;color:#aaa;transition:transform .2s;display:flex;align-items:center;flex-shrink:0;');
    rChev.innerHTML = svg('<polyline points="6 9 12 15 18 9"/>', 14);
    if (_expandedRooms[rKey]) rChev.style.transform = 'rotate(180deg)';

    var rLbl = el('span', 'font-size:12px;font-weight:600;color:#333;flex:1;padding:8px 4px;');
    rLbl.textContent = 'Комната ' + room.id;

    var rR = el('div', 'display:flex;align-items:center;gap:4px;padding-right:8px;');
    var rInfoBtn = mkIconBtn(ICO.info, '#efefef', function (e) {
        e.stopPropagation();
        showSpecsInfo(zone, room, data);
    });
    rR.appendChild(rInfoBtn);

    if (_editMode) {
        var editRoomBtn = mkIconBtn(ICO.pencil, '#efefef', function (e) {
            e.stopPropagation();
            showEditSpecs(zone.id, room.id, null, data, function () { renderContent(); });
        });
        var moveRoomBtn = mkIconBtn(ICO.drag, '#efefef', function (e) {
            e.stopPropagation();
            showMoveRoomDialog(room, zone, data);
        });
        rR.appendChild(editRoomBtn);
        rR.appendChild(moveRoomBtn);
    }

    rHdr.appendChild(rChev); rHdr.appendChild(rLbl); rHdr.appendChild(rR);

    var rContent = el('div', 'display:'+(_expandedRooms[rKey] ? 'block' : 'none')+';padding:2px 0 6px;');

    rHdr.addEventListener('click', function () {
        _expandedRooms[rKey] = !_expandedRooms[rKey];
        rContent.style.display = _expandedRooms[rKey] ? 'block' : 'none';
        rChev.style.transform = _expandedRooms[rKey] ? 'rotate(180deg)' : '';
    });

    // ПК
    room.pcs.forEach(function (pcId) {
        rContent.appendChild(buildPcBlock(pcId, room, zone, data));
    });

    if (_editMode) {
        var addPcBtn = mkTextBtn('+ Добавить ПК', function () {
            showAddPcDialog(room, zone, data);
        });
        addPcBtn.style.cssText += 'margin:2px 8px 4px;font-size:11px;';
        rContent.appendChild(addPcBtn);
    }

    wrap.appendChild(rHdr); wrap.appendChild(rContent);
    return wrap;
}

// ── Блок ПК ──────────────────────────────────────────────
function buildPcBlock(pcId, room, zone, data) {
    var pKey = zone.id + '_' + room.id + '_' + pcId;
    var pcData = (data.pcSpecs && data.pcSpecs[pcId]) || { specs: [] };

    // Эффективные характеристики: комбинируем зона → комната → пк
    var effSpecs = mergeSpecs(zone.specs || [], room.specs || [], pcData.specs || []);

    var wrap = el('div', 'margin:2px 10px;border-radius:6px;overflow:hidden;border:1px solid #f0f0f0;background:#fff;');

    var pHdr = el('div', 'display:flex;align-items:center;background:#fafafa;cursor:pointer;user-select:none;padding:5px 8px;gap:6px;border-top:1px solid #f0f0f0;transition:background 0.1s;');

    var pChev = el('span', 'color:#999;display:flex;align-items:center;flex-shrink:0;transition:transform .2s;');
    pChev.innerHTML = svg('<polyline points="6 9 12 15 18 9"/>', 12);
    if (_expandedPcs[pKey]) pChev.style.transform = 'rotate(180deg)';

    var pLbl = el('span', 'font-size:12px;font-weight:500;color:#444;flex:1;');
    pLbl.textContent = 'ПК ' + pcId;

    // Краткий превью первой характеристики
    if (effSpecs.length > 0) {
        var preview = el('span', 'font-size:11px;color:#aaa;margin-right:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;');
        preview.textContent = effSpecs[0].label + ': ' + effSpecs[0].value;
        pHdr.appendChild(pChev); pHdr.appendChild(pLbl); pHdr.appendChild(preview);
    } else {
        pHdr.appendChild(pChev); pHdr.appendChild(pLbl);
    }

    if (_editMode) {
        var editPcBtn = mkIconBtn(ICO.pencil, '#efefef', function (e) {
            e.stopPropagation();
            showEditSpecs(zone.id, room.id, pcId, data, function () { renderContent(); });
        });
        var movePcBtn = mkIconBtn(ICO.drag, '#efefef', function (e) {
            e.stopPropagation();
            showMovePcDialog(pcId, room, zone, data);
        });
        var delPcBtn = mkIconBtn(ICO.trash, '#fff0f0', function (e) {
            e.stopPropagation();
            if (confirm('Удалить ПК ' + pcId + ' из комнаты ' + room.id + '?')) {
                room.pcs = room.pcs.filter(function (p) { return p !== pcId; });
                saveData(data);
                renderContent();
            }
        });
        delPcBtn.style.color = '#cc2200';
        pHdr.appendChild(editPcBtn);
        pHdr.appendChild(movePcBtn);
        pHdr.appendChild(delPcBtn);
    }

    var pContent = el('div', 'display:'+(_expandedPcs[pKey] ? 'block' : 'none')+';padding:6px 12px 8px;background:#fff;');

    pHdr.addEventListener('click', function () {
        _expandedPcs[pKey] = !_expandedPcs[pKey];
        pContent.style.display = _expandedPcs[pKey] ? 'block' : 'none';
        pChev.style.transform = _expandedPcs[pKey] ? 'rotate(180deg)' : '';
    });

    // Характеристики ПК
    if (effSpecs.length === 0) {
        pContent.innerHTML = '<div style="font-size:11px;color:#bbb;padding:4px 0;">Нет характеристик</div>';
    } else {
        effSpecs.forEach(function (spec) {
            var row = el('div', 'display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid #f5f5f5;');
            var lbl = el('span', 'font-size:11px;color:#888;flex-shrink:0;min-width:100px;font-weight:500;');
            lbl.textContent = spec.label;
            var val = el('span', 'font-size:12px;font-weight:500;flex:1;color:#222;');

            if (spec.url) {
                var a = document.createElement('a');
                a.href = spec.url;
                a.target = '_blank';
                a.rel = 'noopener';
                a.style.cssText = 'color:#60a5fa;text-decoration:none;font-size:12px;font-weight:600;';
                a.textContent = spec.value;
                a.addEventListener('mouseenter', function () { a.style.textDecoration = 'underline'; });
                a.addEventListener('mouseleave', function () { a.style.textDecoration = 'none'; });
                val.appendChild(a);
            } else {
                val.style.color = '#333';
                val.textContent = spec.value;
            }

            // Пометка источника
            if (spec._src === 'zone') {
                var src = el('span', 'font-size:10px;color:#999;flex-shrink:0;');
                src.textContent = '(' + zone.label + ')';
                row.appendChild(lbl); row.appendChild(val); row.appendChild(src);
            } else if (spec._src === 'room') {
                var src2 = el('span', 'font-size:10px;color:#999;flex-shrink:0;');
                src2.textContent = '(комн. ' + room.id + ')';
                row.appendChild(lbl); row.appendChild(val); row.appendChild(src2);
            } else {
                row.appendChild(lbl); row.appendChild(val);
            }

            pContent.appendChild(row);
        });
    }

    wrap.appendChild(pHdr); wrap.appendChild(pContent);
    return wrap;
}

// ─────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ─────────────────────────────────────────────────────────

// Мержим характеристики: зона → комната → ПК (ПК перебивает)
function mergeSpecs(zoneSpecs, roomSpecs, pcSpecs) {
    var map = {};
    (zoneSpecs || []).forEach(function (s) { map[s.label] = Object.assign({}, s, {_src: 'zone'}); });
    (roomSpecs || []).forEach(function (s) { map[s.label] = Object.assign({}, s, {_src: 'room'}); });
    (pcSpecs || []).forEach(function (s) { map[s.label] = Object.assign({}, s, {_src: 'pc'}); });
    var result = [];
    for (var k in map) { if (map.hasOwnProperty(k)) result.push(map[k]); }
    return result;
}

function el(tag, css) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    return e;
}

function mkIconBtn(iconHtml, bg, onClick) {
    var b = el('button', 'background:'+bg+';border:none;border-radius:5px;padding:3px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#555;flex-shrink:0;transition:background .15s;');
    b.innerHTML = iconHtml.replace('width="16" height="16"', 'width="12" height="12"');
    b.addEventListener('click', onClick);
    return b;
}

function mkTextBtn(text, onClick) {
    var b = el('button', 'background:#f5f5f5;border:1px dashed #d0d0d0;border-radius:6px;padding:5px 10px;color:#aaa;font-size:12px;cursor:pointer;font-family:inherit;display:block;width:100%;text-align:left;transition:background .15s;');
    b.textContent = text;
    b.addEventListener('mouseenter', function () { b.style.background = '#efefef'; });
    b.addEventListener('mouseleave', function () { b.style.background = '#f5f5f5'; });
    b.addEventListener('click', onClick);
    return b;
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ РЕДАКТИРОВАНИЯ ХАРАКТЕРИСТИК
// ─────────────────────────────────────────────────────────
function showEditSpecs(zoneId, roomId, pcId, data, onSave) {
    // Определяем что редактируем
    var zone = data.zones.find(function (z) { return z.id === zoneId; });
    var room = roomId ? (zone && zone.rooms.find(function (r) { return r.id === roomId; })) : null;
    var isPC = !!pcId;

    var title = isPC ? ('ПК ' + pcId) : (room ? ('Комната ' + room.id) : ('Зона ' + (zone ? zone.label : '')));
    var targetSpecs;
    if (isPC) {
        if (!data.pcSpecs) data.pcSpecs = {};
        if (!data.pcSpecs[pcId]) data.pcSpecs[pcId] = { specs: [] };
        targetSpecs = data.pcSpecs[pcId].specs;
    } else if (room) {
        targetSpecs = room.specs || (room.specs = []);
    } else if (zone) {
        targetSpecs = zone.specs || (zone.specs = []);
    } else return;

    // Копия для редактирования
    var draft = JSON.parse(JSON.stringify(targetSpecs));

    var dlg = buildDialog('Характеристики: ' + title, '480px');
    var body = dlg.body;

    function renderSpecs() {
        body.innerHTML = '';
        draft.forEach(function (spec, idx) {
            var row = el('div', 'display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;');

            var lInp = mkInput(spec.label, 'Название (CPU, GPU...)');
            lInp.style.flex = '1';
            lInp.addEventListener('input', function () { spec.label = lInp.value; });

            var vInp = mkInput(spec.value, 'Значение');
            vInp.style.flex = '2';
            vInp.addEventListener('input', function () { spec.value = vInp.value; });

            var uInp = mkInput(spec.url || '', 'Ссылка (необязательно)');
            uInp.style.flex = '2';
            uInp.placeholder = 'https://...';
            uInp.addEventListener('input', function () { spec.url = uInp.value || ''; });

            var del = el('button', 'background:#fff0f0;border:1px solid #fca5a5;border-radius:5px;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#cc2200;flex-shrink:0;margin-top:1px;');
            del.innerHTML = ICO.trash.replace('width="16" height="16"', 'width="13" height="13"');
            del.addEventListener('click', function () { draft.splice(idx, 1); renderSpecs(); });

            row.appendChild(lInp); row.appendChild(vInp); row.appendChild(uInp); row.appendChild(del);
            body.appendChild(row);
        });

        var addRow = el('button', 'background:#f9f9f9;border:1px dashed #ccc;border-radius:6px;padding:7px;color:#888;font-size:12px;cursor:pointer;font-family:inherit;width:100%;margin-top:6px;display:flex;align-items:center;justify-content:center;gap:5px;transition:background 0.12s;');
        addRow.innerHTML = ICO.plus.replace('width="16"','width="13"').replace('height="16"','height="13"') + '<span>Добавить характеристику</span>';
        addRow.addEventListener('click', function () {
            draft.push({ label: '', value: '', url: '' });
            renderSpecs();
        });
        body.appendChild(addRow);
    }

    renderSpecs();

    dlg.addFooter([
        { label: 'Сохранить', primary: true, onClick: function () {
            var clean = draft.filter(function (s) { return s.label && s.value; });
            if (isPC) {
                data.pcSpecs[pcId].specs = clean;
            } else if (room) {
                room.specs = clean;
            } else if (zone) {
                zone.specs = clean;
            }
            saveData(data);
            dlg.close();
            if (onSave) onSave();
        }},
        { label: 'Отмена', onClick: function () { dlg.close(); }}
    ]);
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ИНФО О ХАРАКТЕРИСТИКАХ ЗОНЫ/КОМНАТЫ
// ─────────────────────────────────────────────────────────
function showSpecsInfo(zone, room, data) {
    var title = room ? ('Комната ' + room.id) : ('Зона ' + zone.label);
    var baseSpecs = room ? (mergeSpecs(zone.specs || [], room.specs || [], [])) : (zone.specs || []);

    var dlg = buildDialog('Характеристики: ' + title, '480px');
    var body = dlg.body;

    if (baseSpecs.length === 0) {
        var empty = el('div', 'font-size:12px;color:#aaa;padding:8px 0;');
        empty.textContent = 'Нет общих характеристик';
        body.appendChild(empty);
    } else {
        var sect = el('div', 'margin-bottom:12px;');
        var sectLbl = el('div', 'font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;');
        sectLbl.textContent = 'Общие характеристики';
        sect.appendChild(sectLbl);
        baseSpecs.forEach(function (spec) {
            sect.appendChild(buildSpecRow(spec));
        });
        body.appendChild(sect);
    }

    // Отличия по комнатам (если зона) или по ПК (если комната)
    var items = room ? room.pcs : (zone.rooms.map(function (r) { return r.id; }));
    var diffs = [];

    if (room) {
        // Ищем ПК с отличиями
        room.pcs.forEach(function (pcId) {
            var pcS = (data.pcSpecs && data.pcSpecs[pcId] && data.pcSpecs[pcId].specs) || [];
            if (pcS.length > 0) {
                diffs.push({ label: 'ПК ' + pcId, specs: pcS });
            }
        });
    } else {
        // Ищем комнаты с отличиями
        zone.rooms.forEach(function (r) {
            if (r.specs && r.specs.length > 0) {
                diffs.push({ label: 'Комната ' + r.id, specs: mergeSpecs(zone.specs || [], r.specs, []) });
            }
        });
    }

    if (diffs.length > 0) {
        var divider = el('div', 'border-top:1px solid rgba(255,255,255,0.06);margin:10px 0;');
        body.appendChild(divider);
        var diffLbl = el('div', 'font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;');
        diffLbl.textContent = 'Отличия';
        body.appendChild(diffLbl);

        diffs.forEach(function (diff) {
            var s = el('div', 'margin-bottom:10px;');
            var sl = el('div', 'font-size:12px;font-weight:600;color:#aaa;margin-bottom:4px;');
            sl.textContent = diff.label;
            s.appendChild(sl);
            diff.specs.forEach(function (spec) { s.appendChild(buildSpecRow(spec)); });
            body.appendChild(s);
        });
    }

    dlg.addFooter([{ label: 'Закрыть', onClick: function () { dlg.close(); } }]);
}

function buildSpecRow(spec) {
    var row = el('div', 'display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.03);');
    var lbl = el('span', 'font-size:11px;color:#888;min-width:90px;flex-shrink:0;');
    lbl.textContent = spec.label;
    var val = el('span', 'font-size:12px;');
    if (spec.url) {
        var a = document.createElement('a');
        a.href = spec.url; a.target = '_blank'; a.rel = 'noopener';
        a.style.cssText = 'color:#60a5fa;text-decoration:none;';
        a.textContent = spec.value;
        a.addEventListener('mouseenter', function () { a.style.textDecoration = 'underline'; });
        a.addEventListener('mouseleave', function () { a.style.textDecoration = 'none'; });
        val.appendChild(a);
    } else {
        val.style.color = '#333';
        val.textContent = spec.value;
    }
    row.appendChild(lbl); row.appendChild(val);
    return row;
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ПЕРЕМЕЩЕНИЯ КОМНАТЫ
// ─────────────────────────────────────────────────────────
function showMoveRoomDialog(room, currentZone, data) {
    var dlg = buildDialog('Переместить комнату ' + room.id, '340px');
    var body = dlg.body;

    var lbl = el('div', 'font-size:12px;color:#aaa;margin-bottom:10px;');
    lbl.textContent = 'Выберите зону для комнаты ' + room.id + ':';
    body.appendChild(lbl);

    data.zones.forEach(function (z) {
        var opt = el('button', 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;background:'+(z.id === currentZone.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)')+';border:1px solid rgba(255,255,255,0.07);border-radius:7px;cursor:pointer;font-family:inherit;margin-bottom:5px;color:#e0e1e8;font-size:13px;');
        var dot = el('span', 'width:8px;height:8px;border-radius:50%;background:'+z.color+';flex-shrink:0;');
        opt.appendChild(dot);
        opt.appendChild(document.createTextNode(z.label + (z.id === currentZone.id ? ' (текущая)' : '')));
        opt.addEventListener('click', function () {
            if (z.id === currentZone.id) { dlg.close(); return; }
            // Удаляем из текущей зоны
            currentZone.rooms = currentZone.rooms.filter(function (r) { return r.id !== room.id; });
            // Добавляем в новую
            z.rooms.push(room);
            saveData(data);
            dlg.close();
            renderContent();
        });
        body.appendChild(opt);
    });

    dlg.addFooter([{ label: 'Отмена', onClick: function () { dlg.close(); } }]);
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ПЕРЕМЕЩЕНИЯ ПК
// ─────────────────────────────────────────────────────────
function showMovePcDialog(pcId, currentRoom, currentZone, data) {
    var dlg = buildDialog('Переместить ПК ' + pcId, '360px');
    var body = dlg.body;

    var lbl = el('div', 'font-size:12px;color:#aaa;margin-bottom:10px;');
    lbl.textContent = 'Выберите комнату для ПК ' + pcId + ':';
    body.appendChild(lbl);

    data.zones.forEach(function (z) {
        var zSect = el('div', 'margin-bottom:8px;');
        var zLbl = el('div', 'font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;display:flex;align-items:center;gap:5px;');
        var dot = el('span', 'width:7px;height:7px;border-radius:50%;background:'+z.color+';');
        zLbl.appendChild(dot); zLbl.appendChild(document.createTextNode(z.label));
        zSect.appendChild(zLbl);

        z.rooms.forEach(function (r) {
            var isCurrent = r.id === currentRoom.id && z.id === currentZone.id;
            var opt = el('button', 'display:block;width:100%;padding:6px 10px;background:'+(isCurrent ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)')+';border:1px solid rgba(255,255,255,0.06);border-radius:6px;cursor:pointer;font-family:inherit;margin-bottom:3px;color:#444;font-size:12px;text-align:left;');
            opt.textContent = 'Комната ' + r.id + (isCurrent ? ' (текущая)' : '');
            opt.addEventListener('click', function () {
                if (isCurrent) { dlg.close(); return; }
                currentRoom.pcs = currentRoom.pcs.filter(function (p) { return p !== pcId; });
                r.pcs.push(pcId);
                saveData(data);
                dlg.close();
                renderContent();
            });
            zSect.appendChild(opt);
        });
        body.appendChild(zSect);
    });

    dlg.addFooter([{ label: 'Отмена', onClick: function () { dlg.close(); } }]);
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ДОБАВЛЕНИЯ ЗОНЫ
// ─────────────────────────────────────────────────────────
function showAddZoneDialog(data) {
    var dlg = buildDialog('Новая зона', '340px');
    var body = dlg.body;

    var lInp = mkInput('', 'Название (VIP, Турнирная...)');
    lInp.style.marginBottom = '8px';
    var cInp = mkInput('#6366f1', 'Цвет (#hex)');
    cInp.type = 'color';
    cInp.style.cssText += 'height:36px;padding:2px 6px;cursor:pointer;';

    body.appendChild(mkLabel('Название'));
    body.appendChild(lInp);
    body.appendChild(mkLabel('Цвет'));
    body.appendChild(cInp);

    dlg.addFooter([
        { label: 'Добавить', primary: true, onClick: function () {
            var label = lInp.value.trim();
            if (!label) return;
            data.zones.push({ id: 'zone_' + Date.now(), label: label, color: cInp.value, specs: [], rooms: [] });
            saveData(data);
            dlg.close();
            renderContent();
        }},
        { label: 'Отмена', onClick: function () { dlg.close(); }}
    ]);
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ДОБАВЛЕНИЯ КОМНАТЫ
// ─────────────────────────────────────────────────────────
function showAddRoomDialog(zone, data) {
    var dlg = buildDialog('Новая комната в ' + zone.label, '340px');
    var body = dlg.body;

    var idInp = mkInput('', 'ID комнаты (A, B, Z...)');
    body.appendChild(mkLabel('ID комнаты'));
    body.appendChild(idInp);

    dlg.addFooter([
        { label: 'Добавить', primary: true, onClick: function () {
            var id = idInp.value.trim();
            if (!id) return;
            zone.rooms.push({ id: id, pcs: [], specs: [] });
            saveData(data);
            dlg.close();
            renderContent();
        }},
        { label: 'Отмена', onClick: function () { dlg.close(); }}
    ]);
}

// ─────────────────────────────────────────────────────────
// ДИАЛОГ ДОБАВЛЕНИЯ ПК
// ─────────────────────────────────────────────────────────
function showAddPcDialog(room, zone, data) {
    var dlg = buildDialog('Добавить ПК в комнату ' + room.id, '300px');
    var body = dlg.body;
    var idInp = mkInput('', 'Номер ПК (42, 43...)');
    body.appendChild(mkLabel('Номер ПК'));
    body.appendChild(idInp);

    dlg.addFooter([
        { label: 'Добавить', primary: true, onClick: function () {
            var id = idInp.value.trim();
            if (!id || room.pcs.indexOf(id) !== -1) return;
            room.pcs.push(id);
            saveData(data);
            dlg.close();
            renderContent();
        }},
        { label: 'Отмена', onClick: function () { dlg.close(); }}
    ]);
}

// ─────────────────────────────────────────────────────────
// УТИЛИТЫ ДИАЛОГОВ
// ─────────────────────────────────────────────────────────
function buildDialog(title, width) {
    var ov = el('div', 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;');
    var box = el('div', 'background:#ffffff;border:none;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,0.22);color:#1a1a1a;width:'+width+';max-width:96vw;max-height:80vh;display:flex;flex-direction:column;font-family:inherit;overflow:hidden;');

    var hdr = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #f0f0f0;flex-shrink:0;');
    var htxt = el('span', 'font-size:14px;font-weight:700;color:#1a1a1a;');
    htxt.textContent = title;
    var xcl = el('button', 'background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:0 2px;line-height:1;');
    xcl.innerHTML = '&times;';
    hdr.appendChild(htxt); hdr.appendChild(xcl);
    box.appendChild(hdr);

    var body = el('div', 'padding:14px 16px;overflow-y:auto;flex:1;color:#1a1a1a;');
    box.appendChild(body);

    ov.appendChild(box);
    document.body.appendChild(ov);

    function close() { ov.remove(); }
    xcl.addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

    function addFooter(buttons) {
        var ft = el('div', 'display:flex;gap:8px;justify-content:flex-end;padding:10px 16px;border-top:1px solid #f0f0f0;flex-shrink:0;');
        buttons.forEach(function (b) {
            var btn = el('button', 'padding:6px 16px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border:none;'+(b.primary ? 'background:#cc0001;color:#fff;' : 'background:#f0f0f0;color:#555;'));
            btn.textContent = b.label;
            btn.addEventListener('click', b.onClick);
            ft.appendChild(btn);
        });
        box.appendChild(ft);
    }

    return { body: body, close: close, addFooter: addFooter };
}

function mkInput(value, placeholder) {
    var inp = el('input', 'background:#f9f9f9;border:1px solid #e0e0e0;border-radius:7px;padding:7px 10px;font-size:12px;color:#333;font-family:inherit;outline:none;width:100%;box-sizing:border-box;');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder || '';
    return inp;
}

function mkLabel(text) {
    var l = el('div', 'font-size:11px;color:#888;margin-bottom:4px;margin-top:8px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;');
    l.textContent = text;
    return l;
}

// ─────────────────────────────────────────────────────────
// РЕГИСТРАЦИЯ В НАСТРОЙКАХ
// ─────────────────────────────────────────────────────────
function registerSetting() {
    if(!window.__godjiSettingsQueue) window.__godjiSettingsQueue=[];
    if (typeof window.__godjiRegisterSetting !== 'function') {
        setTimeout(registerSetting, 400);
        return;
    }
    window.__godjiRegisterSetting({
        id: 'godji-pc-specs',
        label: 'Характеристики ПК',
        iconBg: '#cc0001',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        type: 'button',
        onClick: function () { openModal(); }
    });
}

registerSetting();

})();

// ==UserScript==
// @name         Годжи — Характеристики ПК
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Карта и менеджер характеристик ПК с иерархией зон/комнат, drag&drop и переопределением
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
'use strict';

/* ═══════════════════════════════════════════════════════
   ДАННЫЕ (Excel "Гоголя")
   ═══════════════════════════════════════════════════════ */
const STORAGE_KEY = 'godji_pc_specs_v2';

// Структура клуба
const STRUCTURE = {
  zones: [
    { id: 'VIP',   name: 'VIP',   rooms: ['O','Y','T','Q'] },
    { id: 'VIP+',  name: 'VIP+',  rooms: ['L','X','W'] },
    { id: 'DUO',   name: 'DUO',   rooms: ['V','E'] },
    { id: 'SOLO',  name: 'SOLO',  rooms: ['S'] }
  ],
  roomPcs: {
    'Q':['10','11','12','13'], 'W':['14','15','16','17'],
    'E':['08','09'], 'T':['18','19','20','21','22'],
    'Y':['23','24','25','26','27','28','29'],
    'O':['30','31','32','33','34','35'],
    'X':['36','37','38','39','40'],
    'L':['01','02','03','04','05'],
    'V':['06','07'], 'S':['41']
  }
};

// Стандартные характеристики (из Excel)
const DEFAULT_SPECS = {
  zone_VIP: {
    'Процессор': { v: 'Intel Core i5-12400F', l: 'https://www.dns-shop.ru/product/0a2114a7fcc9ed20/processor-intel-core-i5-12400f-oem/' },
    'Видеокарта': { v: '4060 TI 8 GB', l: 'https://www.dns-shop.ru/product/55cc9b9165b71b80/videokarta-msi-geforce-rtx-3060-ventus-2x-oc-lhr-rtx-3060-ventus-2x-12g-oc/' },
    'Оперативная память': { v: '32 GB 3200 МГц', l: 'https://www.dns-shop.ru/product/24fe3fca7bf33332/operativnaya-pamyat-adata-xpg-spectrix-d50-rgb-ax4u32008g16a-dw50-16-gb/' },
    'Монитор': { v: 'AOC 27" 280 Гц', l: 'https://www.citilink.ru/product/monitor-aoc-gaming-c27g2ze-27-chernyy-krasnyy-i-chernyy-1418917/' },
    'Наушники': { v: 'Hyper X Cloud v2', l: 'https://www.dns-shop.ru/product/256a9658eb6ced20/provodnye-naushniki-hyperx-cloud-ii-krasnyy-2022/' },
    'Клавиатура': { v: 'Dark Project KD87A Gateron Teal Cap', l: 'https://www.dns-shop.ru/product/1c0f1d803aefed20/klaviatura-provodnaya-dark-project-kd87a-gateron-teal-cap/' },
    'Мышь': { v: 'ARDOR GAMING Phantom PRO V2', l: 'https://www.dns-shop.ru/product/c251f0deddb0ed20/mys-besprovodnayaprovodnaya-ardor-gaming-phantom-pro-v2-ardw-ph3395-wt-belyy/' },
    'Блок питания': { v: 'PROTON BDF-600S 600W', l: 'https://www.dns-shop.ru/product/d07d704607113330/blok-pitaniya-chieftec-proton-600w-bdf-600s-chernyy/' },
    'Корпус': { v: 'ZALMAN N4 Rev.1', l: 'https://www.dns-shop.ru/product/f1707d8a00b9ed20/korpus-zalman-n4-rev1-chernyy/' },
    'Материнская плата': { v: 'MSI MAG B760M MORTAR WIFI II', l: 'https://www.dns-shop.ru/product/4eb39d0e5602ed20/materinskaya-plata-msi-mag-b760m-mortar-wifi-ii/' },    'SSD M.2': { v: 'MSI 256 GB', l: '' },
    'Кресло': { v: 'DXRacer Gladiator / ZONE 51 SOFA RIDER', l: 'https://www.dns-shop.kz/product/6b2fb03fcb222b06/kompyuternoe-kreslo-dxracer-gladiator-krasnyy/' }
  },
  zone_VIP_PLUS: {
    'Процессор': { v: 'Intel Core i5-13400F', l: '' },
    'Видеокарта': { v: '5070 12 GB', l: 'https://www.dns-shop.ru/product/f1bfcf82de6eed20' },
    'Оперативная память': { v: '32 GB 6000 МГц', l: 'https://www.dns-shop.ru/product/14c22b90ecead582/operativnaya-pamyat-kingston-fury-beast-black-kf560c30bbe-16-16-gb/' },
    'Монитор': { v: 'Titan Army 24.5" 360 Гц IPS / Acer Nitro 360 Гц', l: 'https://www.dns-shop.ru/product/1f76a1db1624ed20/245-monitor-titan-army-p25a2k-chernyy/' },
    'Наушники': { v: 'Hyper X Cloud v2', l: '' },
    'Клавиатура': { v: 'AKKO 5087S / Dark Project KD87A', l: '' },
    'Мышь': { v: 'ARDOR GAMING Phantom PRO Nordic', l: 'https://www.dns-shop.ru/product/8c443c3a0af5af05/mys-besprovodnayaprovodnaya-ardor-gaming-phantom-pro-nordic-ardw-phn3395-wt-belyy/' },
    'Блок питания': { v: 'ATX DEXP DTS-650EPS 650W', l: 'https://www.dns-shop.ru/product/16049257bbe03361/bp-atx-dexp-dts-650eps-650w-80-atx-22-apfc-120mm-fan-2444-6xsata-2xpci-e/' },
    'Корпус': { v: 'MONTECH X3 MESH / Geometric Future Model 5', l: 'https://www.dns-shop.ru/product/6e7de89742c1ed20/korpus-montech-x3-mesh-x3-mesh-w-belyy/' },
    'Материнская плата': { v: 'MSI MAG B760M MORTAR II', l: '' },
    'SSD M.2': { v: 'MSI 256 GB', l: '' },
    'Кресло': { v: 'ZONE 51', l: '' }
  },
  zone_DUO: {
    'Процессор': { v: 'Intel Core i5-14600KF', l: 'https://www.dns-shop.ru/product/163592727233ed20/processor-intel-core-i5-14600kf-oem/' },
    'Видеокарта': { v: '5070 12 GB', l: '' },
    'Оперативная память': { v: '32 GB 6000 МГц', l: '' },
    'Монитор': { v: 'Asus TUF 2K 300 Гц / AOC 2K 300 Гц', l: 'https://www.dns-shop.ru/product/5a7423f3fef3d763/monitor-acer-27-xv272ukfbmiipruzx-300-gc-2560x1440-ips-1-ms-gtg-350-cdm-hdmi-display-port-usb-type-c/' },
    'Наушники': { v: 'Hyper X Cloud v2', l: '' },
    'Клавиатура': { v: 'AKKO 5087S', l: 'https://www.dns-shop.ru/product/92a51df7630d8725/klaviatura-provodnaya-akko-5087s/' },
    'Мышь': { v: 'Dark Project x VGN F1 Pro Max', l: '' },
    'Блок питания': { v: 'ATX DEXP DTS-650EPS 650W', l: '' },
    'Корпус': { v: 'MONTECH X3 MESH', l: '' },
    'Материнская плата': { v: 'MSI MAG B760M MORTAR II', l: '' },
    'SSD M.2': { v: 'MSI 256 GB', l: '' },
    'Кресло': { v: 'ZONE 51', l: '' }
  },
  zone_SOLO: {
    'Процессор': { v: 'Intel Core i5-14600KF', l: '' },
    'Видеокарта': { v: 'GeForce RTX 5070 Ti 16GB', l: 'https://www.dns-shop.ru/product/fe5cfcefe77fd582/videokarta-palit-geforce-rtx-5070-ti-gamingpro-ne7507t019t2-gb2031a/' },
    'Оперативная память': { v: '32 GB 6000 МГц', l: '' },
    'Монитор': { v: 'Samsung Odyssey G6 2K 350 Гц', l: 'https://www.dns-shop.ru/product/2a5a1ebd5e12d582/27-monitor-samsung-odyssey-g6-s27fg606ei-chernyy/' },
    'Наушники': { v: 'Hyper X Cloud v2', l: '' },
    'Клавиатура': { v: 'AKKO 5087S', l: '' },
    'Мышь': { v: 'Logitech Superlight 2', l: 'https://www.dns-shop.ru/product/39e593af22b7ed20/mys-besprovodnayaprovodnaya-razer-deathadder-v3-pro-rz01-04630100-r3g1-chernyy/' },
    'Блок питания': { v: 'ATX DEXP DTS-650EPS 650W', l: '' },
    'Корпус': { v: 'MONTECH X3 MESH', l: '' },
    'Материнская плата': { v: 'MSI MAG B760M MORTAR II', l: '' },
    'SSD M.2': { v: 'MSI 256 GB', l: '' },
    'Кресло': { v: 'ZONE 51', l: '' }
  }
};

/* ═══════════════════════════════════════════════════════
   ЛОГИКА
   ═══════════════════════════════════════════════════════ */var _data = null;
var _isEdit = false;
var _modal = null, _overlay = null;
var _expandedSections = {}; // { id: boolean }

function load() {
  try {
    _data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  } catch(e) { _data = null; }
  if (!_data) {
    _data = { structure: JSON.parse(JSON.stringify(STRUCTURE)), specs: JSON.parse(JSON.stringify(DEFAULT_SPECS)) };
    save();
  }
  // Миграция если структура обновилась
  if (!_data.structure) _data.structure = JSON.parse(JSON.stringify(STRUCTURE));
  if (!_data.specs) _data.specs = {};
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_data)); } catch(e) {}
}

// Получить эффективные характеристики (наследование Зона -> Комната -> ПК)
function getEffectiveSpecs(zoneId, roomId, pcId) {
  var out = {};
  var keys = ['zone_'+zoneId, 'room_'+roomId, 'pc_'+pcId];
  keys.forEach(function(k) {
    if (_data.specs[k]) {
      Object.keys(_data.specs[k]).forEach(function(spec) {
        // Последняя запись перезаписывает предыдущую (приоритет ПК > Комната > Зона)
        out[spec] = Object.assign({}, out[spec], _data.specs[k][spec]);
      });
    }
  });
  return out;
}

// Проверить отклонения (для инфо-кнопки)
function getDeviations(zoneId, roomId) {
  var zoneSpecs = _data.specs['zone_'+zoneId] || {};
  var roomSpecs = _data.specs['room_'+roomId] || {};
  var pcs = _data.structure.roomPcs[roomId] || [];
  var diffs = { room: [], pcs: [] };

  // Отклонения комнаты от зоны
  Object.keys(roomSpecs).forEach(function(key) {
    var zoneVal = zoneSpecs[key] ? zoneSpecs[key].v : null;
    if (!zoneVal || zoneVal !== roomSpecs[key].v) {
      diffs.room.push({ key: key, val: roomSpecs[key].v });
    }  });

  // Отклонения ПК от комнаты
  pcs.forEach(function(pc) {
    var pcSpecs = _data.specs['pc_'+pc] || {};
    var hasDiff = false;
    Object.keys(pcSpecs).forEach(function(key) {
      var roomVal = roomSpecs[key] ? roomSpecs[key].v : (zoneSpecs[key] ? zoneSpecs[key].v : null);
      if (!roomVal || roomVal !== pcSpecs[key].v) hasDiff = true;
    });
    if (hasDiff) diffs.pcs.push(pc);
  });
  return diffs;
}

/* ═══════════════════════════════════════════════════════
   UI: МОДАЛКА (ИСПРАВЛЕНО ЦЕНТРИРОВАНИЕ)
   ═══════════════════════════════════════════════════════ */
function createModal() {
  if (_overlay) _overlay.remove();
  if (_modal) _modal.remove();

  // Overlay: Fixed, full screen, flex center
  _overlay = document.createElement('div');
  _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:999998;display:none;align-items:center;justify-content:center;padding:20px;';
  _overlay.addEventListener('click', function(e) { if(e.target===_overlay) hideModal(); });

  // Modal: Fixed, centered via flex parent, but also explicit positioning just in case
  _modal = document.createElement('div');
  _modal.style.cssText = [
    'background:#ffffff',
    'border:1px solid #e0e0e0',
    'border-radius:12px',
    'width:100%',
    'max-width:720px',
    'max-height:85vh',
    'display:none',
    'flex-direction:column',
    'font-family:var(--mantine-font-family,inherit)',
    'box-shadow:0 24px 64px rgba(0,0,0,0.4)',
    'overflow:hidden',
    'color:#1a1a1a'
  ].join(';');

  // Header
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #f0f0f0;flex-shrink:0;background:#fff;';
  hdr.innerHTML = '<div style="display:flex;align-items:center;gap:10px;"><div style="width:30px;height:30px;border-radius:8px;background:#cc0001;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/></svg></div><span style="font-size:15px;font-weight:700;color:#1a1a1a;">Характеристики ПК</span></div>';

  var actions = document.createElement('div');  actions.style.cssText = 'display:flex;gap:8px;align-items:center;';
  
  // Pencil
  var pencil = document.createElement('button');
  pencil.title = 'Режим редактирования';
  pencil.style.cssText = 'background:none;border:none;color:#868e96;font-size:18px;cursor:pointer;padding:6px;border-radius:6px;transition:all 0.15s;';
  pencil.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  pencil.addEventListener('mouseenter', function(){ pencil.style.color='#1a1a1a'; pencil.style.background='#f5f5f5'; });
  pencil.addEventListener('mouseleave', function(){ pencil.style.color='#868e96'; pencil.style.background='transparent'; });
  pencil.addEventListener('click', function() {
    _isEdit = !_isEdit;
    pencil.style.color = _isEdit ? '#cc0001' : '#868e96';
    renderBody();
  });
  
  // Close
  var close = document.createElement('button');
  close.innerHTML = '&times;'; 
  close.style.cssText = 'background:none;border:none;color:#868e96;font-size:22px;cursor:pointer;padding:0;line-height:1;';
  close.addEventListener('click', hideModal);

  actions.appendChild(pencil); 
  actions.appendChild(close);
  hdr.appendChild(actions);
  _modal.appendChild(hdr);

  // Body
  var body = document.createElement('div');
  body.id = 'godji-specs-body';
  body.style.cssText = 'overflow-y:auto;padding:12px 16px 16px;flex:1;background:#fafafa;';
  _modal.appendChild(body);

  document.body.appendChild(_overlay);
  document.body.appendChild(_modal);
  
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && _modal.style.display!=='none') hideModal(); });
}

function hideModal() {
  if(!_modal) return;
  _modal.style.display='none';
  _overlay.style.display='none';
}

function showModal() {
  if(!_modal) createModal();
  load();
  _expandedSections = {}; // Сброс развёрнутых секций
  renderBody();
  _modal.style.display='flex';  _overlay.style.display='flex';
}

function renderBody() {
  var body = document.getElementById('godji-specs-body');
  if(!body) return;
  body.innerHTML = '';

  _data.structure.zones.forEach(function(zone) {
    var zEl = buildZone(zone);
    body.appendChild(zEl);
  });
}

/* ═══════════════════════════════════════════════════════
   ПОСТРОЕНИЕ ИЕРАРХИИ
   ═══════════════════════════════════════════════════════ */
function buildZone(zone) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:10px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.05);';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;user-select:none;transition:background 0.15s;border-bottom:1px solid #f5f5f5;';
  hdr.addEventListener('mouseenter', function(){ hdr.style.background='#f9f9f9'; });
  hdr.addEventListener('mouseleave', function(){ hdr.style.background=''; });
  hdr.addEventListener('click', function(e){
    if(e.target.tagName==='BUTTON' || e.target.tagName==='SELECT') return;
    var body = wrap.querySelector('.z-body');
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    arr.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
    _expandedSections['zone_'+zone.id] = !open;
  });

  var arr = document.createElement('span');
  arr.style.cssText = 'color:#868e96;transition:transform 0.18s;font-size:11px;';
  arr.textContent = '▼';

  var title = document.createElement('span');
  title.style.cssText = 'font-size:13px;font-weight:700;color:#1a1a1a;flex:1;';
  title.textContent = zone.name;

  var infoBtn = mkInfoBtn('zone_'+zone.id, zone.name, null);
  var dragHandle = mkDragHandle('zone', zone.id);

  hdr.appendChild(arr); 
  hdr.appendChild(title);
  if(_isEdit) hdr.appendChild(dragHandle);
  hdr.appendChild(infoBtn);
  wrap.appendChild(hdr);
  var body = document.createElement('div');
  body.className = 'z-body';
  body.style.cssText = 'padding:10px;display:block;background:#fff;'; // Скрыто по умолчанию? Нет, в renderBody мы сбрасываем _expandedSections, но тут display:block. Нужно проверить логику.
  // Исправление: по умолчанию скрыто, если не в expandedSections
  // Но renderBody пересоздает DOM, поэтому нужно управлять display через JS или класс.
  // Проще: в renderBody ничего не меняем, а тут ставим display:none по умолчанию, если не expanded.
  // Но _expandedSections пустой при showModal. Значит всё скрыто.
  body.style.display = 'none'; 
  arr.style.transform = 'rotate(-90deg)';

  zone.rooms.forEach(function(rid) {
    body.appendChild(buildRoom(zone.id, rid));
  });
  wrap.appendChild(body);

  if(_isEdit) {
    body.appendChild(buildSpecEditor('zone_'+zone.id, true));
  }
  return wrap;
}

function buildRoom(zoneId, roomId) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'margin:8px 0 8px 18px;border-left:2px solid #e0e0e0;padding-left:12px;';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;user-select:none;border-radius:6px;transition:background 0.15s;';
  hdr.addEventListener('mouseenter', function(){ hdr.style.background='#f5f5f5'; });
  hdr.addEventListener('mouseleave', function(){ hdr.style.background=''; });
  hdr.addEventListener('click', function(e){
    if(e.target.tagName==='BUTTON' || e.target.tagName==='SELECT') return;
    var body = wrap.querySelector('.r-body');
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    arr.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
    _expandedSections['room_'+roomId] = !open;
  });

  var arr = document.createElement('span');
  arr.style.cssText = 'color:#868e96;transition:transform 0.18s;font-size:10px;';
  arr.textContent = '▼';

  var title = document.createElement('span');
  title.style.cssText = 'font-size:12px;font-weight:600;color:#495057;flex:1;';
  title.textContent = 'Комната ' + roomId;

  var infoBtn = mkInfoBtn('room_'+roomId, 'Комната '+roomId, zoneId);
  var dragHandle = mkDragHandle('room', roomId);
  var moveSelect = _isEdit ? mkRoomMoveSelect(zoneId, roomId) : null;
  hdr.appendChild(arr); 
  hdr.appendChild(title);
  if(_isEdit) { hdr.appendChild(dragHandle); hdr.appendChild(moveSelect); }
  hdr.appendChild(infoBtn);
  wrap.appendChild(hdr);

  var body = document.createElement('div');
  body.className = 'r-body';
  body.style.cssText = 'padding:8px 0 10px;display:none;'; // Скрыто по умолчанию
  arr.style.transform = 'rotate(-90deg)';

  (_data.structure.roomPcs[roomId]||[]).forEach(function(pc) {
    body.appendChild(buildPC(zoneId, roomId, pc));
  });
  wrap.appendChild(body);

  if(_isEdit) {
    body.appendChild(buildSpecEditor('room_'+roomId, false));
  }
  return wrap;
}

function buildPC(zoneId, roomId, pcId) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'margin:6px 0 6px 22px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:6px;padding:7px 10px;';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;';
  hdr.addEventListener('click', function(e){
    if(e.target.tagName==='BUTTON' || e.target.tagName==='SELECT') return;
    var body = wrap.querySelector('.p-body');
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    arr.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
  });

  var arr = document.createElement('span');
  arr.style.cssText = 'color:#adb5bd;transition:transform 0.18s;font-size:9px;';
  arr.textContent = '▶';

  var title = document.createElement('span');
  title.style.cssText = 'font-size:11px;font-weight:600;color:#1a1a1a;flex:1;';
  title.textContent = 'ПК ' + pcId;

  var moveSelect = _isEdit ? mkPcMoveSelect(roomId, pcId) : null;

  hdr.appendChild(arr); 
  hdr.appendChild(title);
  if(_isEdit) hdr.appendChild(moveSelect);  wrap.appendChild(hdr);

  var body = document.createElement('div');
  body.className = 'p-body';
  body.style.cssText = 'padding:8px 0 6px;display:none;'; // Скрыто по умолчанию
  arr.style.transform = 'rotate(-90deg)';
  
  var specs = getEffectiveSpecs(zoneId, roomId, pcId);
  var specKeys = Object.keys(specs);
  if(specKeys.length === 0) {
    body.innerHTML = '<div style="font-size:10px;color:#adb5bd;padding:4px 8px;">Нет характеристик</div>';
  } else {
    specKeys.forEach(function(key) {
      var s = specs[key];
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #f1f3f5;font-size:11px;';
      
      var k = document.createElement('span');
      k.style.cssText = 'color:#868e96;min-width:80px;';
      k.textContent = key + ':';
      
      var v = document.createElement('span');
      v.style.cssText = 'color:#495057;flex:1;word-break:break-all;';
      if(s.l) {
        v.innerHTML = '<a href="'+s.l+'" target="_blank" style="color:#228be6;text-decoration:none;border-bottom:1px dashed rgba(34,139,230,0.3);transition:all 0.15s;">'+(s.v||'—')+'</a>';
      } else {
        v.textContent = s.v || '—';
      }

      row.appendChild(k); 
      row.appendChild(v);
      body.appendChild(row);
    });
  }
  wrap.appendChild(body);
  return wrap;
}

/* ═══════════════════════════════════════════════════════
   КОМПОНЕНТЫ UI
   ═══════════════════════════════════════════════════════ */
function mkInfoBtn(specKey, title, parentZoneId) {
  var btn = document.createElement('button');
  btn.title = 'Информация о характеристиках';
  btn.style.cssText = 'background:none;border:none;color:#adb5bd;font-size:15px;cursor:pointer;padding:4px;border-radius:50%;transition:all 0.15s;';
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  btn.addEventListener('mouseenter', function(){btn.style.background='#e9ecef';btn.style.color='#495057';});
  btn.addEventListener('mouseleave', function(){btn.style.background='none';btn.style.color='#adb5bd';});
  btn.addEventListener('click', function(e){
    e.stopPropagation();    showInfoPopup(btn, specKey, title, parentZoneId);
  });
  return btn;
}

function showInfoPopup(anchor, specKey, title, parentZoneId) {
  if(document.getElementById('godji-info-popup')) document.getElementById('godji-info-popup').remove();
  
  var box = document.createElement('div');
  box.id = 'godji-info-popup';
  box.style.cssText = 'position:absolute;z-index:99999;background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;width:300px;max-height:60vh;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.12);font-family:inherit;font-size:11px;color:#1a1a1a;';
  
  var rect = anchor.getBoundingClientRect();
  box.style.top = (rect.bottom + 4) + 'px';
  box.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';

  var h = document.createElement('div');
  h.style.cssText = 'font-weight:700;color:#1a1a1a;margin-bottom:8px;border-bottom:1px solid #f0f0f0;padding-bottom:6px;';
  h.textContent = 'Характеристики: ' + title;
  box.appendChild(h);

  var specs = _data.specs[specKey] || {};
  if(Object.keys(specs).length === 0) {
    box.innerHTML += '<div style="color:#adb5bd;">Не заданы (наследуются от родителя)</div>';
  } else {
    Object.keys(specs).forEach(function(k){
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;color:#495057;';
      r.innerHTML = '<span>'+k+'</span><span style="color:#228be6;">'+(specs[k].v||'—')+'</span>';
      box.appendChild(r);
    });
  }

  if(parentZoneId) {
    var dev = getDeviations(parentZoneId, specKey.split('_')[1]);
    if(dev.room.length > 0) {
      var dDiv = document.createElement('div');
      dDiv.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #f0f0f0;color:#e67700;';
      dDiv.textContent = '⚠ Отклоняется от зоны: ' + dev.room.map(d=>d.key).join(', ');
      box.appendChild(dDiv);
    }
    if(dev.pcs.length > 0) {
      var dDiv2 = document.createElement('div');
      dDiv2.style.cssText = 'color:#e67700;';
      dDiv2.textContent = '⚠ Отклоняющиеся ПК: ' + dev.pcs.join(', ');
      box.appendChild(dDiv2);
    }
  }

  document.body.appendChild(box);  setTimeout(function(){
    var close = function(e){ if(!box.contains(e.target)){box.remove();document.removeEventListener('click',close);} };
    document.addEventListener('click', close);
  }, 10);
}

function mkDragHandle(type, id) {
  var el = document.createElement('div');
  el.setAttribute('draggable', 'true');
  el.style.cssText = 'cursor:grab;background:#f1f3f5;padding:4px 7px;border-radius:4px;font-size:12px;color:#868e96;user-select:none;';
  el.textContent = '☰';
  el.addEventListener('dragstart', function(e){
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.4';
  });
  el.addEventListener('dragend', function(e){ e.target.style.opacity='1'; });
  el.addEventListener('dragover', function(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; this.style.background='#d0ebff'; });
  el.addEventListener('dragleave', function(){ this.style.background='#f1f3f5'; });
  el.addEventListener('drop', function(e){
    e.stopPropagation();
    e.preventDefault();
    this.style.background='#f1f3f5';
    // Упрощенная логика drop для примера, полная реализация требует отслеживания dragData глобально
    // Но для зон/комнат это работает через mkRoomMoveSelect
  });
  return el;
}

function mkRoomMoveSelect(zoneId, roomId) {
  var sel = document.createElement('select');
  sel.style.cssText = 'background:#fff;border:1px solid #ced4da;color:#1a1a1a;border-radius:4px;padding:2px 5px;font-size:10px;';
  sel.addEventListener('mousedown', function(e){e.stopPropagation();});
  sel.addEventListener('change', function(){
    if(this.value !== zoneId) {
      var oldZ = _data.structure.zones.find(z=>z.rooms.includes(roomId));
      var newZ = _data.structure.zones.find(z=>z.id===this.value);
      if(oldZ && newZ) {
        oldZ.rooms = oldZ.rooms.filter(r=>r!==roomId);
        newZ.rooms.push(roomId);
        save(); renderBody();
      }
    }
  });
  _data.structure.zones.forEach(function(z){
    var o = document.createElement('option');
    o.value = z.id; o.textContent = z.name;
    if(z.id===zoneId) o.selected = true;
    sel.appendChild(o);
  });
  return sel;}

function mkPcMoveSelect(roomId, pcId) {
  var sel = document.createElement('select');
  sel.style.cssText = 'background:#fff;border:1px solid #ced4da;color:#1a1a1a;border-radius:4px;padding:2px 5px;font-size:10px;';
  sel.addEventListener('mousedown', function(e){e.stopPropagation();});
  sel.addEventListener('change', function(){
    if(this.value !== roomId) {
      var oldRpcs = _data.structure.roomPcs[roomId];
      var newRpcs = _data.structure.roomPcs[this.value];
      if(oldRpcs && newRpcs) {
        oldRpcs.splice(oldRpcs.indexOf(pcId), 1);
        newRpcs.push(pcId);
        save(); renderBody();
      }
    }
  });
  Object.keys(_data.structure.roomPcs).forEach(function(r){
    var o = document.createElement('option');
    o.value = r; o.textContent = r;
    if(r===roomId) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

/* ═══════════════════════════════════════════════════════
   РЕДАКТОР ХАРАКТЕРИСТИК
   ═══════════════════════════════════════════════════════ */
function buildSpecEditor(key, isZone) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:10px;padding:10px;background:#f8f9fa;border:1px dashed #ced4da;border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:10px;font-weight:700;color:#e03131;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;';
  title.textContent = 'Редактирование характеристик ' + (isZone ? 'зоны' : 'комнаты');
  wrap.appendChild(title);

  var list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
  
  var specs = _data.specs[key] || {};
  Object.keys(specs).forEach(function(k) {
    list.appendChild(mkSpecRow(key, k, specs[k]));
  });

  var addBtn = document.createElement('button');
  addBtn.textContent = '+ Добавить характеристику';
  addBtn.style.cssText = 'margin-top:8px;background:transparent;border:1px solid #ced4da;color:#495057;border-radius:4px;padding:5px 10px;font-size:10px;cursor:pointer;width:100%;transition:background 0.15s;';
  addBtn.addEventListener('mouseenter', function(){addBtn.style.background='#e9ecef';});  addBtn.addEventListener('mouseleave', function(){addBtn.style.background='transparent';});
  addBtn.addEventListener('click', function(){
    var k = prompt('Название характеристики:');
    if(k && k.trim()) {
      if(!_data.specs[key]) _data.specs[key] = {};
      _data.specs[key][k.trim()] = { v: '', l: '' };
      save(); renderBody();
    }
  });

  wrap.appendChild(list);
  wrap.appendChild(addBtn);
  return wrap;
}

function mkSpecRow(key, specKey, data) {
  var row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:5px;align-items:center;';

  var inpV = document.createElement('input');
  inpV.placeholder = 'Значение'; 
  inpV.value = data.v || '';
  inpV.style.cssText = 'background:#fff;border:1px solid #ced4da;color:#1a1a1a;border-radius:4px;padding:5px 7px;font-size:11px;';
  inpV.addEventListener('change', function(){
    _data.specs[key][specKey].v = this.value; 
    save();
  });

  var inpL = document.createElement('input');
  inpL.placeholder = 'Ссылка'; 
  inpL.value = data.l || '';
  inpL.style.cssText = 'background:#fff;border:1px solid #ced4da;color:#868e96;border-radius:4px;padding:5px 7px;font-size:11px;';
  inpL.addEventListener('change', function(){
    _data.specs[key][specKey].l = this.value; 
    save();
  });

  var del = document.createElement('button');
  del.textContent = '×';
  del.style.cssText = 'background:#fa5252;color:#fff;border:none;border-radius:4px;padding:3px 7px;cursor:pointer;font-size:11px;';
  del.addEventListener('click', function(){
    delete _data.specs[key][specKey]; 
    save(); 
    renderBody();
  });

  row.appendChild(inpV); 
  row.appendChild(inpL); 
  row.appendChild(del);
  return row;}

/* ═══════════════════════════════════════════════════════
   РЕГИСТРАЦИЯ В НАСТРОЙКАХ
   ═══════════════════════════════════════════════════════ */
function registerInSettings(){
  if(typeof window.__godjiRegisterSetting !== 'function'){
    setTimeout(registerInSettings, 300);
    return;
  }
  window.__godjiRegisterSetting({
    id: 'godji-pc-specs',
    label: 'Характеристики ПК',
    iconBg: '#cc0001',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>',
    type: 'button',
    onClick: showModal
  });
}

setTimeout(registerInSettings, 500);
})();
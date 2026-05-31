// ==UserScript==
// @name         Годжи — Конфигурация клуба
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Автоматически определяет clubId текущего клуба. Загружается первым, экспортирует window._godjiGetClubId()
// @match        https://godji.cloud/*
// @match        https://*.godji.cloud/*
// @updateURL    https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_club_config.user.js
// @downloadURL  https://raw.githubusercontent.com/Randyluffu/Godji-ERP/main/godji_club_config.user.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ── Ключ кэша и TTL ──────────────────────────────────────────────────────
    var CACHE_KEY = 'godji_club_id_cache';
    var CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней

    // ── Методы определения clubId ─────────────────────────────────────────────

    function fromCookie() {
        var m = document.cookie.match(/(?:^|;\s*)clubId=(\d+)/);
        return m ? parseInt(m[1]) : null;
    }

    function fromURL() {
        var m = window.location.search.match(/[?&]clubId=(\d+)/);
        if (m) return parseInt(m[1]);
        // Также проверяем pathname: /clubs/14/...
        var pm = window.location.pathname.match(/\/clubs\/(\d+)/);
        return pm ? parseInt(pm[1]) : null;
    }

    function fromJWT(token) {
        if (!token) return null;
        try {
            var raw = token.replace(/^Bearer\s+/i, '');
            var payload = JSON.parse(atob(raw.split('.')[1]));
            var claims = payload['https://hasura.io/jwt/claims'] || {};
            var id = claims['x-hasura-club-id']
                  || claims['x-hasura-allowed-club-id']
                  || claims['x-hasura-default-club-id'];
            if (id) return parseInt(id);
        } catch (e) {}
        return null;
    }

    function fromCache() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (Date.now() - obj.ts > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return null; }
            return obj.id;
        } catch (e) { return null; }
    }

    function saveCache(id) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ id: id, ts: Date.now() })); } catch (e) {}
    }

    function fromAPI(token, role) {
        if (!token) return Promise.resolve(null);
        return fetch('https://hasura.godji.cloud/v1/graphql', {
            method: 'POST',
            headers: {
                'authorization': token,
                'content-type': 'application/json',
                'x-hasura-role': role || 'club_admin'
            },
            body: JSON.stringify({ query: 'query{club_users(limit:1){club_id}}' })
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            var rows = d && d.data && d.data.club_users;
            if (rows && rows[0] && rows[0].club_id) return parseInt(rows[0].club_id);
            return null;
        })
        .catch(function () { return null; });
    }

    // ── Основная функция ─────────────────────────────────────────────────────
    var _pending = null;

    function getClubId(authToken, hasuraRole) {
        // 1. Cookie
        var c = fromCookie();
        if (c) { saveCache(c); return Promise.resolve(c); }

        // 2. URL
        var u = fromURL();
        if (u) { saveCache(u); return Promise.resolve(u); }

        // 3. JWT claims
        var j = fromJWT(authToken);
        if (j) { saveCache(j); return Promise.resolve(j); }

        // 4. Кэш localStorage
        var cached = fromCache();
        if (cached) return Promise.resolve(cached);

        // 5. API запрос (дедупликация параллельных вызовов)
        if (_pending) return _pending;
        if (!authToken) return Promise.resolve(14); // ultimate fallback

        _pending = fromAPI(authToken, hasuraRole).then(function (id) {
            _pending = null;
            if (id) { saveCache(id); return id; }
            return 14;
        });
        return _pending;
    }

    // ── Экспорт ───────────────────────────────────────────────────────────────
    window._godjiGetClubId = getClubId;

    // Также инициализируем кэш сразу из cookie/URL если доступно
    (function () {
        var id = fromCookie() || fromURL();
        if (id) saveCache(id);
    })();

    // Перехватываем первый fetch с авторизацией для автообновления кэша
    var _origFetch = window.fetch;
    window.fetch = function (url, opts) {
        if (opts && opts.headers && opts.headers.authorization && !fromCache()) {
            getClubId(opts.headers.authorization, opts.headers['x-hasura-role']);
        }
        return _origFetch.apply(this, arguments);
    };

})();

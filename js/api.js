/* =====================================================================
   API wrapper около fetch. Прикача JWT токена, обработва JSON и грешки.
   Backend-ът връща грешки във вид { "error": "..." } (виж middleware-а).
   ===================================================================== */
window.API = (function () {
    const BASE = window.BH_CONFIG.API_BASE;

    function token() { return localStorage.getItem('bh_token'); }

    async function request(method, path, body) {
        const headers = {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const t = token();
        if (t) headers['Authorization'] = 'Bearer ' + t;

        // Таймаут: ако сървърът "спи" (студен старт), не висим безкрайно.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);

        let res;
        try {
            res = await fetch(BASE + path, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: ctrl.signal
            });
        } catch (netErr) {
            throw new Error(netErr && netErr.name === 'AbortError'
                ? 'Сървърът се събужда — опитай отново след няколко секунди.'
                : 'Няма връзка със сървъра. Провери дали API-то е стартирано.');
        } finally {
            clearTimeout(timer);
        }

        // 204 No Content
        if (res.status === 204) return null;

        const text = await res.text();
        let data = null;
        if (text) { try { data = JSON.parse(text); } catch { data = text; } }

        if (!res.ok) {
            // Изтекла/невалидна сесия при вече влязъл потребител -> автоматичен
            // изход и пренасочване към вход (с връщане към текущата страница).
            if (res.status === 401 && t) {
                try { if (window.Session) window.Session.clear(); } catch (e) {}
                const here = (location.pathname.split('/').pop() || 'index.html');
                if (!/auth\.html/.test(location.pathname))
                    location.href = 'auth.html?next=' + encodeURIComponent(here) + '&expired=1';
                throw new Error('Сесията изтече. Влез отново.');
            }
            const msg = (data && data.error) ? data.error : ('Грешка (' + res.status + ')');
            const err = new Error(msg);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    // ---- Кеш за публичните списъци (услуги/екип/отзиви) ----
    // Първото зареждане пита сървъра; после страниците се отварят мигновено
    // от кеша, а данните се опресняват тихо на заден план.
    const CACHEABLE = p => /^\/(services$|employees$|employees\/\d+\/services$|reviews(\?.*)?$)/.test(p);
    const CKEY = p => 'bh_cache:' + p;
    const TTL = 10 * 60 * 1000; // 10 минути
    function readCache(p) {
        try {
            const raw = sessionStorage.getItem(CKEY(p));
            if (!raw) return null;
            const o = JSON.parse(raw);
            return (Date.now() - o.t > TTL) ? null : o.d;
        } catch { return null; }
    }
    function writeCache(p, d) {
        try { sessionStorage.setItem(CKEY(p), JSON.stringify({ t: Date.now(), d })); } catch (e) { }
    }

    function cachedGet(p) {
        if (!CACHEABLE(p)) return request('GET', p);
        const c = readCache(p);
        if (c !== null) {
            // тихо опресняване на заден план
            request('GET', p).then(d => writeCache(p, d)).catch(() => { });
            return Promise.resolve(c);
        }
        return request('GET', p).then(d => { writeCache(p, d); return d; });
    }

    return {
        get:   (p)    => cachedGet(p),
        post:  (p, b) => request('POST', p, b ?? {}),
        put:   (p, b) => request('PUT', p, b ?? {}),
        patch: (p, b) => request('PATCH', p, b ?? {}),
        del:   (p)    => request('DELETE', p)
    };
})();

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

        let res;
        try {
            res = await fetch(BASE + path, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
        } catch (netErr) {
            throw new Error('Няма връзка със сървъра. Провери дали API-то е стартирано.');
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

    return {
        get:   (p)    => request('GET', p),
        post:  (p, b) => request('POST', p, b ?? {}),
        put:   (p, b) => request('PUT', p, b ?? {}),
        patch: (p, b) => request('PATCH', p, b ?? {}),
        del:   (p)    => request('DELETE', p)
    };
})();

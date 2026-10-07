/* =====================================================================
   Сесия: пази JWT + роля в localStorage и обновява навигацията.
   ===================================================================== */
window.Session = (function () {
    const K = { token: 'bh_token', role: 'bh_role', name: 'bh_name', id: 'bh_id' };

    function save(auth) {
        localStorage.setItem(K.token, auth.token);
        localStorage.setItem(K.role, auth.role);
        localStorage.setItem(K.name, auth.fullName || '');
        localStorage.setItem(K.id, auth.userId);
    }
    function clear() { Object.values(K).forEach(k => localStorage.removeItem(k)); }

    // Кога изтича токенът (JWT „exp", в ms) — четем го направо от токена.
    function expOf(t) {
        try {
            const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            return p.exp ? p.exp * 1000 : 0;
        } catch (e) { return 0; }
    }
    const expired = t => { const x = expOf(t); return !!x && x <= Date.now() + 15000; };
    // Други полета от токена (sub = id на потребителя, iat = кога е издаден).
    function claimsOf(t) {
        try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) || {}; }
        catch (e) { return {}; }
    }
    const subOf = t => (t ? String(claimsOf(t).sub || '') : '');

    // Изтекла сесия при отваряне на страницата -> чистим я веднага, за да не
    // изглеждаш „влязъл", а после да ти гърми при първото действие.
    (function dropIfExpired() {
        const t = localStorage.getItem(K.token);
        if (t && expired(t)) {
            clear();
            try { sessionStorage.setItem('bh_expired', '1'); } catch (e) {}
        }
    })();

    // Страници, които изискват вход -> при изтичане отиваме направо на вход.
    const PROTECTED = /\/(account|profile)(\.html)?$/;
    const hereUrl = () => (location.pathname.split('/').pop() || 'index.html') + location.search;

    // Преди пренасочване към вход страницата може да си запази състоянието
    // (напр. избрания час) — регистрира се с Session.beforeLogin(fn).
    const beforeLoginHooks = [];
    function goLogin(opts = {}) {
        if (/\/auth(\.html)?$/.test(location.pathname)) return;
        beforeLoginHooks.forEach(fn => { try { fn(); } catch (e) {} });
        const q = 'next=' + encodeURIComponent(opts.next || hereUrl()) + (opts.expired ? '&expired=1' : '');
        location.href = 'auth.html?' + q;
    }

    // Токенът, с който е заредена ТАЗИ страница. Ако в друг таб някой излезе
    // или влезе с друг профил, страницата се презарежда -> няма заявки с чужд
    // токен (оттам идваше 403 при отмяна на час).
    let pageToken = localStorage.getItem(K.token);
    // Подновен токен на СЪЩИЯ потребител (тихото подновяване на персонала)
    // не е „смяна на профила" -> приемаме го без презареждане.
    function adoptIfSameUser() {
        const t = localStorage.getItem(K.token);
        if (t && pageToken && t !== pageToken && subOf(t) === subOf(pageToken)) pageToken = t;
    }
    const changed = () => { adoptIfSameUser(); return localStorage.getItem(K.token) !== pageToken; };
    function syncIfChanged() { if (changed()) location.reload(); }
    window.addEventListener('storage', e => {
        if (e.key === K.token || e.key === null) syncIfChanged();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncIfChanged();
    });
    window.addEventListener('pageshow', e => { if (e.persisted) syncIfChanged(); });

    // Сесията изтича, докато страницата е отворена -> излизаме навреме:
    // на защитена страница пренасочваме към вход, иначе само обновяваме менюто.
    function onExpire() {
        clear(); pageToken = null;
        try { sessionStorage.setItem('bh_expired', '1'); } catch (e) {}
        if (PROTECTED.test(location.pathname)) goLogin({ expired: true });
        else if (typeof renderAuthNav === 'function') renderAuthNav();
    }
    function armExpiry() {
        const t = localStorage.getItem(K.token);
        const x = t ? expOf(t) : 0;
        if (!x) return;
        // setTimeout не приема > ~24 дни; проверяваме пак при връщане към таба.
        const ms = Math.min(x - Date.now() - 15000, 2 ** 31 - 1);
        if (ms <= 0) onExpire(); else setTimeout(armExpiry, ms);
    }
    armExpiry();
    document.addEventListener('visibilitychange', () => {
        const t = localStorage.getItem(K.token);
        if (document.visibilityState === 'visible' && t && expired(t)) onExpire();
    });

    // ---- Дълга сесия за персонала ----
    // Токенът на служител/шеф е валиден 60 дни; при всяко отваряне на сайта
    // (най-много веднъж на 12 ч) го подновяваме тихо. Така момичетата не
    // излизат от админ панела на телефона, докато го ползват поне веднъж на 2 месеца.
    const STAFF = /^(employee|boss)$/;
    const RENEW_AFTER_MS = 12 * 60 * 60 * 1000;
    let renewing = false;
    async function renewStaffToken() {
        const t = localStorage.getItem(K.token);
        if (renewing || !t || expired(t) || !STAFF.test(localStorage.getItem(K.role) || '')) return;
        const iat = (claimsOf(t).iat || 0) * 1000;
        if (iat && Date.now() - iat < RENEW_AFTER_MS) return;
        const base = window.BH_CONFIG && window.BH_CONFIG.API_BASE;
        if (!base) return;
        renewing = true;
        try {
            const res = await fetch(base + '/me/refresh-token', { method: 'POST', headers: { 'Authorization': 'Bearer ' + t } });
            if (res.ok) {
                const auth = await res.json();
                // Само ако междувременно никой не е излязъл/влязъл с друг профил.
                if (auth && auth.token && localStorage.getItem(K.token) === t) {
                    save(auth); pageToken = auth.token;
                }
            }
            // 401/403 (деактивиран профил) -> не пипаме нищо; старият токен
            // си изтича сам, а заявките към API-то ще пратят към вход.
        } catch (e) { /* няма мрежа -> пробваме при следващото отваряне */ }
        finally { renewing = false; }
    }
    renewStaffToken();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') renewStaffToken();
    });

    return {
        save:  (auth) => { save(auth); pageToken = auth.token; },
        clear: () => { clear(); pageToken = null; },
        changed,
        isIn:  () => { const t = localStorage.getItem(K.token); return !!t && !expired(t); },
        // Към вход и обратно тук след това: Session.goLogin({ expired, next }).
        goLogin,
        beforeLogin: (fn) => beforeLoginHooks.push(fn),
        // „Сесията изтече" — показва се веднъж на страницата за вход.
        takeExpiredFlag: () => { try { const v = sessionStorage.getItem('bh_expired'); sessionStorage.removeItem('bh_expired'); return !!v; } catch (e) { return false; } },
        role:  () => localStorage.getItem(K.role) || '',
        name:  () => localStorage.getItem(K.name) || '',
        userId: () => parseInt(localStorage.getItem(K.id), 10) || 0,
        logout: () => { clear(); location.href = 'index.html'; }
    };
})();

/* Прозорче за потвърждение в стила на сайта. Връща Promise<boolean>. */
function confirmBox({ title, text, ok = 'Да', cancel = 'Отказ' }) {
    return new Promise(resolve => {
        const safe = window.esc || (x => x);
        const wrap = document.createElement('div');
        wrap.className = 'bh-confirm';
        wrap.innerHTML = `
            <div class="bh-confirm__box" role="dialog" aria-modal="true" aria-labelledby="bh-confirm-t">
                <h3 id="bh-confirm-t" class="bh-confirm__title">${safe(title)}</h3>
                <p class="bh-confirm__text">${safe(text)}</p>
                <div class="bh-confirm__actions">
                    <button type="button" class="btn btn--ghost" data-a="0">${safe(cancel)}</button>
                    <button type="button" class="btn btn--primary" data-a="1">${safe(ok)}</button>
                </div>
            </div>`;
        const prevFocus = document.activeElement;
        function close(v) {
            document.removeEventListener('keydown', onKey);
            wrap.remove();
            if (prevFocus && prevFocus.focus) prevFocus.focus();
            resolve(v);
        }
        function onKey(e) { if (e.key === 'Escape') close(false); }
        wrap.addEventListener('click', e => {
            if (e.target === wrap) return close(false);          // клик извън прозорчето
            const b = e.target.closest('[data-a]');
            if (b) close(b.dataset.a === '1');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(wrap);
        wrap.querySelector('[data-a="0"]').focus();
    });
}
window.confirmBox = confirmBox;

/* Обновява дясната част на навигацията според това дали има вход. */
function renderAuthNav() {
    const box = document.getElementById('nav-auth');
    if (!box) return;

    if (Session.isIn()) {
        const safe = window.esc || (s => s);
        const first = safe((Session.name() || 'Профил').split(' ')[0]);
        // Бутон според ролята: клиент → часовете си, служител → графика, шеф → таблото.
        const role = Session.role();
        const profileLabel = role === 'boss' ? 'Табло'
            : (role === 'employee' ? 'Моят график' : 'Моите часове');
        const initial = safe(first.charAt(0).toUpperCase());
        // Допълнителните страници (График / Моят акаунт) НЕ пълнят основното меню —
        // на компютър са в падащо меню под профилния чип, на телефон — в менюто ☰.
        const page = location.pathname.split('/').pop() || 'index.html';
        const q = location.search;
        const extra = [{ href: 'account.html', label: profileLabel, icon: 'M4 20h16M7 16.5v-5M12 16.5V6.5M17 16.5v-7.5', on: page === 'account.html' && !/tab=calendar/.test(q) }];
        if (role === 'employee' || role === 'boss')
            extra.push({ href: role === 'boss' ? 'account.html?tab=calendar' : 'account.html', label: 'График', icon: 'M3.5 9.5h17M8 3v4M16 3v4M5.5 5h13a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', on: /tab=calendar/.test(q), dup: role === 'employee' });
        extra.push({ href: 'profile.html', label: 'Моят акаунт', icon: 'M12 11.8a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM4.5 20c1.4-3.6 4.3-5.4 7.5-5.4s6.1 1.8 7.5 5.4', on: page === 'profile.html' });
        const svg = d => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

        box.innerHTML = `
            <div class="nav__acct">
                <a class="nav__profile" href="account.html" title="${profileLabel}" aria-haspopup="menu" aria-expanded="false">
                    <span class="nav__profile__av">${initial}</span>
                    <span class="nav__profile__text">
                        <span class="nav__profile__name">${first}</span>
                        <span class="nav__profile__label">${profileLabel}</span>
                    </span>
                    <svg class="nav__profile__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </a>
                <div class="nav__menu" role="menu">
                    ${extra.filter(x => !x.dup).map(x => `<a role="menuitem" class="nav__menu-item${x.on ? ' is-on' : ''}" href="${x.href}">${svg(x.icon)}<span>${x.label}</span></a>`).join('')}
                    <span class="nav__menu-sep"></span>
                    <button type="button" role="menuitem" class="nav__menu-item nav__menu-item--out" data-logout>${svg('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')}<span>Изход</span></button>
                </div>
            </div>
            <button type="button" class="nav__logout" data-logout title="Изход" aria-label="Изход">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <path d="M16 17l5-5-5-5"/>
                    <path d="M21 12H9"/>
                </svg>
            </button>`;

        box.querySelectorAll('[data-logout]').forEach(lb => lb.addEventListener('click', async (e) => {
            e.preventDefault();
            closeMenu();
            const ok = await confirmBox({
                title: 'Изход от профила',
                text: 'Сигурен ли си, че искаш да излезеш?',
                ok: 'Изход', cancel: 'Отказ'
            });
            if (ok) Session.logout();
        }));

        // Падащо меню (само на компютър/таблет; на телефон чипът води направо към профила).
        const acct = box.querySelector('.nav__acct');
        const chip = acct.querySelector('.nav__profile');
        const desktop = () => window.matchMedia('(min-width: 721px)').matches;
        function closeMenu() { acct.classList.remove('is-open'); chip.setAttribute('aria-expanded', 'false'); }
        chip.addEventListener('click', (e) => {
            if (!desktop()) return;
            e.preventDefault();
            const open = !acct.classList.contains('is-open');
            acct.classList.toggle('is-open', open);
            chip.setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', (e) => { if (!acct.contains(e.target)) closeMenu(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

        // Телефон: същите връзки в менюто ☰ (на компютър са скрити с CSS).
        const links = document.getElementById('nav-links');
        if (links && !links.querySelector('.nav__link--acct')) {
            extra.slice(1).forEach(x => {
                const a = document.createElement('a');
                a.className = 'nav__link nav__link--acct' + (x.on ? ' active' : '');
                a.href = x.href;
                a.textContent = x.label;
                links.appendChild(a);
            });
        }
    } else {
        box.innerHTML = `
            <a class="nav__link" href="auth.html">Вход</a>
            <a class="btn btn--primary" href="booking.html">Запази час</a>`;
    }
}
document.addEventListener('DOMContentLoaded', renderAuthNav);

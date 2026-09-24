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

    return {
        save, clear,
        isIn:  () => !!localStorage.getItem(K.token),
        role:  () => localStorage.getItem(K.role) || '',
        name:  () => localStorage.getItem(K.name) || '',
        userId: () => parseInt(localStorage.getItem(K.id), 10) || 0,
        logout: () => { clear(); location.href = 'index.html'; }
    };
})();

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
        box.innerHTML = `
            <a class="nav__profile" href="account.html" title="${profileLabel}">
                <span class="nav__profile__av">${initial}</span>
                <span class="nav__profile__text">
                    <span class="nav__profile__name">${first}</span>
                    <span class="nav__profile__label">${profileLabel}</span>
                </span>
            </a>
            <button type="button" class="nav__logout" id="logout-btn" title="Изход" aria-label="Изход">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <path d="M16 17l5-5-5-5"/>
                    <path d="M21 12H9"/>
                </svg>
            </button>`;
        const lb = document.getElementById('logout-btn');
        if (lb) lb.addEventListener('click', (e) => { e.preventDefault(); Session.logout(); });

        // „График" в основното меню — само за екипа (служител/шеф).
        // Клиенти и гости не го виждат. Шефът отива директно на раздел „График".
        if (role === 'employee' || role === 'boss') {
            const links = document.getElementById('nav-links');
            if (links && !links.querySelector('.nav__link--schedule')) {
                const a = document.createElement('a');
                a.className = 'nav__link nav__link--schedule';
                a.href = role === 'boss' ? 'account.html?tab=calendar' : 'account.html';
                a.textContent = 'График';
                links.appendChild(a);
            }
        }
        // „Моят акаунт" (име/имейл/парола) — отделна страница, в менюто за всички роли.
        const links = document.getElementById('nav-links');
        if (links && !links.querySelector('.nav__link--profile')) {
            const a = document.createElement('a');
            a.className = 'nav__link nav__link--profile';
            a.href = 'profile.html';
            a.textContent = 'Моят акаунт';
            if (location.pathname.endsWith('/profile.html')) a.classList.add('active');
            links.appendChild(a);
        }
    } else {
        box.innerHTML = `
            <a class="nav__link" href="auth.html">Вход</a>
            <a class="btn btn--primary" href="booking.html">Запази час</a>`;
    }
}
document.addEventListener('DOMContentLoaded', renderAuthNav);

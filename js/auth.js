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
        box.innerHTML = `
            <span class="nav__auth-hi" style="color:var(--muted);font-weight:500;white-space:nowrap">Здравей, ${first}</span>
            <a class="btn btn--primary" href="account.html" style="--pad-y:.5rem;--pad-x:1.1rem;font-size:.9rem;white-space:nowrap">${profileLabel}</a>
            <a href="#" class="nav__link" id="logout-btn" style="white-space:nowrap">Изход</a>`;
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
    } else {
        box.innerHTML = `
            <a class="nav__link" href="auth.html">Вход</a>
            <a class="btn btn--primary" href="booking.html">Запази час</a>`;
    }
}
document.addEventListener('DOMContentLoaded', renderAuthNav);

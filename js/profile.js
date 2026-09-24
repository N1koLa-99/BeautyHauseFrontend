/* =====================================================================
   Моят акаунт — редакция на име/имейл/парола (за всички роли).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    if (!Session.isIn()) { location.href = 'auth.html?next=' + encodeURIComponent('profile.html'); return; }

    const accForm = document.getElementById('acc-form');
    const pwdForm = document.getElementById('pwd-form');
    if (!accForm || !pwdForm) return;

    try {
        const me = await API.get('/me/account');
        accForm.querySelector('#acc-name').value = me.fullName || '';
        accForm.querySelector('#acc-email').value = me.email || '';
    } catch (e) {}

    accForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = accForm.querySelector('.acc-msg');
        const btn = accForm.querySelector('button[type="submit"]');
        msg.innerHTML = '';
        btn.disabled = true; btn.style.opacity = .7;
        try {
            const auth = await API.put('/me/account', {
                fullName: accForm.querySelector('#acc-name').value.trim(),
                email: accForm.querySelector('#acc-email').value.trim()
            });
            Session.save(auth); // нов токен + обновено име в localStorage
            renderAuthNav();    // обнови чипа в навигацията веднага
            msg.innerHTML = `<div class="alert alert--ok">Записано ✓</div>`;
        } catch (err) {
            msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        } finally {
            btn.disabled = false; btn.style.opacity = 1;
        }
    });

    pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = pwdForm.querySelector('.pwd-msg');
        const btn = pwdForm.querySelector('button[type="submit"]');
        const cur = pwdForm.querySelector('#pwd-current');
        const nw = pwdForm.querySelector('#pwd-new');
        msg.innerHTML = '';
        btn.disabled = true; btn.style.opacity = .7;
        try {
            await API.put('/me/password', { currentPassword: cur.value, newPassword: nw.value });
            msg.innerHTML = `<div class="alert alert--ok">Паролата е сменена ✓</div>`;
            cur.value = ''; nw.value = '';
        } catch (err) {
            msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        } finally {
            btn.disabled = false; btn.style.opacity = 1;
        }
    });
});

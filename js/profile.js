/* =====================================================================
   Моят акаунт — преглед на име/имейл/парола (за всички роли).
   Данните се показват като текст; моливчето отваря полетата за редакция.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    if (!Session.isIn()) { location.href = 'auth.html?next=' + encodeURIComponent('profile.html'); return; }

    const accForm = document.getElementById('acc-form');
    const pwdForm = document.getElementById('pwd-form');
    if (!accForm || !pwdForm) return;

    const nameIn = accForm.querySelector('#acc-name');
    const emailIn = accForm.querySelector('#acc-email');
    const accMsg = document.querySelector('.acc-msg');
    const pwdMsg = document.querySelector('.pwd-msg');
    let me = { fullName: '', email: '' };

    function paintView() {
        document.getElementById('acc-v-name').textContent = me.fullName || '—';
        document.getElementById('acc-v-email').textContent = me.email || '—';
    }

    // Преглед <-> редакция за един раздел (лични данни / парола).
    function editable(form, view, editBtn, msg, onOpen) {
        const set = (on) => {
            form.hidden = !on; view.hidden = on; editBtn.hidden = on;
            if (on) { msg.innerHTML = ''; if (onOpen) onOpen(); form.querySelector('input').focus(); }
            else editBtn.focus({ preventScroll: true });
        };
        editBtn.addEventListener('click', () => set(true));
        form.querySelector('.acc-cancel').addEventListener('click', () => { if (form === pwdForm) form.reset(); set(false); });
        form.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
        return set;
    }
    const setAcc = editable(accForm, document.getElementById('acc-view'), document.getElementById('acc-edit'), accMsg,
        () => { nameIn.value = me.fullName || ''; emailIn.value = me.email || ''; });
    const setPwd = editable(pwdForm, document.getElementById('pwd-view'), document.getElementById('pwd-edit'), pwdMsg,
        () => { pwdForm.reset(); });

    try {
        const data = await API.get('/me/account');
        me = { fullName: data.fullName || '', email: data.email || '' };
    } catch (e) {}
    paintView();

    accForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = accForm.querySelector('button[type="submit"]');
        accMsg.innerHTML = '';
        btn.disabled = true; btn.style.opacity = .7;
        try {
            const next = { fullName: nameIn.value.trim(), email: emailIn.value.trim() };
            const auth = await API.put('/me/account', next);
            Session.save(auth); // нов токен + обновено име в localStorage
            renderAuthNav();    // обнови чипа в навигацията веднага
            me = next; paintView();
            setAcc(false);
            accMsg.innerHTML = `<div class="alert alert--ok">Записано ✓</div>`;
        } catch (err) {
            accMsg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        } finally {
            btn.disabled = false; btn.style.opacity = 1;
        }
    });

    pwdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = pwdForm.querySelector('button[type="submit"]');
        const cur = pwdForm.querySelector('#pwd-current');
        const nw = pwdForm.querySelector('#pwd-new');
        pwdMsg.innerHTML = '';
        btn.disabled = true; btn.style.opacity = .7;
        try {
            await API.put('/me/password', { currentPassword: cur.value, newPassword: nw.value });
            pwdForm.reset();
            setPwd(false);
            pwdMsg.innerHTML = `<div class="alert alert--ok">Паролата е сменена ✓</div>`;
        } catch (err) {
            pwdMsg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        } finally {
            btn.disabled = false; btn.style.opacity = 1;
        }
    });
});

/* =====================================================================
   Страница Вход/Регистрация: табове + заявки към API-то.
   След успех: пази сесията и връща потребителя където е тръгнал
   (?next=booking.html) или към "Моите часове".
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Връщане само към страница от сайта (не към чужд адрес през ?next=).
    const safeNext = v => (v && /^[\w-]+(\.html)?(\?[^#]*)?$/.test(v)) ? v : 'account.html';
    // Ако вече е влязъл, няма смисъл да е тук -> направо където е тръгнал.
    if (Session.isIn()) { location.href = safeNext(new URLSearchParams(location.search).get('next')); return; }

    const tabs   = document.getElementById('auth-tabs');
    const thumb  = document.getElementById('tabs-thumb');
    const title  = document.getElementById('auth-title');
    const loginF = document.getElementById('login-form');
    const regF   = document.getElementById('register-form');
    const verifyF = document.getElementById('verify-form');
    const forgotF = document.getElementById('forgot-form');
    const resetF  = document.getElementById('reset-form');
    const note   = document.getElementById('auth-note');
    const params = new URLSearchParams(location.search);
    const next   = safeNext(params.get('next'));
    let pendingEmail = null; // имейл, който чака потвърждение

    // --- Позициониране на плъзгача под активния таб ---
    function moveThumb(btn) {
        thumb.style.width = btn.offsetWidth + 'px';
        thumb.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
    }
    function activate(name) {
        tabs.style.display = '';
        verifyF.hidden = true;
        forgotF.hidden = true;
        resetF.hidden = true;
        tabs.querySelectorAll('.tab').forEach(b => {
            const on = b.dataset.tab === name;
            b.classList.toggle('active', on);
            if (on) moveThumb(b);
        });
        const isLogin = name === 'login';
        loginF.hidden = !isLogin;
        regF.hidden = isLogin;
        title.textContent = isLogin ? 'Влез в профила си' : 'Създай своя профил';
        note.innerHTML = '';
    }

    function renderVerifyStep() {
        const info = document.getElementById('verify-info');
        const label = document.getElementById('verify-label');
        const btn = document.getElementById('verify-btn');
        const input = document.getElementById('verify-code');
        input.value = '';
        info.textContent = 'Изпратихме код на имейла ти. Въведи го, за да завършиш регистрацията.';
        label.textContent = 'Код от имейла';
        btn.textContent = 'Потвърди имейла';
        input.focus();
    }

    // Показва стъпката за потвърждение (крие табовете и другите форми).
    function showVerify(email) {
        pendingEmail = email;
        tabs.style.display = 'none';
        loginF.hidden = true;
        regF.hidden = true;
        verifyF.hidden = false;
        title.textContent = 'Потвърди профила си';
        renderVerifyStep();
    }
    tabs.querySelectorAll('.tab').forEach(b =>
        b.addEventListener('click', () => activate(b.dataset.tab)));
    // Начална позиция (изчакваме шрифтовете/оформлението).
    requestAnimationFrame(() => moveThumb(tabs.querySelector('.tab.active')));
    window.addEventListener('resize', () => moveThumb(tabs.querySelector('.tab.active')));

    // Ако линкът е ?tab=register
    if (params.get('tab') === 'register') activate('register');

    // Ако сесията е изтекла и потребителят е върнат тук.
    if (Session.takeExpiredFlag() || params.get('expired')) note.innerHTML = `<div class="alert alert--info">Сесията изтече. Влез отново, за да продължиш.</div>`;

    // --- Помощник за бутон "зареждане" ---
    function busy(form, on) {
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = on;
        btn.style.opacity = on ? .7 : 1;
    }
    const showErr = (m) => note.innerHTML = `<div class="alert alert--err">${esc(m)}</div>`;

    // --- Вход ---
    loginF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(loginF, true);
        try {
            const fd = new FormData(loginF);
            const email = fd.get('email');
            const auth = await API.post('/auth/login', { email, password: fd.get('password') });
            Session.save(auth);
            location.href = next;
        } catch (err) {
            // Непотвърден профил -> праща нови кодове и показва потвърждението.
            if (err.status === 403 && /потвърд/i.test(err.message || '')) {
                const email = new FormData(loginF).get('email');
                try { await API.post('/auth/resend', { email }); } catch (e) {}
                showVerify(email);
                note.innerHTML = `<div class="alert alert--info">Профилът не е потвърден. Изпратихме ти нови кодове — въведи ги по-долу.</div>`;
                busy(loginF, false);
                return;
            }
            showErr(err.message);
            busy(loginF, false);
        }
    });

    // --- Регистрация ---
    regF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(regF, true);
        try {
            const fd = new FormData(regF);
            const email = fd.get('email');
            if (!fd.get('termsAccepted')) {
                showErr('Трябва да приемеш Общите условия и Политиката за поверителност.');
                busy(regF, false);
                return;
            }
            await API.post('/auth/register', {
                fullName: fd.get('fullName'),
                email,
                phone: fd.get('phone'),
                password: fd.get('password'),
                termsAccepted: true
            });
            showVerify(email);
            note.innerHTML = `<div class="alert alert--ok">Профилът е създаден! Потвърди имейла си с изпратения код, за да влезеш.</div>`;
        } catch (err) {
            showErr(err.message);
        }
        busy(regF, false);
    });

    // --- Потвърждение на имейла -> директен вход ---
    verifyF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(verifyF, true);
        const code = (document.getElementById('verify-code').value || '').trim();
        try {
            const auth = await API.post('/auth/verify-email', { email: pendingEmail, code });
            Session.save(auth);
            location.href = next;
        } catch (err) {
            showErr(err.message);
            busy(verifyF, false);
        }
    });

    // --- Изпрати кода отново ---
    document.getElementById('resend-link').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!pendingEmail) return;
        try {
            await API.post('/auth/resend', { email: pendingEmail });
            note.innerHTML = `<div class="alert alert--ok">Изпратихме нов код.</div>`;
        } catch (err) { showErr(err.message); }
    });

    // --- Забравена парола ---
    let forgotEmail = null;

    function showForgot() {
        tabs.style.display = 'none';
        loginF.hidden = true; regF.hidden = true; verifyF.hidden = true;
        resetF.hidden = true; forgotF.hidden = false;
        title.textContent = 'Забравена парола';
        note.innerHTML = '';
        document.getElementById('forgot-email').focus();
    }
    function showReset() {
        tabs.style.display = 'none';
        loginF.hidden = true; regF.hidden = true; verifyF.hidden = true;
        forgotF.hidden = true; resetF.hidden = false;
        title.textContent = 'Нова парола';
        document.getElementById('reset-code').value = '';
        document.getElementById('reset-password').value = '';
        document.getElementById('reset-code').focus();
    }

    document.getElementById('forgot-link').addEventListener('click', (e) => {
        e.preventDefault();
        showForgot();
    });
    document.getElementById('forgot-back-link').addEventListener('click', (e) => {
        e.preventDefault();
        activate('login');
    });

    forgotF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(forgotF, true);
        forgotEmail = (document.getElementById('forgot-email').value || '').trim();
        try {
            await API.post('/auth/forgot-password', { email: forgotEmail });
            showReset();
            note.innerHTML = `<div class="alert alert--ok">Ако имейлът съществува, изпратихме код за нова парола.</div>`;
        } catch (err) {
            showErr(err.message);
        }
        busy(forgotF, false);
    });

    resetF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(resetF, true);
        const code = (document.getElementById('reset-code').value || '').trim();
        const newPassword = document.getElementById('reset-password').value || '';
        try {
            await API.post('/auth/reset-password', { email: forgotEmail, code, newPassword });
            activate('login');
            note.innerHTML = `<div class="alert alert--ok">Паролата е сменена. Влез с новата парола.</div>`;
        } catch (err) {
            showErr(err.message);
        }
        busy(resetF, false);
    });

    document.getElementById('resend-reset-link').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!forgotEmail) return;
        try {
            await API.post('/auth/forgot-password', { email: forgotEmail });
            note.innerHTML = `<div class="alert alert--ok">Изпратихме нов код.</div>`;
        } catch (err) { showErr(err.message); }
    });
});

/* =====================================================================
   Страница Вход/Регистрация: табове + заявки към API-то.
   След успех: пази сесията и връща потребителя където е тръгнал
   (?next=booking.html) или към "Моите часове".
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // Ако вече е влязъл, няма смисъл да е тук.
    if (Session.isIn()) { location.href = 'account.html'; return; }

    const tabs   = document.getElementById('auth-tabs');
    const thumb  = document.getElementById('tabs-thumb');
    const title  = document.getElementById('auth-title');
    const loginF = document.getElementById('login-form');
    const regF   = document.getElementById('register-form');
    const verifyF = document.getElementById('verify-form');
    const note   = document.getElementById('auth-note');
    const params = new URLSearchParams(location.search);
    const next   = params.get('next') || 'account.html';
    let pendingEmail = null; // имейл, който чака потвърждение

    // --- Позициониране на плъзгача под активния таб ---
    function moveThumb(btn) {
        thumb.style.width = btn.offsetWidth + 'px';
        thumb.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
    }
    function activate(name) {
        tabs.style.display = '';
        verifyF.hidden = true;
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

    let verifyStep = 'email'; // 'email' -> после 'phone'

    function renderVerifyStep() {
        const info = document.getElementById('verify-info');
        const label = document.getElementById('verify-label');
        const btn = document.getElementById('verify-btn');
        const input = document.getElementById('verify-code');
        const s1 = document.getElementById('vstep-1');
        const s2 = document.getElementById('vstep-2');
        input.value = '';
        if (verifyStep === 'email') {
            info.textContent = 'Изпратихме код на имейла ти. Въведи го, за да продължиш.';
            label.textContent = 'Код от имейла';
            btn.textContent = 'Потвърди имейла';
            s1.style.opacity = 1; s2.style.opacity = .5;
        } else {
            info.textContent = 'Имейлът е потвърден ✓. Сега въведи кода, който ти изпратихме по SMS.';
            label.textContent = 'Код по SMS';
            btn.textContent = 'Потвърди телефона';
            s1.style.opacity = .5; s2.style.opacity = 1;
        }
        input.focus();
    }

    // Показва стъпката за потвърждение (крие табовете и другите форми).
    function showVerify(email, step) {
        pendingEmail = email;
        verifyStep = step || 'email';
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
    if (params.get('expired')) note.innerHTML = `<div class="alert alert--info">Сесията изтече. Влез отново, за да продължиш.</div>`;

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
            await API.post('/auth/register', {
                fullName: fd.get('fullName'),
                email,
                phone: fd.get('phone'),
                password: fd.get('password')
            });
            showVerify(email);
            note.innerHTML = `<div class="alert alert--ok">Профилът е създаден! Първо потвърди имейла си с изпратения код.</div>`;
        } catch (err) {
            showErr(err.message);
        }
        busy(regF, false);
    });

    // --- Потвърждение на две стъпки: първо имейл, после телефон ---
    verifyF.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy(verifyF, true);
        const code = (document.getElementById('verify-code').value || '').trim();
        try {
            if (verifyStep === 'email') {
                await API.post('/auth/verify-email', { email: pendingEmail, code });
                verifyStep = 'phone';
                renderVerifyStep();
                note.innerHTML = `<div class="alert alert--ok">Имейлът е потвърден. Сега потвърди телефона.</div>`;
                busy(verifyF, false);
            } else {
                const auth = await API.post('/auth/verify-phone', { email: pendingEmail, code });
                Session.save(auth);
                location.href = next;
            }
        } catch (err) {
            showErr(err.message);
            busy(verifyF, false);
        }
    });

    // --- Изпрати кода отново (праща наново и двата) ---
    document.getElementById('resend-link').addEventListener('click', async (e) => {
        e.preventDefault();
        if (!pendingEmail) return;
        try {
            await API.post('/auth/resend', { email: pendingEmail });
            note.innerHTML = `<div class="alert alert--ok">Изпратихме нов код.</div>`;
        } catch (err) { showErr(err.message); }
    });
});

/* =====================================================================
   Споделено UI поведение: навигация (scroll + мобилно меню),
   активен линк, scroll-reveal анимации, попълване на контакти/година.
   ===================================================================== */
(function () {
    // --- Page loader: изчаква реално зареденото съдържание (вкл. hero видеото готово
    //     за плавно пускане) И минимална продължителност, за да няма lag след скриването му ---
    (function () {
        const loader = document.getElementById('page-loader');
        if (!loader) return;

        const MIN_MS = 2200;   // анимацията се вижда поне толкова, дори при мигновено зареждане
        const MAX_MS = 6000;   // твърд таван — никога не блокира потребителя за по-дълго

        const minDelay = new Promise(res => setTimeout(res, MIN_MS));
        const pageLoad = document.readyState === 'complete'
            ? Promise.resolve()
            : new Promise(res => window.addEventListener('load', res, { once: true }));

        // Изчакваме и hero видеото да е реално готово за плавно (без буфериращ lag) пускане —
        // не и лениво заредените видеа надолу (напр. Clip2, който нарочно чака скрол).
        const heroVideo = document.querySelector('.hero__frame-video[data-scroll-video]');
        const heroReady = (heroVideo && heroVideo.readyState < 3)
            ? new Promise(res => {
                heroVideo.addEventListener('canplaythrough', res, { once: true });
                heroVideo.addEventListener('error', res, { once: true });
            })
            : Promise.resolve();

        let hidden = false;
        const hide = () => {
            if (hidden) return;
            hidden = true;
            loader.classList.add('is-hidden');
            setTimeout(() => loader.remove(), 600);
        };

        Promise.all([minDelay, pageLoad, heroReady]).then(hide);
        setTimeout(hide, MAX_MS); // fallback — не блокира ако мрежата закъса
    })();

    document.addEventListener('DOMContentLoaded', () => {
        const nav = document.querySelector('.nav');

        // --- Nav фон при скрол (throttle с rAF, за да не блокира scroll-а) ---
        let navTick = false;
        const onScroll = () => {
            if (navTick) return;
            navTick = true;
            requestAnimationFrame(() => {
                if (nav) nav.classList.toggle('scrolled', window.scrollY > 24);
                navTick = false;
            });
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });

        // --- Мобилно меню ---
        const toggle = document.getElementById('nav-toggle');
        const links = document.getElementById('nav-links');
        if (toggle && links) {
            toggle.addEventListener('click', () => {
                const open = links.classList.toggle('open');
                nav.classList.toggle('menu-open', open);
                toggle.setAttribute('aria-expanded', open);
            });
            links.querySelectorAll('a').forEach(a =>
                a.addEventListener('click', () => {
                    links.classList.remove('open');
                    nav.classList.remove('menu-open');
                }));
        }

        // --- Активен линк спрямо текущата страница ---
        const page = (location.pathname.split('/').pop() || 'index.html');
        document.querySelectorAll('.nav__link').forEach(a => {
            const href = a.getAttribute('href');
            if (href === page || (page === '' && href === 'index.html')) a.classList.add('active');
        });

        // --- Scroll reveal чрез IntersectionObserver (без изчисления на всеки scroll) ---
        initReveal();

        // --- Попълване на контактни данни от config ---
        const S = window.BH_CONFIG?.SALON || {};
        const SOCIAL_KEYS = ['instagram', 'facebook', 'tiktok'];
        document.querySelectorAll('[data-salon]').forEach(el => {
            const key = el.getAttribute('data-salon');
            if (S[key]) {
                if (el.tagName === 'A' && key === 'phone') el.href = 'tel:' + S[key].replace(/\s/g, '');
                else if (el.tagName === 'A' && key === 'email') el.href = 'mailto:' + S[key];
                else if (el.tagName === 'A' && SOCIAL_KEYS.includes(key)) el.href = S[key];
                if (!el.hasAttribute('data-href-only')) el.textContent = S[key];
            }
        });

        // --- Икон система: попълва [data-icon="име"] с вградено SVG ---
        if (window.Icon) {
            document.querySelectorAll('[data-icon]').forEach(el => {
                el.innerHTML = Icon(el.getAttribute('data-icon'), { size: +el.dataset.iconSize || 22 });
            });
        }

        // --- Година във footer ---
        const y = document.getElementById('year');
        if (y) y.textContent = new Date().getFullYear();
    });
})();

/* Помощна функция: HTML escape (срещу XSS при вмъкване на данни от API). */
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* Споделена карта за член на екипа (ползва се в index.html и team.html). */
function teamCardHTML(emp, delay) {
    const name = esc(emp.fullName || 'Специалист');
    const role = esc(emp.jobTitle || 'Специалист');
    const initial = name.trim().charAt(0).toUpperCase() || 'B';
    const photo = emp.photoUrl
        ? `<img src="${esc(emp.photoUrl)}" alt="${name}" loading="lazy">`
        : `<div class="team-card__initial">${initial}</div>`;

    const social = (url, label, icon) => url
        ? `<a href="${esc(url)}" target="_blank" rel="noopener" aria-label="${label}">${Icon(icon, { size: 16 })}</a>` : '';
    const socials = [
        social(emp.instagram, 'Instagram', 'instagram'),
        social(emp.facebook, 'Facebook', 'facebook'),
        social(emp.tiktok, 'TikTok', 'tiktok')
    ].join('');

    const bio = emp.bio ? `<p class="team-card__bio">${esc(emp.bio).slice(0, 120)}</p>` : '';
    const d = delay ? ` data-delay="${delay}"` : '';

    return `
    <article class="card team-card reveal" data-tilt="4"${d}>
        <div class="team-card__photo">
            ${photo}
            ${socials ? `<div class="team-card__socials">${socials}</div>` : ''}
        </div>
        <div class="team-card__body">
            <h3>${name}</h3>
            <div class="team-card__role">${role}</div>
            ${bio}
            <a href="booking.html" class="btn btn--ghost" style="margin-top:1.1rem;--pad-y:.6rem;--pad-x:1.1rem;font-size:.85rem">Запиши се →</a>
        </div>
    </article>`;
}

/* Scroll-reveal чрез IntersectionObserver — задейства се, когато елементът
   влезе в изгледа, без скъпи изчисления на всеки scroll (гладко скролване). */
let _revealObserver = null;
function initReveal() {
    if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
        return;
    }
    _revealObserver = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
            if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
        });
    }, { rootMargin: '0px 0px 400px 0px', threshold: 0 }); // + отдолу => reveal/lazy снимките тръгват по-рано, преди елементът реално да се вижда
    document.querySelectorAll('.reveal:not(.in)').forEach(el => _revealObserver.observe(el));

    // Застраховка: ако елемент остане неразкрит (напр. 0px висок под фолда),
    // разкрий видимите при първо скролване — еднократно, без цена на всеки scroll.
    let safetyDone = false;
    const safety = () => {
        if (safetyDone) return;
        const vh = window.innerHeight || 800;
        document.querySelectorAll('.reveal:not(.in)').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.top < vh && r.bottom > 0) el.classList.add('in');
        });
    };
    window.addEventListener('load', safety, { once: true });
}

/* Пуска reveal за динамично добавени елементи (напр. екип/услуги от API). */
function revealNew(container) {
    const root = container || document;
    if (_revealObserver) root.querySelectorAll('.reveal:not(.in)').forEach(el => _revealObserver.observe(el));
    else root.querySelectorAll('.reveal:not(.in)').forEach(el => el.classList.add('in'));
}

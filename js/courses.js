/* =====================================================================
   КУРСОВЕ — карти, страница на курс, форма за записване, FAQ.
   Зарежда се ПРЕДИ ui.js: рисува синхронно, а после ui.js добавя
   иконите ([data-icon]) и scroll-reveal анимациите върху готовия HTML.
   Съдържанието е в js/courses-data.js.
   ===================================================================== */
(function () {
    const D = window.BH_COURSES;
    if (!D) return;

    const h = s => String(s ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ic = (name, size) => `<span class="ic" data-icon="${name}"${size ? ` data-icon-size="${size}"` : ''}></span>`;
    const money = v => `${Number(v).toLocaleString('bg-BG')} €`;
    const arrow = `<span class="btn__arrow" data-icon="arrow-right" data-icon-size="14"></span>`;

    // Чипове за карта/hero: първо реалните факти, после общите.
    function chips(c) {
        const f = c.facts || {};
        const out = [];
        if (f.duration) out.push(['clock', f.duration]);
        if (f.group) out.push(['users', f.group]);
        if (f.document) out.push(['award', f.document]);
        [['hand', 'С практика'], ['calendar', 'Дата по договаряне'], ['map-pin', 'В салона']]
            .forEach(x => { if (out.length < 3) out.push(x); });
        return out.slice(0, 3);
    }
    const chipsHTML = (c, cls = '') => `<ul class="crs-chips ${cls}">${chips(c).map(([i, t]) =>
        `<li>${ic(i, 15)}<span>${h(t)}</span></li>`).join('')}</ul>`;

    /* ---------------- Карта на курс ---------------- */
    function card(c, i = 0) {
        return `
        <article class="crs-card" style="--i:${i}">
            <a class="crs-card__media" href="${c.page}" aria-label="${h(c.title)}">
                <img src="${c.cardImg}" alt="${h(c.title)}" loading="lazy" width="800" height="600">
                <span class="crs-card__level">${h(c.level)}</span>
            </a>
            <div class="crs-card__body">
                <h3 class="crs-card__title"><a href="${c.page}">${h(c.title)}</a></h3>
                <p class="crs-card__text">${h(c.excerpt)}</p>
                <div class="crs-card__price"><span>${money(c.price)}</span></div>
                ${chipsHTML(c)}
                <div class="crs-card__foot">
                    <a class="crs-more" href="${c.page}">Научи повече ${ic('arrow-right', 14)}</a>
                    <a class="btn btn--primary crs-card__cta" href="${c.page}#zapis">Запиши се</a>
                </div>
            </div>
        </article>`;
    }

    document.querySelectorAll('[data-courses-grid]').forEach(el => {
        const skip = el.dataset.exclude;
        el.innerHTML = D.list.filter(c => c.slug !== skip).map(card).join('');
    });

    /* ---------------- Форма за записване ---------------- */
    function formHTML(preset) {
        const opts = D.list.map(c =>
            `<option value="${c.slug}"${c.slug === preset ? ' selected' : ''}>${h(c.title)} — ${money(c.price)}</option>`).join('');
        return `
        <form class="crs-form" novalidate>
            <div class="crs-form__grid">
                <label class="crs-field">
                    <span class="crs-field__lb">Име и фамилия <i>*</i></span>
                    <input class="input" name="fullName" type="text" autocomplete="name" placeholder="напр. Мария Иванова" maxlength="200" required>
                    <small class="crs-field__err"></small>
                </label>
                <label class="crs-field">
                    <span class="crs-field__lb">Телефон <i>*</i></span>
                    <input class="input" name="phone" type="tel" autocomplete="tel" placeholder="08X XXX XXXX" maxlength="30" required>
                    <small class="crs-field__err"></small>
                </label>
                <label class="crs-field">
                    <span class="crs-field__lb">Имейл <i>*</i></span>
                    <input class="input" name="email" type="email" autocomplete="email" placeholder="ime@primer.bg" maxlength="256" required>
                    <small class="crs-field__hint">Тук ще получиш потвърждение за заявката.</small>
                    <small class="crs-field__err"></small>
                </label>
                <label class="crs-field">
                    <span class="crs-field__lb">Курс <i>*</i></span>
                    <select class="select" name="courseSlug" required>
                        ${preset ? '' : '<option value="" selected disabled>Избери курс…</option>'}${opts}
                    </select>
                    <small class="crs-field__err"></small>
                </label>
                <label class="crs-field crs-field--full">
                    <span class="crs-field__lb">Съобщение <em>(по избор)</em></span>
                    <textarea class="input" name="message" rows="3" maxlength="1000" placeholder="Удобни дни, въпроси, опит…"></textarea>
                </label>
                <label class="crs-hp" aria-hidden="true">Уебсайт<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
                <label class="crs-consent crs-field--full">
                    <input type="checkbox" name="consent">
                    <span class="crs-consent__box">${ic('check', 14)}</span>
                    <span>Съгласна/ен съм данните ми да се използват за връзка относно курса, според <a href="privacy.html" target="_blank">Политиката за поверителност</a>.</span>
                </label>
            </div>
            <small class="crs-field__err crs-consent__err"></small>
            <button class="btn btn--primary btn--lg btn--block crs-form__submit" type="submit">
                <span class="crs-form__label">Изпрати заявка</span>${arrow}
            </button>
            <p class="crs-form__alt">Предпочиташ по телефона? <a href="${D.PHONE_HREF}">${D.PHONE}</a></p>
            <div class="crs-form__msg" role="alert"></div>
        </form>`;
    }

    function successHTML(email, course) {
        return `
        <div class="crs-success">
            <svg class="crs-success__check" viewBox="0 0 52 52" aria-hidden="true">
                <circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="m15 27 7.5 7.5L37.5 19"/>
            </svg>
            <h3>Заявката е изпратена!</h3>
            <p>Записахме те за <b>${h(course ? course.title : 'курса')}</b>. Изпратихме потвърждение на <b>${h(email)}</b> — провери и папка „Промоции“ / „Спам“.</p>
            <p class="crs-success__next">Радина ще ти се обади, за да уточните дата. Ако бързаш — <a href="${D.PHONE_HREF}">${D.PHONE}</a>.</p>
        </div>`;
    }

    function wireForm(root) {
        const form = root.querySelector('.crs-form');
        if (!form) return;
        const msg = form.querySelector('.crs-form__msg');
        const btn = form.querySelector('.crs-form__submit');
        const lbl = form.querySelector('.crs-form__label');

        const setErr = (name, text) => {
            const el = form.elements[name];
            const wrap = el && el.closest('.crs-field');
            if (name === 'consent') {
                form.querySelector('.crs-consent').classList.toggle('is-err', !!text);
                form.querySelector('.crs-consent__err').textContent = text || '';
                return;
            }
            if (!wrap) return;
            wrap.classList.toggle('is-err', !!text);
            wrap.querySelector('.crs-field__err').textContent = text || '';
        };
        ['fullName', 'phone', 'email', 'courseSlug'].forEach(n =>
            form.elements[n].addEventListener('input', () => setErr(n, '')));
        form.elements.consent.addEventListener('change', () => setErr('consent', ''));

        function validate(v) {
            let ok = true;
            const fail = (n, t) => { setErr(n, t); ok = false; };
            if (v.fullName.length < 2) fail('fullName', 'Въведи име и фамилия.');
            const digits = v.phone.replace(/\D/g, '');
            if (digits.length < 7 || digits.length > 15) fail('phone', 'Въведи валиден телефон.');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) fail('email', 'Въведи валиден имейл.');
            if (!v.courseSlug) fail('courseSlug', 'Избери курс.');
            if (!v.consent) fail('consent', 'Нужно е съгласие, за да се свържем с теб.');
            return ok;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            msg.innerHTML = '';
            const v = {
                fullName: form.elements.fullName.value.trim(),
                phone: form.elements.phone.value.trim(),
                email: form.elements.email.value.trim(),
                courseSlug: form.elements.courseSlug.value,
                message: form.elements.message.value.trim() || null,
                consent: form.elements.consent.checked,
                website: form.elements.website.value
            };
            if (!validate(v)) {
                const first = form.querySelector('.is-err input, .is-err select, .crs-consent.is-err input');
                if (first) first.focus({ preventScroll: false });
                return;
            }
            btn.disabled = true; btn.classList.add('is-loading'); lbl.textContent = 'Изпращане…';
            try {
                await window.API.post('/courses/enroll', v);
                const box = form.parentElement;
                box.style.minHeight = box.offsetHeight + 'px';
                form.classList.add('is-leaving');
                setTimeout(() => {
                    box.innerHTML = successHTML(v.email, D.bySlug(v.courseSlug));
                    box.style.minHeight = '';
                    if (window.Icon) box.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = Icon(el.dataset.icon, { size: +el.dataset.iconSize || 22 }));
                }, 260);
            } catch (err) {
                const text = err && err.status === 429
                    ? 'Изпрати твърде много заявки. Опитай пак след малко или се обади.'
                    : (err && err.message) || 'Нещо се обърка.';
                msg.innerHTML = `<div class="alert alert--err">${h(text)} Можеш и да се обадиш на <a href="${D.PHONE_HREF}">${D.PHONE}</a>.</div>`;
                btn.disabled = false; btn.classList.remove('is-loading'); lbl.textContent = 'Изпрати заявка';
            }
        });
    }

    document.querySelectorAll('[data-enroll-form]').forEach(el => {
        el.innerHTML = formHTML(el.dataset.course || '');
        wireForm(el);
    });

    /* ---------------- FAQ (плавно отваряне) ---------------- */
    function faqHTML(items) {
        return `<div class="crs-faq">${items.map((f, i) => `
            <div class="crs-faq__item">
                <button class="crs-faq__q" type="button" aria-expanded="false">
                    <span>${h(f.q)}</span><span class="crs-faq__ic" aria-hidden="true"></span>
                </button>
                <div class="crs-faq__a"><div><p>${h(f.a)}</p></div></div>
            </div>`).join('')}</div>`;
    }
    document.querySelectorAll('[data-faq="common"]').forEach(el => el.innerHTML = faqHTML(D.COMMON_FAQ));

    /* ---------------- Страница на курс ---------------- */
    const root = document.getElementById('course-root');
    const course = root && D.bySlug(root.dataset.course);
    if (root && course) {
        document.querySelectorAll('.nav__link[href="courses.html"]').forEach(l => l.classList.add('active'));
        const c = course, T = D.TRAINER;
        const others = D.list.filter(x => x.slug !== c.slug);
        root.innerHTML = `
        <section class="crs-hero">
            <div class="container">
                <div class="crs-hero__panel">
                    <div class="crs-hero__copy">
                        <a class="crs-back anim" href="courses.html">${ic('arrow-right', 14)} Всички курсове</a>
                        <span class="crs-eyebrow anim">Обучение · ${h(c.level)}</span>
                        <h1 class="crs-hero__title anim">${h(c.title)}</h1>
                        <p class="crs-hero__lead anim">${h(c.lead)}</p>
                        <div class="crs-hero__cta anim">
                            <a href="#zapis" class="btn btn--primary btn--lg" data-magnetic>Запиши се ${arrow}</a>
                            <div class="crs-hero__price"><small>Цена</small><strong>${money(c.price)}</strong></div>
                        </div>
                        <div class="anim">${chipsHTML(c, 'crs-chips--plain')}</div>
                    </div>
                    <div class="crs-hero__visual">
                        <span class="crs-hero__ring" aria-hidden="true"></span>
                        <figure class="crs-hero__arch"><img src="${c.heroImg}" alt="${h(c.title)}" fetchpriority="high"></figure>
                        <div class="crs-float crs-float--trainer">
                            <img src="${T.photo}" alt="${h(T.name)}">
                            <div><b>${h(T.name)}</b><span>Твоят обучител</span></div>
                        </div>
                        ${c.certificate ? `<div class="crs-float crs-float--doc">${ic('award', 18)}<span>${h(c.certificate.title)}</span></div>` : ''}
                    </div>
                </div>
            </div>
        </section>

        <section class="section section--tight crs-sec-info">
            <div class="container">
                <div class="crs-info reveal reveal-stagger">
                    ${c.highlights.map(x => `
                    <article class="crs-info__card">
                        <span class="crs-info__ic">${ic(x.icon, 22)}</span>
                        <h3>${h(x.title)}</h3>
                        <p>${h(x.text)}</p>
                    </article>`).join('')}
                </div>
            </div>
        </section>

        <section class="crs-band">
            <div class="container"><div class="crs-band__inner reveal">
                <div>
                    <h2>Готова ли си за следващата крачка?</h2>
                    <p>Запази мястото си — Радина ще ти се обади, за да уточните дата.</p>
                </div>
                <div class="crs-band__actions">
                    <a href="#zapis" class="btn btn--primary btn--lg" data-magnetic>Запиши се ${arrow}</a>
                    <a href="${D.PHONE_HREF}" class="crs-band__phone">${ic('phone', 16)} ${D.PHONE}</a>
                </div>
            </div></div>
        </section>

        <section class="section crs-program">
            <div class="container crs-program__grid">
                <aside class="crs-trainer reveal">
                    <figure class="crs-trainer__photo"><img src="${T.photo}" alt="${h(T.name)}" loading="lazy"></figure>
                    <div class="crs-trainer__card">
                        <span class="crs-eyebrow">Твоят обучител</span>
                        <h3>${h(T.name)}</h3>
                        <p class="crs-trainer__role">${h(T.role)}</p>
                        <p>${h(T.bio)}</p>
                    </div>
                </aside>
                <div class="crs-program__body">
                    <div class="crs-head reveal">
                        <span class="crs-eyebrow">Какво ще учиш</span>
                        <h2>Програма на обучението</h2>
                    </div>
                    <ol class="crs-modules">
                        ${c.program.map((m, i) => `
                        <li class="crs-module reveal" data-delay="${Math.min(i, 3)}">
                            <span class="crs-module__num">${String(i + 1).padStart(2, '0')}</span>
                            <div class="crs-module__body">
                                <h3>${h(m.title)}</h3>
                                <p class="crs-module__sub">${h(m.sub)}</p>
                                <ul>${m.items.map(it => `<li>${ic('check', 14)}<span>${h(it)}</span></li>`).join('')}</ul>
                            </div>
                        </li>`).join('')}
                    </ol>
                </div>
            </div>
        </section>

        <section class="section crs-fit">
            <div class="container crs-fit__grid">
                <div>
                    <div class="crs-head reveal">
                        <span class="crs-eyebrow">Подходящ ли е за теб</span>
                        <h2>За кого е курсът?</h2>
                    </div>
                    <div class="crs-who reveal reveal-stagger">
                        ${c.forWhom.map(x => `<div class="crs-who__item"><b>${h(x.t)}</b><span>${h(x.d)}</span></div>`).join('')}
                    </div>
                    <div class="crs-outcomes reveal">
                        <h3>След курса ще можеш</h3>
                        <ul>${c.outcomes.map(o => `<li>${ic('check', 14)}<span>${h(o)}</span></li>`).join('')}</ul>
                    </div>
                </div>
                <div>
                    <div class="crs-head reveal">
                        <span class="crs-eyebrow">Въпроси</span>
                        <h2>Често питат</h2>
                    </div>
                    <div class="reveal">${faqHTML([...c.faq, ...D.COMMON_FAQ])}</div>
                </div>
            </div>
        </section>

        ${c.certificate ? `
        <section class="section section--tight crs-cert">
            <div class="container">
                <div class="crs-cert__card reveal">
                    <div class="crs-cert__copy">
                        <span class="crs-eyebrow">Документ</span>
                        <h2>${h(c.certificate.title)}</h2>
                        <p>${h(c.certificate.text)}</p>
                    </div>
                    <div class="crs-cert__paper" aria-hidden="true">
                        <span class="crs-cert__seal">${ic('award', 30)}</span>
                        <span class="crs-cert__line crs-cert__line--t"></span>
                        <span class="crs-cert__line"></span><span class="crs-cert__line crs-cert__line--s"></span>
                        <span class="crs-cert__line"></span><span class="crs-cert__line crs-cert__line--s"></span>
                        <span class="crs-cert__sign"></span>
                    </div>
                </div>
            </div>
        </section>` : ''}

        ${c.gallery && c.gallery.length ? `
        <section class="section section--tight crs-gallery">
            <div class="container">
                <div class="crs-head center reveal"><span class="crs-eyebrow">Галерия</span><h2>От нашите обучения</h2></div>
                <div class="crs-gallery__track reveal">${c.gallery.map(src => `<figure><img src="${src}" alt="Курсистка от обучение в Beauty House" loading="lazy"></figure>`).join('')}</div>
            </div>
        </section>` : ''}

        <section class="section crs-enroll" id="zapis">
            <div class="container crs-enroll__grid">
                <div class="crs-enroll__form reveal" data-enroll-form data-course="${c.slug}"></div>
                <div class="crs-enroll__side">
                    <div class="crs-head reveal">
                        <span class="crs-eyebrow">Записване</span>
                        <h2>Как да се запишеш?</h2>
                    </div>
                    <ol class="crs-steps reveal reveal-stagger">
                        <li><span>1</span><div><b>Изпрати заявка</b><p>Попълни формата — отнема по-малко от минута.</p></div></li>
                        <li><span>2</span><div><b>Получаваш потвърждение</b><p>Веднага идва имейл, че заявката е приета.</p></div></li>
                        <li><span>3</span><div><b>Уточнявате дата</b><p>Радина ти се обажда и заедно избирате удобен ден.</p></div></li>
                    </ol>
                    <a class="crs-callcard reveal" href="${D.PHONE_HREF}">
                        <span class="crs-callcard__ic">${ic('phone', 20)}</span>
                        <span><small>Въпроси? Обади се на Радина</small><b>${D.PHONE}</b></span>
                    </a>
                </div>
            </div>
        </section>

        <section class="section section--tight crs-others">
            <div class="container">
                <div class="crs-head center reveal"><span class="crs-eyebrow">Още обучения</span><h2>Разгледай и другите курсове</h2></div>
                <div class="crs-grid crs-grid--2 reveal reveal-stagger">${others.map(card).join('')}</div>
            </div>
        </section>

        <div class="crs-sticky" aria-hidden="true">
            <div><small>${h(c.title)}</small><b>${money(c.price)}</b></div>
            <a href="#zapis" class="btn btn--primary" tabindex="-1">Запиши се</a>
        </div>`;

        const fbox = root.querySelector('[data-enroll-form]');
        fbox.innerHTML = formHTML(c.slug);
        wireForm(fbox);

        // Лента „Запиши се" на телефон: показва се след hero-то, крие се при формата.
        const sticky = root.querySelector('.crs-sticky');
        const hero = root.querySelector('.crs-hero');
        const enroll = root.querySelector('#zapis');
        if ('IntersectionObserver' in window) {
            let heroOut = false, formIn = false;
            const upd = () => sticky.classList.toggle('is-on', heroOut && !formIn);
            new IntersectionObserver(([e]) => { heroOut = !e.isIntersecting; upd(); }).observe(hero);
            new IntersectionObserver(([e]) => { formIn = e.isIntersecting; upd(); }, { rootMargin: '0px 0px -30% 0px' }).observe(enroll);
        }
    }

    /* ---------------- FAQ поведение (всички страници) ---------------- */
    document.addEventListener('click', e => {
        const q = e.target.closest('.crs-faq__q');
        if (!q) return;
        const item = q.parentElement;
        const open = !item.classList.contains('is-open');
        item.parentElement.querySelectorAll('.crs-faq__item.is-open').forEach(x => {
            if (x !== item) { x.classList.remove('is-open'); x.querySelector('.crs-faq__q').setAttribute('aria-expanded', 'false'); }
        });
        item.classList.toggle('is-open', open);
        q.setAttribute('aria-expanded', String(open));
    });

    /* ---------------- Точки под лентата с курсове (само телефон) ---------------- */
    document.querySelectorAll('.crs-grid').forEach(grid => {
        const cards = grid.children;
        if (cards.length < 2) return;
        const dots = document.createElement('div');
        dots.className = 'crs-dots';
        dots.innerHTML = [...cards].map((_, i) => `<button type="button" aria-label="Курс ${i + 1}"${i ? '' : ' class="is-on"'}></button>`).join('');
        grid.after(dots);
        const btns = [...dots.children];
        const current = () => {
            const first = cards[0].getBoundingClientRect().left;
            const step = cards[1].getBoundingClientRect().left - first || 1;
            return Math.max(0, Math.min(cards.length - 1, Math.round(grid.scrollLeft / step)));
        };
        let t = 0;
        grid.addEventListener('scroll', () => {
            cancelAnimationFrame(t);
            t = requestAnimationFrame(() => { const k = current(); btns.forEach((b, i) => b.classList.toggle('is-on', i === k)); });
        }, { passive: true });
        btns.forEach((b, i) => b.addEventListener('click', () => {
            grid.scrollTo({ left: cards[i].offsetLeft - cards[0].offsetLeft, behavior: 'smooth' });
        }));
    });

    /* ---------------- 3D сцена в hero-то (накланя се след мишката) ---------------- */
    document.querySelectorAll('[data-tilt3d]').forEach(scene => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) return;
        scene.classList.add('is-idle');                     // бавно полюшване, докато никой не я пипа
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return; // телефон — само полюшване
        const area = scene.closest('[data-tilt-area]') || scene;
        let raf = 0;
        area.addEventListener('pointermove', e => {
            const r = scene.getBoundingClientRect();
            const x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 1.2)));
            const y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 1.2)));
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                scene.classList.remove('is-idle');
                scene.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg');
                scene.style.setProperty('--rx', (-y * 9).toFixed(2) + 'deg');
            });
        });
        area.addEventListener('pointerleave', () => {
            cancelAnimationFrame(raf);
            scene.style.setProperty('--ry', '0deg');
            scene.style.setProperty('--rx', '0deg');
            setTimeout(() => { if (!area.matches(':hover')) scene.classList.add('is-idle'); }, 700);
        });
    });

    window.BH_CourseCard = card;
})();

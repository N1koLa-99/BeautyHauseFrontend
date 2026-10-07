/* =====================================================================
   Портфолио — публичната част (Екип, Услуги, Записване).
   window.Portfolio:
     .openEmployee(empOrId, { serviceId, onChoose, chooseLabel })
         модал с портфолиото на специалиста: снимки (филтър по процедура)
         + отзиви със средна оценка. onChoose -> бутон „Избери“ вместо линк
         към записване (ползва се в booking.html, без да се губи прогресът).
     .openService({ serviceIds, title })
         галерия с работата по процедура от всички специалисти.
     .lightbox(items, index)  — снимка на цял екран (стрелки, swipe, zoom).
     .url(u)                  — относителен URL от API-то -> пълен адрес.
     .counts()                — Promise<{ serviceId: брой }> (кеш за страницата).
   Бутонът „Назад“ на телефона затваря отворения модал/снимка.
   ===================================================================== */
window.Portfolio = (function () {
    const E = window.esc || (s => String(s ?? ''));
    const I = (n, size) => Icon(n, { size: size || 20 });
    const API_ORIGIN = String((window.BH_CONFIG && BH_CONFIG.API_BASE) || '').replace(/\/api\/?$/i, '');

    // При локално хранилище API-то връща "/uploads/..." -> допълваме с адреса на API-то.
    function url(u) {
        if (!u) return '';
        if (/^(https?:)?\/\//i.test(u) || /^data:|^blob:/i.test(u)) return u;
        return API_ORIGIN + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    // ---------------------------------------------------------------
    //  Слоеве (модал / lightbox) + бутон „Назад“
    // ---------------------------------------------------------------
    const layers = [];
    function lockScroll(on) { document.documentElement.classList.toggle('pf-lock', on); }

    // Добавя слой: close(fromHistory) го маха от DOM. Връща функция за затваряне от UI.
    function pushLayer(el, onRemove) {
        const layer = { el, onRemove, closed: false };
        layers.push(layer);
        lockScroll(true);
        try { history.pushState({ bhPf: layers.length }, ''); layer.hist = true; } catch (e) { layer.hist = false; }
        return () => closeLayer(layer, false);
    }
    function removeLayer(layer) {
        if (layer.closed) return;
        layer.closed = true;
        const i = layers.indexOf(layer);
        if (i >= 0) layers.splice(i, 1);
        layer.el.classList.add('is-leaving');
        setTimeout(() => layer.el.remove(), 160);
        if (layer.onRemove) layer.onRemove();
        if (!layers.length) lockScroll(false);
    }
    function closeLayer(layer, fromHistory) {
        if (layer.closed) return;
        // Затваряне от UI -> връщаме и историята една стъпка назад (popstate ще го махне).
        if (!fromHistory && layer.hist && layers[layers.length - 1] === layer) { history.back(); return; }
        removeLayer(layer);
    }
    window.addEventListener('popstate', () => {
        const top = layers[layers.length - 1];
        if (top) removeLayer(top);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !layers.length) return;
        const top = layers[layers.length - 1];
        if (top.el.querySelector('.bh-confirm')) return;
        e.preventDefault();
        closeLayer(top, false);
    });

    // ---------------------------------------------------------------
    //  Помощни
    // ---------------------------------------------------------------
    const firstName = n => String(n || '').trim().split(/\s+/)[0] || '';
    const fmtDate = iso => {
        if (!iso) return '';
        const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
        return isNaN(d) ? '' : d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' });
    };
    function stars(rating, size) {
        const r = Math.round(Number(rating) || 0);
        return `<span class="pf-stars" aria-label="${r} от 5">${[1, 2, 3, 4, 5].map(n =>
            `<span class="pf-star${n <= r ? ' is-on' : ''}">${Icon('star', { size: size || 15 })}</span>`).join('')}</span>`;
    }
    const fmtAvg = v => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

    function emptyState(text) {
        return `<div class="pf-empty"><span class="pf-empty__ic">${I('camera', 30)}</span><p>${E(text)}</p></div>`;
    }

    // Мрежа с thumbnails. showEmp -> името на специалиста под снимката; showSrv -> процедурата.
    function gridHTML(items, o = {}) {
        if (!items.length) return emptyState(o.empty || 'Все още няма снимки.');
        return `<div class="pf-grid">${items.map((p, i) => {
            const cap = [o.showSrv ? p.serviceName : '', o.showEmp ? p.employeeName : ''].filter(Boolean);
            return `
            <button type="button" class="pf-tile" data-i="${i}" aria-label="Отвори снимка ${i + 1}">
                <img src="${E(url(p.thumbnailUrl || p.imageUrl))}" alt="${E(p.caption || p.serviceName || 'Снимка от портфолиото')}" loading="lazy" decoding="async">
                ${cap.length ? `<span class="pf-tile__cap">${cap.map(E).join(' · ')}</span>` : ''}
            </button>`;
        }).join('')}</div>`;
    }
    function bindGrid(root, items) {
        root.querySelectorAll('.pf-tile').forEach(t => t.addEventListener('click', () => lightbox(items, +t.dataset.i)));
        // Плавно появяване, когато thumbnail-ът се зареди.
        root.querySelectorAll('.pf-tile img').forEach(img => {
            const done = () => img.classList.add('is-loaded');
            if (img.complete) done(); else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
        });
    }

    // Чипове за филтър: [{ key, label, n }]
    function chipsHTML(list, active) {
        if (list.length < 2) return '';
        return `<div class="pf-chips" role="tablist">${list.map(c =>
            `<button type="button" class="pf-chip${String(c.key) === String(active) ? ' is-on' : ''}" data-k="${E(c.key)}">${E(c.label)}${c.n != null ? ` <small>${c.n}</small>` : ''}</button>`).join('')}</div>`;
    }

    // Избраният чип да се вижда (редът се плъзга хоризонтално на телефон).
    function centerChip(root) {
        const on = root.querySelector('.pf-chips .pf-chip.is-on');
        if (!on) return;
        const row = on.parentElement;
        row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
    }

    // ---------------------------------------------------------------
    //  Модал (на телефон — цял екран, отдолу нагоре)
    // ---------------------------------------------------------------
    function openSheet(cls) {
        const wrap = document.createElement('div');
        wrap.className = 'pf-modal ' + (cls || '');
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.innerHTML = `
            <div class="pf-modal__box">
                <button type="button" class="pf-modal__x" aria-label="Затвори">${I('close', 22)}</button>
                <div class="pf-modal__body"><div class="spinner"></div></div>
            </div>`;
        document.body.appendChild(wrap);
        const prevFocus = document.activeElement;
        const close = pushLayer(wrap, () => { if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) {} });
        wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
        wrap.querySelector('.pf-modal__x').addEventListener('click', close);
        wrap.querySelector('.pf-modal__x').focus({ preventScroll: true });
        return { el: wrap, body: wrap.querySelector('.pf-modal__body'), close };
    }

    // ---------------------------------------------------------------
    //  Портфолио на специалист
    // ---------------------------------------------------------------
    async function findEmployee(empOrId) {
        if (empOrId && typeof empOrId === 'object') return empOrId;
        const list = await API.get('/employees');
        return (list || []).find(e => String(e.id) === String(empOrId)) || null;
    }

    async function openEmployee(empOrId, opts = {}) {
        const sheet = openSheet('pf-modal--emp');
        let emp;
        try { emp = await findEmployee(empOrId); } catch (e) { emp = null; }
        if (!emp) { sheet.body.innerHTML = `<div class="alert alert--err">Специалистът не е намерен.</div>`; return; }

        let photos = [], rev = { average: 0, count: 0, items: [] }, loadErr = '';
        try {
            [photos, rev] = await Promise.all([
                API.get('/portfolio/employee/' + emp.id),
                API.get('/reviews/employee/' + emp.id).catch(() => ({ average: 0, count: 0, items: [] }))
            ]);
            photos = photos || [];
            rev = rev || { average: 0, count: 0, items: [] };
        } catch (err) { loadErr = err.message; }

        const photoUrl = emp.photoUrl || (typeof TEAM_PHOTO_BY_NAME !== 'undefined' && TEAM_PHOTO_BY_NAME[emp.fullName]) || '';
        const avatar = photoUrl
            ? `<img src="${E(photoUrl)}" alt="">`
            : `<span>${E((emp.fullName || 'B').charAt(0).toUpperCase())}</span>`;
        const ratingLine = rev.count
            ? `<span class="pf-rating">${stars(rev.average, 15)} <b>${fmtAvg(rev.average)}</b> <span class="hint">· ${plural(rev.count, 'отзив', 'отзива')}</span></span>`
            : `<span class="hint">Още няма отзиви</span>`;
        const cta = opts.onChoose
            ? `<button type="button" class="btn btn--primary pf-choose">${E(opts.chooseLabel || ('Избери ' + firstName(emp.fullName)))}</button>`
            : `<a class="btn btn--primary" href="booking.html?emp=${encodeURIComponent(emp.id)}">Запиши се при ${E(firstName(emp.fullName))} <span class="btn__arrow">→</span></a>`;

        // Процедури със снимки -> чипове.
        const bySrv = new Map();
        photos.forEach(p => {
            const k = p.serviceId || 0;
            if (!bySrv.has(k)) bySrv.set(k, { key: k, label: p.serviceName || 'Други', n: 0 });
            bySrv.get(k).n++;
        });
        const chipList = [{ key: 'all', label: 'Всички', n: photos.length }, ...[...bySrv.values()].sort((a, b) => b.n - a.n)];
        let active = opts.serviceId && bySrv.has(+opts.serviceId) ? +opts.serviceId : 'all';
        let tab = 'photos';

        sheet.body.innerHTML = `
            <header class="pf-head">
                <div class="pf-head__av">${avatar}</div>
                <div class="pf-head__info">
                    <h3 class="pf-head__name">${E(emp.fullName)}</h3>
                    <div class="pf-head__role">${E(emp.jobTitle || 'Специалист')}</div>
                    ${ratingLine}
                </div>
            </header>
            <div class="pf-tabs" role="tablist">
                <button type="button" class="pf-tab is-on" data-t="photos">${I('image', 17)} Снимки <small>${photos.length}</small></button>
                <button type="button" class="pf-tab" data-t="reviews">${I('star', 17)} Отзиви <small>${rev.count}</small></button>
            </div>
            <div class="pf-pane" data-p="photos"></div>
            <div class="pf-pane" data-p="reviews" hidden></div>
            <div class="pf-foot">${cta}</div>`;

        const paneP = sheet.body.querySelector('[data-p="photos"]');
        const paneR = sheet.body.querySelector('[data-p="reviews"]');

        function paintPhotos() {
            if (loadErr) { paneP.innerHTML = `<div class="alert alert--err">${E(loadErr)}</div>`; return; }
            const list = active === 'all' ? photos : photos.filter(p => (p.serviceId || 0) === active);
            paneP.innerHTML = chipsHTML(chipList, active) +
                gridHTML(list, { showSrv: active === 'all', empty: `${firstName(emp.fullName)} все още не е качила снимки.` });
            paneP.querySelectorAll('.pf-chip').forEach(c => c.addEventListener('click', () => {
                active = c.dataset.k === 'all' ? 'all' : +c.dataset.k;
                paintPhotos();
            }));
            bindGrid(paneP, list);
            centerChip(paneP);
        }
        function paintReviews() {
            if (!rev.count) { paneR.innerHTML = `<div class="pf-empty"><span class="pf-empty__ic">${I('star', 30)}</span><p>Все още няма отзиви за ${E(firstName(emp.fullName))}.</p></div>`; return; }
            paneR.innerHTML = `
                <div class="pf-revsum">
                    <div class="pf-revsum__avg">${fmtAvg(rev.average)}</div>
                    <div>${stars(rev.average, 18)}<div class="hint">${plural(rev.count, 'отзив', 'отзива')} от клиенти с проведен час</div></div>
                </div>
                <div class="pf-revs">${rev.items.map(r => `
                    <article class="pf-rev">
                        <div class="pf-rev__top">${stars(r.rating, 14)}<span class="hint">${E(fmtDate(r.createdAt))}</span></div>
                        ${r.comment ? `<p class="pf-rev__txt">„${E(r.comment)}“</p>` : ''}
                        <div class="pf-rev__who"><b>${E(r.clientName)}</b>${r.serviceName ? ` <span class="hint">· ${E(r.serviceName)}</span>` : ''}</div>
                    </article>`).join('')}</div>`;
        }
        sheet.body.querySelectorAll('.pf-tab').forEach(t => t.addEventListener('click', () => {
            tab = t.dataset.t;
            sheet.body.querySelectorAll('.pf-tab').forEach(x => x.classList.toggle('is-on', x === t));
            paneP.hidden = tab !== 'photos';
            paneR.hidden = tab !== 'reviews';
        }));
        if (opts.onChoose) sheet.body.querySelector('.pf-choose').addEventListener('click', () => {
            sheet.close();
            setTimeout(() => opts.onChoose(emp), 0);
        });
        if (opts.tab === 'reviews') sheet.body.querySelector('.pf-tab[data-t="reviews"]').click();
        paintPhotos();
        paintReviews();
    }

    // ---------------------------------------------------------------
    //  Снимки по процедура (от всички специалисти)
    // ---------------------------------------------------------------
    async function openService(o = {}) {
        const ids = [...new Set((o.serviceIds || []).map(Number).filter(Boolean))];
        const sheet = openSheet('pf-modal--srv');
        let photos = [];
        try {
            photos = ids.length === 1
                ? await API.get('/portfolio/service/' + ids[0])
                : await API.get('/portfolio?serviceIds=' + ids.join(','));
            photos = photos || [];
        } catch (err) {
            sheet.body.innerHTML = `<div class="alert alert--err">${E(err.message)}</div>`;
            return;
        }
        const byEmp = new Map();
        photos.forEach(p => {
            if (!byEmp.has(p.employeeId)) byEmp.set(p.employeeId, { key: p.employeeId, label: firstName(p.employeeName), n: 0 });
            byEmp.get(p.employeeId).n++;
        });
        const chipList = [{ key: 'all', label: 'Всички', n: photos.length }, ...byEmp.values()];
        let active = 'all';

        sheet.body.innerHTML = `
            <header class="pf-head pf-head--srv">
                <span class="pf-head__ic">${I('camera', 24)}</span>
                <div class="pf-head__info">
                    <div class="pf-head__role">Снимки от работата ни</div>
                    <h3 class="pf-head__name">${E(o.title || 'Процедура')}</h3>
                </div>
            </header>
            <div class="pf-pane"></div>`;
        const pane = sheet.body.querySelector('.pf-pane');
        function paint() {
            const list = active === 'all' ? photos : photos.filter(p => p.employeeId === active);
            pane.innerHTML = chipsHTML(chipList, active) +
                gridHTML(list, { showEmp: true, empty: 'Все още няма снимки за тази процедура. Скоро ще добавим!' });
            pane.querySelectorAll('.pf-chip').forEach(c => c.addEventListener('click', () => {
                active = c.dataset.k === 'all' ? 'all' : +c.dataset.k;
                paint();
            }));
            bindGrid(pane, list);
            centerChip(pane);
        }
        paint();
    }

    // ---------------------------------------------------------------
    //  Lightbox: стрелки, swipe, клавиатура, zoom (двоен клик / бутон)
    // ---------------------------------------------------------------
    function lightbox(items, start) {
        if (!items || !items.length) return;
        let idx = Math.max(0, Math.min(items.length - 1, start || 0));
        let zoomed = false;
        const one = items.length === 1;
        const wrap = document.createElement('div');
        wrap.className = 'pf-lb';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', 'Снимка');
        wrap.innerHTML = `
            <div class="pf-lb__bar">
                <span class="pf-lb__count"></span>
                <span class="pf-lb__sp"></span>
                <button type="button" class="pf-lb__btn pf-lb__zoom" aria-label="Увеличи">${I('zoom-in', 22)}</button>
                <button type="button" class="pf-lb__btn pf-lb__close" aria-label="Затвори">${I('close', 24)}</button>
            </div>
            <div class="pf-lb__stage">
                <div class="spinner pf-lb__spin"></div>
                <img class="pf-lb__img" alt="">
            </div>
            ${one ? '' : `
            <button type="button" class="pf-lb__nav pf-lb__nav--prev" aria-label="Предишна">${I('chevron-left', 28)}</button>
            <button type="button" class="pf-lb__nav pf-lb__nav--next" aria-label="Следваща">${I('chevron-right', 28)}</button>`}
            <div class="pf-lb__cap"></div>`;
        document.body.appendChild(wrap);
        const close = pushLayer(wrap, () => { document.removeEventListener('keydown', onKey); });

        const stage = wrap.querySelector('.pf-lb__stage');
        const img = wrap.querySelector('.pf-lb__img');
        const spin = wrap.querySelector('.pf-lb__spin');
        const zoomBtn = wrap.querySelector('.pf-lb__zoom');

        function setZoom(on, cx, cy) {
            zoomed = on;
            wrap.classList.toggle('is-zoomed', on);
            zoomBtn.innerHTML = I(on ? 'zoom-out' : 'zoom-in', 22);
            zoomBtn.setAttribute('aria-label', on ? 'Намали' : 'Увеличи');
            if (on) {
                // Скролваме така, че мястото, където е кликнато, да остане под пръста.
                requestAnimationFrame(() => {
                    const fx = cx != null ? cx : .5, fy = cy != null ? cy : .5;
                    stage.scrollLeft = Math.max(0, img.offsetWidth * fx - stage.clientWidth / 2);
                    stage.scrollTop = Math.max(0, img.offsetHeight * fy - stage.clientHeight / 2);
                });
            } else { stage.scrollLeft = 0; stage.scrollTop = 0; }
        }

        function show(i) {
            idx = (i + items.length) % items.length;
            const p = items[idx];
            setZoom(false);
            spin.hidden = false;
            img.classList.remove('is-loaded');
            img.onload = () => { spin.hidden = true; img.classList.add('is-loaded'); };
            img.onerror = () => { spin.hidden = true; };
            img.src = url(p.imageUrl);
            img.alt = p.caption || p.serviceName || 'Снимка';
            wrap.querySelector('.pf-lb__count').textContent = one ? '' : `${idx + 1} / ${items.length}`;
            const meta = [p.serviceName, p.employeeName ? 'при ' + firstName(p.employeeName) : ''].filter(Boolean).join(' · ');
            wrap.querySelector('.pf-lb__cap').innerHTML =
                (p.caption ? `<div class="pf-lb__cap-t">${E(p.caption)}</div>` : '') + (meta ? `<div class="pf-lb__cap-m">${E(meta)}</div>` : '');
            // Предварително зареждане на съседните.
            [idx + 1, idx - 1].forEach(j => { const q = items[(j + items.length) % items.length]; if (q) { const im = new Image(); im.src = url(q.imageUrl); } });
        }

        function onKey(e) {
            if (layers[layers.length - 1] && layers[layers.length - 1].el !== wrap) return;
            if (e.key === 'ArrowRight') show(idx + 1);
            else if (e.key === 'ArrowLeft') show(idx - 1);
        }
        document.addEventListener('keydown', onKey);

        wrap.querySelector('.pf-lb__close').addEventListener('click', close);
        zoomBtn.addEventListener('click', () => setZoom(!zoomed));
        if (!one) {
            wrap.querySelector('.pf-lb__nav--prev').addEventListener('click', () => show(idx - 1));
            wrap.querySelector('.pf-lb__nav--next').addEventListener('click', () => show(idx + 1));
        }
        // Клик по празното място около снимката -> затваря.
        stage.addEventListener('click', e => { if (e.target === stage && !zoomed) close(); });
        // Двоен клик/тап по снимката -> zoom там, където е кликнато.
        img.addEventListener('dblclick', e => {
            const r = img.getBoundingClientRect();
            setZoom(!zoomed, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        });
        let lastTap = 0;
        img.addEventListener('touchend', e => {
            const now = Date.now();
            if (now - lastTap < 300 && e.changedTouches[0]) {
                e.preventDefault();
                const t = e.changedTouches[0], r = img.getBoundingClientRect();
                setZoom(!zoomed, (t.clientX - r.left) / r.width, (t.clientY - r.top) / r.height);
                lastTap = 0;
            } else lastTap = now;
        });

        // Swipe наляво/надясно (само когато не е увеличено — тогава пръстът мести снимката).
        let sx = 0, sy = 0, tracking = false;
        stage.addEventListener('touchstart', e => {
            if (zoomed || one || e.touches.length !== 1) { tracking = false; return; }
            tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
        }, { passive: true });
        stage.addEventListener('touchmove', e => {
            if (!tracking) return;
            const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
            if (Math.abs(dx) > Math.abs(dy)) img.style.transform = `translateX(${dx}px)`;
        }, { passive: true });
        stage.addEventListener('touchend', e => {
            if (!tracking) return;
            tracking = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx, dy = t.clientY - sy;
            img.style.transform = '';
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) show(idx + (dx < 0 ? 1 : -1));
            else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) close();   // плъзгане надолу -> затваря
        });

        show(idx);
        wrap.querySelector('.pf-lb__close').focus({ preventScroll: true });
    }

    // ---------------------------------------------------------------
    //  Брой снимки по процедура (за бутоните „Виж снимки“) — веднъж на страница.
    // ---------------------------------------------------------------
    let countsP = null;
    function counts() {
        if (!countsP) countsP = API.get('/portfolio/counts')
            .then(list => { const m = {}; (list || []).forEach(c => { m[c.serviceId] = c.count; }); return m; })
            .catch(() => ({}));
        return countsP;
    }

    return { url, openEmployee, openService, lightbox, counts, gridHTML, bindGrid, stars, emptyState, chipsHTML };
})();

/* =====================================================================
   Месечен календар за график на служител/шеф.
   Calendar.mount(container, cfg):
     cfg.editable     – true => може ръчно добавяне на час + маркиране
     cfg.staffId      – id-то на служителя (за свободни часове)
     cfg.services     – [{serviceId, serviceName, durationMinutes}] (за формата)
     cfg.fetchMonth(fromStr, toStr) -> Promise<bookings[]>
     cfg.createBooking(dto) -> Promise            (ако editable)
     cfg.setStatus(id, status) -> Promise         (ако editable)
   ===================================================================== */
window.Calendar = (function () {
    const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const MON = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
        'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
    const STATUS = {
        booked:    { label: 'Запазен',   cls: 'alert--info' },
        completed: { label: 'Проведен',  cls: 'alert--ok' },
        cancelled: { label: 'Отменен',   cls: 'alert--err' },
        no_show:   { label: 'Не се яви', cls: 'alert--err' }
    };
    const pad = n => String(n).padStart(2, '0');
    const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const esc = window.esc || (s => String(s ?? ''));
    const minToHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const hhmmToMin = v => { const p = (v || '').split(':'); return p.length < 2 ? null : (+p[0]) * 60 + (+p[1]); };
    const addMinIso = (iso, mins) => { const d = new Date(iso); d.setMinutes(d.getMinutes() + mins); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`; };
    const WDNAMES = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
    // 24-часови опции за час (стъпка 30 мин) — гарантира 24ч формат навсякъде.
    const timeOptions = (selected) => {
        let o = '';
        for (let m = 0; m < 24 * 60; m += 30) {
            const v = minToHHMM(m);
            o += `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
        }
        return o;
    };
    // Стабилен цвят за всеки специалист (по id).
    const EMP_COLORS = ['#E29A93', '#C7A16B', '#B98BA0', '#8FB0A0', '#7BA7C7', '#CE7A78'];
    const empColor = id => EMP_COLORS[Math.abs(+id || 0) % EMP_COLORS.length];

    function mount(container, cfg) {
        const now = new Date();
        let y = now.getFullYear(), m = now.getMonth();
        let selKey = key(y, m, now.getDate());
        let data = {};            // 'YYYY-MM-DD' -> [bookings]
        let selBk = null;         // избран час в дневната времева решетка
        let empFilter = null;     // филтър по специалист (в „Целият салон")
        // Мащаб (zoom) на дневната решетка + изглед (ден/седмица). Пазят се локално.
        // Много широк, плавен диапазон на мащаба (клетките се смаляват/уголемяват през всяко ниво).
        const Z_MIN = 0.6, Z_MAX = 9.0;
        let zoom = Math.min(Z_MAX, Math.max(Z_MIN, parseFloat(localStorage.getItem('bh_cal_zoom')) || 2.2));
        let view = 'day';         // 'day' | 'week'
        const clampZoom = z => Math.min(Z_MAX, Math.max(Z_MIN, z));
        // Прагове за натовареност (Радина ги задава от Настройки; пазят се локално).
        const loadY = parseInt(localStorage.getItem('bh_load_yellow'), 10) || 10;
        const loadR = parseInt(localStorage.getItem('bh_load_red'), 10) || 15;

        container.innerHTML = `
            <div class="cal">
                <div class="cal-nav" style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.85rem">
                    <button class="btn btn--ghost cal-prev" style="--pad-y:.4rem;--pad-x:.95rem;font-size:1.1rem" aria-label="Предишен ден">‹</button>
                    <button class="cal-datebtn" style="position:relative;flex:1;max-width:290px;border:1px solid var(--line);background:var(--ivory);border-radius:13px;padding:.55rem .9rem;font-family:var(--font-display);font-size:1.15rem;color:var(--ink);cursor:pointer">
                        <span class="cal-datebtn__d"></span>
                        <input type="date" class="cal-dateinp" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer" aria-label="Избери дата">
                    </button>
                    <button class="btn btn--ghost cal-next" style="--pad-y:.4rem;--pad-x:.95rem;font-size:1.1rem" aria-label="Следващ ден">›</button>
                </div>
                <div class="cal-week" style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:.4rem"></div>
                <div class="cal-detail" style="margin-top:.8rem;padding-top:.7rem;border-top:1px solid var(--line)"></div>
            </div>`;

        const weekEl = container.querySelector('.cal-week');
        const dateBtnD = container.querySelector('.cal-datebtn__d');
        const dateInp = container.querySelector('.cal-dateinp');
        const detail = container.querySelector('.cal-detail');
        // В седмичен изглед стрелките местят по цяла седмица; в дневен — по ден.
        container.querySelector('.cal-prev').addEventListener('click', () => shiftDay(view === 'week' ? -7 : -1));
        container.querySelector('.cal-next').addEventListener('click', () => shiftDay(view === 'week' ? 7 : 1));
        dateInp.addEventListener('change', () => { if (dateInp.value) goToDate(dateInp.value); });

        // ---- Плаващ филтър по специалист (кръгче долу вдясно) ----
        // Само в изглед „Целият салон". Кликаш кръгчето → изскачат кръгчета
        // с инициала на всяка служителка; избираш → графикът се филтрира.
        let fabEl = null;
        const initial = n => (String(n || '').trim()[0] || '?').toUpperCase();
        const FILTER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M15.5 14.2c2.2.2 4 2 4 4.3"/></svg>';
        const ALL_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2"/><circle cx="16" cy="8" r="2.2"/><circle cx="12" cy="15.5" r="2.2"/></svg>';
        function empsSorted() {
            const ORDER = ['ирина', 'радина', 'анелия'];
            const rank = n => { const s = (n || '').toLowerCase(); const i = ORDER.findIndex(o => s.includes(o)); return i < 0 ? ORDER.length : i; };
            return (cfg.employees || []).slice().sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name), 'bg'));
        }
        function buildFab() {
            if (!(cfg.showEmployee && cfg.employees && cfg.employees.length)) return;
            // Закача се директно към <body> (както долната навигация), за да е
            // ВИНАГИ залепено за екрана — иначе трансформиран родител го „чупи".
            document.querySelectorAll('body > .cal-fab').forEach(x => x.remove());
            fabEl = document.createElement('div');
            fabEl.className = 'cal-fab';
            document.body.appendChild(fabEl);
        }
        function renderFab() {
            if (!fabEl) return;
            const wasOpen = fabEl.classList.contains('is-open');
            const emps = empsSorted();
            const cur = empFilter == null ? null : emps.find(e => e.id === empFilter);
            const opt = (id, label, av, color, on) => `
                <button class="cal-fab__opt${on ? ' is-on' : ''}" data-emp="${id}">
                    <span class="cal-fab__lb">${esc(label)}</span>
                    <span class="cal-fab__av" style="${color ? `background:${color}` : ''}">${av}</span>
                </button>`;
            fabEl.innerHTML = `
                <div class="cal-fab__menu">
                    ${opt('all', 'Всички', ALL_SVG, 'var(--ink)', empFilter == null)}
                    ${emps.map(e => opt(e.id, e.name, initial(e.name), empColor(e.id), empFilter === e.id)).join('')}
                </div>
                <button class="cal-fab__main${cur ? ' is-emp' : ''}" aria-label="Филтър по специалист" style="${cur ? `background:${empColor(cur.id)}` : ''}">${cur ? initial(cur.name) : FILTER_SVG}</button>`;
            if (wasOpen) fabEl.classList.add('is-open');
            fabEl.querySelector('.cal-fab__main').addEventListener('click', () => fabEl.classList.toggle('is-open'));
            fabEl.querySelectorAll('.cal-fab__opt').forEach(b => b.addEventListener('click', () => {
                empFilter = b.dataset.emp === 'all' ? null : +b.dataset.emp;
                fabEl.classList.remove('is-open');
                renderDetail();
            }));
        }
        buildFab();

        // Кеш по месеци — за да работи седмица, която пресича два месеца.
        const loadedMonths = new Set();

        function goToDate(dateStr) { selKey = dateStr; selBk = null; navigate(); }
        function shiftDay(delta) {
            const d = new Date(selKey + 'T00:00:00'); d.setDate(d.getDate() + delta);
            goToDate(key(d.getFullYear(), d.getMonth(), d.getDate()));
        }

        // Месеците, които покрива текущият изглед (ден = 1; седмица = до 2).
        function visibleMonths() {
            const seen = new Set(), out = [];
            const add = d => { const mk = `${d.getFullYear()}-${d.getMonth()}`; if (!seen.has(mk)) { seen.add(mk); out.push([d.getFullYear(), d.getMonth()]); } };
            const sd = new Date(selKey + 'T00:00:00');
            if (view === 'week') {
                const monday = new Date(sd); monday.setDate(sd.getDate() - ((sd.getDay() + 6) % 7));
                for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); add(d); }
            } else add(sd);
            return out;
        }

        async function fetchMonthInto(Y, M0) {
            const from = key(Y, M0, 1);
            const to = `${M0 === 11 ? Y + 1 : Y}-${pad((M0 + 1) % 12 + 1)}-01`;
            const items = await cfg.fetchMonth(from, to);
            for (const dk of Object.keys(data)) { const dt = new Date(dk + 'T00:00:00'); if (dt.getFullYear() === Y && dt.getMonth() === M0) delete data[dk]; }
            (items || []).forEach(b => { const k = b.startAt.slice(0, 10); (data[k] = data[k] || []).push(b); });
            loadedMonths.add(`${Y}-${M0}`);
        }

        // Зарежда липсващите видими месеци (force = презарежда ги пак — след промяна).
        async function ensureVisible(force) {
            const need = visibleMonths().filter(([Y, M0]) => force || !loadedMonths.has(`${Y}-${M0}`));
            if (need.length) {
                if (!Object.keys(data).length) detail.innerHTML = `<div class="spinner"></div>`;
                try { for (const [Y, M0] of need) await fetchMonthInto(Y, M0); }
                catch (err) { detail.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`; return; }
            }
            paintNav(); renderDetail();
        }
        function load() { return ensureVisible(true); }       // презареждане (след промяна)
        function navigate() { return ensureVisible(false); }  // навигация (зарежда само липсващото)

        // Навигация в стил Apple: дата + седмична лента с точки за натовареност.
        function paintNav() {
            const [yy, mm, dd] = selKey.split('-');
            dateBtnD.textContent = `${+dd} ${MON[+mm - 1]} ${yy}`;
            dateInp.value = selKey;

            const sd = new Date(selKey + 'T00:00:00');
            const monday = new Date(sd); monday.setDate(sd.getDate() - ((sd.getDay() + 6) % 7));
            const todayK = key(now.getFullYear(), now.getMonth(), now.getDate());

            let html = '';
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday); d.setDate(monday.getDate() + i);
                const k = key(d.getFullYear(), d.getMonth(), d.getDate());
                const cnt = (data[k] || []).length;
                const isSel = k === selKey, isToday = k === todayK;
                const loadColor = cnt > loadR ? '#D9534F' : (cnt > loadY ? '#E7B100' : '#4E9E76');
                const numStyle = isSel
                    ? 'background:var(--rose-deep);color:#fff'
                    : (isToday ? 'color:var(--rose-deep);font-weight:800' : 'color:var(--ink)');
                html += `
                    <button class="cal-wday" data-k="${k}" style="border:0;background:transparent;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:.35rem 0">
                        <span style="font-size:.66rem;font-weight:600;color:var(--muted)">${WD[i]}</span>
                        <span style="width:32px;height:32px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.92rem;font-weight:600;${numStyle}">${d.getDate()}</span>
                        <span style="width:6px;height:6px;border-radius:50%;background:${cnt ? loadColor : 'transparent'}"></span>
                    </button>`;
            }
            weekEl.innerHTML = html;
            weekEl.querySelectorAll('.cal-wday').forEach(el => el.addEventListener('click', () => goToDate(el.dataset.k)));
        }

        // Лента: превключване Ден/Седмица + мащаб (±). Ползва се в двата изгледа.
        function toolsHtml() {
            return `
                <div class="cal-tools">
                    <div class="cal-seg">
                        <button class="cal-seg__b${view === 'day' ? ' is-on' : ''}" data-view="day">Ден</button>
                        <button class="cal-seg__b${view === 'week' ? ' is-on' : ''}" data-view="week">Седмица</button>
                    </div>
                    ${view === 'day' ? `<div class="cal-zoom">
                        <button class="cal-zoom__b" data-z="out" aria-label="Намали">−</button>
                        <button class="cal-zoom__b" data-z="in" aria-label="Увеличи">+</button>
                    </div>` : ''}
                </div>`;
        }
        function wireTools() {
            detail.querySelectorAll('.cal-seg__b').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; navigate(); }));
            detail.querySelectorAll('.cal-zoom__b').forEach(b => b.addEventListener('click', () => {
                // Като намалиш под минимума на деня -> преминаваш към седмичен изглед.
                if (b.dataset.z === 'out' && zoom <= Z_MIN + 0.01) { view = 'week'; zoom = Z_MIN; navigate(); return; }
                zoom = clampZoom(zoom * (b.dataset.z === 'in' ? 1.12 : 0.9)); // фини стъпки
                localStorage.setItem('bh_cal_zoom', zoom.toFixed(2));
                renderDetail();
            }));
        }

        // ---------------------------------------------------------------
        // Жестове върху графика — на НАТИВНИ touch събития (работят еднакво
        // в Chrome и Safari). Pointer Events не се ползват, защото при
        // preventDefault iOS хвърля pointercancel и жестът се къса.
        //   • 2 пръста        -> мащаб (жив преглед; при пускане се записва)
        //   • 1 пръст ↔       -> смяна на ден/седмица (със слайд)
        //   • 1 пръст ↕       -> нормален скрол на страницата
        //   • мишка влачене ↔ -> смяна на ден/седмица;  Ctrl+колелце -> мащаб
        // opts: { pinch: bool, step: 1|7, onPinchEnd(zoomOut) }
        // ---------------------------------------------------------------
        function wireGestures(el, opts) {
            if (!el) return;
            const o = opts || {};
            const STEP = o.step || 1;
            let busy = false;
            const reset = () => { el.style.transform = ''; el.style.opacity = '1'; };
            const anim = (ms) => { el.style.transition = `transform ${ms}ms ease-out, opacity ${ms}ms ease-out`; };

            // Safari: спираме собствената му щипка САМО тук.
            ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
                el.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

            const commitSwipe = (dx) => {
                if (Math.abs(dx) > 45) {
                    busy = true; anim(150);
                    el.style.transform = `translateX(${dx < 0 ? '-110%' : '110%'})`;
                    el.style.opacity = '0';
                    setTimeout(() => shiftDay(dx < 0 ? STEP : -STEP), 145);
                } else { anim(180); reset(); }
            };

            // ---------- Докосване ----------
            let mode = null, sx = 0, sy = 0, dx = 0;
            let pStart = 1, pFrom = zoom, pTo = zoom;
            const d2 = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

            el.addEventListener('touchstart', (e) => {
                if (busy) return;
                el.style.transition = 'none';
                if (e.touches.length >= 2) {
                    if (o.pinch === false) { mode = 'pinch-off'; return; }
                    mode = 'pinch'; pStart = d2(e.touches) || 1; pFrom = zoom; pTo = zoom;
                } else if (e.touches.length === 1) {
                    mode = null; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0;
                }
            }, { passive: true });

            el.addEventListener('touchmove', (e) => {
                if (busy) return;
                // Всеки 2-пръстов жест е наш -> браузърът да не зумва.
                if (e.touches.length >= 2) {
                    e.preventDefault();
                    if (mode === 'pinch-off') {
                        // В седмица: разтваряне на пръстите => обратно към ден.
                        if (d2(e.touches) / (pStart || 1) > 1.15 && o.onPinchIn) { busy = true; o.onPinchIn(); }
                        return;
                    }
                    if (mode !== 'pinch') { mode = 'pinch'; pStart = d2(e.touches) || 1; pFrom = zoom; pTo = zoom; }
                    pTo = clampZoom(pFrom * (d2(e.touches) / pStart));
                    el.style.transform = `scaleY(${(pTo / zoom).toFixed(3)})`;
                    return;
                }
                if (e.touches.length !== 1 || mode === 'pinch' || mode === 'pinch-off') return;
                dx = e.touches[0].clientX - sx;
                const dy = e.touches[0].clientY - sy;
                if (mode === null) {
                    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
                    mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'scroll';
                }
                if (mode === 'swipe') {
                    e.preventDefault();   // не скролвай страницата настрани
                    el.style.transform = `translateX(${dx.toFixed(0)}px)`;
                    el.style.opacity = String(Math.max(.5, 1 - Math.abs(dx) / 800));
                }
            }, { passive: false });

            el.addEventListener('touchend', (e) => {
                if (busy || e.touches.length) return;   // изчакай последния пръст
                const was = mode; mode = null;
                if (was === 'pinch') {
                    reset();
                    const zoomedOut = pTo < pFrom - 0.005;
                    if (o.onPinchEnd && o.onPinchEnd(zoomedOut, pTo)) return;
                    if (Math.abs(pTo - zoom) > 0.01) { zoom = pTo; localStorage.setItem('bh_cal_zoom', zoom.toFixed(2)); renderDetail(); }
                } else if (was === 'swipe') commitSwipe(dx);
                else reset();
            });
            el.addEventListener('touchcancel', () => { mode = null; el.style.transition = ''; reset(); });

            // ---------- Мишка (десктоп): влачене настрани = смяна ----------
            let mDown = false, mx = 0, my = 0, mdx = 0, mAxis = null;
            el.addEventListener('mousedown', (e) => {
                if (busy || e.button !== 0) return;
                mDown = true; mAxis = null; mx = e.clientX; my = e.clientY; mdx = 0; el.style.transition = 'none';
            });
            window.addEventListener('mousemove', (e) => {
                if (!mDown || busy) return;
                mdx = e.clientX - mx; const mdy = e.clientY - my;
                if (mAxis === null) {
                    if (Math.abs(mdx) < 12 && Math.abs(mdy) < 12) return;
                    mAxis = Math.abs(mdx) > Math.abs(mdy) ? 'x' : 'y';
                }
                if (mAxis === 'x') {
                    e.preventDefault();
                    el.style.transform = `translateX(${mdx.toFixed(0)}px)`;
                    el.style.opacity = String(Math.max(.5, 1 - Math.abs(mdx) / 800));
                }
            });
            window.addEventListener('mouseup', () => {
                if (!mDown) return; mDown = false;
                if (mAxis === 'x') commitSwipe(mdx);
                mAxis = null;
            });

            // ---------- Десктоп: Ctrl + колелце = мащаб ----------
            if (o.pinch !== false) {
                let pending = false;
                el.addEventListener('wheel', (e) => {
                    if (!e.ctrlKey) return;
                    e.preventDefault();
                    zoom = clampZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.91));
                    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; localStorage.setItem('bh_cal_zoom', zoom.toFixed(2)); renderDetail(); }); }
                }, { passive: false });
            }
        }

        // Седмичен изглед: 7 колони с малки блокчета; клик на ден => дневен изглед.
        function weekHtml() {
            const sd = new Date(selKey + 'T00:00:00');
            const monday = new Date(sd); monday.setDate(sd.getDate() - ((sd.getDay() + 6) % 7));
            const todayK = key(now.getFullYear(), now.getMonth(), now.getDate());
            const kk = d => key(d.getFullYear(), d.getMonth(), d.getDate());
            const toMin = iso => (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16));
            const days = [];
            for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); days.push(d); }
            const listFor = d => { const a = data[kk(d)] || []; return empFilter != null ? a.filter(b => b.employeeId === empFilter) : a; };
            let ws = 9 * 60, we = 19 * 60;
            days.forEach(d => listFor(d).forEach(b => { ws = Math.min(ws, toMin(b.startAt)); we = Math.max(we, b.endAt ? toMin(b.endAt) : toMin(b.startAt) + 30); }));
            ws = Math.floor(ws / 60) * 60; we = Math.ceil(we / 60) * 60;
            const WPX = 0.9, HEAD = 50, H = (we - ws) * WPX;
            let gut = '', lines = '';
            for (let mm = ws; mm <= we; mm += 60) {
                const top = (mm - ws) * WPX;
                gut += `<span style="position:absolute;left:0;top:${(HEAD + top - 6).toFixed(0)}px;font-size:.6rem;font-weight:600;color:var(--muted)">${minToHHMM(mm)}</span>`;
                lines += `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;border-top:1px solid rgba(60,47,51,.08)"></div>`;
            }
            const cols = days.map((d, di) => {
                const k = kk(d);
                const arr = listFor(d).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));
                const laneEnd = [], laneOf = [];
                arr.forEach((b, i) => { const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30; let l = laneEnd.findIndex(x => x <= s); if (l === -1) { l = laneEnd.length; laneEnd.push(e); } else laneEnd[l] = e; laneOf[i] = l; });
                const lanes = Math.max(1, laneEnd.length);
                const blk = arr.map((b, i) => {
                    const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30;
                    const top = (s - ws) * WPX, hh = Math.max(5, (e - s) * WPX - 1);
                    const flg = b.noShowCount > 0 || b.status === 'no_show';
                    const bg = flg ? '#D9534F' : empColor(b.employeeId);
                    const w = 100 / lanes, left = laneOf[i] * w;
                    const t0 = b.startAt.slice(11, 16), nm = esc(b.serviceName);
                    const title = `${t0} · ${nm}${b.clientName ? ' · ' + esc(b.clientName) : ''}${flg ? ' · ⚠' : ''}`;
                    // Етикет вътре в блока (когато има място) — час + услуга, за да е ясно за какво е.
                    const lab = hh >= 18
                        ? `<div style="font-size:.55rem;font-weight:700;color:#fff;line-height:1.08;padding:2px 3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${hh >= 44 ? 3 : 2};-webkit-box-orient:vertical;word-break:break-word">${t0} ${nm}</div>`
                        : '';
                    return `<div title="${title}" style="position:absolute;top:${top.toFixed(0)}px;height:${hh.toFixed(0)}px;left:calc(${left}% + 1px);width:calc(${w}% - 2px);background:${bg};border-radius:3px;overflow:hidden;opacity:${b.status === 'completed' ? .7 : .97}">${lab}</div>`;
                }).join('');
                const isSel = k === selKey, isToday = k === todayK;
                const numS = isSel ? 'background:var(--rose-deep);color:#fff' : (isToday ? 'color:var(--rose-deep);font-weight:800' : 'color:var(--ink)');
                return `<button class="cal-wk-col" data-k="${k}" style="flex:1;min-width:0;border:0;border-left:1px solid rgba(60,47,51,.06);background:${isSel ? 'rgba(206,122,120,.06)' : 'transparent'};cursor:pointer;padding:0;display:block">
                    <div style="height:${HEAD}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem">
                        <span style="font-size:.6rem;font-weight:600;color:var(--muted)">${WD[di]}</span>
                        <span style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.78rem;font-weight:700;${numS}">${d.getDate()}</span>
                    </div>
                    <div style="position:relative;height:${H.toFixed(0)}px">${lines}${blk}</div>
                </button>`;
            }).join('');
            return `<div class="wk-zoom" style="transform-origin:top center;touch-action:pan-y">
                <div style="display:flex;margin-top:.5rem;overflow:hidden">
                    <div style="flex:0 0 34px;position:relative;height:${(HEAD + H).toFixed(0)}px">${gut}</div>
                    <div style="flex:1;display:flex;min-width:0">${cols}</div>
                </div>
            </div>
            <p class="hint" style="margin:.8rem 0 0;text-align:center">Докосни ден, за да го отвориш · плъзни настрани за друга седмица.</p>`;
        }


        function renderDetail() {
            renderFab();
            // ---- Седмичен изглед (out-zoom): виждат се всички дни ----
            if (view === 'week') {
                detail.innerHTML = toolsHtml() + weekHtml();
                wireTools();
                // Седмица: плъзгане ↔ = друга седмица; разтваряне на пръсти = обратно към ден.
                wireGestures(detail.querySelector('.wk-zoom'), {
                    pinch: false, step: 7,
                    onPinchIn: () => { view = 'day'; zoom = Z_MIN; localStorage.setItem('bh_cal_zoom', zoom.toFixed(2)); navigate(); }
                });
                detail.querySelectorAll('.cal-wk-col').forEach(c => c.addEventListener('click', () => {
                    selKey = c.dataset.k; selBk = null; view = 'day'; paintNav(); renderDetail();
                }));
                return;
            }

            const fullList = (data[selKey] || []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));
            // Филтър по специалист (избран от плаващото кръгче). Пази се между дните.
            const list = (empFilter != null) ? fullList.filter(b => b.employeeId === empFilter) : fullList;
            const [yy, mm, dd] = selKey.split('-');
            const heading = `${+dd} ${MON[+mm - 1]} ${yy}`;
            const isPastDay = selKey < key(now.getFullYear(), now.getMonth(), now.getDate());

            // Часови обхват на деня.
            let span = '';
            if (list.length) {
                const first = list[0].startAt.slice(11, 16);
                const last = list.map(b => (b.endAt || b.startAt).slice(11, 16)).sort().slice(-1)[0];
                span = `<span class="hint">${list.length} ${list.length === 1 ? 'час' : 'часа'} · ${first}–${last}</span>`;
            }

            // Карта с детайли/действия за ЕДИН час (отваря се при докосване на блок).
            const bookingCardHtml = (b) => {
                const st = STATUS[b.status] || { label: b.status, cls: 'alert--info' };
                const phone = b.clientPhone ? ` · <a href="tel:${esc(b.clientPhone)}">${esc(b.clientPhone)}</a>` : '';
                const flagged = b.noShowCount > 0;           // повторен нарушител (по тел./профил)
                const noShow = b.status === 'no_show';       // този час е пропуснат
                const red = flagged || noShow;               // червен акцент
                const col = empColor(b.employeeId);
                const edge = red ? '#D9534F' : col;
                const bg = red ? '#D9534F1F' : `${col}26`;

                // Ясна червена лента отгоре — веднага личи и в общия график.
                const bannerStyle = 'display:flex;align-items:center;gap:.45rem;background:#D9534F;color:#fff;font-weight:800;font-size:.74rem;letter-spacing:.02em;padding:.34rem .7rem';
                const banner = flagged
                    ? `<div style="${bannerStyle}"><span style="font-size:1.05rem;line-height:1">⚠</span> СЪМНИТЕЛЕН КЛИЕНТ · ${b.noShowCount}× не се е явявал(а)</div>`
                    : (noShow
                        ? `<div style="${bannerStyle}"><span style="font-size:1.05rem;line-height:1">⚠</span> НЕ СЕ ЯВИ</div>`
                        : '');
                const nameHtml = red
                    ? `<b style="color:#B02A26">${esc(b.clientName || 'Клиент')}</b>`
                    : esc(b.clientName || 'Клиент');
                // Статусът „Не се яви" — плътно червено, за да се забелязва лесно.
                const statusPill = noShow
                    ? `<span style="background:#D9534F;color:#fff;border-radius:99px;padding:.25rem .6rem;font-size:.72rem;font-weight:700;white-space:nowrap">Не се яви</span>`
                    : `<span class="alert ${st.cls}" style="padding:.25rem .55rem;font-size:.72rem;white-space:nowrap">${st.label}</span>`;

                // Действия според статуса (вкл. поправка при грешка).
                let actions = '';
                if (cfg.editable) {
                    if (b.status === 'booked')
                        actions = `
                        <button class="btn btn--gold cal-set" data-id="${b.id}" data-st="completed" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Проведен</button>
                        <button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="no_show" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Не се яви</button>`;
                    else if (b.status === 'no_show')
                        actions = `<button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="completed" title="Поправи: клиентът всъщност дойде" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">↩ Явил се</button>`;
                    else if (b.status === 'completed')
                        actions = `<button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="no_show" title="Отбележи като неявил се" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Не се яви</button>`;
                }
                return `
                <div style="border-radius:12px;overflow:hidden;${red ? 'box-shadow:0 0 0 2px #D9534F' : ''}">
                    ${banner}
                    <div class="card" style="display:flex;flex-wrap:wrap;align-items:center;gap:.45rem .7rem;padding:.65rem .85rem;border-left:7px solid ${edge};background:${bg};border-radius:0">
                        <div style="font-weight:700;font-variant-numeric:tabular-nums;min-width:42px">${b.startAt.slice(11, 16)}</div>
                        <div style="flex:1 1 55%;min-width:130px">
                            <strong style="line-height:1.25">${esc(b.serviceName)}</strong>${cfg.showEmployee ? ` <span style="background:${col};color:#fff;border-radius:99px;padding:.08rem .55rem;font-size:.72rem;font-weight:600;white-space:nowrap">${esc(b.employeeName)}</span>` : ''}
                            <div class="hint" style="margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nameHtml}${phone} · ${(b.priceSnapshot || 0).toFixed(0)} €</div>
                        </div>
                        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-left:auto">
                            ${statusPill}
                            ${actions}
                        </div>
                    </div>
                </div>`;
            };

            // ---- Дневна времева решетка (Google/Apple стил) ----
            const toMin = iso => (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16));
            const PX = zoom, GUT = 46, LANE_MIN = 185;
            let tStart = 9 * 60, tEnd = 19 * 60; // работни часове; разширяват се спрямо реалните
            if (list.length) {
                tStart = Math.min(tStart, Math.min(...list.map(b => toMin(b.startAt))));
                tEnd = Math.max(tEnd, Math.max(...list.map(b => b.endAt ? toMin(b.endAt) : toMin(b.startAt) + 30)));
            }
            tStart = Math.floor(tStart / 60) * 60;
            tEnd = Math.ceil(tEnd / 60) * 60;
            const H = (tEnd - tStart) * PX;

            // Колони: в „Целият салон" всяка специалистка има своя колона; иначе по застъпване.
            let laneOf = [], lanes = 1;
            if (cfg.showEmployee && list.length) {
                const ORDER = ['ирина', 'радина', 'анелия'];
                const rank = name => { const n = (name || '').toLowerCase(); const i = ORDER.findIndex(o => n.includes(o)); return i === -1 ? ORDER.length : i; };
                const emps = [];
                list.forEach(b => { if (!emps.some(e => e.id === b.employeeId)) emps.push({ id: b.employeeId, name: b.employeeName }); });
                emps.sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name), 'bg'));
                const empLane = {}; emps.forEach((e, i) => empLane[e.id] = i);
                laneOf = list.map(b => empLane[b.employeeId]);
                lanes = Math.max(1, emps.length);
            } else if (list.length) {
                const laneEnd = [];
                list.forEach((b, i) => {
                    const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30;
                    let l = laneEnd.findIndex(x => x <= s);
                    if (l === -1) { l = laneEnd.length; laneEnd.push(e); } else laneEnd[l] = e;
                    laneOf[i] = l;
                });
                lanes = Math.max(1, laneEnd.length);
            }

            // Редуващи се фонови ленти на всеки час — по-лесно се чете кой час е кой.
            let hourBands = '';
            for (let hb = tStart; hb < tEnd; hb += 60) {
                if (Math.round(hb / 60) % 2 === 0) {
                    const top = (hb - tStart) * PX;
                    hourBands += `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;height:${(60 * PX).toFixed(0)}px;background:rgba(60,47,51,.025);pointer-events:none"></div>`;
                }
            }
            // По-ясни линии: плътни на кръгъл час, по-меки на половин час, тънки на 15 мин.
            let gridLines = '', gutLabels = '';
            for (let mmn = tStart; mmn <= tEnd; mmn += 15) {
                const top = (mmn - tStart) * PX;
                const isHour = mmn % 60 === 0, isHalf = mmn % 30 === 0 && mmn % 60 !== 0;
                const lineStyle = isHour ? '1.5px solid rgba(60,47,51,.20)' : (isHalf ? '1px solid rgba(60,47,51,.11)' : '1px dashed rgba(60,47,51,.055)');
                gridLines += `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;border-top:${lineStyle}"></div>`;
                if (isHour) gutLabels += `<span style="position:absolute;left:0;top:${(top - 9).toFixed(0)}px;font-size:.78rem;font-weight:700;color:var(--ink-soft);font-variant-numeric:tabular-nums">${minToHHMM(mmn)}</span>`;
                else if (isHalf) gutLabels += `<span style="position:absolute;left:0;top:${(top - 7).toFixed(0)}px;font-size:.64rem;font-weight:500;color:var(--muted);opacity:.7;font-variant-numeric:tabular-nums">${minToHHMM(mmn)}</span>`;
            }

            // Червена линия „сега".
            let nowLine = '', nowDot = '';
            const nowD2 = new Date();
            if (selKey === key(nowD2.getFullYear(), nowD2.getMonth(), nowD2.getDate())) {
                const nm = nowD2.getHours() * 60 + nowD2.getMinutes();
                if (nm >= tStart && nm <= tEnd) {
                    const top = (nm - tStart) * PX;
                    nowLine = `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;border-top:2px solid #EA4335;z-index:3;pointer-events:none"></div>`;
                    nowDot = `<span style="position:absolute;right:-5px;top:${(top - 5).toFixed(0)}px;width:10px;height:10px;border-radius:50%;background:#EA4335;z-index:3"></span>`;
                }
            }

            const blocks = list.map((b, i) => {
                const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30;
                const top = (s - tStart) * PX;
                const h = Math.max(34, (e - s) * PX - 3);
                const col = empColor(b.employeeId);
                const isNoShow = b.status === 'no_show';
                const flagged = b.noShowCount > 0;              // некоректен клиент (има минали неявявания)
                const bgc = (isNoShow || flagged) ? '#D9534F' : col;
                const wPct = 100 / lanes, leftPct = laneOf[i] * wPct;
                const mark = flagged ? ' ⚠' : (b.status === 'completed' ? ' ✓' : '');
                // Изявено обрамчване + светеща сянка за некоректните — за да се забелязват веднага.
                const ring = flagged
                    ? 'outline:2.5px solid #fff;outline-offset:-1px;box-shadow:0 0 0 3px #D9534F,0 4px 14px rgba(217,83,79,.6);'
                    : 'box-shadow:0 2px 8px rgba(0,0,0,.16);';
                // Значка „записан онлайн през сайта" (глобус) — горен десен ъгъл.
                const onlineBadge = b.isOnline
                    ? `<span title="Записан онлайн през сайта" style="position:absolute;top:3px;right:3px;width:17px;height:17px;border-radius:50%;background:rgba(255,255,255,.95);color:${bgc};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.3)"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3.1c2.4 2.6 2.4 15.2 0 17.8M12 3.1c-2.4 2.6-2.4 15.2 0 17.8"/></svg></span>`
                    : '';
                const small = h < 50;
                const inner = small
                    ? `<div style="font-size:.72rem;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="font-weight:800">${b.startAt.slice(11, 16)}</span>${mark} · ${esc(b.serviceName)}</div>`
                    : `<div style="font-size:.72rem;font-weight:800;opacity:.95;line-height:1;white-space:nowrap">${b.startAt.slice(11, 16)}–${(b.endAt || '').slice(11, 16)}${mark}</div>
                       <div style="font-size:.82rem;font-weight:700;line-height:1.18;margin-top:.16rem;display:-webkit-box;-webkit-line-clamp:${h >= 68 ? 2 : 1};-webkit-box-orient:vertical;overflow:hidden">${esc(b.serviceName)}</div>
                       ${h >= 84 ? `<div style="font-size:.73rem;opacity:.92;margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.clientName || 'Клиент')}</div>` : ''}`;
                return `<button class="tl-bk" data-id="${b.id}" style="position:absolute;top:${top.toFixed(0)}px;height:${h.toFixed(0)}px;left:calc(${leftPct}% + 2px);width:calc(${wPct}% - 5px);background:${bgc};${b.status === 'completed' ? 'opacity:.8;' : ''}border:0;border-radius:${small ? 8 : 11}px;color:#fff;text-align:left;cursor:pointer;padding:${small ? '.15rem .5rem' : '.42rem .55rem'};overflow:hidden;${small ? 'display:flex;align-items:center;' : ''}${ring}">${small ? `<div style="min-width:0">${inner}</div>` : inner}${onlineBadge}</button>`;
            }).join('');

            const tlHtml = `
                <div class="tl-zoom" style="display:flex;margin-top:.4rem;transform-origin:top center;touch-action:pan-y">
                    <div style="flex:0 0 ${GUT}px;position:relative;height:${(H + 10).toFixed(0)}px">${gutLabels}${nowDot}</div>
                    <div class="tl-wrap" style="flex:1;min-width:0;overflow:hidden">
                        <div style="position:relative;height:${(H + 10).toFixed(0)}px">
                            ${hourBands}${gridLines}${nowLine}
                            <div class="tl-canvas" style="position:absolute;left:2px;right:2px;top:0;bottom:10px">${blocks}</div>
                        </div>
                    </div>
                </div>`;

            const canAdd = cfg.editable && cfg.createBooking &&
                (cfg.staffId || (cfg.showEmployee && cfg.employees && cfg.employees.length));
            const addHint = '';
            const schedHtml = (cfg.editable && cfg.staffId) ? `<div class="panel sched-panel" style="margin-top:1.4rem"><div class="spinner"></div></div>` : '';

            detail.innerHTML = `
                ${toolsHtml()}
                ${addHint}
                ${tlHtml}
                ${schedHtml}`;
            wireTools();
            // Ден: щипка = мащаб; при смаляване под минимума -> седмичен изглед.
            wireGestures(detail.querySelector('.tl-zoom'), {
                step: 1,
                onPinchEnd: (zoomedOut, target) => {
                    if (zoomedOut && target <= Z_MIN + 0.02) {
                        view = 'week'; zoom = Z_MIN; localStorage.setItem('bh_cal_zoom', zoom.toFixed(2)); navigate();
                        return true;
                    }
                    return false;
                }
            });

            // Клик на час -> попъп с детайли/действия.
            detail.querySelectorAll('.tl-bk').forEach(btn =>
                btn.addEventListener('click', (e) => { e.stopPropagation(); openBookingModal(list.find(x => x.id === +btn.dataset.id)); }));

            // Клик на празно място -> добавяне на час в този времеви момент.
            const canvas = detail.querySelector('.tl-canvas');
            if (canvas && canAdd) {
                canvas.style.cursor = 'copy';
                canvas.addEventListener('click', (e) => {
                    if (e.target.closest('.tl-bk')) return;
                    const rect = canvas.getBoundingClientRect();
                    let mins = tStart + (e.clientY - rect.top) / PX;
                    mins = Math.max(tStart, Math.min(tEnd - 15, Math.round(mins / 15) * 15));
                    openAddModal(minToHHMM(mins));
                });
            }

            const sched = detail.querySelector('.sched-panel');
            if (sched) loadSchedule(sched, selKey);
        }

        // Попъп за добавяне на час (клик на празно място в графика).
        // В „Целият салон" има и избор на специалист (за кого е часът).
        function openAddModal(hhmm) {
            document.querySelectorAll('.cal-modal-backdrop').forEach(x => x.remove());
            const pickEmp = !!(cfg.showEmployee && cfg.employees && cfg.employees.length && cfg.servicesFor);

            let timeOpts = '';
            for (let mm = 8 * 60; mm <= 20 * 60; mm += 15) { const v = minToHHMM(mm); timeOpts += `<option value="${v}"${v === hhmm ? ' selected' : ''}>${v}</option>`; }
            const empOpts = pickEmp ? cfg.employees.map(e => `<option value="${e.id}"${empFilter === e.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('') : '';
            const staticSvc = pickEmp ? '' : (cfg.services || []).map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('');
            const lbl = 'display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.35rem';

            const backdrop = document.createElement('div');
            backdrop.className = 'cal-modal-backdrop';
            backdrop.innerHTML = `
                <div class="cal-modal">
                    <button class="cal-modal__close" aria-label="Затвори">×</button>
                    <div style="font-weight:800;font-size:1.15rem;margin-bottom:1rem">Нов час</div>
                    <div style="display:grid;gap:.85rem">
                        ${pickEmp ? `<label class="field" style="margin:0"><span style="${lbl}">Специалист</span>
                            <select class="select ad-emp">${empOpts}</select></label>` : ''}
                        <label class="field" style="margin:0"><span style="${lbl}">Услуга</span>
                            <select class="select ad-svc">${pickEmp ? '<option value="">Избери специалист…</option>' : (staticSvc || '<option value="">Няма зададени услуги</option>')}</select></label>
                        <label class="field" style="margin:0"><span style="${lbl}">Начален час</span>
                            <select class="select ad-time">${timeOpts}</select></label>
                        <label class="field" style="margin:0"><span style="${lbl}">Продължителност в графика <span style="font-weight:400;color:var(--muted)">(процедура + почивка)</span></span>
                            <select class="select ad-dur"></select></label>
                        <label class="field" style="margin:0"><span style="${lbl}">Име на клиента</span>
                            <input class="input ad-name" type="text" placeholder="напр. Мария (по телефон)"></label>
                        <label class="field" style="margin:0"><span style="${lbl}">Телефон (по избор)</span>
                            <input class="input ad-phone" type="tel" placeholder="+359…"></label>
                        <button class="btn btn--primary ad-save">Запиши часа</button>
                        <div class="ad-msg"></div>
                    </div>
                </div>`;
            document.body.appendChild(backdrop);
            const close = () => backdrop.remove();
            backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
            backdrop.querySelector('.cal-modal__close').addEventListener('click', close);

            const empSel = backdrop.querySelector('.ad-emp');
            const svcSel = backdrop.querySelector('.ad-svc');
            const durSel = backdrop.querySelector('.ad-dur');
            const msg = backdrop.querySelector('.ad-msg');
            const REST = 10; // почивка по подразбиране след процедурата

            // Опции за продължителност в графика: процедура (без почивка),
            // процедура + почивка (по подразбиране) и още варианти за удължаване.
            function fillDur(procMin) {
                const p = procMin || 30;
                const set = new Set([p, p + REST, p + 20, p + 30, p + 45, p + 60, p + 90]);
                const def = p + REST;
                durSel.innerHTML = [...set].sort((a, b) => a - b).map(m => {
                    const tag = m === p ? ' (само процедура)' : (m === def ? ' · препоръчано' : '');
                    return `<option value="${m}"${m === def ? ' selected' : ''}>${m} мин${tag}</option>`;
                }).join('');
            }

            // Карта service_id -> времетраене на процедурата.
            let svcDur = {};
            (cfg.services || []).forEach(s => { svcDur[s.serviceId] = s.durationMinutes; });

            async function loadSvc(empId) {
                svcSel.innerHTML = `<option value="">Зареждане…</option>`;
                try {
                    const list = await cfg.servicesFor(empId);
                    svcDur = {};
                    (list || []).forEach(s => { svcDur[s.serviceId] = s.durationMinutes; });
                    svcSel.innerHTML = (list && list.length)
                        ? list.map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('')
                        : `<option value="">Няма зададени услуги</option>`;
                    fillDur(svcDur[+svcSel.value]);
                } catch (e) { svcSel.innerHTML = `<option value="">Грешка при зареждане</option>`; }
            }
            svcSel.addEventListener('change', () => fillDur(svcDur[+svcSel.value]));
            if (empSel) { empSel.addEventListener('change', () => loadSvc(+empSel.value)); loadSvc(+empSel.value); }
            else fillDur(svcDur[+svcSel.value]); // единичен специалист: услугите вече са налични

            backdrop.querySelector('.ad-save').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const employeeId = empSel ? +empSel.value : cfg.staffId;
                const dto = {
                    employeeId,
                    serviceId: +svcSel.value,
                    startAt: `${selKey}T${backdrop.querySelector('.ad-time').value}:00`,
                    durationMinutes: +durSel.value || null,
                    guestName: backdrop.querySelector('.ad-name').value.trim(),
                    guestPhone: backdrop.querySelector('.ad-phone').value.trim() || null,
                    note: null
                };
                if (pickEmp && !employeeId) { msg.innerHTML = `<div class="alert alert--err">Избери специалист.</div>`; return; }
                if (!dto.serviceId) { msg.innerHTML = `<div class="alert alert--err">Избери услуга.</div>`; return; }
                if (!dto.guestName) { msg.innerHTML = `<div class="alert alert--err">Въведи име на клиента.</div>`; return; }
                btn.disabled = true; btn.style.opacity = .7;
                try { await cfg.createBooking(dto); close(); await load(); }
                catch (err) { msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`; btn.disabled = false; btn.style.opacity = 1; }
            });
        }

        async function act(btn, fn) {
            btn.disabled = true; btn.style.opacity = .7;
            try { await fn(); await load(); }
            catch (err) { alert(err.message); btn.disabled = false; btn.style.opacity = 1; }
        }

        // Опции за продължителност (за редакция в попъпа).
        function durOptions(cur) {
            const opts = [15, 20, 30, 40, 45, 60, 75, 90, 105, 120, 150, 180];
            let o = opts.includes(cur) ? '' : `<option value="${cur}" selected>${cur} мин</option>`;
            opts.forEach(m => { o += `<option value="${m}"${m === cur ? ' selected' : ''}>${m} мин</option>`; });
            return o;
        }

        // Попъп за час: детайли + присъства/не присъства + отстъпка + времетраене + изтрий.
        function openBookingModal(b) {
            if (!b) return;
            document.querySelectorAll('.cal-modal-backdrop').forEach(x => x.remove());

            const st = STATUS[b.status] || { label: b.status, cls: 'alert--info' };
            const flagged = b.noShowCount > 0;
            const orig = b.priceSnapshot || 0;
            const curDisc = b.discountPercent || 0;
            const finalPrice = (b.priceFinal != null) ? b.priceFinal : orig;
            const dur = Math.round((new Date(b.endAt) - new Date(b.startAt)) / 60000) || 30;
            const canManage = !!cfg.canManage;
            const phone = b.clientPhone ? `<a href="tel:${esc(b.clientPhone)}">${esc(b.clientPhone)}</a>` : '—';

            const warn = flagged
                ? `<div style="background:#D9534F;color:#fff;font-weight:800;font-size:.78rem;padding:.5rem .8rem;border-radius:12px;margin-bottom:1rem">⚠ Некоректен клиент · ${b.noShowCount}× не се е явявал(а)</div>` : '';

            const priceBlock = canManage
                ? `<div class="cal-modal__price">
                       <label style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;font-size:.9rem;margin-bottom:.9rem">Отстъпка (лоялен клиент)
                           <span style="white-space:nowrap"><input class="input md-disc" type="number" min="0" max="100" value="${curDisc}" style="width:74px;text-align:center"> %</span></label>
                       <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:1.05rem">
                           <span class="hint">Цена</span>
                           <span><span class="md-orig" style="text-decoration:${curDisc ? 'line-through' : 'none'};color:var(--muted);font-size:.9rem">${orig.toFixed(0)} €</span>
                           <b class="md-final" style="color:var(--rose-deep);margin-left:.5rem;font-family:var(--font-display);font-size:1.4rem">${(orig * (100 - curDisc) / 100).toFixed(0)} €</b></span>
                       </div>
                   </div>`
                : `<div class="cal-modal__price" style="display:flex;justify-content:space-between;align-items:baseline;font-size:1.05rem">
                       <span class="hint">Цена</span><b style="color:var(--rose-deep);font-family:var(--font-display);font-size:1.4rem">${Number(finalPrice).toFixed(0)} €</b></div>`;

            let actions = '';
            if (cfg.editable) {
                actions = `<div class="cal-modal__actions">
                    <button class="btn btn--gold md-present">Присъства (проведен)</button>
                    <button class="btn btn--ghost md-absent">Не присъства</button>
                    ${canManage ? `
                    <label class="hint" style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:.4rem">Времетраене
                        <select class="select md-dur" style="width:auto">${durOptions(dur)}</select></label>
                    <button class="btn btn--ghost md-del" style="color:#D9534F">Изтрий часа</button>` : ''}
                </div>`;
            }

            const backdrop = document.createElement('div');
            backdrop.className = 'cal-modal-backdrop';
            backdrop.innerHTML = `
                <div class="cal-modal">
                    <button class="cal-modal__close" aria-label="Затвори">×</button>
                    ${warn}
                    <div class="cal-modal__title">${esc(b.serviceName)}</div>
                    <div class="cal-modal__meta hint">${b.startAt.slice(11, 16)}–${(b.endAt || '').slice(11, 16)}${cfg.showEmployee ? ' · ' + esc(b.employeeName) : ''} <span class="alert ${st.cls}" style="padding:.12rem .5rem;font-size:.72rem">${st.label}</span></div>
                    <div class="cal-modal__rows">
                        <div class="cmrow"><span class="hint">Клиент</span><b>${esc(b.clientName || 'Клиент')}</b></div>
                        <div class="cmrow"><span class="hint">Телефон</span><span>${phone}</span></div>
                        <div class="cmrow"><span class="hint">Източник</span>${b.isOnline
                            ? `<span style="display:inline-flex;align-items:center;gap:.35rem;background:var(--blush-soft);color:var(--rose-deep);border-radius:999px;padding:.22rem .65rem;font-size:.76rem;font-weight:700"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3.1c2.4 2.6 2.4 15.2 0 17.8M12 3.1c-2.4 2.6-2.4 15.2 0 17.8"/></svg> Онлайн през сайта</span>`
                            : `<span style="display:inline-flex;align-items:center;gap:.35rem;background:var(--line);color:var(--ink-soft);border-radius:999px;padding:.22rem .65rem;font-size:.76rem;font-weight:700">Въведен ръчно</span>`}</div>
                    </div>
                    ${priceBlock}
                    ${actions}
                    <div class="md-msg" style="margin-top:.8rem"></div>
                </div>`;
            document.body.appendChild(backdrop);

            const close = () => backdrop.remove();
            backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
            backdrop.querySelector('.cal-modal__close').addEventListener('click', close);

            const discInp = backdrop.querySelector('.md-disc');
            if (discInp) {
                const finalEl = backdrop.querySelector('.md-final'), origEl = backdrop.querySelector('.md-orig');
                discInp.addEventListener('input', () => {
                    const d = Math.max(0, Math.min(100, +discInp.value || 0));
                    finalEl.textContent = (orig * (100 - d) / 100).toFixed(0) + ' €';
                    origEl.style.textDecoration = d ? 'line-through' : 'none';
                });
            }

            const msg = backdrop.querySelector('.md-msg');
            const run = async (fn) => {
                try { await fn(); close(); await load(); }
                catch (err) { msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`; }
            };
            const saveDiscount = async () => {
                if (discInp && cfg.setDiscount) {
                    const d = Math.max(0, Math.min(100, +discInp.value || 0));
                    if (d !== curDisc) await cfg.setDiscount(b.id, d);
                }
            };

            const present = backdrop.querySelector('.md-present');
            if (present) present.addEventListener('click', () => run(async () => { await saveDiscount(); await cfg.setStatus(b.id, 'completed'); }));
            const absent = backdrop.querySelector('.md-absent');
            if (absent) absent.addEventListener('click', () => run(() => cfg.setStatus(b.id, 'no_show')));
            const del = backdrop.querySelector('.md-del');
            if (del) del.addEventListener('click', () => { if (confirm('Да изтрия ли този час?')) run(() => cfg.deleteBk(b.id)); });
            const durSel = backdrop.querySelector('.md-dur');
            if (durSel) durSel.addEventListener('change', () => run(() => cfg.setDuration(b.id, +durSel.value)));
        }

        function renderForm(box) {
            if (!box) return;
            if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = '0'; return; }
            box.dataset.open = '1';
            const svcOpts = (cfg.services || [])
                .map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('');
            box.innerHTML = `
                <div class="panel" style="margin-top:1rem;display:grid;gap:.9rem">
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Услуга</span>
                        <select class="select f-svc">${svcOpts || '<option value="">Нямаш зададени услуги</option>'}</select>
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Свободен час</span>
                        <select class="select f-slot"><option value="">Избери услуга…</option></select>
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Име на клиента</span>
                        <input class="input f-name" type="text" placeholder="напр. Мария (по телефон)">
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Телефон (по избор)</span>
                        <input class="input f-phone" type="tel" placeholder="+359…">
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Бележка (по избор)</span>
                        <input class="input f-note" type="text">
                    </label>
                    <button class="btn btn--primary f-save" style="justify-self:start">Запиши часа</button>
                    <div class="f-msg"></div>
                </div>`;

            const svc = box.querySelector('.f-svc');
            const slot = box.querySelector('.f-slot');
            const msg = box.querySelector('.f-msg');

            async function loadSlots() {
                const sid = svc.value;
                if (!sid) { slot.innerHTML = `<option value="">—</option>`; return; }
                slot.innerHTML = `<option value="">Зареждане…</option>`;
                try {
                    const times = await window.API.get(`/availability?employeeId=${cfg.staffId}&serviceId=${sid}&date=${selKey}`);
                    slot.innerHTML = (times && times.length)
                        ? times.map(t => `<option value="${t}">${t.slice(11, 16)}</option>`).join('')
                        : `<option value="">Няма свободни часове</option>`;
                } catch (err) {
                    slot.innerHTML = `<option value="">Грешка</option>`;
                }
            }
            svc.addEventListener('change', loadSlots);
            loadSlots();

            box.querySelector('.f-save').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const dto = {
                    serviceId: +svc.value,
                    startAt: slot.value,
                    guestName: box.querySelector('.f-name').value.trim(),
                    guestPhone: box.querySelector('.f-phone').value.trim() || null,
                    note: box.querySelector('.f-note').value.trim() || null
                };
                if (!dto.serviceId || !dto.startAt) { msg.innerHTML = `<div class="alert alert--err">Избери услуга и свободен час.</div>`; return; }
                if (!dto.guestName) { msg.innerHTML = `<div class="alert alert--err">Въведи име на клиента.</div>`; return; }
                btn.disabled = true; btn.style.opacity = .7;
                try {
                    await cfg.createBooking(dto);
                    await load();
                } catch (err) {
                    msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
                    btn.disabled = false; btn.style.opacity = 1;
                }
            });
        }

        function reloadAll() { load(); }

        // Панел „Работно време" за избрания ден: ефективни часове + свободни
        // слотове (клик = блокирай) + блокирани (клик = освободи) + промяна.
        async function loadSchedule(box, dayKey) {
            box.innerHTML = `<div class="spinner"></div>`;
            let info;
            try {
                info = await window.API.get(`/schedule/day?employeeId=${cfg.staffId}&date=${dayKey}`);
            } catch (err) {
                box.innerHTML = `<div class="hint">Работното време е недостъпно (${esc(err.message)}).</div>`;
                return;
            }
            const wd = new Date(dayKey + 'T00:00:00').getDay();
            const hoursText = info.isOff ? 'Почивен ден' : `${minToHHMM(info.startMin)} – ${minToHHMM(info.endMin)}`;

            const chip = 'display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.28rem .7rem;font-size:.8rem;cursor:pointer;border:1px solid var(--line);background:var(--ivory)';
            const chipBlk = 'display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.28rem .7rem;font-size:.8rem;cursor:pointer;border:1px solid transparent;background:var(--grad-rose);color:#fff';

            const free = (info.freeSlots || []).map(s =>
                `<button class="sc-block" data-t="${s}" title="Блокирай (почивка)" style="${chip}">${s.slice(11, 16)} ✕</button>`
            ).join('') || '<span class="hint">Няма свободни слотове.</span>';

            const blocks = (info.blocks || []).map(b =>
                `<button class="sc-unblock" data-id="${b.id}" title="Освободи" style="${chipBlk}">${b.startAt.slice(11, 16)} ↺</button>`
            ).join('');

            box.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
                    <strong>Работно време: <span style="color:var(--rose-deep)">${hoursText}</span></strong>
                    <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                        <button class="btn btn--ghost sc-edit" style="--pad-y:.4rem;--pad-x:.8rem;font-size:.8rem">Промени часове</button>
                        <button class="btn btn--ghost sc-off" style="--pad-y:.4rem;--pad-x:.8rem;font-size:.8rem">${info.isOff ? 'Направи работен' : 'Почивен ден'}</button>
                    </div>
                </div>
                <div class="sc-form"></div>
                ${info.isOff ? '' : `
                <div style="margin-top:.9rem">
                    <div class="hint" style="margin-bottom:.4rem">Свободни слотове:</div>
                    <div style="display:flex;flex-wrap:wrap;gap:.4rem">${free}</div>
                    ${blocks ? `<div class="hint" style="margin:.8rem 0 .4rem">Почивки:</div><div style="display:flex;flex-wrap:wrap;gap:.4rem">${blocks}</div>` : ''}
                </div>`}`;

            box.querySelector('.sc-off').addEventListener('click', async () => {
                try {
                    if (info.isOff) await window.API.del(`/schedule/override?employeeId=${cfg.staffId}&date=${dayKey}`);
                    else await window.API.put('/schedule/override', { employeeId: cfg.staffId, date: dayKey, isOff: true });
                    reloadAll();
                } catch (err) { alert(err.message); }
            });
            box.querySelector('.sc-edit').addEventListener('click', () => schedForm(box.querySelector('.sc-form'), info, dayKey, wd));
            box.querySelectorAll('.sc-block').forEach(btn => btn.addEventListener('click', async () => {
                try {
                    await window.API.post('/schedule/block', { employeeId: cfg.staffId, startAt: btn.dataset.t, endAt: addMinIso(btn.dataset.t, 30) });
                    reloadAll();
                } catch (err) { alert(err.message); }
            }));
            box.querySelectorAll('.sc-unblock').forEach(btn => btn.addEventListener('click', async () => {
                try { await window.API.del(`/schedule/block/${btn.dataset.id}?employeeId=${cfg.staffId}`); reloadAll(); }
                catch (err) { alert(err.message); }
            }));
        }

        function schedForm(box, info, dayKey, wd) {
            if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = '0'; return; }
            box.dataset.open = '1';
            const from = info.isOff ? '09:00' : minToHHMM(info.startMin);
            const to = info.isOff ? '18:00' : minToHHMM(info.endMin);
            const lbl = 'display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.35rem';
            box.innerHTML = `
                <div class="panel" style="margin-top:.8rem;display:grid;gap:.7rem;max-width:360px">
                    <label class="field" style="margin:0"><span style="${lbl}">От</span><select class="select sc-from">${timeOptions(from)}</select></label>
                    <label class="field" style="margin:0"><span style="${lbl}">До</span><select class="select sc-to">${timeOptions(to)}</select></label>
                    <label class="field" style="margin:0"><span style="${lbl}">Приложи за</span>
                        <select class="select sc-scope">
                            <option value="day">Само този ден</option>
                            <option value="week">Всеки ${WDNAMES[wd]} нататък</option>
                        </select>
                    </label>
                    <button class="btn btn--primary sc-save" style="justify-self:start">Запази</button>
                </div>`;
            box.querySelector('.sc-save').addEventListener('click', async () => {
                const sm = hhmmToMin(box.querySelector('.sc-from').value);
                const em = hhmmToMin(box.querySelector('.sc-to').value);
                if (sm == null || em == null || em <= sm) { alert('Невалидни часове (краят трябва да е след началото).'); return; }
                const scope = box.querySelector('.sc-scope').value;
                try {
                    if (scope === 'day')
                        await window.API.put('/schedule/override', { employeeId: cfg.staffId, date: dayKey, startMin: sm, endMin: em, isOff: false });
                    else
                        await window.API.put('/schedule/hours', { employeeId: cfg.staffId, days: [{ weekday: wd, startMin: sm, endMin: em, isOff: false }] });
                    reloadAll();
                } catch (err) { alert(err.message); }
            });
        }

        load();
    }

    return { mount };
})();

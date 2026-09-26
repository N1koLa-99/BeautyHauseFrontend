/* =====================================================================
   График (стил Studio 24) за служител/шеф.
   Calendar.mount(container, cfg):
     cfg.editable     – true => може ръчно добавяне на час + маркиране
     cfg.staffId      – id-то на служителя (за свободни часове)
     cfg.services     – [{serviceId, serviceName, durationMinutes}] (за формата)
     cfg.showEmployee – графикът на целия салон (колона за всяка специалистка)
     cfg.employees    – [{id, name, photo}] (за избора „чий график")
     cfg.workHours    – {0..6: [startMin, endMin] | null} (по избор; иначе часовете на салона)
     cfg.fetchMonth(fromStr, toStr) -> Promise<bookings[]>
     cfg.createBooking(dto) -> Promise            (ако editable)
     cfg.setStatus(id, status) -> Promise         (ако editable)

   Жестове (като в приложението на Studio 24):
     • 2 пръста (или Ctrl + колелце) -> мащаб по часове и по дни
     • иконката горе вляво           -> свий всичко в екрана / разгъни
     • докосване на празно място     -> нов час в този момент
     • задръж + плъзни надолу        -> маркира период (напр. 09:00–12:00) -> нов час с тази продължителност
     • плъзгане настрани (в Ден)     -> предишен/следващ ден
   ===================================================================== */
window.Calendar = (function () {
    const MON = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
        'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
    const MON_S = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
    const WD_S = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];            // по getDay()
    const WD_MON = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];          // седмица от понеделник
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
    // Видимата част от денонощието в графика: 08:00–20:00 (извън нея салонът не работи).
    const DAY_S = 7 * 60 + 30, DAY_E = 20 * 60 + 30, SPAN = DAY_E - DAY_S;   // видимо: 07:30–20:30 (по половин час буфер)
    const BOOK_S = 8 * 60, BOOK_E = 20 * 60;                                 // записване: 08:00–20:00
    const clampM = m => Math.max(DAY_S, Math.min(DAY_E, m));
    // 24-часови опции за час (стъпка 30 мин) — гарантира 24ч формат навсякъде.
    const timeOptions = (selected) => {
        let o = '';
        for (let m = BOOK_S; m <= BOOK_E; m += 30) {
            const v = minToHHMM(m);
            o += `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
        }
        return o;
    };
    // Стабилен цвят за всеки специалист (по id).
    // Тоновете са нарочно РАЗЛИЧНИ един от друг (синьо · охра · слива · тюркоаз ·
    // лилаво · маслина), за да се различава от пръв поглед чий е часът. Всички са
    // достатъчно тъмни за четим бял текст (контраст ≥ 4.8:1).
    // Червеното е запазено за некоректни клиенти — затова го няма в списъка.
    const EMP_COLORS = ['#2F6BB0', '#9C6614', '#9B3E7D', '#1F7A6B', '#6B4BA8', '#5E7A1E'];
    const empColor = id => EMP_COLORS[Math.abs(+id || 0) % EMP_COLORS.length];

    // Бялата (работна) част на графика: пн–сб 08:00–20:00 — толкова може да се записва ръчно.
    // Неделя остава сива (салонът е затворен), но пак може да се запише час при нужда.
    const SALON_HOURS = { 0: null, 1: [480, 1200], 2: [480, 1200], 3: [480, 1200], 4: [480, 1200], 5: [480, 1200], 6: [480, 1200] };

    // Геометрия на решетката. --hh = пиксели за 1 час, --cw = ширина на колона.
    const HH0 = 60, CW0 = 105, GUT = 50, HEAD = 46, SNAP = 15;
    const Z_MIN = 0.3, Z_MAX = 4, Z_DEF = 1.2;
    // Позиция във времевата решетка като % от денонощието — блокчетата следват
    // височината на колоната сами, без да се пресмятат наново при мащаб.
    // pct(минута) -> позиция; pctD(минути) -> височина. И двете спрямо 08:00–20:00.
    const pct = min => ((clampM(min) - DAY_S) / SPAN * 100).toFixed(4) + '%';
    const pctD = d => (d / SPAN * 100).toFixed(4) + '%';
    const VIEWS = [['day', 'Ден'], ['3day', '3 дни'], ['week', 'Седмица'], ['month', 'Месец']];

    const ICO = {
        prev: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15.5 5 7.5 12l8 7z" fill="currentColor"/></svg>',
        next: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M8.5 5l8 7-8 7z" fill="currentColor"/></svg>',
        today: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none"><rect x="3" y="4.5" width="18" height="16.5" rx="2.4" fill="currentColor" opacity=".38"/><path d="M3 9h18" stroke="currentColor" stroke-width="1.6" opacity=".55"/><path d="M7.5 2.8v3.4M16.5 2.8v3.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/><rect x="6.5" y="11.5" width="5" height="5" rx=".8" fill="currentColor" opacity=".75"/></svg>',
        menu: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3.5 6h17M3.5 12h17M3.5 18h17"/></svg>',
        chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
        // Стрелки навътре = „свий"; навън = „разгъни".
        compress: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4l-6.5 6.5M13.5 5.5v5h5M4 20l6.5-6.5M10.5 18.5v-5h-5"/></svg>',
        expand: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 10.5 20 4M15 4h5v5M10.5 13.5 4 20M9 20H4v-5"/></svg>',
        people: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="8.5" r="3.2"/><path d="M3 19c.9-3.3 3.2-5 6-5s5.1 1.7 6 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M16 14.1c2.4 0 4.3 1.5 5 4.4"/></svg>',
        check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'
    };
    const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

    // ---- Бърз избор на услуга: търсене + категории + последно избирани ----
    // Стои върху обикновения <select> (той остава източникът на стойността), така че
    // останалият код (зареждане, продължителност, запис) работи както преди.
    const svcNorm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya' };
    // И „мигли", и „migli" намират едно и също.
    const toLat = s => svcNorm(s).replace(/[а-я]/g, c => LAT[c] || c);
    let catIndex = null;
    function svcCatalog() {
        if (catIndex) return catIndex;
        catIndex = new Map();
        let i = 0;
        (window.BH_CATALOG || []).forEach(c => c.groups.forEach(g => g.items.forEach(it => {
            const put = db => { const k = svcNorm(db); if (k && !catIndex.has(k)) catIndex.set(k, { cat: c.label, group: g.name, order: i++ }); };
            if (it.options) it.options.forEach(o => put(o.db)); else put(it.db || it.name);
        })));
        return catIndex;
    }

    function svcPicker(sel, recentKey) {
        const wrap = document.createElement('div');
        // В попъпа списъкът се отваря върху целия попъп (не го удължава).
        const sheet = !!sel.closest('.cal-modal');
        wrap.className = 'svp' + (sheet ? ' svp--sheet' : '');
        wrap.innerHTML = `<button type="button" class="select svp-btn"></button>
            <div class="svp-pop" hidden>
                <div class="svp-top"><button type="button" class="svp-back" aria-label="Назад"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><span>Избери услуга</span></div>
                <input class="input svp-q" type="search" placeholder="Търси услуга… (гел, лице, мигли)" autocomplete="off" enterkeyhint="done">
                <div class="svp-cats"></div>
                <div class="svp-list" role="listbox"></div>
            </div>`;
        sel.hidden = true;
        sel.after(wrap);
        const btn = wrap.querySelector('.svp-btn'), pop = wrap.querySelector('.svp-pop');
        const qEl = wrap.querySelector('.svp-q'), catsEl = wrap.querySelector('.svp-cats'), listEl = wrap.querySelector('.svp-list');
        let q = '', cat = '', act = 0, shown = [];

        const rKey = () => 'bh_svc_recent_' + recentKey();
        const recent = () => { try { return JSON.parse(lsGet(rKey())) || []; } catch (e) { return []; } };
        const remember = v => lsSet(rKey(), JSON.stringify([v, ...recent().filter(x => x !== v)].slice(0, 5)));

        function items() {
            const idx = svcCatalog();
            return [...sel.options].filter(o => o.value).map(o => {
                const m = o.text.match(/^(.*) · (\d+) мин$/);
                const name = m ? m[1] : o.text;
                if (o.value.startsWith('__'))
                    return { v: o.value, name, dur: null, cat: 'Почивка', group: 'Почивка', order: -1, hay: toLat(`${name} почивка почивен ден`) };
                const c = idx.get(svcNorm(name));
                return { v: o.value, name, dur: m ? +m[2] : null, cat: c ? c.cat : 'Други', group: c ? c.group : 'Други', order: c ? c.order : 1e6,
                    hay: toLat(`${name} ${c ? c.cat + ' ' + c.group : ''}`) };
            }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'bg'));
        }
        // Удебелява написаното в името (когато е на кирилица, както е в името).
        function hl(name) {
            const low = name.toLowerCase(), marks = [];
            svcNorm(q).split(' ').filter(Boolean).forEach(w => { const i = low.indexOf(w); if (i >= 0) marks.push([i, i + w.length]); });
            marks.sort((a, b) => a[0] - b[0]);
            let out = '', at = 0;
            marks.forEach(([s, e]) => { if (s < at) return; out += esc(name.slice(at, s)) + `<mark>${esc(name.slice(s, e))}</mark>`; at = e; });
            return out + esc(name.slice(at));
        }

        function paintBtn() {
            const o = sel.selectedOptions[0];
            const m = o && o.value && o.text.match(/^(.*) · (\d+) мин$/);
            btn.disabled = !items().length;
            btn.innerHTML = m ? `<span>${esc(m[1])}</span><small>${m[2]} мин</small>` : `<span>${esc(o ? o.text : '')}</span>`;
        }
        function renderList() {
            const all = items(), words = toLat(q).split(' ').filter(Boolean);
            const cats = [...new Set(all.map(i => i.cat))];
            catsEl.innerHTML = cats.length > 1 ? ['', ...cats].map(c =>
                `<button type="button" class="svp-cat${c === cat ? ' is-on' : ''}" data-c="${esc(c)}">${c ? esc(c) : 'Всички'}</button>`).join('') : '';
            shown = [];
            const row = it => `<button type="button" class="svp-it${it.v === sel.value ? ' is-sel' : ''}" data-i="${shown.push(it) - 1}" role="option"><span>${hl(it.name)}</span>${it.dur ? `<small>${it.dur} мин</small>` : ''}</button>`;
            let html = '';
            if (!q && !cat) {
                const rec = recent().map(v => all.find(i => i.v === v)).filter(Boolean);
                if (rec.length) html += `<div class="svp-h">Последно избирани</div>` + rec.map(row).join('');
            }
            let g = null;
            all.filter(it => (!cat || it.cat === cat) && words.every(w => it.hay.includes(w))).forEach(it => {
                const h = it.group === 'Други' ? 'Други' : ((cat || it.cat === it.group) ? it.group : `${it.cat} · ${it.group}`);
                if (h !== g) { g = h; html += `<div class="svp-h">${esc(h)}</div>`; }
                html += row(it);
            });
            listEl.innerHTML = html || `<div class="svp-empty">Няма услуга с „${esc(q)}“</div>`;
            act = Math.min(act, Math.max(0, shown.length - 1));
            paintAct();
        }
        function paintAct(center) {
            listEl.querySelectorAll('.svp-it.is-act').forEach(x => x.classList.remove('is-act'));
            const el = listEl.querySelector(`.svp-it[data-i="${act}"]`);
            if (el) { el.classList.add('is-act'); el.scrollIntoView({ block: center ? 'center' : 'nearest' }); }
        }

        function open() {
            if (btn.disabled) return;
            q = ''; cat = ''; qEl.value = '';
            pop.hidden = false; wrap.classList.add('is-open');
            renderList();
            act = Math.max(0, shown.findIndex(i => i.v === sel.value)); paintAct(true);
            if (!sheet) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            // На компютър -> направо се пише; на телефон клавиатурата не изскача сама.
            if (matchMedia('(hover: hover) and (pointer: fine)').matches) qEl.focus({ preventScroll: true });
        }
        function close() { pop.hidden = true; wrap.classList.remove('is-open'); }
        function pick(it) {
            if (!it) return;
            sel.value = it.v;
            sel.dispatchEvent(new Event('change'));
            remember(it.v);
            paintBtn(); close();
        }

        btn.addEventListener('click', () => pop.hidden ? open() : close());
        wrap.querySelector('.svp-back').addEventListener('click', () => { close(); btn.focus(); });
        qEl.addEventListener('input', () => { q = qEl.value; act = 0; renderList(); listEl.scrollTop = 0; });
        qEl.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                act = Math.max(0, Math.min(shown.length - 1, act + (e.key === 'ArrowDown' ? 1 : -1))); paintAct();
            } else if (e.key === 'Enter') { e.preventDefault(); pick(shown[act]); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
        });
        catsEl.addEventListener('click', (e) => {
            const c = e.target.closest('.svp-cat'); if (!c) return;
            cat = c.dataset.c; act = 0; renderList(); listEl.scrollTop = 0;
        });
        listEl.addEventListener('click', (e) => { const b = e.target.closest('.svp-it'); if (b) pick(shown[+b.dataset.i]); });
        const outside = (e) => {
            if (!document.body.contains(wrap)) { document.removeEventListener('pointerdown', outside, true); return; }
            if (!pop.hidden && !wrap.contains(e.target)) close();
        };
        document.addEventListener('pointerdown', outside, true);
        // Списъкът се сменя (друга специалистка, зареждане…) -> бутонът се обновява.
        new MutationObserver(() => { paintBtn(); if (!pop.hidden) renderList(); }).observe(sel, { childList: true });
        paintBtn();
    }

    function mount(container, cfg) {
        const todayKey = () => { const d = new Date(); return key(d.getFullYear(), d.getMonth(), d.getDate()); };
        const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
        let selKey = todayKey();
        let data = {};            // 'YYYY-MM-DD' -> [bookings]
        let offs = {};            // 'YYYY-MM-DD' -> [почивки {kind:'rest'} / почивен ден {kind:'off'}]
        let empFilter = null;     // избрана специалистка (null = всички)
        let view = VIEWS.some(v => v[0] === lsGet('bh_sc_view')) ? lsGet('bh_sc_view') : 'week';
        const clampZoom = z => Math.min(Z_MAX, Math.max(Z_MIN, z));
        let zoom = clampZoom(parseFloat(lsGet('bh_sc_zoom')) || Z_DEF);
        // Прагове за натовареност (Радина ги задава от Настройки; пазят се локално).
        const loadY = parseInt(lsGet('bh_load_yellow'), 10) || 10;
        const loadR = parseInt(lsGet('bh_load_red'), 10) || 15;
        const workHours = cfg.workHours || SALON_HOURS;

        container.innerHTML = `
            <div class="sc">
                <div class="sc-bar">
                    <button type="button" class="sc-date" aria-label="Избери дата"><span class="sc-date__d"></span><span class="sc-date__w"></span></button>
                    <div class="sc-bar__mid">
                        <button type="button" class="sc-ic sc-prev" aria-label="Назад">${ICO.prev}</button>
                        <button type="button" class="sc-ic sc-today" aria-label="Днес">${ICO.today}</button>
                        <button type="button" class="sc-ic sc-next" aria-label="Напред">${ICO.next}</button>
                    </div>
                    <button type="button" class="sc-ic sc-menu" aria-label="Изглед">${ICO.menu}</button>
                </div>
                <div class="sc-pop sc-pop--date" hidden></div>
                <div class="sc-pop sc-pop--menu" hidden></div>
                <div class="sc-scroll"></div>
                <div class="sc-fabs">
                    <button type="button" class="sc-fab sc-fab--who" aria-label="Чий график" hidden></button>
                    <button type="button" class="sc-fab sc-fab--add" aria-label="Нов час" hidden>
                        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                </div>
                <div class="sc-sheet" hidden></div>
                <div class="sc-loading" hidden><div class="spinner"></div></div>
            </div>
            <div class="sc-below"></div>`;

        const root = container.querySelector('.sc');
        const scroll = root.querySelector('.sc-scroll');
        const dateBtn = root.querySelector('.sc-date');
        const popDate = root.querySelector('.sc-pop--date');
        const popMenu = root.querySelector('.sc-pop--menu');
        const sheet = root.querySelector('.sc-sheet');
        const fabWho = root.querySelector('.sc-fab--who');
        const fabAdd = root.querySelector('.sc-fab--add');
        const loadingEl = root.querySelector('.sc-loading');
        const below = container.querySelector('.sc-below');

        // ---- Специалистки ----
        function empsSorted() {
            const ORDER = ['ирина', 'радина', 'анелия'];
            const rank = n => { const s = (n || '').toLowerCase(); const i = ORDER.findIndex(o => s.includes(o)); return i < 0 ? ORDER.length : i; };
            return (cfg.employees || []).slice().sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name), 'bg'));
        }
        const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'Специалист';
        const hasEmps = () => !!(cfg.showEmployee && cfg.employees && cfg.employees.length);
        const photoOf = e => e.photo || ((typeof TEAM_PHOTO_BY_NAME !== 'undefined' && TEAM_PHOTO_BY_NAME[e.name]) || '');
        const avatarHtml = (e, size) => {
            const p = photoOf(e);
            return p
                ? `<img class="sc-av" src="${esc(p)}" alt="" style="width:${size}px;height:${size}px;--c:${empColor(e.id)}">`
                : `<span class="sc-av sc-av--i" style="width:${size}px;height:${size}px;background:${empColor(e.id)};font-size:${Math.round(size * .42)}px">${esc(firstName(e.name).charAt(0))}</span>`;
        };
        const canAdd = () => !!(cfg.editable && cfg.createBooking &&
            (cfg.staffId || (hasEmps() && cfg.servicesFor)));

        // ---- Дати ----
        const parseK = k => new Date(k + 'T00:00:00');
        const kOf = d => key(d.getFullYear(), d.getMonth(), d.getDate());
        const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
        const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
        const toMin = iso => (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16));
        const endMin = b => b.endAt ? toMin(b.endAt) : toMin(b.startAt) + 30;
        const listFor = k => { const a = data[k] || []; return empFilter != null ? a.filter(b => b.employeeId === empFilter) : a; };
        const offsFor = k => { const a = offs[k] || []; return empFilter != null ? a.filter(o => o.employeeId === empFilter) : a; };
        // Почивки/почивни дни: за служител (собствения график) и шефа (чужд / целия салон).
        const canRest = () => !!(cfg.editable && (cfg.staffId || hasEmps()));
        const ITEM_SEL = '.sc-bk, .sc-dayoff, .sc-offtag';

        function visibleDays() {
            const sd = parseK(selKey);
            if (view === 'day') return [sd];
            if (view === '3day') return [0, 1, 2].map(i => addDays(sd, i));
            if (view === 'week') { const m = mondayOf(sd); return [0, 1, 2, 3, 4, 5, 6].map(i => addDays(m, i)); }
            const first = new Date(sd.getFullYear(), sd.getMonth(), 1), m = mondayOf(first);
            const last = new Date(sd.getFullYear(), sd.getMonth() + 1, 0);
            const cells = Math.ceil((Math.round((last - m) / 864e5) + 1) / 7) * 7;
            return Array.from({ length: cells }, (_, i) => addDays(m, i));
        }
        function visibleMonths() {
            const seen = new Set(), out = [];
            visibleDays().forEach(d => { const mk = `${d.getFullYear()}-${d.getMonth()}`; if (!seen.has(mk)) { seen.add(mk); out.push([d.getFullYear(), d.getMonth()]); } });
            return out;
        }

        // ---- Данни (кеш по месеци) ----
        const loadedMonths = new Set();
        async function fetchMonthInto(Y, M0) {
            const from = key(Y, M0, 1);
            const to = `${M0 === 11 ? Y + 1 : Y}-${pad((M0 + 1) % 12 + 1)}-01`;
            const rangeQ = hasEmps() ? 'all=true' : `employeeId=${cfg.staffId}`;
            const [items, rng] = await Promise.all([
                cfg.fetchMonth(from, to),
                // Почивките не са задължителни за графика -> грешка тук не спира зареждането.
                canRest() ? window.API.get(`/schedule/range?${rangeQ}&from=${from}&to=${to}`).catch(() => null) : null
            ]);
            const inMonth = dk => { const dt = parseK(dk); return dt.getFullYear() === Y && dt.getMonth() === M0; };
            for (const dk of Object.keys(data)) if (inMonth(dk)) delete data[dk];
            for (const dk of Object.keys(offs)) if (inMonth(dk)) delete offs[dk];
            (items || []).forEach(b => { const k = b.startAt.slice(0, 10); (data[k] = data[k] || []).push(b); });
            if (rng) {
                (rng.blocks || []).forEach(r => { const k = r.startAt.slice(0, 10); (offs[k] = offs[k] || []).push({ kind: 'rest', ...r }); });
                (rng.offDays || []).forEach(o => { const k = String(o.date).slice(0, 10); (offs[k] = offs[k] || []).push({ kind: 'off', employeeId: o.employeeId, employeeName: o.employeeName, k }); });
            }
            loadedMonths.add(`${Y}-${M0}`);
        }
        // Зарежда липсващите видими месеци (force = презарежда ги пак — след промяна).
        async function ensureVisible(force) {
            const need = visibleMonths().filter(([Y, M0]) => force || !loadedMonths.has(`${Y}-${M0}`));
            if (need.length) {
                loadingEl.hidden = false;
                try { for (const [Y, M0] of need) await fetchMonthInto(Y, M0); }
                catch (err) { loadingEl.hidden = true; scroll.innerHTML = `<div class="alert alert--err" style="margin:1rem">${esc(err.message)}</div>`; return; }
                loadingEl.hidden = true;
            }
            render();
        }
        function load() { belowKey = ''; return ensureVisible(true); }   // презареждане (след промяна)
        function navigate() { return ensureVisible(false); }  // навигация (зарежда само липсващото)

        function goToDate(k) { selKey = k; navigate(); }
        function setView(v) { view = v; lsSet('bh_sc_view', v); navigate(); }
        function shift(dir) {
            const sd = parseK(selKey);
            if (view === 'month') {
                const t = new Date(sd.getFullYear(), sd.getMonth() + dir, 1);
                const dim = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
                t.setDate(Math.min(sd.getDate(), dim));
                goToDate(kOf(t));
            } else goToDate(kOf(addDays(sd, dir * (view === 'week' ? 7 : view === '3day' ? 3 : 1))));
        }

        root.querySelector('.sc-prev').addEventListener('click', () => shift(-1));
        root.querySelector('.sc-next').addEventListener('click', () => shift(1));
        root.querySelector('.sc-today').addEventListener('click', () => { closePops(); pendingScroll = 'now'; goToDate(todayKey()); });

        // ================= Рисуване =================
        let lastLayout = '', pendingScroll = 'start';
        function render() {
            paintBar();
            paintFabs();
            if (view === 'month') renderMonth(); else renderGrid();
            renderBelow();
        }

        function paintBar() {
            const sd = parseK(selKey);
            const d = root.querySelector('.sc-date__d'), w = root.querySelector('.sc-date__w');
            if (view === 'month') { d.innerHTML = `${MON[sd.getMonth()].toUpperCase()} ${ICO.chev}`; w.textContent = sd.getFullYear(); }
            else { d.innerHTML = `${sd.getDate()} ${MON_S[sd.getMonth()].toUpperCase()} ${ICO.chev}`; w.textContent = WDNAMES[sd.getDay()]; }
        }

        function paintFabs() {
            fabAdd.hidden = !canAdd();
            fabWho.hidden = !hasEmps();
            if (!hasEmps()) return;
            const e = empFilter != null && cfg.employees.find(x => x.id === empFilter);
            fabWho.innerHTML = e ? avatarHtml(e, 56) : `<span class="sc-fab__all">${ICO.people}</span>`;
            fabWho.style.setProperty('--c', e ? empColor(e.id) : 'var(--sc-accent)');
        }

        // Колони на времевата решетка: дни, или (Ден + „Всички") — по една за всяка специалистка.
        function columns() {
            const days = visibleDays();
            if (view === 'day' && hasEmps() && empFilter == null)
                return empsSorted().map(e => ({ k: selKey, d: days[0], emp: e }));
            return days.map(d => ({ k: kOf(d), d, emp: null }));
        }

        function blocksHtml(items, rests) {
            const arr = items.map(b => ({ b, s: toMin(b.startAt), e: endMin(b) }))
                .concat((rests || []).map(r => ({ r, s: toMin(r.startAt), e: r.endAt.slice(0, 10) > r.startAt.slice(0, 10) ? 1440 : toMin(r.endAt) })))
                .map(x => {
                    x.s = Math.min(clampM(x.s), DAY_E - 15);
                    x.e = Math.max(clampM(x.e), x.s + 15);
                    return x;
                })
                .sort((x, y) => x.s - y.s || x.e - y.e);
            const laneEnd = [], laneOf = [];
            arr.forEach((x, i) => {
                let l = laneEnd.findIndex(v => v <= x.s);
                if (l === -1) { l = laneEnd.length; laneEnd.push(x.e); } else laneEnd[l] = x.e;
                laneOf[i] = l;
            });
            const lanes = Math.max(1, laneEnd.length), dl = Math.min(lanes, 8);
            return arr.map((x, i) => {
                const { s, e } = x, w = 100 / lanes, left = laneOf[i] * w;
                const pos = `top:${pct(s)};height:calc(${pctD(e - s)} - 2px);left:calc(${left}% + 1px);width:calc(${w}% - 2px)`;
                if (x.r) {
                    // Почивка — щрихована, в цвета на специалистката.
                    const r = x.r;
                    const who = cfg.showEmployee && empFilter == null ? esc(firstName(r.employeeName)) : '';
                    return `<button type="button" class="sc-bk sc-rest" data-l="${dl}" data-rest="${r.id}" data-k="${r.startAt.slice(0, 10)}" style="${pos};--bc:${empColor(r.employeeId)}">
                    <span class="sc-bk__t">${r.startAt.slice(11, 16)}–${minToHHMM(e)}</span>
                    <span class="sc-bk__s">Почивка</span>
                    ${who ? `<span class="sc-bk__c">${who}</span>` : ''}
                </button>`;
                }
                const b = x.b;
                const flagged = b.noShowCount > 0, noShow = b.status === 'no_show';
                const c = (flagged || noShow) ? '#D9534F' : empColor(b.employeeId);
                const mark = flagged ? ' ⚠' : (b.status === 'completed' ? ' ✓' : '');
                const cls = `sc-bk${flagged ? ' is-flag' : ''}${b.status === 'completed' ? ' is-done' : ''}${b.status === 'cancelled' ? ' is-cancel' : ''}`;
                const online = b.isOnline
                    ? `<span class="sc-bk__web" title="Записан онлайн през сайта"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6M12 3.1c2.4 2.6 2.4 15.2 0 17.8M12 3.1c-2.4 2.6-2.4 15.2 0 17.8"/></svg></span>` : '';
                return `<button type="button" class="${cls}" data-l="${dl}" data-id="${b.id}" data-k="${b.startAt.slice(0, 10)}" style="${pos};--bc:${c}">
                    <span class="sc-bk__t">${b.startAt.slice(11, 16)}–${(b.endAt || '').slice(11, 16)}${mark}</span>
                    <span class="sc-bk__s">${esc(b.serviceName)}</span>
                    <span class="sc-bk__c">${esc(b.clientName || 'Клиент')}${cfg.showEmployee && empFilter == null && view !== 'day' ? ' · ' + esc(firstName(b.employeeName)) : ''}</span>
                    ${online}
                </button>`;
            }).join('');
        }

        // Почивен ден в колоната: за една специалистка -> щрихова зона през работното време;
        // в обща колона (няколко специалистки) -> етикетче „Почивен · Име" най-горе.
        function dayOffHtml(c, wh) {
            const list = offsFor(c.k).filter(o => o.kind === 'off' && (!c.emp || o.employeeId === c.emp.id));
            if (!list.length) return '';
            const ws = clampM((wh || [540, 1110])[0]), we = clampM((wh || [540, 1110])[1]);
            const single = !!c.emp || !cfg.showEmployee || empFilter != null;
            if (single)
                return `<button type="button" class="sc-dayoff" data-off="${list[0].employeeId}" data-k="${c.k}" style="top:${pct(ws)};height:${pctD(we - ws)};--bc:${empColor(list[0].employeeId)}"><span>Почивен ден</span></button>`;
            return `<div class="sc-offtags" style="top:${pct(ws)}">${list.map(o =>
                `<button type="button" class="sc-offtag" data-off="${o.employeeId}" data-k="${c.k}" style="--bc:${empColor(o.employeeId)}">Почивен · ${esc(firstName(o.employeeName))}</button>`).join('')}</div>`;
        }

        function renderGrid() {
            const cols = columns(), n = cols.length, tk = todayKey(), nm = nowMin();
            let heads = '', bodies = '';
            cols.forEach(c => {
                const wh = workHours[c.d.getDay()];
                if (c.emp) {
                    heads += `<div class="sc-hd sc-hd--emp" style="--c:${empColor(c.emp.id)}">${avatarHtml(c.emp, 26)}<span>${esc(firstName(c.emp.name))}</span></div>`;
                } else {
                    const isToday = c.k === tk, isSel = c.k === selKey && view !== 'day';
                    heads += `<button type="button" class="sc-hd${isToday ? ' is-today' : ''}${isSel ? ' is-sel' : ''}" data-k="${c.k}"><span>${WD_S[c.d.getDay()]}</span> <b>${c.d.getDate()}</b><span class="sc-hd__m"> ${MON_S[c.d.getMonth()]}</span></button>`;
                }
                const items = listFor(c.k).filter(b => !c.emp || b.employeeId === c.emp.id);
                const rests = offsFor(c.k).filter(o => o.kind === 'rest' && (!c.emp || o.employeeId === c.emp.id));
                const work = wh ? `<div class="sc-work" style="top:${pct(wh[0])};height:${pctD(clampM(wh[1]) - clampM(wh[0]))}"></div>` : '';
                const nowL = c.k === tk && nm >= DAY_S && nm <= DAY_E ? `<div class="sc-now" style="top:${pct(nm)}"></div>` : '';
                bodies += `<div class="sc-col" data-k="${c.k}"${c.emp ? ` data-emp="${c.emp.id}"` : ''}>${work}<div class="sc-lines"></div>${dayOffHtml(c, wh)}${blocksHtml(items, rests)}${nowL}</div>`;
            });
            let gut = '';
            // Надпис на всеки 15 мин: кръгъл час (плътно), :30 и :15/:45 (по-дребно).
            for (let m = DAY_S + 15; m < DAY_E; m += 15) {
                const q = m % 60, cls = q === 0 ? (Math.floor(m / 60) % 2 ? ' is-odd' : '') : (q === 30 ? ' sc-gl--h' : ' sc-gl--q');
                gut += `<span class="sc-gl${cls}" style="top:${pct(m)}">${minToHHMM(m)}</span>`;
            }

            const prevTop = scroll.scrollTop, prevLeft = scroll.scrollLeft;
            root.dataset.n = n;
            scroll.innerHTML = `
                <div class="sc-grid">
                    <button type="button" class="sc-corner" aria-label="Свий / разгъни графика"></button>
                    ${heads}
                    <div class="sc-gut">${gut}</div>
                    ${bodies}
                </div>`;
            measure();
            applyZoom(zoom);

            // Скрол: при нов изглед -> към началото на работния ден; иначе остава, където е бил.
            const layout = `${view}|${n}`;
            if (layout !== lastLayout || pendingScroll) {
                const hh = HH0 * zoom;
                if (pendingScroll === 'now' && selKey === tk) scroll.scrollTop = Math.max(0, (clampM(nm) - 90 - DAY_S) / 60 * hh);
                else scroll.scrollTop = Math.max(0, (clampM(firstMinute(cols)) - DAY_S) / 60 * hh - 12);
                // Седмица, която не се побира -> избраният ден да е в началото.
                const idx = cols.findIndex(c => c.k === selKey && !c.emp);
                scroll.scrollLeft = idx > 0 ? idx * curCw() : 0;
            } else { scroll.scrollTop = prevTop; scroll.scrollLeft = prevLeft; }
            lastLayout = layout; pendingScroll = null;
        }
        // Най-ранната минута, която си струва да се вижда: началото на работното време или първият час.
        function firstMinute(cols) {
            let m = 24 * 60;
            cols.forEach(c => {
                const wh = workHours[c.d.getDay()];
                if (wh) m = Math.min(m, wh[0]);
                listFor(c.k).forEach(b => { if (!c.emp || b.employeeId === c.emp.id) m = Math.min(m, toMin(b.startAt)); });
            });
            return m === 24 * 60 ? 9 * 60 : Math.floor(m / 60) * 60;
        }
        function workSpan() {
            const cols = columns();
            let s = 24 * 60, e = 0;
            cols.forEach(c => {
                const wh = workHours[c.d.getDay()];
                if (wh) { s = Math.min(s, wh[0]); e = Math.max(e, wh[1]); }
                listFor(c.k).forEach(b => { s = Math.min(s, toMin(b.startAt)); e = Math.max(e, endMin(b)); });
            });
            if (e <= s) { s = 9 * 60; e = 19 * 60; }
            return [clampM(Math.floor(s / 60) * 60), clampM(Math.ceil(e / 60) * 60)];
        }

        // ---- Мащаб: само CSS променливи -> гладко, без пре-рендиране ----
        // Размерът на полето се чете рядко (рендер / resize), не на всеки кадър от
        // щипката — иначе браузърът пресмята цялата решетка по няколко пъти на кадър.
        let cw = 100, viewW = 0, viewH = 0, ctCache = null;
        const measure = () => { viewW = scroll.clientWidth; viewH = scroll.clientHeight; ctCache = null; };
        const curCw = () => cw;
        function cwFor(z) {
            const n = +root.dataset.n || 1;
            const W = Math.max(120, viewW - GUT);
            const fit = Math.floor(W / n * 100) / 100;
            return n <= 3 ? fit : Math.max(fit, CW0 * z);
        }
        function applyZoom(z) {
            zoom = clampZoom(z);
            const hh = HH0 * zoom;
            cw = cwFor(zoom);
            // Само размерът на решетката се сменя; всичко вътре е в % -> браузърът
            // не пресмята стиловете на стотиците блокчета на всеки кадър.
            const grid = scroll.querySelector('.sc-grid');
            if (grid) {
                grid.style.gridTemplateColumns = `${GUT}px repeat(${+root.dataset.n || 1}, ${cw.toFixed(2)}px)`;
                grid.style.gridTemplateRows = `${HEAD}px ${(hh * SPAN / 60).toFixed(2)}px`;
                grid.style.setProperty('--sc-hh', hh.toFixed(3) + 'px');   // линиите по часове (графикът започва от :30)
            }
            root.classList.toggle('is-small', hh < 50);
            root.classList.toggle('is-tiny', hh < 30);
            root.classList.toggle('is-narrow', cw < 92);
            // Колко подробни да са часовете вляво, за да не се застъпват надписите.
            root.classList.toggle('no-q', hh < 64);    // без :15 и :45
            root.classList.toggle('no-h', hh < 36);    // без :30
            // Много тесни блокчета (по брой застъпени = data-l) -> само цветът, без смачкан текст.
            for (let L = 1; L <= 8; L++) root.classList.toggle('hl' + L, (cw - 1) / L - 18 <= 34);
            const corner = scroll.querySelector('.sc-corner');
            if (corner) { const c = isCompressed(); if (corner._c !== c) { corner._c = c; corner.innerHTML = c ? ICO.expand : ICO.compress; } }
        }
        // Щипка / колелце идват по много пъти на кадър -> прилагаме само последното, веднъж на кадър.
        let zReq = null, zRaf = 0;
        const pendingZoom = () => zReq ? zReq.z : zoom;
        function zoomAt(z, fx, fy) {
            zReq = { z, fx, fy };
            if (!zRaf) zRaf = requestAnimationFrame(flushZoom);
        }
        function flushZoom() {
            cancelAnimationFrame(zRaf); zRaf = 0;
            const q = zReq; zReq = null;
            if (q) zoomAtNow(q.z, q.fx, q.fy);
        }
        // Мащаб около точка (пръстите / мишката) — тя остава на същото място.
        function zoomAtNow(z, fx, fy) {
            const r = scroll.getBoundingClientRect();
            const px = fx - r.left - GUT, py = fy - r.top - HEAD;
            const hours = (scroll.scrollTop + py) / (HH0 * zoom);
            const colsX = (scroll.scrollLeft + px) / curCw();
            applyZoom(z);
            scroll.scrollTop = hours * HH0 * zoom - py;
            scroll.scrollLeft = colsX * curCw() - px;
        }
        const saveZoom = () => lsSet('bh_sc_zoom', zoom.toFixed(2));
        const compressTarget = () => {
            if (ctCache != null) return ctCache;
            const [s, e] = workSpan();
            const n = +root.dataset.n || 1;
            const zv = (viewH - HEAD - 4) / ((e - s) / 60) / HH0;
            const zh = n > 3 ? (viewW - GUT) / n / CW0 : zv;
            return (ctCache = clampZoom(Math.min(zv, zh)));
        };
        const isCompressed = () => zoom <= compressTarget() + 0.02;

        let tweenId = null;
        function tweenZoom(target, after) {
            cancelAnimationFrame(tweenId);
            zReq = null; cancelAnimationFrame(zRaf); zRaf = 0;
            const from = zoom, t0 = performance.now(), dur = 240;
            const r = scroll.getBoundingClientRect();
            const ease = t => 1 - Math.pow(1 - t, 3);
            const step = (t) => {
                const k = Math.min(1, (t - t0) / dur);
                zoomAtNow(from + (target - from) * ease(k), r.left + GUT, r.top + HEAD);
                if (k < 1) tweenId = requestAnimationFrame(step);
                else { saveZoom(); if (after) after(); }
            };
            tweenId = requestAnimationFrame(step);
        }
        function toggleCompress() {
            if (isCompressed()) tweenZoom(Z_DEF);
            else {
                const s = workSpan()[0];
                tweenZoom(compressTarget(), () => { scroll.scrollTop = (s - DAY_S) / 60 * HH0 * zoom; scroll.scrollLeft = 0; });
            }
        }

        // Промяна на ширината (завъртане, показване на раздела) -> колоните се
        // преизчисляват, а хоризонталният скрол остава на същия ден.
        if (window.ResizeObserver) new ResizeObserver(() => {
            if (view === 'month') return;
            const colsX = scroll.scrollLeft / curCw();
            measure();
            applyZoom(zoom);
            scroll.scrollLeft = Math.round(colsX) * curCw();
        }).observe(scroll);

        // ---- Месечен изглед ----
        function renderMonth() {
            const days = visibleDays(), sd = parseK(selKey), tk = todayKey();
            const rows = days.length / 7;
            const cells = days.map(d => {
                const k = kOf(d), arr = listFor(k).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));
                const other = d.getMonth() !== sd.getMonth();
                const cnt = arr.length;
                const offTags = offsFor(k).filter(o => o.kind === 'off').map(o =>
                    `<span class="sc-mi sc-mi--off" style="--bc:${empColor(o.employeeId)}">Почивен${cfg.showEmployee && empFilter == null ? ' · ' + esc(firstName(o.employeeName)) : ' ден'}</span>`).join('');
                const dot = cnt ? (cnt > loadR ? '#D9534F' : (cnt > loadY ? '#E7B100' : '#4E9E76')) : '';
                const items = arr.slice(0, 3).map(b => {
                    const c = (b.noShowCount > 0 || b.status === 'no_show') ? '#D9534F' : empColor(b.employeeId);
                    return `<span class="sc-mi${b.status === 'cancelled' ? ' is-cancel' : ''}" style="--bc:${c}"><b>${b.startAt.slice(11, 16)}</b> ${esc(b.serviceName)}</span>`;
                }).join('');
                return `<button type="button" class="sc-mc${other ? ' is-other' : ''}${workHours[d.getDay()] ? '' : ' is-off'}${k === tk ? ' is-today' : ''}${k === selKey ? ' is-sel' : ''}" data-k="${k}">
                    <span class="sc-mc__n">${d.getDate()}${dot ? `<i style="background:${dot}"></i>` : ''}</span>
                    ${offTags}${items}${cnt > 3 ? `<span class="sc-mc__more">+${cnt - 3} още</span>` : ''}
                </button>`;
            }).join('');
            root.dataset.n = 7;
            scroll.innerHTML = `
                <div class="sc-month" style="grid-template-rows:${HEAD - 12}px repeat(${rows}, minmax(92px, 1fr))">
                    ${WD_MON.map(w => `<span class="sc-mh">${w}</span>`).join('')}
                    ${cells}
                </div>`;
            scroll.scrollTop = 0; scroll.scrollLeft = 0;
            lastLayout = 'month';
        }

        // Панел „Работно време" под графика (само собствен график, изглед Ден).
        let belowKey = '';
        function renderBelow() {
            const want = (cfg.editable && cfg.staffId && view === 'day') ? selKey : '';
            if (want === belowKey) return;
            belowKey = want;
            if (!want) { below.innerHTML = ''; return; }
            below.innerHTML = `<div class="panel sched-panel" style="margin-top:1.2rem"><div class="spinner"></div></div>`;
            loadSchedule(below.querySelector('.sched-panel'), want);
        }

        // ================= Горна лента: дата + меню =================
        let popM = null; // [Y, M] на мини-календара
        function closePops() { popDate.hidden = true; popMenu.hidden = true; }
        function paintDatePop() {
            const [Y, M] = popM;
            const first = new Date(Y, M, 1), m = mondayOf(first);
            const last = new Date(Y, M + 1, 0);
            const cells = Math.ceil((Math.round((last - m) / 864e5) + 1) / 7) * 7;
            const tk = todayKey();
            let html = '';
            for (let i = 0; i < cells; i++) {
                const d = addDays(m, i), k = kOf(d);
                const cnt = listFor(k).length;
                html += `<button type="button" class="sc-mini__d${d.getMonth() !== M ? ' is-other' : ''}${k === tk ? ' is-today' : ''}${k === selKey ? ' is-sel' : ''}" data-k="${k}">${d.getDate()}${cnt ? '<i></i>' : ''}</button>`;
            }
            popDate.innerHTML = `
                <div class="sc-mini">
                    <div class="sc-mini__nav">
                        <button type="button" class="sc-mini__arr" data-d="-1" aria-label="Предишен месец">${ICO.prev}</button>
                        <strong>${MON[M]} ${Y}</strong>
                        <button type="button" class="sc-mini__arr" data-d="1" aria-label="Следващ месец">${ICO.next}</button>
                    </div>
                    <div class="sc-mini__grid">${WD_MON.map(w => `<span>${w}</span>`).join('')}${html}</div>
                </div>`;
        }
        dateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = popDate.hidden;
            closePops();
            if (!open) return;
            const sd = parseK(selKey); popM = [sd.getFullYear(), sd.getMonth()];
            paintDatePop(); popDate.hidden = false;
        });
        popDate.addEventListener('click', (e) => {
            e.stopPropagation();
            const arr = e.target.closest('.sc-mini__arr');
            if (arr) { const t = new Date(popM[0], popM[1] + (+arr.dataset.d), 1); popM = [t.getFullYear(), t.getMonth()]; paintDatePop(); return; }
            const d = e.target.closest('.sc-mini__d');
            if (d) { closePops(); goToDate(d.dataset.k); }
        });

        root.querySelector('.sc-menu').addEventListener('click', (e) => {
            e.stopPropagation();
            const open = popMenu.hidden;
            closePops();
            if (!open) return;
            popMenu.innerHTML = `
                ${VIEWS.map(([v, lb]) => `<button type="button" class="sc-mn${v === view ? ' is-on' : ''}" data-view="${v}"><span>${lb}</span>${v === view ? ICO.check : ''}</button>`).join('')}
                <div class="sc-mn__sep"></div>
                <div class="sc-mn__zoom"><span>Мащаб</span>
                    <button type="button" class="sc-mn__z" data-z="0.8" aria-label="Намали">−</button>
                    <button type="button" class="sc-mn__z" data-z="1.25" aria-label="Увеличи">+</button>
                </div>`;
            popMenu.hidden = false;
        });
        popMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const v = e.target.closest('[data-view]');
            if (v) { closePops(); setView(v.dataset.view); return; }
            const z = e.target.closest('[data-z]');
            if (z) { if (view === 'month') setView('week'); tweenZoom(clampZoom(zoom * +z.dataset.z)); }
        });
        document.addEventListener('click', (e) => { if (!root.contains(e.target) || !e.target.closest('.sc-pop')) closePops(); });

        // ================= Плаващи кръгчета =================
        fabWho.addEventListener('click', () => {
            const row = (id, label, av, on) => `<button type="button" class="sc-sh__row${on ? ' is-on' : ''}" data-emp="${id}">${av}<span>${esc(label)}</span>${on ? ICO.check : ''}</button>`;
            sheet.innerHTML = `
                <div class="sc-sh__back"></div>
                <div class="sc-sh__panel">
                    <div class="sc-sh__grab"></div>
                    <div class="sc-sh__title">Чий график да се показва</div>
                    ${row('all', 'Всички', `<span class="sc-av sc-av--all">${ICO.people}</span>`, empFilter == null)}
                    ${empsSorted().map(e => row(e.id, e.name, avatarHtml(e, 44), empFilter === e.id)).join('')}
                </div>`;
            sheet.hidden = false;
        });
        sheet.addEventListener('click', (e) => {
            const r = e.target.closest('.sc-sh__row');
            if (r) { empFilter = r.dataset.emp === 'all' ? null : +r.dataset.emp; sheet.hidden = true; lastLayout = ''; render(); return; }
            if (e.target.closest('.sc-sh__back')) sheet.hidden = true;
        });
        fabAdd.addEventListener('click', () => {
            const wh = workHours[parseK(selKey).getDay()];
            let m = wh ? wh[0] : 9 * 60;
            if (selKey === todayKey()) m = Math.max(m, Math.ceil(nowMin() / SNAP) * SNAP);
            openAddModal(minToHHMM(Math.max(BOOK_S, Math.min(m, BOOK_E - SNAP))), { dayKey: selKey });
        });

        // ================= Докосване / мишка върху решетката =================
        // Кликове: блок -> детайли; заглавие на ден -> изглед Ден; иконата в ъгъла -> свий/разгъни;
        // клетка в месеца -> този ден.
        let suppressClickUntil = 0;
        scroll.addEventListener('click', (e) => {
            if (Date.now() < suppressClickUntil) return;
            const rs = e.target.closest('[data-rest]');
            if (rs) { openRestModal((offs[rs.dataset.k] || []).find(x => x.kind === 'rest' && x.id === +rs.dataset.rest)); return; }
            const od = e.target.closest('[data-off]');
            if (od) { openRestModal((offs[od.dataset.k] || []).find(x => x.kind === 'off' && x.employeeId === +od.dataset.off)); return; }
            const bk = e.target.closest('.sc-bk');
            if (bk) { const b = (data[bk.dataset.k] || []).find(x => x.id === +bk.dataset.id); openBookingModal(b); return; }
            if (e.target.closest('.sc-corner')) { toggleCompress(); return; }
            const hd = e.target.closest('.sc-hd[data-k]');
            if (hd) { selKey = hd.dataset.k; setView('day'); return; }
            const mc = e.target.closest('.sc-mc');
            if (mc) { selKey = mc.dataset.k; setView('day'); }
        });

        const minAt = (col, clientY) => DAY_S + (clientY - col.getBoundingClientRect().top) / (HH0 * zoom) * 60;
        const durLabel = d => { const h = Math.floor(d / 60), m = d % 60; return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`; };

        // Маркиране на период: задържане + плъзгане (телефон) / влачене (мишка).
        let sel = null;
        function beginSelect(col, clientY) {
            const a = Math.max(BOOK_S, Math.min(BOOK_E - SNAP, Math.floor(minAt(col, clientY) / SNAP) * SNAP));
            const el = document.createElement('div');
            el.className = 'sc-sel';
            col.appendChild(el);
            sel = { col, a, s: a, e: Math.min(BOOK_E, a + 2 * SNAP), el };
            paintSel();
            root.classList.add('is-selecting');
            if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) {}
        }
        function updateSelect(clientY) {
            if (!sel) return;
            const m = Math.max(BOOK_S, Math.min(BOOK_E, minAt(sel.col, clientY)));
            if (m >= sel.a) { sel.s = sel.a; sel.e = Math.max(sel.a + SNAP, Math.ceil(m / SNAP) * SNAP); }
            else { sel.s = Math.floor(m / SNAP) * SNAP; sel.e = sel.a + SNAP; }
            sel.e = Math.min(BOOK_E, sel.e);
            paintSel();
        }
        function paintSel() {
            const { s, e, el } = sel;
            el.style.top = pct(s);
            el.style.height = pctD(e - s);
            el.innerHTML = `<span>${minToHHMM(s)} – ${minToHHMM(e)}</span><small>${durLabel(e - s)}</small>`;
        }
        function clearSel() { if (sel) sel.el.remove(); sel = null; root.classList.remove('is-selecting'); cancelAnimationFrame(asRaf); asRaf = null; }
        function finishSelect() {
            if (!sel) return;
            const { col, s, e } = sel;
            root.classList.remove('is-selecting');
            cancelAnimationFrame(asRaf); asRaf = null;
            suppressClickUntil = Date.now() + 450;
            const el = sel.el; sel = null;
            openAddModal(minToHHMM(s), { dayKey: col.dataset.k, dur: e - s, empId: col.dataset.emp ? +col.dataset.emp : undefined, onClose: () => el.remove() });
        }
        // Автоматичен скрол, докато пръстът е до ръба (за да се маркира и отвъд екрана).
        let asRaf = null, lastY = 0;
        function autoScroll() {
            asRaf = null;
            if (!sel) return;
            const r = scroll.getBoundingClientRect();
            let dy = 0;
            if (lastY > r.bottom - 56) dy = Math.min(16, (lastY - (r.bottom - 56)) / 3 + 2);
            else if (lastY < r.top + HEAD + 40) dy = -Math.min(16, (r.top + HEAD + 40 - lastY) / 3 + 2);
            if (!dy) return;
            scroll.scrollTop += dy;
            updateSelect(lastY);
            asRaf = requestAnimationFrame(autoScroll);
        }
        function tapAdd(col, clientY) {
            const m = Math.max(BOOK_S, Math.min(BOOK_E - SNAP, Math.floor(minAt(col, clientY) / SNAP) * SNAP));
            openAddModal(minToHHMM(m), { dayKey: col.dataset.k, empId: col.dataset.emp ? +col.dataset.emp : undefined });
        }

        // Swipe настрани (само когато нищо не се скролва хоризонтално) -> смяна на период.
        const canSwipe = () => scroll.scrollWidth <= scroll.clientWidth + 2;
        const slideEl = () => scroll.firstElementChild;
        function commitSwipe(dx) {
            const s = slideEl();
            if (Math.abs(dx) > 60) {
                if (s) { s.style.transition = 'transform .15s ease-out, opacity .15s ease-out'; s.style.transform = `translateX(${dx < 0 ? -40 : 40}%)`; s.style.opacity = '0'; }
                setTimeout(() => shift(dx < 0 ? 1 : -1), 140);
            } else if (s) { s.style.transition = 'transform .18s ease-out'; s.style.transform = ''; s.style.opacity = ''; }
        }

        let lastScrollAt = 0;
        scroll.addEventListener('scroll', () => { lastScrollAt = Date.now(); }, { passive: true });

        // Safari: собствената щипка на браузъра се спира само тук.
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => root.addEventListener(ev, e => e.preventDefault(), { passive: false }));

        let t = null, lpTimer = null, lastTouchAt = 0;
        const d2 = ts => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1;
        scroll.addEventListener('touchstart', (e) => {
            lastTouchAt = Date.now();
            clearTimeout(lpTimer);
            if (e.touches.length >= 2) {
                clearSel();
                if (view === 'month') { t = null; return; }
                t = { mode: 'pinch', d0: d2(e.touches), z0: zoom };
                return;
            }
            const p = e.touches[0];
            const col = e.target.closest('.sc-col');
            const slide = slideEl(); if (slide) slide.style.transition = 'none';
            t = { mode: 'pending', x0: p.clientX, y0: p.clientY, dx: 0, col, t0: Date.now(), fling: Date.now() - lastScrollAt < 120 };
            if (col && canAdd() && !e.target.closest(ITEM_SEL))
                lpTimer = setTimeout(() => { if (t && t.mode === 'pending') { t.mode = 'select'; beginSelect(col, t.y0); } }, 380);
        }, { passive: true });

        scroll.addEventListener('touchmove', (e) => {
            if (!t) return;
            if (t.mode === 'pinch') {
                if (e.touches.length < 2) return;
                e.preventDefault();
                const [a, b] = e.touches;
                zoomAt(t.z0 * d2(e.touches) / t.d0, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
                return;
            }
            const p = e.touches[0];
            if (t.mode === 'select') {
                e.preventDefault();
                lastY = p.clientY;
                updateSelect(p.clientY);
                if (!asRaf) asRaf = requestAnimationFrame(autoScroll);
                return;
            }
            const dx = p.clientX - t.x0, dy = p.clientY - t.y0;
            if (t.mode === 'pending') {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                clearTimeout(lpTimer);
                t.mode = (view !== 'month' && Math.abs(dx) > Math.abs(dy) * 1.3 && canSwipe()) ? 'swipe' : 'scroll';
            }
            if (t.mode === 'swipe') {
                e.preventDefault();
                t.dx = dx;
                const s = slideEl();
                if (s) { s.style.transform = `translateX(${dx.toFixed(0)}px)`; s.style.opacity = String(Math.max(.4, 1 - Math.abs(dx) / 700)); }
            }
        }, { passive: false });

        scroll.addEventListener('touchend', (e) => {
            lastTouchAt = Date.now();
            clearTimeout(lpTimer);
            if (!t) return;
            if (t.mode === 'pinch') { if (!e.touches.length) { flushZoom(); saveZoom(); t = null; } return; }
            if (e.touches.length) return;
            const was = t; t = null;
            if (was.mode === 'select') finishSelect();
            else if (was.mode === 'swipe') commitSwipe(was.dx);
            else if (was.mode === 'pending' && was.col && !was.fling && canAdd() && !e.target.closest(ITEM_SEL)) {
                // Кратко докосване на празно място -> нов час в този момент.
                suppressClickUntil = Date.now() + 450;
                tapAdd(was.col, was.y0);
            }
        });
        scroll.addEventListener('touchcancel', () => {
            clearTimeout(lpTimer);
            if (t && t.mode === 'swipe') commitSwipe(0);
            clearSel(); t = null;
        });

        // Мишка: влачене надолу по празно място = маркиране; клик = нов час.
        let mSel = null;
        scroll.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || Date.now() - lastTouchAt < 800) return;
            const col = e.target.closest('.sc-col');
            if (!col || e.target.closest(ITEM_SEL) || !canAdd()) return;
            e.preventDefault();
            mSel = { col, y0: e.clientY, moved: false };
        });
        window.addEventListener('mousemove', (e) => {
            if (!mSel) return;
            if (!mSel.moved) {
                if (Math.abs(e.clientY - mSel.y0) < 5) return;
                mSel.moved = true; beginSelect(mSel.col, mSel.y0);
            }
            lastY = e.clientY;
            updateSelect(e.clientY);
            if (!asRaf) asRaf = requestAnimationFrame(autoScroll);
        });
        window.addEventListener('mouseup', () => {
            if (!mSel) return;
            const m = mSel; mSel = null;
            if (m.moved) finishSelect();
            else { suppressClickUntil = Date.now() + 300; tapAdd(m.col, m.y0); }
        });

        // Десктоп: Ctrl + колелце (и щипка на тъчпада) = мащаб.
        scroll.addEventListener('wheel', (e) => {
            if (!e.ctrlKey || view === 'month') return;
            e.preventDefault();
            zoomAt(pendingZoom() * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
            clearTimeout(scroll._wz); scroll._wz = setTimeout(saveZoom, 200);
        }, { passive: false });

        // Червената линия „сега" се мести сама всяка минута.
        let dayAtMount = todayKey();
        const nowTimer = setInterval(() => {
            if (!document.body.contains(root)) { clearInterval(nowTimer); return; }
            if (todayKey() !== dayAtMount) { dayAtMount = todayKey(); render(); return; }
            root.querySelectorAll('.sc-now').forEach(el => { const m = nowMin(); el.style.top = pct(m); el.style.display = m >= DAY_S && m <= DAY_E ? '' : 'none'; });
        }, 60000);

        // Попъп за добавяне на час (клик на празно място / маркиран период в графика).
        // В „Целият салон" има и избор на специалист (за кого е часът).
        // В списъка с услуги има и „Почивка" (блокира време) и „Почивен ден" (цял ден).
        // opts: { dayKey, dur (маркирани минути), empId (от колоната), onClose }
        const REST = 15; // стандартна почивка след процедура (като в backend-а)
        function openAddModal(hhmm, opts = {}) {
            document.querySelectorAll('.cal-modal-backdrop').forEach(x => x.remove());
            const pickEmp = !!(cfg.showEmployee && cfg.employees && cfg.employees.length && cfg.servicesFor);
            const dayKey = opts.dayKey || selKey;
            const dd = parseK(dayKey);
            const presetEmp = opts.empId != null ? opts.empId : empFilter;
            const SPECIAL = canRest() ? `<option value="__rest">Почивка</option><option value="__off">Почивен ден (цял ден)</option>` : '';

            let timeOpts = '';
            for (let mm = BOOK_S; mm < BOOK_E; mm += 15) { const v = minToHHMM(mm); timeOpts += `<option value="${v}"${v === hhmm ? ' selected' : ''}>${v}</option>`; }
            const empOpts = pickEmp ? cfg.employees.map(e => `<option value="${e.id}"${presetEmp === e.id ? ' selected' : ''}>${esc(e.name)}</option>`).join('') : '';
            const staticSvc = pickEmp ? '' : (cfg.services || []).map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('');
            const REST_OPTS = [0, 5, 10, 15, 20, 30, 45, 60];

            const backdrop = document.createElement('div');
            backdrop.className = 'cal-modal-backdrop';
            backdrop.innerHTML = `
                <div class="cal-modal cal-modal--add">
                    <button class="cal-modal__close" aria-label="Затвори">×</button>
                    <div class="ad-title" style="font-weight:800;font-size:1.15rem">Нов час</div>
                    <div class="hint" style="margin:.15rem 0 .85rem">${WDNAMES[dd.getDay()]}, ${dd.getDate()} ${MON[dd.getMonth()].toLowerCase()}${opts.dur ? ` · ${hhmm}–${minToHHMM(Math.min(24 * 60, hhmmToMin(hhmm) + opts.dur))}` : ''}</div>
                    <div class="ad-form">
                        ${pickEmp ? `<label class="field"><span class="ad-lbl">Специалист</span>
                            <select class="select ad-emp">${empOpts}</select></label>` : ''}
                        <label class="field"><span class="ad-lbl">Услуга</span>
                            <select class="select ad-svc">${pickEmp ? '<option value="">Избери специалист…</option>' : (staticSvc || '<option value="">Няма зададени услуги</option>') + SPECIAL}</select></label>
                        <div class="ad-pair ad-pair--time ad-row-time">
                            <label class="field"><span class="ad-lbl">Начален час</span>
                                <select class="select ad-time">${timeOpts}</select></label>
                            <label class="field"><span class="ad-lbl ad-dur-lbl">Процедура</span>
                                <select class="select ad-dur"></select></label>
                        </div>
                        <div class="ad-pair ad-pair--time ad-row-rest">
                            <label class="field"><span class="ad-lbl" title="Свободно време след процедурата, преди следващия клиент">Почивка след</span>
                                <select class="select ad-rest"></select></label>
                            <div class="ad-sum"></div>
                        </div>
                        <div class="ad-off-note hint" style="display:none">Целият ден ще е почивен — никой няма да може да си запише час. Отменя се с клик върху деня в графика.</div>
                        <div class="ad-pair ad-row-client">
                            <label class="field"><span class="ad-lbl">Име на клиента</span>
                                <input class="input ad-name" type="text" placeholder="напр. Мария"></label>
                            <label class="field"><span class="ad-lbl">Телефон <small>(по избор)</small></span>
                                <input class="input ad-phone" type="tel" placeholder="+359…"></label>
                        </div>
                        <button class="btn btn--primary ad-save">Запиши часа</button>
                        <div class="ad-msg"></div>
                    </div>
                </div>`;
            document.body.appendChild(backdrop);
            const close = () => { backdrop.remove(); if (opts.onClose) opts.onClose(); };
            backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
            backdrop.querySelector('.cal-modal__close').addEventListener('click', close);

            const $ = sel => backdrop.querySelector(sel);
            const empSel = $('.ad-emp'), svcSel = $('.ad-svc'), timeSel = $('.ad-time');
            const durSel = $('.ad-dur'), restSel = $('.ad-rest'), sumEl = $('.ad-sum');
            const saveBtn = $('.ad-save'), msg = $('.ad-msg');
            const show = (sel, on) => { $(sel).style.display = on ? '' : 'none'; };
            const mode = () => svcSel.value === '__rest' ? 'rest' : (svcSel.value === '__off' ? 'off' : 'svc');
            const whEnd = () => { const wh = workHours[dd.getDay()]; return wh ? wh[1] : 1110; };
            const numOpts = (vals, def, label) => [...new Set(vals)].sort((a, b) => a - b)
                .map(m => `<option value="${m}"${m === def ? ' selected' : ''}>${label(m)}</option>`).join('');

            // Карта service_id -> времетраене на процедурата.
            let svcDur = {};
            (cfg.services || []).forEach(s => { svcDur[s.serviceId] = s.durationMinutes; });

            function fillDur() {
                const md = mode();
                if (md === 'rest') {
                    const def = opts.dur || 60;
                    durSel.innerHTML = numOpts([15, 30, 45, 60, 90, 120, 180, 240, def], def,
                        m => durLabel(m) + (m === opts.dur ? ' · маркирано' : '')) + `<option value="end">до края на деня</option>`;
                } else if (md === 'svc') {
                    // Маркиран период -> процедурата остава стандартна, а разликата е почивка.
                    const p = svcDur[+svcSel.value] || 30;
                    let proc = p, rest = REST;
                    if (opts.dur) {
                        if (opts.dur < p) { proc = opts.dur; rest = 0; }
                        else if (opts.dur - p <= 120) rest = opts.dur - p;
                        else proc = opts.dur - REST;
                    }
                    durSel.innerHTML = numOpts([p, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240, proc], proc,
                        m => `${m} мин${m === p ? ' (стандартно)' : ''}`);
                    restSel.innerHTML = numOpts([...REST_OPTS, rest], rest,
                        m => (m ? `${m} мин` : 'без почивка'));
                }
                paintMode();
            }
            function paintMode() {
                const md = mode();
                show('.ad-row-time', md !== 'off');
                show('.ad-row-rest', md === 'svc');
                show('.ad-row-client', md === 'svc');
                show('.ad-off-note', md === 'off');
                $('.ad-dur-lbl').textContent = md === 'rest' ? 'Продължителност' : 'Процедура';
                $('.ad-title').textContent = md === 'svc' ? 'Нов час' : (md === 'rest' ? 'Почивка' : 'Почивен ден');
                saveBtn.textContent = md === 'svc' ? 'Запиши часа' : (md === 'rest' ? 'Запази почивката' : 'Маркирай почивен ден');
                paintSum();
            }
            // „Готово в 09:45 · следващ час от 10:00"
            function paintSum() {
                if (mode() !== 'svc') { sumEl.innerHTML = ''; return; }
                const st = hhmmToMin(timeSel.value), pr = +durSel.value || 0, rs = +restSel.value || 0;
                sumEl.innerHTML = `<span>Готово в <b>${minToHHMM(Math.min(1440, st + pr))}</b></span><span>следващ час от <b>${minToHHMM(Math.min(1440, st + pr + rs))}</b></span>`;
            }

            async function loadSvc(empId) {
                svcSel.innerHTML = `<option value="">Зареждане…</option>`;
                try {
                    const list = await cfg.servicesFor(empId);
                    svcDur = {};
                    (list || []).forEach(s => { svcDur[s.serviceId] = s.durationMinutes; });
                    svcSel.innerHTML = ((list && list.length)
                        ? list.map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('')
                        : `<option value="">Няма зададени услуги</option>`) + SPECIAL;
                    fillDur();
                } catch (e) { svcSel.innerHTML = `<option value="">Грешка при зареждане</option>` + SPECIAL; fillDur(); }
            }
            svcSel.addEventListener('change', fillDur);
            [timeSel, durSel, restSel].forEach(x => x.addEventListener('change', paintSum));
            svcPicker(svcSel, () => (empSel ? empSel.value : cfg.staffId));
            if (empSel) { empSel.addEventListener('change', () => loadSvc(+empSel.value)); loadSvc(+empSel.value); }
            else fillDur(); // единичен специалист: услугите вече са налични

            saveBtn.addEventListener('click', async () => {
                const employeeId = empSel ? +empSel.value : cfg.staffId;
                const md = mode();
                const startAt = `${dayKey}T${timeSel.value}:00`;
                const err = t => { msg.innerHTML = `<div class="alert alert--err">${esc(t)}</div>`; };
                if (pickEmp && !employeeId) return err('Избери специалист.');

                let run;
                if (md === 'off') {
                    run = () => window.API.put('/schedule/override', { employeeId, date: dayKey, isOff: true });
                } else if (md === 'rest') {
                    const dur = durSel.value === 'end' ? whEnd() - hhmmToMin(timeSel.value) : +durSel.value;
                    if (!(dur > 0)) return err('Началният час е след края на работния ден.');
                    run = () => window.API.post('/schedule/block', { employeeId, startAt, endAt: addMinIso(startAt, Math.min(dur, 1440 - hhmmToMin(timeSel.value))) });
                } else {
                    const dto = {
                        employeeId,
                        serviceId: +svcSel.value,
                        startAt,
                        procedureMinutes: +durSel.value || null,
                        restMinutes: +restSel.value || 0,
                        guestName: $('.ad-name').value.trim(),
                        guestPhone: $('.ad-phone').value.trim() || null,
                        note: null
                    };
                    if (!dto.serviceId) return err('Избери услуга.');
                    if (!dto.guestName) return err('Въведи име на клиента.');
                    run = () => cfg.createBooking(dto);
                }
                saveBtn.disabled = true; saveBtn.style.opacity = .7;
                try { await run(); close(); await load(); }
                catch (e) { err(e.message); saveBtn.disabled = false; saveBtn.style.opacity = 1; }
            });
        }

        // Попъп за почивка / почивен ден: детайли + премахване.
        function openRestModal(o) {
            if (!o) return;
            document.querySelectorAll('.cal-modal-backdrop').forEach(x => x.remove());
            const isOff = o.kind === 'off';
            const d = parseK(isOff ? o.k : o.startAt.slice(0, 10));
            const time = isOff ? 'цял ден' : `${o.startAt.slice(11, 16)}–${o.endAt.slice(11, 16)}`;
            const backdrop = document.createElement('div');
            backdrop.className = 'cal-modal-backdrop';
            backdrop.innerHTML = `
                <div class="cal-modal">
                    <button class="cal-modal__close" aria-label="Затвори">×</button>
                    <div class="cal-modal__title">${isOff ? 'Почивен ден' : 'Почивка'}</div>
                    <div class="cal-modal__meta hint">${WDNAMES[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()].toLowerCase()} · ${time}${cfg.showEmployee ? ' · ' + esc(o.employeeName) : ''}</div>
                    <div class="hint" style="margin:.7rem 0 1rem">${isOff ? 'В този ден никой не може да си запише час.' : 'В това време никой не може да си запише час.'}</div>
                    ${cfg.editable ? `<div class="cal-modal__actions"><button class="btn btn--ghost rm-del" style="color:#D9534F">${isOff ? 'Направи го работен ден' : 'Премахни почивката'}</button></div>` : ''}
                    <div class="md-msg" style="margin-top:.8rem"></div>
                </div>`;
            document.body.appendChild(backdrop);
            const close = () => backdrop.remove();
            backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
            backdrop.querySelector('.cal-modal__close').addEventListener('click', close);
            const del = backdrop.querySelector('.rm-del');
            if (del) del.addEventListener('click', async () => {
                del.disabled = true;
                try {
                    if (isOff) await window.API.del(`/schedule/override?employeeId=${o.employeeId}&date=${o.k}`);
                    else await window.API.del(`/schedule/block/${o.id}?employeeId=${o.employeeId}`);
                    close(); await load();
                } catch (err) {
                    backdrop.querySelector('.md-msg').innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
                    del.disabled = false;
                }
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

            const canCancelWithReason = cfg.editable && cfg.cancelBooking && b.status === 'booked';
            let actions = '';
            if (cfg.editable) {
                actions = `<div class="cal-modal__actions">
                    <button class="btn btn--gold md-present">Присъства (проведен)</button>
                    <button class="btn btn--ghost md-absent">Не присъства</button>
                    ${canCancelWithReason ? `<button class="btn btn--ghost md-cancel" style="color:#D9534F">Отмени часа на клиента</button>` : ''}
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
            const cancelWithReason = backdrop.querySelector('.md-cancel');
            if (cancelWithReason) cancelWithReason.addEventListener('click', () => {
                const reason = window.prompt('Причина за отмяната — клиентът ще я види в имейла/SMS-а:');
                if (reason === null) return; // отказ
                if (!reason.trim()) { msg.innerHTML = `<div class="alert alert--err">Трябва да въведеш причина.</div>`; return; }
                run(() => cfg.cancelBooking(b.id, reason.trim()));
            });
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
            svcPicker(svc, () => cfg.staffId);
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

    return { mount, empColor, EMP_COLORS };
})();

/* =====================================================================
   Профил:
   - клиент  → предстоящите му часове (може да отменя);
   - служител→ календар на графика + ръчно добавяне на телефонни часове;
   - шеф     → табло с раздели: Табло · Статистики · График · Настройки.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (!Session.isIn()) { Session.goLogin(); return; }

    const role = Session.role();
    const list = document.getElementById('acc-list');
    const title = document.getElementById('acc-title');
    const sub = document.getElementById('acc-sub');


    const STATUS = {
        booked:    { label: 'Запазен',   cls: 'alert--info' },
        completed: { label: 'Проведен',  cls: 'alert--ok' },
        cancelled: { label: 'Отменен',   cls: 'alert--err' },
        no_show:   { label: 'Не се яви', cls: 'alert--err' }
    };
    // Акцентни цветове на разделите в таблото — съвпадат с css/styles.css (--acc-*).
    const ACC = { stats: '#5F8DBF', cal: '#4F9E7C', alert: '#D9534F', cli: '#3A8C99', set: '#9B7FC2', crs: '#B07D52' };
    const pad = n => String(n).padStart(2, '0');
    // Пари — винаги до стотинка (без закръгляне до цяло евро). 0.005 -> нагоре, както в бекенда.
    const r2 = v => { const n = Number(v) || 0; return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-6) / 100; };
    const money = v => r2(v).toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    // Процент — до 4 знака, без излишни нули (70 -> „70“, 66.6667 -> „66,6667“).
    const fmtPct = v => (Math.round((Number(v) || 0) * 10000) / 10000).toLocaleString('bg-BG', { maximumFractionDigits: 4 });
    const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    let BOSS_ID = 0;   // id на шефа (от /employees по роля) — надеждно, без session id

    function fmt(iso) {
        const d = new Date(iso);
        const date = d.toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric', month: 'long' });
        return `${date} · ${iso.slice(11, 16)}`;
    }

    // ---- Календари (споделени) ----
    // Бялата (работна) част в графика = седмичния график на специалистката
    // (напр. Анелия: онлайн до 17:00, събота затворена). Липсващ ден -> часовете на салона.
    const SALON_WH = { 0: null, 1: [540, 1110], 2: [540, 1110], 3: [540, 1110], 4: [540, 1110], 5: [540, 1110], 6: [600, 870] };
    async function workHoursFor(empId) {
        const wh = { ...SALON_WH };
        try {
            const rows = await API.get('/schedule/hours' + (empId ? `?employeeId=${empId}` : ''));
            (rows || []).forEach(r => { wh[r.weekday] = r.isOff ? null : [r.startMin, r.endMin]; });
        } catch (e) {}
        return wh;
    }
    async function mountMyCalendar(container) {
        let services = [];
        const [svc, wh] = await Promise.all([API.get('/me/services').catch(() => []), workHoursFor(null)]);
        services = svc;
        Calendar.mount(container, {
            editable: true, staffId: BOSS_ID || Session.userId(), workHours: wh,
            services: (services || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes, price: s.price })),
            fetchMonth: (f, t) => API.get(`/me/calendar?from=${f}&to=${t}`),
            createBooking: (dto) => API.post('/me/bookings', dto),
            setStatus: (id, st, price) => API.patch(`/bookings/${id}/status`, price != null ? { status: st, price } : { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason })
        });
    }
    async function mountReadonlyCalendar(container, staffId) {
        let services = [];
        const [svc, wh] = await Promise.all([API.get(`/employees/${staffId}/services`).catch(() => []), workHoursFor(staffId)]);
        services = svc;
        Calendar.mount(container, {
            editable: true, staffId: staffId, canManage: role === 'boss', workHours: wh,
            services: (services || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes, price: s.price })),
            fetchMonth: (f, t) => API.get(`/reports/employee-calendar?employeeId=${staffId}&from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/reports/bookings?employeeId=${staffId}`, dto),
            setStatus: (id, st, price) => API.patch(`/bookings/${id}/status`, price != null ? { status: st, price } : { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason }),
            setDiscount: (id, pct) => API.put(`/reports/bookings/${id}/discount`, { discountPercent: pct }),
            setDuration: (id, min) => API.put(`/reports/bookings/${id}/duration`, { durationMinutes: min }),
            deleteBk: (id) => API.del(`/reports/bookings/${id}`)
        });
    }
    // Чужд график с достъп (напр. Анелия -> Радина): вижда часовете и записва нови,
    // без цени, без почивки/„Запазено“ и без „присъства/не присъства“.
    async function mountSharedCalendar(container, ownerId) {
        const [svc, wh] = await Promise.all([API.get(`/employees/${ownerId}/services`).catch(() => []), workHoursFor(ownerId)]);
        Calendar.mount(container, {
            editable: true, shared: true, hidePrices: true, staffId: ownerId, workHours: wh,
            services: (svc || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes })),
            fetchMonth: (f, t) => API.get(`/me/shared-calendar?ownerId=${ownerId}&from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/me/shared-bookings?ownerId=${ownerId}`, dto)
        });
    }

    // Служителка: своя график + (ако има достъп) превключвател към чужд — напр. Анелия -> Радина.
    // Ирина няма достъп до чужди графици -> вижда само своя, както досега.
    async function mountEmployeeCalendars(container) {
        let shared = [];
        try { shared = (await API.get('/me/shared-calendars')) || []; } catch (e) {}
        if (!shared.length) return mountMyCalendar(container);
        const me = Session.userId();
        try { Calendar.learnEmp(me, Session.name()); } catch (e) {}
        const list = [{ id: 0, name: 'Моят график', color: Calendar.empColor(me) }]
            .concat(shared.map(s => ({ id: s.id, name: s.name.split(' ')[0], color: (Calendar.learnEmp(s.id, s.name), Calendar.empColor(s.id)) })));
        container.innerHTML = `<div class="cal-switch">${list.map(x =>
            `<button type="button" class="cal-switch__b" data-id="${x.id}" style="--c:${x.color}"><i></i>${esc(x.name)}</button>`).join('')}</div><div class="cal-host"></div>`;
        const host = container.querySelector('.cal-host');
        const btns = [...container.querySelectorAll('.cal-switch__b')];
        function open(id) {
            btns.forEach(b => b.classList.toggle('is-on', +b.dataset.id === id));
            host.innerHTML = '';
            const box = document.createElement('div');
            host.appendChild(box);
            if (id) mountSharedCalendar(box, id); else mountMyCalendar(box);
        }
        btns.forEach(b => b.addEventListener('click', () => { if (!b.classList.contains('is-on')) open(+b.dataset.id); }));
        open(0);
    }

    async function mountAllCalendar(container) {
        let employees = [];
        try { employees = (await API.get('/employees')) || []; } catch (e) {}
        // Радина отваря графика само със своите часове; „Всички“ / другите — от бутона с хората.
        const me = BOSS_ID || Session.userId();
        Calendar.mount(container, {
            editable: true, showEmployee: true, canManage: role === 'boss',
            employees: employees.map(e => ({ id: e.id, name: e.fullName, photo: e.photoUrl })),
            initialEmp: employees.some(e => e.id === me) ? me : null,
            servicesFor: (empId) => API.get(`/employees/${empId}/services`),
            fetchMonth: (f, t, empId) => empId != null
                ? API.get(`/reports/employee-calendar?employeeId=${empId}&from=${f}&to=${t}`)
                : API.get(`/reports/calendar?from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/reports/bookings?employeeId=${dto.employeeId}`, dto),
            setStatus: (id, st, price) => API.patch(`/bookings/${id}/status`, price != null ? { status: st, price } : { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason }),
            setDiscount: (id, pct) => API.put(`/reports/bookings/${id}/discount`, { discountPercent: pct }),
            setDuration: (id, min) => API.put(`/reports/bookings/${id}/duration`, { durationMinutes: min }),
            deleteBk: (id) => API.del(`/reports/bookings/${id}`)
        });
    }

    // „30%" или „30% · 20% за биорепил и пробиване" (услуги с фиксиран процент за Радина).
    // „Пробиване — нос", „Пробиване — хрущял"… се събират в „пробиване".
    const deductLbl = x => {
        const base = 100 - x.percent;
        const diff = p => Math.abs(p - base) > 1e-9;
        const svc = (x.fixedServices || []).filter(f => diff(f.bossPercent));
        if (svc.length) {
            const byPct = {};
            svc.forEach(f => {
                const short = String(f.name || '').split(/\s+[—–-]\s+/)[0].trim().toLowerCase();
                const arr = byPct[f.bossPercent] || (byPct[f.bossPercent] = []);
                if (short && !arr.includes(short)) arr.push(short);
            });
            const andJoin = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' и ' + a[a.length - 1] : a[0];
            const parts = Object.keys(byPct).map(Number).sort((a, b) => a - b)
                .map(p => `${fmtPct(p)}% за ${andJoin(byPct[p])}`);
            return `${fmtPct(base)}% · ${parts.join(' · ')}`;
        }
        const fx = (x.fixedBossPercents || []).filter(diff);
        return `${fmtPct(base)}%` + (fx.length ? ` · ${fx.map(fmtPct).join('/')}% за някои` : '');
    };

    // Нетно разпределение: работничка = дела ѝ; шефът = своя дял + комисионните.
    // Шефът се разпознава по флага r.isBoss от backend-а (не по session id).
    function computeShares(rows, bossName) {
        // Шефът се разпознава по id-то от /employees (по роля) или флага от backend.
        const bossId = BOSS_ID || Session.userId();
        const byEmp = {};
        rows.forEach(r => {
            const e = byEmp[r.employeeId] || (byEmp[r.employeeId] = { id: r.employeeId, name: r.employeeName, isBoss: (!!r.isBoss) || (r.employeeId === bossId), rows: [], total: 0, count: 0, worker: 0, boss: 0, pct: null, fixedPct: r.workerPercent });
            if (e.pct == null && !r.isFixed) e.pct = r.workerPercent;
            e.rows.push(r); e.total += r.total; e.count += r.count; e.worker += (r.workerShare || 0); e.boss += (r.bossShare || 0);
        });
        const commissionToBoss = rows.reduce((s, r) => s + (r.bossShare || 0), 0);
        const persons = Object.values(byEmp).map(e => ({
            name: e.name, isBoss: e.isBoss, pct: e.pct != null ? e.pct : e.fixedPct,
            net: e.worker + (e.isBoss ? commissionToBoss : 0)
        }));
        if (commissionToBoss > 0 && !persons.some(p => p.isBoss))
            persons.push({ name: bossName || Session.name() || 'Шеф', isBoss: true, pct: 100, net: commissionToBoss });
        persons.sort((a, b) => (b.isBoss - a.isBoss) || (b.net - a.net));
        return { byEmp, persons };
    }

    // ===============================================================
    //  ТАБЛО НА ШЕФА (раздели)
    // ===============================================================
    async function renderBoss(box) {
        // Разпознай шефа надеждно по роля (не по session id).
        try {
            const emps = await API.get('/employees');
            const b = (emps || []).find(e => e.role === 'boss');
            if (b) BOSS_ID = b.id;
        } catch (e) {}
        // Навигация на таблото: на телефон — долна лента (като мобилно приложение);
        // на компютър същите бутони стават страничен стълб вляво (виж css/styles.css).
        box.classList.add('dash-body');
        box.innerHTML = `
            <div class="dash-panel" data-p="stats"><div class="spinner"></div></div>
            <div class="dash-panel" data-p="calendar" hidden></div>
            <div class="dash-panel" data-p="noshow" hidden></div>
            <div class="dash-panel" data-p="courses" hidden></div>
            <div class="dash-panel" data-p="settings" hidden></div>
            <nav class="dash-nav" aria-label="Навигация на таблото">
                <button class="dash-tab" data-t="stats"><span class="dash-tab__ic">${Icon('chart', { size: 20 })}</span><span class="dash-tab__lb">Статистики</span></button>
                <button class="dash-tab" data-t="calendar"><span class="dash-tab__ic">${Icon('calendar-check', { size: 20 })}<span class="dash-tab__badge" hidden></span></span><span class="dash-tab__lb">График</span></button>
                <button class="dash-tab" data-t="noshow"><span class="dash-tab__ic">${Icon('users', { size: 20 })}</span><span class="dash-tab__lb">Клиенти</span></button>
                <button class="dash-tab" data-t="courses"><span class="dash-tab__ic">${Icon('book', { size: 20 })}<span class="dash-tab__badge" hidden></span></span><span class="dash-tab__lb">Курсове</span></button>
                <button class="dash-tab" data-t="settings"><span class="dash-tab__ic">${Icon('gear', { size: 20 })}</span><span class="dash-tab__lb">Настройки</span></button>
            </nav>`;

        // Лентата се закача директно към <body>, за да е ВИНАГИ залепена за
        // екрана (никой родителски елемент не може да я повлече при скрол).
        // Класът на <body> отмества съдържанието, когато навигацията е отстрани.
        document.querySelectorAll('body > .dash-nav').forEach(n => n.remove());
        const dashNav = box.querySelector('.dash-nav');
        document.body.appendChild(dashNav);
        document.body.classList.add('has-dashnav');

        const tabs = [...dashNav.querySelectorAll('.dash-tab')];
        const panels = {};
        box.querySelectorAll('.dash-panel').forEach(p => panels[p.dataset.p] = p);
        const loaded = {};
        const loaders = { stats: renderStats, calendar: renderCalendarTab, noshow: renderClients, clients: renderClients, courses: renderCourses, settings: renderSettings };
        // Фонът на цялото табло се оцветява леко според отворения раздел — веднага личи къде си.
        const PANEL_BG = { stats: 'var(--acc-stats-soft)', calendar: 'var(--acc-cal-soft)', noshow: 'var(--acc-cli-soft)', courses: 'var(--acc-crs-soft)', settings: 'var(--acc-set-soft)' };

        function show(name) {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.t === name));
            Object.entries(panels).forEach(([k, el]) => el.hidden = k !== name);
            if (!loaded[name]) { loaded[name] = true; loaders[name](panels[name]); }
            box.style.background = PANEL_BG[name] || '';
            // На телефон графикът заема целия екран под табовете (виж css/styles.css).
            document.body.classList.toggle('dash-on-cal', name === 'calendar');
            if (name === 'courses') markCoursesSeen();
            if (name === 'calendar') markCalSeen();
        }
        tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.t)));
        // ?tab=calendar (от менюто „График") отваря директно съответния раздел.
        const wanted = new URLSearchParams(location.search).get('tab');
        show(wanted === 'clients' ? 'noshow' : (loaders[wanted] ? wanted : 'stats'));
        refreshCourseBadge();
        refreshCalBadge();
        // нови заявки и часове, докато таблото е отворено
        setInterval(() => { refreshCourseBadge(); refreshCalBadge(); }, 2 * 60 * 1000);
    }

    // Червено кръгче с броя НОВИ заявки за курсове върху таба „Курсове".
    // Кръгчето е „непрочетено" известие: брои заявките, дошли СЛЕД последното
    // отваряне на таба. Щом отвориш „Курсове" — изчезва (помни се в браузъра).
    const COURSES_SEEN = 'bh_courses_seen';
    const seenAt = () => { try { return +localStorage.getItem(COURSES_SEEN) || 0; } catch (e) { return 0; } };
    function markCoursesSeen() {
        try { localStorage.setItem(COURSES_SEEN, String(Date.now())); } catch (e) {}
        const badge = document.querySelector('.dash-tab[data-t="courses"] .dash-tab__badge');
        if (badge) badge.hidden = true;
    }
    // Същото за „График": кръгче с броя НОВИ онлайн часове (записани от клиенти
    // през сайта) след последното отваряне на графика. Ръчно въведените не се броят.
    const CAL_SEEN = 'bh_calendar_seen';
    function markCalSeen() {
        try { localStorage.setItem(CAL_SEEN, String(Date.now())); } catch (e) {}
        const badge = document.querySelector('.dash-tab[data-t="calendar"] .dash-tab__badge');
        if (badge) badge.hidden = true;
    }
    async function refreshCalBadge() {
        const badge = document.querySelector('.dash-tab[data-t="calendar"] .dash-tab__badge');
        if (!badge) return;
        if (document.querySelector('.dash-tab[data-t="calendar"].active')) { badge.hidden = true; return; }
        let since = 0;
        try { since = +localStorage.getItem(CAL_SEEN) || 0; } catch (e) {}
        // Първо отваряне на това устройство: броим от сега нататък, не цялата история.
        if (!since) { markCalSeen(); return; }
        try {
            const r = await API.get(`/reports/new-bookings?since=${since}`);
            const n = (r && r.count) || 0;
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.hidden = n === 0;
        } catch (e) { badge.hidden = true; }
    }
    async function refreshCourseBadge() {
        const badge = document.querySelector('.dash-tab[data-t="courses"] .dash-tab__badge');
        if (!badge) return;
        // Докато гледаш таба, няма какво да се брои.
        if (document.querySelector('.dash-tab[data-t="courses"].active')) { badge.hidden = true; return; }
        try {
            const rows = await API.get('/courses/enrollments');
            const since = seenAt();
            const n = (rows || []).filter(r => new Date(r.createdAt).getTime() > since).length;
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.hidden = n === 0;
        } catch (e) { badge.hidden = true; }
    }

    // ---- Раздел КУРСОВЕ: заявки от сайта ----
    const CE_STATUS = {
        new:       { label: 'Нова',           cls: 'ce-st--new' },
        contacted: { label: 'Свързах се',     cls: 'ce-st--contacted' },
        enrolled:  { label: 'Записан(а)',     cls: 'ce-st--enrolled' },
        cancelled: { label: 'Отказал(а) се',  cls: 'ce-st--cancelled' }
    };
    // „Курс по миглопластика" -> „Миглопластика" (за филтрите).
    const shortTitle = t => { const x = t.replace(/^Курс по /, '').split(' ')[0]; return x.charAt(0).toUpperCase() + x.slice(1); };
    async function renderCourses(box) {
        box.innerHTML = `
            ${sectionTitle('Курсове', ACC.crs, '0 0 .3rem')}
            <p class="hint" style="margin:0 0 1.2rem">Заявките от сайта. Всеки, който се запише, получава имейл потвърждение, а ти — известие. Обади се и смени статуса, за да знаеш докъде си стигнала.</p>
            <div class="ce-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.ce-body');
        let stats = [], rows = [], filter = 'all', stFilter = 'active';

        async function load() {
            try {
                [stats, rows] = await Promise.all([API.get('/courses/stats'), API.get('/courses/enrollments')]);
                stats = stats || []; rows = rows || [];
                paint();
            } catch (err) {
                body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        }

        const fmtDate = iso => {
            try { return new Date(iso).toLocaleString('bg-BG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); }
            catch { return '—'; }
        };

        function paint() {
            const totalActive = stats.reduce((a, c) => a + (c.total - c.cancelledCount), 0);
            const totalNew = stats.reduce((a, c) => a + c.newCount, 0);
            const cards = stats.map(c => {
                const active = c.total - c.cancelledCount;
                return `
                <button class="ce-course${filter === c.slug ? ' is-on' : ''}" data-f="${esc(c.slug)}">
                    <span class="ce-course__title">${esc(c.title)}</span>
                    <span class="ce-course__num">${active}<small>${active === 1 ? 'записан' : 'записани'}</small></span>
                    <span class="ce-course__chips">
                        ${c.newCount ? `<i class="ce-st ce-st--new">${c.newCount} нови</i>` : ''}
                        ${c.enrolledCount ? `<i class="ce-st ce-st--enrolled">${c.enrolledCount} потвърдени</i>` : ''}
                        ${!c.newCount && !c.enrolledCount ? `<i class="ce-muted">${money(c.price)}</i>` : ''}
                    </span>
                </button>`;
            }).join('');

            const list = rows
                .filter(r => filter === 'all' || r.courseSlug === filter)
                .filter(r => stFilter === 'all' || (stFilter === 'active' ? r.status !== 'cancelled' : r.status === stFilter));

            const items = list.map(r => {
                const st = CE_STATUS[r.status] || CE_STATUS.new;
                const initial = esc((r.fullName || '?').trim().charAt(0).toUpperCase());
                const trash = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7"/></svg>';
                return `
                <article class="ce-item ${r.status === 'new' ? 'is-new' : ''}" data-id="${r.id}">
                    <div class="ce-item__head">
                        <span class="ce-av">${initial}</span>
                        <div class="ce-item__who">
                            <b>${esc(r.fullName)}</b>
                            <span>${esc(r.courseTitle)}</span>
                        </div>
                        <select class="ce-item__st ${st.cls}" aria-label="Статус">
                            ${Object.entries(CE_STATUS).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v.label}</option>`).join('')}
                        </select>
                    </div>
                    ${r.message ? `<p class="ce-item__msg">${esc(r.message)}</p>` : ''}
                    <div class="ce-item__foot">
                        <a class="ce-act ce-act--call" href="tel:${esc(r.phone)}">${Icon('phone', { size: 15 })}<span>${esc(r.phone)}</span></a>
                        <a class="ce-act" href="mailto:${esc(r.email)}" title="${esc(r.email)}">${Icon('mail', { size: 15 })}<span>Имейл</span></a>
                        <span class="ce-item__date">${fmtDate(r.createdAt)}</span>
                        <button class="ce-item__del" title="Изтрий заявката" aria-label="Изтрий заявката">${trash}</button>
                    </div>
                </article>`;
            }).join('');

            body.innerHTML = `
                <div class="ce-kpis">
                    ${stat('Записали се общо', totalActive, 'без отказалите се', ACC.crs)}
                    ${stat('Нови заявки', totalNew, totalNew ? 'чакат да им се обадиш' : 'всичко е обработено', totalNew ? ACC.alert : ACC.cal)}
                </div>
                <div class="ce-courses">${cards}</div>
                <div class="ce-toolbar">
                    <div class="ce-filter">
                        <button class="ce-chip${filter === 'all' ? ' is-on' : ''}" data-f="all">Всички курсове</button>
                        ${stats.map(c => `<button class="ce-chip${filter === c.slug ? ' is-on' : ''}" data-f="${esc(c.slug)}">${esc(shortTitle(c.title))}</button>`).join('')}
                    </div>
                    <select class="select ce-stf" aria-label="Филтър по статус">
                        <option value="active"${stFilter === 'active' ? ' selected' : ''}>Без отказалите се</option>
                        <option value="all"${stFilter === 'all' ? ' selected' : ''}>Всички статуси</option>
                        ${Object.entries(CE_STATUS).map(([k, v]) => `<option value="${k}"${stFilter === k ? ' selected' : ''}>Само: ${v.label}</option>`).join('')}
                    </select>
                </div>
                <div class="ce-list">${items || `<div class="panel center"><p class="hint" style="margin:0">${rows.length ? 'Няма заявки по този филтър.' : 'Още няма заявки за курсове. Щом някой се запише от сайта, ще се появи тук.'}</p></div>`}</div>`;
        }

        body.addEventListener('click', async e => {
            const f = e.target.closest('[data-f]');
            if (f) { filter = (filter === f.dataset.f && f.classList.contains('ce-course')) ? 'all' : f.dataset.f; paint(); return; }
            const del = e.target.closest('.ce-item__del');
            if (del) {
                const id = +del.closest('.ce-item').dataset.id;
                if (!confirm('Да изтрия ли тази заявка? Това не може да се върне.')) return;
                try { await API.del(`/courses/enrollments/${id}`); rows = rows.filter(r => r.id !== id); await reloadStats(); paint(); }
                catch (err) { alert(err.message); }
            }
        });
        body.addEventListener('change', async e => {
            if (e.target.classList.contains('ce-stf')) { stFilter = e.target.value; paint(); return; }
            const sel = e.target.closest('.ce-item__st');
            if (!sel) return;
            const id = +sel.closest('.ce-item').dataset.id;
            const r = rows.find(x => x.id === id);
            const prev = r.status;
            sel.disabled = true;
            try {
                await API.patch(`/courses/enrollments/${id}/status`, { status: sel.value });
                r.status = sel.value;
                await reloadStats();
                paint();
            } catch (err) { alert(err.message); sel.value = prev; sel.disabled = false; }
        });
        async function reloadStats() {
            try { stats = (await API.get('/courses/stats')) || stats; } catch (e) {}
            refreshCourseBadge();
        }
        load();
    }

    // Компактна KPI карта: етикетът е ОТГОРЕ (ясно кое за какво е), стойността под него.
    // color = акцентният цвят на раздела, за да си личи веднага какво измерва картата.
    const stat = (label, value, hint, color) => `
        <div class="card" style="flex:1;min-width:145px;padding:1.05rem 1.2rem;text-align:left;border-top:3px solid ${color || 'var(--rose)'}">
            <div class="hint" style="font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;margin-bottom:.4rem">${label}</div>
            <div style="font-family:var(--font-dash);font-weight:800;font-size:1.65rem;color:${color || 'var(--rose-deep)'};line-height:1.1;white-space:nowrap">${value}</div>
            ${hint ? `<div class="hint" style="font-size:.7rem;margin-top:.4rem">${hint}</div>` : ''}
        </div>`;

    // Заглавие на раздел с цветна точка отпред — веднага личи темата му.
    const sectionTitle = (text, color, margin) => `<h3 style="margin:${margin || '0 0 .6rem'};display:flex;align-items:flex-start;gap:.55rem">
        <span style="width:9px;height:9px;border-radius:3px;background:${color};flex:none;margin-top:.42em"></span><span style="min-width:0">${text}</span></h3>`;

    // ---- Помощно: диапазон [from, to) според избрания период ----
    function periodRange(period, cFrom, cTo) {
        const isoD = x => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
        const d = new Date();
        if (period === 'day') { const e = new Date(d); e.setDate(e.getDate() + 1); return [isoD(d), isoD(e)]; }
        if (period === 'week') { const s = new Date(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); const e = new Date(s); e.setDate(e.getDate() + 7); return [isoD(s), isoD(e)]; }
        if (period === 'month') { return [isoD(new Date(d.getFullYear(), d.getMonth(), 1)), isoD(new Date(d.getFullYear(), d.getMonth() + 1, 1))]; }
        const e = new Date((cTo || todayStr()) + 'T00:00:00'); e.setDate(e.getDate() + 1);
        return [cFrom || todayStr(), isoD(e)];
    }

    // ---- Помощно: лента с период (Ден/Седмица/Месец/Период) + ключ Затворени/Общо ----
    function periodBar(box, onChange) {
        let period = 'week', cFrom = todayStr(), cTo = todayStr();
        box.innerHTML = `
            <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem">
                <button class="btn ov-p" data-p="day" style="--pad-y:.45rem;--pad-x:.9rem;font-size:.85rem">Ден</button>
                <button class="btn ov-p" data-p="week" style="--pad-y:.45rem;--pad-x:.9rem;font-size:.85rem">Седмица</button>
                <button class="btn ov-p" data-p="month" style="--pad-y:.45rem;--pad-x:.9rem;font-size:.85rem">Месец</button>
                <button class="btn ov-p" data-p="period" style="--pad-y:.45rem;--pad-x:.9rem;font-size:.85rem">Период</button>
            </div>
            <div class="ov-range" hidden style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.7rem">
                <input type="date" class="input ov-from" style="width:auto" value="${cFrom}">
                <span class="hint">–</span>
                <input type="date" class="input ov-to" style="width:auto" value="${cTo}">
            </div>
            <label style="display:inline-flex;align-items:center;gap:.6rem;margin-bottom:1.3rem;cursor:pointer;font-size:.9rem;color:var(--ink-soft)">
                <span>Затворени</span>
                <span class="switch"><input type="checkbox" class="ov-mode"><span class="switch__slider"></span></span>
                <span>Общо</span>
            </label>
            <div class="ov-when hint" style="margin:-.6rem 0 1rem;font-size:.82rem"></div>
            <div class="ov-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.ov-body');
        const whenEl = box.querySelector('.ov-when');
        const pbtns = [...box.querySelectorAll('.ov-p')];
        const range = box.querySelector('.ov-range');
        const modeInp = box.querySelector('.ov-mode');
        const fromInp = box.querySelector('.ov-from'), toInp = box.querySelector('.ov-to');

        function fire() {
            const [from, to] = periodRange(period, fromInp.value, toInp.value);
            // Кой точно период се смята (напр. седмицата може да влиза в следващия месец).
            const dm = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
            const last = new Date(to + 'T00:00:00'); last.setDate(last.getDate() - 1);
            const lastIso = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
            if (whenEl) whenEl.textContent = from === lastIso ? `За ${dm(from)}.${from.slice(0, 4)}` : `От ${dm(from)} до ${dm(lastIso)}.${lastIso.slice(0, 4)} вкл.`;
            onChange(body, from, to, modeInp.checked);
        }
        function setActive() {
            pbtns.forEach(b => { const on = b.dataset.p === period; b.classList.toggle('btn--primary', on); b.classList.toggle('btn--ghost', !on); });
            range.hidden = period !== 'period';
        }
        pbtns.forEach(b => b.addEventListener('click', () => { period = b.dataset.p; setActive(); fire(); }));
        modeInp.addEventListener('change', fire);
        fromInp.addEventListener('change', () => period === 'period' && fire());
        toInp.addEventListener('change', () => period === 'period' && fire());
        setActive(); fire();
    }

    // Цвят на специалист — взима се от календара, за да е СЪЩИЯТ навсякъде.
    const earnColor = (id, name) => {
        if (!(window.Calendar && Calendar.empColor)) return 'var(--rose)';
        if (name && Calendar.learnEmp) Calendar.learnEmp(id, name);   // Анелия — синьо, Радина — розово
        return Calendar.empColor(id);
    };

    const earnCard = (name, isBoss, rows, color) => {
        const initials = (name || '?').split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
        return `
        <div class="card earn-card" style="border-top:3px solid ${color}">
            <div class="earn-card__head">
                <span class="earn-card__avatar" style="background:${color}">${initials}</span>
                <div class="earn-card__title"><strong>${esc(name)}</strong>${isBoss ? `<span class="earn-card__badge">${Icon('crown', { size: 13 })} Управител</span>` : ''}</div>
            </div>
            ${rows.map(r => `<div class="earn-card__row${r.total ? ' earn-card__row--total' : ''}"${r.after ? ' style="border-top:1px dashed var(--line);margin-top:.5rem;padding-top:.55rem"' : ''}><span>${r.label}</span><b>${money(r.value)}</b></div>`).join('')}
        </div>`;
    };

    // ---- Печалба по специалист (карти) — ползва се в „Статистики" ----
    async function bossEarnings(body, from, to, all) {
        body.innerHTML = `<div class="spinner"></div>`;
        try {
            const rows = await API.get(`/reports/earnings?from=${from}&to=${to}&all=${all}`);
            const boss = (rows || []).find(r => r.isBoss);
            const workers = (rows || []).filter(r => !r.isBoss);
            const fromOthers = workers.reduce((s, r) => s + (r.commissionToBoss || 0), 0);
            const firstName = n => (n || '').trim().split(/\s+/)[0] || n;
            const bossTotal = (boss ? boss.take : 0) + fromOthers;

            const cards = [];
            if (boss) cards.push(earnCard(boss.name, true, [
                { label: 'Твоят дял', value: boss.take },
                // Делът от всяка служителка поотделно (едно под друго).
                ...workers.map(w => ({ label: `+ от ${esc(firstName(w.name))}`, value: w.commissionToBoss || 0 })),
                { label: 'Общо ще вземеш', value: bossTotal, total: true }
            ], earnColor(boss.employeeId, boss.name)));
            workers.forEach(w => cards.push(earnCard(w.name, false, [
                { label: 'Изкарала', value: w.gross },
                { label: 'Ще вземе', value: w.take, total: true },
                { label: `За Радина (${deductLbl(w)})`, value: w.gross - w.take, after: true }
            ], earnColor(w.employeeId, w.name))));

            body.innerHTML = `<div class="earn-grid">${cards.join('')}</div>
                <p class="hint" style="margin-top:1rem">${all ? 'Включени са и записаните (предстоящи) часове — приблизително.' : 'Само проведените (затворени) часове.'}</p>`;
        } catch (err) {
            body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // ---- Раздел СТАТИСТИКИ (печалба по специалист + диаграми) ----
    async function renderStats(box) {
        const now = new Date();
        const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const to = `${now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()}-${pad((now.getMonth() + 1) % 12 + 1)}-01`;
        const monthName = now.toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });

        box.innerHTML = `
            ${sectionTitle('Печалба по специалист', ACC.stats, '0 0 .9rem')}
            <div class="stats-earn" style="margin-bottom:2rem"></div>
            <div class="stats-diagrams"><div class="spinner"></div></div>`;

        // Горе: картите по специалист с избор Ден/Седмица/Месец/Период + ключ.
        periodBar(box.querySelector('.stats-earn'), bossEarnings);

        // Долу: месечните диаграми.
        const dbox = box.querySelector('.stats-diagrams');
        try {
            const [rep, cal, commissions] = await Promise.all([
                API.get(`/reports/revenue?period=month&date=${todayStr()}`),
                API.get(`/reports/calendar?from=${from}&to=${to}`).catch(() => []),
                API.get('/reports/commissions').catch(() => [])
            ]);
            const rows = rep.breakdown || [];
            const { persons } = computeShares(rows, rep.bossName);

            // Топ процедури по оборот
            const svc = {};
            rows.forEach(r => svc[r.serviceName] = (svc[r.serviceName] || 0) + r.total);
            const topSvc = Object.entries(svc).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);

            // Оборот по дни (само проведени)
            const perDay = {};
            (cal || []).filter(b => b.status === 'completed').forEach(b => {
                const k = b.startAt.slice(0, 10);
                perDay[k] = (perDay[k] || 0) + ((b.priceFinal != null ? b.priceFinal : b.priceSnapshot) || 0);
            });
            // Всички дни от месеца (празните също), бъдещите — бледи. Надпис на 1, 5, 10… и днес.
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const dayBars = Array.from({ length: lastDay }, (_, i) => {
                const d = i + 1, k = `${from.slice(0, 8)}${pad(d)}`;
                return { label: d, value: perDay[k] || 0, title: `${d} ${now.toLocaleDateString('bg-BG', { month: 'long' })}`,
                    muted: d > now.getDate(), forceLabel: d === 1 || d === now.getDate() || (d % 5 === 0 && Math.abs(d - now.getDate()) > 1) };
            });
            const hasDayRevenue = Object.keys(perDay).length > 0;

            // Часове по ден от седмицата (всички активни)
            const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            const perWd = [0, 0, 0, 0, 0, 0, 0];
            (cal || []).forEach(b => { perWd[new Date(b.startAt).getDay()]++; });
            const order = [1, 2, 3, 4, 5, 6, 0];
            const wdBars = order.map(i => ({ label: WD[i], value: perWd[i] }));

            const totalBookings = (cal || []).length;
            const completed = (cal || []).filter(b => b.status === 'completed').length;
            const busiest = wdBars.reduce((a, b) => b.value > a.value ? b : a, { label: '—', value: 0 });
            const WDF = { 'Пн': 'Понеделник', 'Вт': 'Вторник', 'Ср': 'Сряда', 'Чт': 'Четвъртък', 'Пт': 'Петък', 'Сб': 'Събота', 'Нд': 'Неделя' };

            // Очакван приход до края на месеца = реализирано + стойността на
            // предстоящите записани (booked) часове. Може да варира (отмени/неявявания).
            const pipeline = (cal || []).filter(b => b.status === 'booked').reduce((s, b) => s + (b.priceSnapshot || 0), 0);
            const projected = rep.grandTotal + pipeline;

            // Дял на Радина (шефа): нейните 100% + комисионните от другите (100 - тех %).
            const comm = {}; (commissions || []).forEach(c => comm[c.employeeId] = c.percent);
            const paid = b => (b.priceFinal != null ? b.priceFinal : b.priceSnapshot) || 0;   // с отстъпката
            const bossShareOf = b => (b.employeeId === BOSS_ID)
                ? paid(b)
                : (b.serviceBossPercent != null)   // Биорепил, пробиване… -> фиксиран % за Радина
                    ? paid(b) * b.serviceBossPercent / 100
                    : paid(b) * (100 - (comm[b.employeeId] != null ? comm[b.employeeId] : 100)) / 100;
            const bossProjected = (cal || []).filter(b => b.status === 'completed' || b.status === 'booked').reduce((s, b) => s + bossShareOf(b), 0);

            dbox.innerHTML = `
                <div class="st-grid">
                    <section class="st-card st-card--wide">
                        ${sectionTitle('Оборот по дни', ACC.stats)}
                        <p class="hint st-sub">Само проведените часове · в евро</p>
                        ${hasDayRevenue ? Charts.bars(dayBars, { color: ACC.stats, unit: '€', labelEvery: 99 }) : '<p class="hint">Още няма проведени часове този месец.</p>'}
                    </section>
                    <section class="st-card">
                        ${sectionTitle('Топ процедури', ACC.set)}
                        <p class="hint st-sub">По оборот за месеца</p>
                        ${Charts.hbars(topSvc)}
                    </section>
                    <section class="st-card">
                        ${sectionTitle('Натовареност по дни', ACC.cal)}
                        <p class="hint st-sub">Брой часове по ден от седмицата</p>
                        ${Charts.bars(wdBars, { color: ACC.cal, highlightMax: true, showValues: 'all' })}
                    </section>
                </div>`;
        } catch (err) {
            dbox.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // ---- Раздел ГРАФИК ----
    async function renderCalendarTab(box) {
        // Целият салон; горе в графика има лента с имената за филтриране.
        box.innerHTML = `<div id="boss-cal"><div class="spinner"></div></div>`;
        mountAllCalendar(box.querySelector('#boss-cal'));
    }

    // ---- Раздел НЕКОРЕКТНИ КЛИЕНТИ ----
    async function renderNoShow(box) {
        box.innerHTML = `
            ${sectionTitle('Некоректни клиенти', ACC.alert, '0 0 .3rem')}
            <p class="hint" style="margin:0 0 1.2rem">Клиенти, които не са се явявали на записан час — следят се по телефонен номер. Щом такъв клиент запази нов час, той светва с червен триъгълник ⚠ в графика.</p>
            <div class="ns-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.ns-body');
        try {
            const rows = await API.get('/reports/no-show-clients');
            if (!rows || !rows.length) {
                body.innerHTML = `<div class="panel center"><p class="hint" style="margin:0">Няма некоректни клиенти. 🎉</p></div>`;
                return;
            }
            const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return '—'; } };
            const phoneSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>';
            const clockSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
            body.innerHTML = rows.map(c => {
                const phone = c.phone
                    ? `<span class="ns-meta-row">${phoneSvg}<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></span>`
                    : `<span class="ns-meta-row">${phoneSvg}<span>без телефон</span></span>`;
                const last = `<span class="ns-meta-row">${clockSvg}<span>последно неявяване: ${fmtDate(c.lastNoShow)}</span></span>`;
                const upcoming = c.upcomingCount > 0
                    ? `<span class="ns-badge-up">⚠ има ${c.upcomingCount} предстоящ${c.upcomingCount === 1 ? '' : 'и'} час${c.upcomingCount === 1 ? '' : 'а'}</span>`
                    : `<span class="ns-badge-none">няма предстоящи часове</span>`;
                return `
                <div class="ns-card">
                    <div class="ns-ic">⚠</div>
                    <div class="ns-main">
                        <div class="ns-top">
                            <span class="ns-name">${esc(c.clientName || 'Клиент')}</span>
                            <span class="ns-count">${c.noShowCount}× не се яви</span>
                        </div>
                        <div class="ns-meta">${phone}${last}</div>
                        <div class="ns-upcoming">${upcoming}</div>
                    </div>
                </div>`;
            }).join('');
        } catch (err) {
            body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // ---- Раздел КЛИЕНТИ (за Радина, Анелия и Ирина) ----
    // Всички клиенти: записали се онлайн + добавени ръчно от персонала (по телефон).
    // Филтър Всички / Коректни / Некоректни + търсене по име, телефон или имейл.
    // Клик върху клиент -> всичките му минали и предстоящи часове (при всички специалисти).
    // Цените на чужди часове идват празни от сървъра — служителката вижда само своите пари.
    async function renderClients(box) {
        box.innerHTML = `
            ${sectionTitle('Клиенти', ACC.cli, '0 0 .3rem')}
            <p class="hint" style="margin:0 0 1rem">Всички клиенти — записали се онлайн и добавени ръчно от вас (разпознават се по телефона). Натисни клиент, за да видиш всичките му часове.</p>
            <div class="cl-bar">
                <div class="cl-seg" role="tablist">
                    <button class="cl-f is-on" data-f="all">Всички</button>
                    <button class="cl-f" data-f="ok">Коректни</button>
                    <button class="cl-f" data-f="noshow">Некоректни</button>
                    <button class="cl-f" data-f="dup">Повтарящи се</button>
                </div>
                <input class="input cl-q" type="search" placeholder="Търси по име, телефон или имейл…" autocomplete="off">
                <button type="button" class="btn btn--gold cl-add-btn">+ Добави клиент</button>
            </div>
            <form class="cl-add card" hidden novalidate>
                <div class="cl-add__title">Нов клиент</div>
                <div class="cl-add__fields">
                    <label>Имена<input class="input cl-add-name" type="text" maxlength="200" autocomplete="off" placeholder="напр. Мария Иванова"></label>
                    <label>Телефон<input class="input cl-add-phone" type="tel" maxlength="30" inputmode="tel" autocomplete="off" placeholder="0888 123 456"></label>
                </div>
                <div class="cl-add__msg"></div>
                <div class="cl-add__acts">
                    <button type="submit" class="btn btn--primary cl-add-save">Запази</button>
                    <button type="button" class="btn btn--ghost cl-add-cancel">Отказ</button>
                </div>
            </form>
            <div class="cl-count hint"></div>
            <div class="cl-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.cl-body'), countEl = box.querySelector('.cl-count');
        const qEl = box.querySelector('.cl-q');
        let filter = 'all', seq = 0, timer = null, lastRows = [];
        const nameKey = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; } };
        const phoneSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>';
        const mailSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

        function card(c) {
            const bad = c.noShow > 0;
            const meta = [
                c.phone ? `<span class="ns-meta-row">${phoneSvg}<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></span>` : `<span class="ns-meta-row">${phoneSvg}<span>без телефон</span></span>`,
                c.email ? `<span class="ns-meta-row">${mailSvg}<span>${esc(c.email)}</span></span>` : ''
            ].join('');
            const stats = c.isAdded ? '<span>още няма часове</span>' : [
                `<span>${c.total} ${c.total === 1 ? 'час' : 'часа'}</span>`,
                c.completed ? `<span>${c.completed} проведени</span>` : '',
                c.upcoming ? `<span class="cl-up">${c.upcoming} предстоящ${c.upcoming === 1 ? '' : 'и'}</span>` : '',
                c.lastVisit ? `<span>последно: ${fmtDate(c.lastVisit)}</span>` : ''
            ].filter(Boolean).join('<i>·</i>');
            return `
            <div class="cl-card${bad ? ' is-bad' : ''}" data-key="${esc(c.key)}" data-acc="${c.hasAccount ? 1 : 0}" data-added="${c.isAdded ? 1 : 0}" data-dup="${c.isDuplicate ? 1 : 0}" data-up="${c.upcoming || 0}" data-name="${esc(c.name || '')}" data-phone="${esc(c.phone || '')}">
                <button type="button" class="cl-head">
                    <span class="cl-av">${bad ? '⚠' : esc((c.name || '?').trim().charAt(0).toUpperCase())}</span>
                    <span class="cl-main">
                        <span class="cl-top">
                            <span class="cl-name">${esc(c.name || 'Клиент')}</span>
                            ${bad ? `<span class="ns-count">${c.noShow}× не се яви</span>` : ''}
                            <span class="cl-tag${c.hasAccount ? ' is-acc' : ''}">${c.hasAccount ? 'с профил' : 'добавен ръчно'}</span>
                            ${c.isDuplicate ? `<span class="cl-tag is-dup" title="Има и друг клиент със същите имена">повтаря се</span>` : ''}
                        </span>
                        <span class="ns-meta">${meta}</span>
                        <span class="cl-stats">${stats}</span>
                    </span>
                    <span class="cl-chev">${Icon('chevron-down', { size: 18 })}</span>
                </button>
                <div class="cl-hist" hidden></div>
            </div>`;
        }

        async function load() {
            const my = ++seq;
            body.innerHTML = `<div class="spinner"></div>`;
            try {
                const q = qEl.value.trim();
                const rows = await API.get(`/clients?filter=${filter}${q ? '&q=' + encodeURIComponent(q) : ''}`) || [];
                if (my !== seq) return;
                lastRows = rows;
                countEl.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'клиент' : 'клиента'}` : '';
                body.innerHTML = rows.length ? rows.map(card).join('')
                    : `<div class="panel center"><p class="hint" style="margin:0">${q ? 'Няма клиент, който да отговаря на търсенето.' : (filter === 'noshow' ? 'Няма некоректни клиенти. 🎉' : (filter === 'dup' ? 'Няма повтарящи се клиенти. 🎉' : 'Още няма клиенти.'))}</p></div>`;
            } catch (err) {
                if (my === seq) body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        }

        async function toggleHistory(cardEl) {
            const hist = cardEl.querySelector('.cl-hist');
            const open = hist.hidden;
            cardEl.classList.toggle('is-open', open);
            hist.hidden = !open;
            if (!open || hist.dataset.loaded) return;
            hist.innerHTML = `<div class="spinner"></div>`;
            try {
                const h = await API.get(`/clients/history?key=${encodeURIComponent(cardEl.dataset.key)}`);
                const items = (h && h.bookings) || [];
                hist.dataset.loaded = '1';
                // Ръчно добавен клиент -> покана да си направи профил (линк, който пращаш от своя телефон).
                const inviteBar = cardEl.dataset.acc === '1' ? '' : `
                    <div class="cl-inv">
                        <span>Няма профил в сайта. Прати ѝ покана — като се регистрира през линка, тези часове ще са в профила ѝ.</span>
                        <button type="button" class="btn btn--gold cl-inv-btn" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem">Покани за профил</button>
                        <div class="cl-inv-out" hidden></div>
                    </div>`;
                // Редакция + изтриване: добавен без часове — всички; с история — Радина, а служителките
                // само повтарящ се клиент (същите имена като друг). Предстоящ час не пречи.
                const isAcc = cardEl.dataset.acc === '1', isAdded = cardEl.dataset.added === '1', isDup = cardEl.dataset.dup === '1';
                const canDel = isAdded || role === 'boss' || isDup;
                // Повтарящ се без телефон -> „Обедини“ с картата със същите имена и телефон (часовете минават там).
                const mergeTo = (isDup && cardEl.dataset.key.charAt(0) === 'n')
                    ? lastRows.filter(r => r.key !== cardEl.dataset.key && r.key.charAt(0) === 'p' && nameKey(r.name) === nameKey(cardEl.dataset.name)) : [];
                const actBar = `
                    <div class="cl-acts">
                        <button type="button" class="btn btn--ghost cl-edit-btn">Редактирай</button>
                        ${mergeTo.map(r => `<button type="button" class="btn btn--gold cl-merge-btn" data-name="${esc(r.name)}" data-phone="${esc(r.phone || '')}">Обедини с ${esc(r.phone || '')}</button>`).join('')}
                        ${canDel ? `<button type="button" class="btn btn--ghost cl-del-btn">Изтрий</button>` : ''}
                    </div>
                    <div class="cl-edit-box" hidden></div>`;
                if (!items.length) { hist.innerHTML = actBar + inviteBar + `<p class="hint" style="margin:.4rem 0 0">Няма записани часове.</p>`; return; }
                const now = Date.now();
                hist.innerHTML = actBar + inviteBar + items.map(b => {
                    const st = STATUS[b.status] || { label: b.status, cls: 'alert--info' };
                    const future = b.status === 'booked' && new Date(b.startAt).getTime() > now;
                    const price = b.price != null
                        ? `<b class="cl-price">${money(b.price * (100 - (b.discountPercent || 0)) / 100)}${b.discountPercent ? ` <small>−${b.discountPercent}%</small>` : ''}</b>` : '';
                    return `<div class="cl-row${future ? ' is-future' : ''}">
                        <div class="cl-row__when">${fmtDate(b.startAt)}<small>${b.startAt.slice(11, 16)}</small></div>
                        <div class="cl-row__what"><span>${esc(b.serviceName)}</span><small>при ${esc(b.employeeName)}${b.source === 'staff' ? ' · записан ръчно' : ' · онлайн'}</small>
                            ${b.cancelReason ? `<small class="cl-row__why">Причина: ${esc(b.cancelReason)}</small>` : ''}</div>
                        <div class="cl-row__st"><span class="cl-st ${st.cls}">${future ? 'Предстоящ' : st.label}</span>${price}</div>
                    </div>`;
                }).join('');
            } catch (err) {
                hist.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        }

        box.querySelectorAll('.cl-f').forEach(b => b.addEventListener('click', () => {
            filter = b.dataset.f;
            box.querySelectorAll('.cl-f').forEach(x => x.classList.toggle('is-on', x === b));
            load();
        }));
        qEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 280); });

        // ---- Добави клиент (имена + телефон, без час) ----
        const addBtn = box.querySelector('.cl-add-btn'), addForm = box.querySelector('.cl-add');
        const addName = addForm.querySelector('.cl-add-name'), addPhone = addForm.querySelector('.cl-add-phone');
        const addMsg = addForm.querySelector('.cl-add__msg'), addSave = addForm.querySelector('.cl-add-save');
        const closeAdd = () => { addForm.hidden = true; addBtn.hidden = false; addForm.reset(); addMsg.innerHTML = ''; };
        addBtn.addEventListener('click', () => { addForm.hidden = false; addBtn.hidden = true; addName.focus(); });
        addForm.querySelector('.cl-add-cancel').addEventListener('click', closeAdd);
        addForm.addEventListener('submit', async e => {
            e.preventDefault();
            const name = addName.value.trim(), phone = addPhone.value.trim();
            if (name.length < 2) { addMsg.innerHTML = `<div class="alert alert--err">Въведи имената.</div>`; addName.focus(); return; }
            if ((phone.match(/\d/g) || []).length < 6) { addMsg.innerHTML = `<div class="alert alert--err">Въведи телефонен номер.</div>`; addPhone.focus(); return; }
            addSave.disabled = true;
            try {
                const c = await API.post('/clients', { name, phone });
                closeAdd();
                // Показва новия клиент най-отгоре.
                filter = 'all';
                box.querySelectorAll('.cl-f').forEach(x => x.classList.toggle('is-on', x.dataset.f === 'all'));
                qEl.value = (c && c.phone) || phone;
                await load();
            } catch (err) {
                addMsg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            } finally { addSave.disabled = false; }
        });

        body.addEventListener('click', async e => {
            const mergeBtn = e.target.closest('.cl-merge-btn');
            if (mergeBtn) {
                const cardEl = mergeBtn.closest('.cl-card');
                const nm = mergeBtn.dataset.name, ph = mergeBtn.dataset.phone;
                if (!confirm(`Да обединя ли двете карти на ${nm}?\n\nЧасовете от картата „без телефон“ минават към ${nm} (${ph}) и остава само една карта. Предстоящите часове си остават в графика.`)) return;
                mergeBtn.disabled = true;
                try { await API.put(`/clients?key=${encodeURIComponent(cardEl.dataset.key)}`, { name: nm, phone: ph }); await load(); }
                catch (err) { alert(err.message); mergeBtn.disabled = false; }
                return;
            }
            const delBtn = e.target.closest('.cl-del-btn');
            if (delBtn) {
                const cardEl = delBtn.closest('.cl-card');
                const nm = cardEl.dataset.name || 'клиента';
                const q = cardEl.dataset.added === '1'
                    ? `Да изтрия ли ${nm}?`
                    : cardEl.dataset.dup === '1'
                    ? `Да изтрия ли този запис на ${nm}${cardEl.dataset.phone ? ' (' + cardEl.dataset.phone + ')' : ' (без телефон)'}?\n\nДругият запис със същите имена остава. Миналите часове и парите остават в статистиките.`
                    : `Да изтрия ли ${nm} от списъка?\n\nМиналите часове и парите остават в статистиките. Ако пак си запише час, ще се появи отново.`;
                const upN = +cardEl.dataset.up || 0;
                const upWarn = upN > 0 ? `\n\n⚠ Има ${upN} предстоящ${upN === 1 ? '' : 'и'} час${upN === 1 ? '' : 'а'} — ${upN === 1 ? 'той остава' : 'те остават'} в графика. Ако не трябва, отмени ги отделно.` : '';
                if (!confirm(q + upWarn)) return;
                delBtn.disabled = true;
                try { await API.del(`/clients?key=${encodeURIComponent(cardEl.dataset.key)}`); await load(); }
                catch (err) { alert(err.message); delBtn.disabled = false; }
                return;
            }
            const editBtn = e.target.closest('.cl-edit-btn');
            if (editBtn) {
                const cardEl = editBtn.closest('.cl-card'), eb = cardEl.querySelector('.cl-edit-box');
                if (!eb.hidden) { eb.hidden = true; return; }
                const byPhone = cardEl.dataset.key.charAt(0) === 'p';
                eb.innerHTML = `
                    <div class="cl-add__fields">
                        <label>Имена<input class="input cl-e-name" type="text" maxlength="200" autocomplete="off" value="${esc(cardEl.dataset.name || '')}"></label>
                        <label>Телефон<input class="input cl-e-phone" type="tel" maxlength="30" inputmode="tel" autocomplete="off" value="${esc(cardEl.dataset.phone || '')}"${byPhone ? '' : ' placeholder="по желание"'}></label>
                    </div>
                    ${cardEl.dataset.acc === '1' ? `<small class="hint">Клиентът има профил — сменят се името и телефонът в профила ѝ. Имейлът и паролата не се пипат.</small>` : ''}
                    <div class="cl-add__msg"></div>
                    <div class="cl-add__acts">
                        <button type="button" class="btn btn--primary cl-e-save">Запази</button>
                        <button type="button" class="btn btn--ghost cl-e-cancel">Отказ</button>
                    </div>`;
                eb.hidden = false;
                eb.querySelector('.cl-e-name').focus();
                eb.querySelector('.cl-e-cancel').addEventListener('click', () => { eb.hidden = true; });
                eb.querySelector('.cl-e-save').addEventListener('click', async ev => {
                    const name = eb.querySelector('.cl-e-name').value.trim(), phone = eb.querySelector('.cl-e-phone').value.trim();
                    const m = eb.querySelector('.cl-add__msg');
                    if (name.length < 2) { m.innerHTML = `<div class="alert alert--err">Въведи имената.</div>`; return; }
                    ev.target.disabled = true;
                    try { await API.put(`/clients?key=${encodeURIComponent(cardEl.dataset.key)}`, { name, phone }); await load(); }
                    catch (err) { m.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`; ev.target.disabled = false; }
                });
                return;
            }
            if (e.target.closest('.cl-edit-box')) return;
            const invBtn = e.target.closest('.cl-inv-btn');
            if (invBtn) {
                const cardEl = invBtn.closest('.cl-card'), out = cardEl.querySelector('.cl-inv-out');
                invBtn.disabled = true;
                try {
                    const inv = await API.post('/clients/invite', { key: cardEl.dataset.key });
                    const url = `${location.origin}/auth.html?invite=${inv.token}`;
                    const first = (cardEl.dataset.name || '').trim().split(/\s+/)[0];
                    const text = `Здравей${first ? ', ' + first : ''}! Направи си профил в Beauty House — ще виждаш всичките си часове при нас и ще се записваш онлайн: ${url}`;
                    const phone = (cardEl.dataset.phone || '').replace(/[^\d+]/g, '');
                    const until = new Date(inv.expiresAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
                    out.innerHTML = `
                        <input class="input cl-inv-url" readonly value="${esc(url)}">
                        <div class="cl-inv-acts">
                            <button type="button" class="btn btn--primary cl-inv-copy" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem">Копирай съобщението</button>
                            <a class="btn btn--ghost" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem" href="viber://forward?text=${encodeURIComponent(text)}">Viber</a>
                            ${phone ? `<a class="btn btn--ghost" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem" href="sms:${esc(phone)}?body=${encodeURIComponent(text)}">SMS</a>` : ''}
                        </div>
                        <small class="hint">Линкът е само за нея, важи до ${until} и се ползва веднъж.</small>`;
                    out.hidden = false;
                    invBtn.hidden = true;
                    out.querySelector('.cl-inv-copy').addEventListener('click', async ev => {
                        try { await navigator.clipboard.writeText(text); ev.target.textContent = 'Копирано ✓'; }
                        catch (_) { const i = out.querySelector('.cl-inv-url'); i.select(); document.execCommand('copy'); ev.target.textContent = 'Копирано ✓'; }
                    });
                } catch (err) {
                    out.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`; out.hidden = false;
                    invBtn.disabled = false;
                }
                return;
            }
            const head = e.target.closest('.cl-head');
            if (!head || e.target.closest('a')) return;
            toggleHistory(head.closest('.cl-card'));
        });
        load();
    }

    // ---- Раздел НАСТРОЙКИ (комисионни) ----
    async function renderSettings(box) {
        box.innerHTML = `
            ${sectionTitle('Натовареност на графика', ACC.set, '0 0 .3rem')}
            <p class="hint" style="margin:0 0 .9rem">Прагове за цветовете в календара (брой часове за целия салон на ден).</p>
            <div class="card set-card" style="display:grid;margin-bottom:1.8rem">
                <div class="set-thresh">
                    <div class="set-trow">
                        <span class="set-dot" style="background:#E7B100"></span>
                        <span class="set-trow__lb">Умерено натоварен<small>Ден с повече от толкова часа свети в жълто</small></span>
                        <span class="set-field"><input class="input ld-yellow" type="number" min="1" max="100"><span class="set-field__u">часа</span></span>
                    </div>
                    <div class="set-trow">
                        <span class="set-dot" style="background:#D9534F"></span>
                        <span class="set-trow__lb">Много натоварен<small>Ден с повече от толкова часа свети в червено</small></span>
                        <span class="set-field"><input class="input ld-red" type="number" min="1" max="100"><span class="set-field__u">часа</span></span>
                    </div>
                </div>
                <button class="btn btn--gold ld-save set-save" style="--pad-y:.5rem;--pad-x:1.2rem;font-size:.85rem">Запази праговете</button>
            </div>

            ${sectionTitle('Комисионни', ACC.set, '0 0 .3rem')}
            <p class="hint" style="margin:0 0 .9rem">Процент от сумата, който остава за работничката (останалото е за теб).</p>
            <div class="comm-body"><div class="spinner"></div></div>`;

        // Прагове за натовареност (пазят се локално, ползват се от календара).
        const ly = box.querySelector('.ld-yellow'), lr = box.querySelector('.ld-red');
        ly.value = parseInt(localStorage.getItem('bh_load_yellow'), 10) || 10;
        lr.value = parseInt(localStorage.getItem('bh_load_red'), 10) || 15;
        box.querySelector('.ld-save').addEventListener('click', (e) => {
            let yv = Math.max(1, +ly.value || 10), rv = Math.max(1, +lr.value || 15);
            if (rv <= yv) rv = yv + 1;
            localStorage.setItem('bh_load_yellow', yv);
            localStorage.setItem('bh_load_red', rv);
            ly.value = yv; lr.value = rv;
            const btn = e.currentTarget; btn.textContent = 'Запазено ✓'; setTimeout(() => btn.textContent = 'Запази', 1500);
        });

        const cbox = box.querySelector('.comm-body');
        try {
            const listc = await API.get('/reports/commissions');
            if (!listc || !listc.length) { cbox.innerHTML = `<div class="hint">Няма работнички.</div>`; return; }
            const avColor = earnColor;   // същият цвят като в графика и статистиките
            const initials = n => (String(n || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
            cbox.innerHTML = listc.map(c => `
                <div class="card comm-card">
                    <div class="comm-head">
                        <span class="comm-av" style="background:${avColor(c.employeeId, c.name)}">${initials(c.name)}</span>
                        <div class="comm-name"><strong>${esc(c.name)}</strong><div class="hint">Комисионно разпределение</div></div>
                        <span class="comm-boss-pill">за теб <b class="comm-boss">${fmtPct(100 - c.percent)}%</b></span>
                    </div>
                    <div class="comm-bar"><span class="comm-bar__her" style="width:${c.percent}%"></span></div>
                    <div class="comm-ctrl">
                        <span class="hint">Дял за нея</span>
                        <span class="set-field"><input class="input comm-input" data-id="${c.employeeId}" type="number" min="0" max="100" step="any" inputmode="decimal" value="${+(+c.percent).toFixed(4)}"><span class="set-field__u">%</span></span>
                        <button class="btn btn--gold comm-save" data-id="${c.employeeId}" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem">Запази</button>
                    </div>
                </div>`).join('');
            cbox.querySelectorAll('.comm-input').forEach(inp => inp.addEventListener('input', () => {
                const card = inp.closest('.card');
                const v = Math.max(0, Math.min(100, +String(inp.value).replace(',', '.') || 0));
                const b = card.querySelector('.comm-boss'); if (b) b.textContent = fmtPct(100 - v) + '%';
                const bar = card.querySelector('.comm-bar__her'); if (bar) bar.style.width = v + '%';
            }));
            cbox.querySelectorAll('.comm-save').forEach(btn => btn.addEventListener('click', async () => {
                const inp = cbox.querySelector(`.comm-input[data-id="${btn.dataset.id}"]`);
                const percent = Math.round(Math.max(0, Math.min(100, +String(inp.value).replace(',', '.') || 0)) * 10000) / 10000;
                btn.disabled = true; btn.style.opacity = .7;
                try { await API.put('/reports/commissions', { employeeId: +btn.dataset.id, percent }); btn.textContent = 'Запазено ✓'; setTimeout(() => btn.textContent = 'Запази', 1500); }
                catch (err) { alert(err.message); }
                btn.disabled = false; btn.style.opacity = 1;
            }));
        } catch (err) {
            cbox.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // ===============================================================
    //  Разпределение по роля
    // ===============================================================
    if (role === 'boss') {
        title.textContent = 'Табло на салона';
        sub.textContent = '';
        renderBoss(list);
        return;
    }

    if (role === 'employee') {
        title.textContent = 'Моят график';
        sub.textContent = '';
        // Служителката (Анелия, Ирина) вижда: своя график, своите пари и клиентите
        // (коректни/некоректни + история). Чужди пари и статистики — не.
        list.classList.add('dash-body');
        list.innerHTML = `
            <div class="dash-panel" data-p="calendar"></div>
            <div class="dash-panel" data-p="earn" hidden></div>
            <div class="dash-panel" data-p="clients" hidden></div>
            <nav class="dash-nav dash-nav--3" aria-label="Навигация">
                <button class="dash-tab" data-t="calendar"><span class="dash-tab__ic">${Icon('calendar-check', { size: 20 })}</span><span class="dash-tab__lb">График</span></button>
                <button class="dash-tab" data-t="earn"><span class="dash-tab__ic">${Icon('chart', { size: 20 })}</span><span class="dash-tab__lb">Моите пари</span></button>
                <button class="dash-tab" data-t="clients"><span class="dash-tab__ic">${Icon('users', { size: 20 })}</span><span class="dash-tab__lb">Клиенти</span></button>
            </nav>`;
        document.querySelectorAll('body > .dash-nav').forEach(n => n.remove());
        const eNav = list.querySelector('.dash-nav');
        document.body.appendChild(eNav);
        document.body.classList.add('has-dashnav');
        const eTabs = [...eNav.querySelectorAll('.dash-tab')];
        const ePanels = {};
        list.querySelectorAll('.dash-panel').forEach(p => ePanels[p.dataset.p] = p);
        const eLoaded = {};
        const eLoaders = { calendar: mountEmployeeCalendars, earn: renderMyEarnings, clients: renderClients };
        const eBg = { calendar: 'var(--acc-cal-soft)', earn: 'var(--acc-stats-soft)', clients: 'var(--acc-cli-soft)' };
        const eShow = name => {
            eTabs.forEach(t => t.classList.toggle('active', t.dataset.t === name));
            Object.entries(ePanels).forEach(([k, el]) => el.hidden = k !== name);
            if (!eLoaded[name]) { eLoaded[name] = true; eLoaders[name](ePanels[name]); }
            list.style.background = eBg[name] || '';
            document.body.classList.toggle('dash-on-cal', name === 'calendar');
        };
        eTabs.forEach(t => t.addEventListener('click', () => eShow(t.dataset.t)));
        const eWanted = new URLSearchParams(location.search).get('tab');
        eShow(eLoaders[eWanted] ? eWanted : (eWanted === 'noshow' ? 'clients' : 'calendar'));
        return;
    }

    // Собствена печалба за период (служителката вижда само своята).
    function renderMyEarnings(earnBox) {
        earnBox.innerHTML = sectionTitle('Моите пари', ACC.stats, '0 0 .8rem') + '<div class="my-earn"></div>';
        periodBar(earnBox.querySelector('.my-earn'), async (body, from, to, all) => {
            body.innerHTML = `<div class="spinner"></div>`;
            try {
                const m = await API.get(`/me/earnings?from=${from}&to=${to}&all=${all}`);
                if (!m) { body.innerHTML = `<div class="alert alert--info">Няма данни за периода.</div>`; return; }
                body.innerHTML = `<div style="max-width:420px">${earnCard(m.name, false, [
                    { label: 'Изкарала', value: m.gross },
                    { label: 'Ще вземеш', value: m.take, total: true },
                    { label: `За Радина (${deductLbl(m)})`, value: m.gross - m.take, after: true }
                ], earnColor(m.employeeId, m.name))}</div>
                <p class="hint" style="margin-top:.7rem">${all ? 'Включени са и предстоящите записани часове.' : 'Само проведените часове.'}</p>`;
            } catch (err) {
                body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        });
    }

    // ---- Клиент: предстоящи + минали часове ----
    title.textContent = 'Моите часове';
    sub.textContent = 'Твоите предстоящи и минали часове.';
    // Дошла е през линк-покана от салона и вече е с профил -> старите часове са свързани.
    const linkedN = +new URLSearchParams(location.search).get('linked') || 0;
    if (linkedN > 0) sub.textContent = `Свързахме ${linkedN} ${linkedN === 1 ? 'час' : 'часа'} от салона с профила ти. ` + sub.textContent;

    const isUpcoming = b => b.status === 'booked' && new Date(b.startAt) >= new Date();
    let reviewedIds = new Set(); // часове, за които клиентът вече е оставил отзив

    function bookingCard(b) {
        const st = STATUS[b.status] || { label: b.status, cls: 'alert--info' };
        const up = isUpcoming(b);
        // Отмяна е позволена само до 3 часа преди началото (правило на салона).
        const canCancel = up && new Date(b.startAt).getTime() > Date.now() + 3 * 60 * 60 * 1000;
        const actions = canCancel
            ? `<button class="btn btn--ghost bk-cancel" data-id="${b.id}" style="--pad-y:.55rem;--pad-x:1rem;font-size:.85rem">Отмени</button>`
            : (up ? `<span class="hint" style="font-size:.8rem">Наближава — обади се в салона за отмяна</span>` : '');
        // "Запази пак" пренася същата услуга + специалист — ако все още ги предлага, стига направо до избор на дата.
        const rebookQs = b.employeeId
            ? `?emp=${encodeURIComponent(b.employeeId)}${b.serviceName ? '&srv=' + encodeURIComponent(b.serviceName) : ''}`
            : (b.serviceName ? `?srv=${encodeURIComponent(b.serviceName)}` : '');
        const rebook = !up
            ? `<a href="booking.html${rebookQs}" class="btn btn--ghost" style="--pad-y:.55rem;--pad-x:1rem;font-size:.85rem">Запази пак</a>` : '';
        // Отзив — само за проведени часове (по желание).
        const reviewUi = (!up && b.status === 'completed')
            ? (reviewedIds.has(b.id)
                ? `<span class="hint" style="font-size:.8rem;white-space:nowrap">Отзивът е оставен ✓</span>`
                : `<button class="btn btn--gold rev-open" data-id="${b.id}" style="--pad-y:.55rem;--pad-x:1rem;font-size:.85rem">Остави отзив</button>`)
            : '';
        return `
        <article class="card" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap${up ? '' : ';opacity:.9'}">
            <div>
                <strong style="font-size:1.08rem">${esc(b.serviceName)}</strong>
                <div class="team-card__role" style="color:var(--muted);font-weight:500">при ${esc(b.employeeName)}</div>
                <div class="hint" style="margin-top:.35rem;display:flex;align-items:center;gap:.4rem">${Icon('calendar', { size: 14 })} ${fmt(b.startAt)} · ${money((b.priceFinal != null ? b.priceFinal : b.priceSnapshot) || 0)}</div>
            </div>
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
                <span class="alert ${st.cls}" style="padding:.35rem .7rem;font-size:.78rem">${st.label}</span>
                ${actions}${reviewUi}${rebook}
            </div>
        </article>`;
    }

    // Инлайн форма за отзив (звезди + коментар).
    function openReviewForm(bookingId) {
        const host = document.getElementById('rev-form');
        if (!host) return;
        let rating = 5;
        host.innerHTML = `
            <div class="panel" style="margin-top:.4rem">
                <h4 style="margin:0 0 .6rem">Остави отзив</h4>
                <div class="rev-stars" style="display:flex;gap:.25rem;font-size:1.7rem;color:#E7B100;cursor:pointer;margin-bottom:.7rem">
                    ${[1, 2, 3, 4, 5].map(n => `<span data-n="${n}">★</span>`).join('')}
                </div>
                <textarea class="input rev-comment" placeholder="Сподели впечатленията си (по избор)" style="min-height:90px"></textarea>
                <div style="display:flex;gap:.6rem;margin-top:.8rem">
                    <button class="btn btn--primary rev-send">Публикувай</button>
                    <button class="btn btn--ghost rev-cancel">Отказ</button>
                </div>
                <div class="rev-msg" style="margin-top:.6rem"></div>
            </div>`;
        const starEls = [...host.querySelectorAll('.rev-stars span')];
        const paint = () => starEls.forEach(s => s.style.opacity = (+s.dataset.n <= rating ? '1' : '.3'));
        starEls.forEach(s => s.addEventListener('click', () => { rating = +s.dataset.n; paint(); }));
        paint();
        host.querySelector('.rev-cancel').addEventListener('click', () => host.innerHTML = '');
        host.querySelector('.rev-send').addEventListener('click', async (e) => {
            const btn = e.currentTarget; btn.disabled = true; btn.style.opacity = .7;
            try {
                await API.post('/reviews', { bookingId, rating, comment: host.querySelector('.rev-comment').value.trim() || null });
                reviewedIds.add(bookingId);
                host.innerHTML = `<div class="alert alert--ok">Благодарим за отзива! 💛</div>`;
                setTimeout(load, 900);
            } catch (err) {
                host.querySelector('.rev-msg').innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
                btn.disabled = false; btn.style.opacity = 1;
            }
        });
        host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function load() {
        list.innerHTML = `<div class="spinner"></div>`;
        try {
            const items = await API.get('/me/bookings') || [];
            if (!items.length) {
                list.innerHTML = `
                    <div class="panel center">
                        <div class="service-card__icon ic--rose" style="margin:0 auto 1rem">${Icon('sprout')}</div>
                        <h3 style="margin-bottom:.4rem">Още нямаш часове</h3>
                        <p class="hint" style="margin-bottom:1.4rem">Твоят момент на грижа те чака.</p>
                        <a href="booking.html" class="btn btn--primary">Запази час →</a>
                    </div>`;
                return;
            }
            // Кои минали часове вече са оценени.
            try { const mine = await API.get('/reviews/mine'); reviewedIds = new Set((mine || []).map(r => r.bookingId)); }
            catch (e) { reviewedIds = new Set(); }

            const upcoming = items.filter(isUpcoming).sort((a, b) => a.startAt.localeCompare(b.startAt));
            const past = items.filter(b => !isUpcoming(b)); // backend връща най-новите отгоре

            list.innerHTML = `
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.4rem">
                    <button class="btn my-tab" data-t="up" style="--pad-y:.5rem;--pad-x:1.1rem;font-size:.9rem">Предстоящи (${upcoming.length})</button>
                    <button class="btn my-tab" data-t="past" style="--pad-y:.5rem;--pad-x:1.1rem;font-size:.9rem">Минали (${past.length})</button>
                </div>
                <div id="my-bk"></div>`;

            const box = list.querySelector('#my-bk');
            const tabs = [...list.querySelectorAll('.my-tab')];
            function show(which) {
                tabs.forEach(t => {
                    const on = t.dataset.t === which;
                    t.classList.toggle('btn--primary', on);
                    t.classList.toggle('btn--ghost', !on);
                });
                const arr = which === 'up' ? upcoming : past;
                box.innerHTML = arr.length
                    ? `<div class="cards" style="gap:14px">` + arr.map(bookingCard).join('') + `</div>`
                        + (which === 'past' ? `<div id="rev-form"></div>` : '')
                    : `<div class="panel center"><p class="hint" style="margin:0">${which === 'up' ? 'Нямаш предстоящи часове.' : 'Нямаш минали часове.'}</p></div>`;
                box.querySelectorAll('.bk-cancel').forEach(btn =>
                    btn.addEventListener('click', () => act(btn, () => API.patch('/bookings/' + btn.dataset.id, { cancel: true }))));
                box.querySelectorAll('.rev-open').forEach(btn =>
                    btn.addEventListener('click', () => openReviewForm(+btn.dataset.id)));
            }
            tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.t)));
            show('up');
        } catch (err) {
            list.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    async function act(btn, fn) {
        btn.disabled = true; btn.style.opacity = .7;
        try { await fn(); load(); }
        catch (err) { alert(err.message); btn.disabled = false; btn.style.opacity = 1; }
    }

    load();
});

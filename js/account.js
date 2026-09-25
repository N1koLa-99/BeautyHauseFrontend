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
    const ACC = { stats: '#5F8DBF', cal: '#4F9E7C', alert: '#D9534F', set: '#9B7FC2' };
    const pad = n => String(n).padStart(2, '0');
    const money = v => Math.round(Number(v) || 0).toLocaleString('bg-BG') + ' €';
    const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    let BOSS_ID = 0;   // id на шефа (от /employees по роля) — надеждно, без session id

    function fmt(iso) {
        const d = new Date(iso);
        const date = d.toLocaleDateString('bg-BG', { weekday: 'short', day: 'numeric', month: 'long' });
        return `${date} · ${iso.slice(11, 16)}`;
    }

    // ---- Календари (споделени) ----
    async function mountMyCalendar(container) {
        let services = [];
        try { services = await API.get('/me/services'); } catch (e) {}
        Calendar.mount(container, {
            editable: true, staffId: BOSS_ID || Session.userId(),
            services: (services || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes })),
            fetchMonth: (f, t) => API.get(`/me/calendar?from=${f}&to=${t}`),
            createBooking: (dto) => API.post('/me/bookings', dto),
            setStatus: (id, st) => API.patch(`/bookings/${id}/status`, { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason })
        });
    }
    async function mountReadonlyCalendar(container, staffId) {
        let services = [];
        try { services = await API.get(`/employees/${staffId}/services`); } catch (e) {}
        Calendar.mount(container, {
            editable: true, staffId: staffId, canManage: role === 'boss',
            services: (services || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes })),
            fetchMonth: (f, t) => API.get(`/reports/employee-calendar?employeeId=${staffId}&from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/reports/bookings?employeeId=${staffId}`, dto),
            setStatus: (id, st) => API.patch(`/bookings/${id}/status`, { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason }),
            setDiscount: (id, pct) => API.put(`/reports/bookings/${id}/discount`, { discountPercent: pct }),
            setDuration: (id, min) => API.put(`/reports/bookings/${id}/duration`, { durationMinutes: min }),
            deleteBk: (id) => API.del(`/reports/bookings/${id}`)
        });
    }
    async function mountAllCalendar(container) {
        let employees = [];
        try { employees = (await API.get('/employees')) || []; } catch (e) {}
        Calendar.mount(container, {
            editable: true, showEmployee: true, canManage: role === 'boss',
            employees: employees.map(e => ({ id: e.id, name: e.fullName, photo: e.photoUrl })),
            servicesFor: (empId) => API.get(`/employees/${empId}/services`),
            fetchMonth: (f, t) => API.get(`/reports/calendar?from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/reports/bookings?employeeId=${dto.employeeId}`, dto),
            setStatus: (id, st) => API.patch(`/bookings/${id}/status`, { status: st }),
            cancelBooking: (id, reason) => API.post(`/bookings/${id}/cancel`, { reason }),
            setDiscount: (id, pct) => API.put(`/reports/bookings/${id}/discount`, { discountPercent: pct }),
            setDuration: (id, min) => API.put(`/reports/bookings/${id}/duration`, { durationMinutes: min }),
            deleteBk: (id) => API.del(`/reports/bookings/${id}`)
        });
    }

    // „30%" или „30% · 20% за някои" (Биорепил, пробиване са с фиксиран процент).
    const deductLbl = x => {
        const fx = (x.fixedBossPercents || []).filter(p => p !== 100 - x.percent);
        return `${100 - x.percent}%` + (fx.length ? ` · ${fx.join('/')}% за някои` : '');
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
            <div class="dash-panel" data-p="settings" hidden></div>
            <nav class="dash-nav" aria-label="Навигация на таблото">
                <button class="dash-tab" data-t="stats"><span class="dash-tab__ic">${Icon('chart', { size: 20 })}</span><span class="dash-tab__lb">Статистики</span></button>
                <button class="dash-tab" data-t="calendar"><span class="dash-tab__ic">${Icon('calendar-check', { size: 20 })}</span><span class="dash-tab__lb">График</span></button>
                <button class="dash-tab" data-t="noshow"><span class="dash-tab__ic">${Icon('alert', { size: 20 })}</span><span class="dash-tab__lb">Некоректни</span></button>
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
        const loaders = { stats: renderStats, calendar: renderCalendarTab, noshow: renderNoShow, settings: renderSettings };
        // Фонът на цялото табло се оцветява леко според отворения раздел — веднага личи къде си.
        const PANEL_BG = { stats: 'var(--acc-stats-soft)', calendar: 'var(--acc-cal-soft)', noshow: 'var(--acc-alert-soft)', settings: 'var(--acc-set-soft)' };

        function show(name) {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.t === name));
            Object.entries(panels).forEach(([k, el]) => el.hidden = k !== name);
            if (!loaded[name]) { loaded[name] = true; loaders[name](panels[name]); }
            box.style.background = PANEL_BG[name] || '';
            // На телефон графикът заема целия екран под табовете (виж css/styles.css).
            document.body.classList.toggle('dash-on-cal', name === 'calendar');
        }
        tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.t)));
        // ?tab=calendar (от менюто „График") отваря директно съответния раздел.
        const wanted = new URLSearchParams(location.search).get('tab');
        show(loaders[wanted] ? wanted : 'stats');
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
            <div class="ov-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.ov-body');
        const pbtns = [...box.querySelectorAll('.ov-p')];
        const range = box.querySelector('.ov-range');
        const modeInp = box.querySelector('.ov-mode');
        const fromInp = box.querySelector('.ov-from'), toInp = box.querySelector('.ov-to');

        function fire() {
            const [from, to] = periodRange(period, fromInp.value, toInp.value);
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
    const earnColor = id => (window.Calendar && Calendar.empColor)
        ? Calendar.empColor(id) : 'var(--rose)';

    const earnCard = (name, isBoss, rows, color) => {
        const initials = (name || '?').split(' ').map(w => w.charAt(0)).slice(0, 2).join('').toUpperCase();
        return `
        <div class="card earn-card" style="border-top:3px solid ${color}">
            <div class="earn-card__head">
                <span class="earn-card__avatar" style="background:${color}">${initials}</span>
                <div class="earn-card__title"><strong>${esc(name)}</strong>${isBoss ? `<span class="earn-card__badge">${Icon('crown', { size: 13 })} Управител</span>` : ''}</div>
            </div>
            ${rows.map(r => `<div class="earn-card__row${r.total ? ' earn-card__row--total' : ''}"><span>${r.label}</span><b>${money(r.value)}</b></div>`).join('')}
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
            const bossTotal = (boss ? boss.take : 0) + fromOthers;

            const cards = [];
            if (boss) cards.push(earnCard(boss.name, true, [
                { label: 'Твоят дял', value: boss.take },
                { label: '+ от Анелия и Ирина', value: fromOthers },
                { label: 'Общо ще вземеш', value: bossTotal, total: true }
            ], earnColor(boss.employeeId)));
            workers.forEach(w => cards.push(earnCard(w.name, false, [
                { label: 'Изкарала', value: w.gross },
                { label: `Удръжка (${deductLbl(w)})`, value: -(w.gross - w.take) },
                { label: 'Ще вземе', value: w.take, total: true }
            ], earnColor(w.employeeId))));

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
            ${sectionTitle(`Статистики за <b>${monthName}</b>`, ACC.stats, '0 0 .3rem')}
            <div class="stats-diagrams" style="margin-top:1rem"><div class="spinner"></div></div>`;

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
            const dayBars = Object.keys(perDay).sort().map(k => ({ label: +k.slice(8, 10), value: perDay[k] }));

            // Часове по ден от седмицата (всички активни)
            const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            const perWd = [0, 0, 0, 0, 0, 0, 0];
            (cal || []).forEach(b => { perWd[new Date(b.startAt).getDay()]++; });
            const order = [1, 2, 3, 4, 5, 6, 0];
            const wdBars = order.map(i => ({ label: WD[i], value: perWd[i] }));

            const totalBookings = (cal || []).length;
            const completed = (cal || []).filter(b => b.status === 'completed').length;
            const busiest = wdBars.reduce((a, b) => b.value > a.value ? b : a, { label: '—', value: 0 });

            // Очакван приход до края на месеца = реализирано + стойността на
            // предстоящите записани (booked) часове. Може да варира (отмени/неявявания).
            const pipeline = (cal || []).filter(b => b.status === 'booked').reduce((s, b) => s + (b.priceSnapshot || 0), 0);
            const projected = rep.grandTotal + pipeline;

            // Дял на Радина (шефа): нейните 100% + комисионните от другите (100 - тех %).
            const comm = {}; (commissions || []).forEach(c => comm[c.employeeId] = c.percent);
            const bossShareOf = b => (b.employeeId === BOSS_ID)
                ? (b.priceSnapshot || 0)
                : (b.serviceBossPercent != null)   // Биорепил, пробиване… -> фиксиран % за Радина
                    ? (b.priceSnapshot || 0) * b.serviceBossPercent / 100
                    : (b.priceSnapshot || 0) * (100 - (comm[b.employeeId] != null ? comm[b.employeeId] : 100)) / 100;
            const bossProjected = (cal || []).filter(b => b.status === 'completed' || b.status === 'booked').reduce((s, b) => s + bossShareOf(b), 0);

            dbox.innerHTML = `
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:1.6rem">
                    ${stat('Часове (общо)', totalBookings, completed + ' проведени', ACC.stats)}
                    ${stat('Най-натоварен ден', busiest.label, busiest.value + ' часа', ACC.cal)}
                </div>

                ${sectionTitle('Оборот по дни', ACC.stats)}
                <div class="panel" style="margin-bottom:1.6rem">
                    ${dayBars.length ? Charts.bars(dayBars, { color: ACC.stats }) : '<p class="hint">Още няма проведени часове този месец.</p>'}
                </div>

                ${sectionTitle('Топ процедури (по оборот)', ACC.set)}
                <div class="panel" style="margin-bottom:1.6rem">${Charts.hbars(topSvc)}</div>

                ${sectionTitle('Натовареност по дни от седмицата', ACC.cal)}
                <div class="panel">${Charts.bars(wdBars, { color: ACC.cal })}</div>`;
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
                        <span class="comm-av" style="background:${avColor(c.employeeId)}">${initials(c.name)}</span>
                        <div class="comm-name"><strong>${esc(c.name)}</strong><div class="hint">Комисионно разпределение</div></div>
                        <span class="comm-boss-pill">за теб <b class="comm-boss">${100 - c.percent}%</b></span>
                    </div>
                    <div class="comm-bar"><span class="comm-bar__her" style="width:${c.percent}%"></span></div>
                    <div class="comm-ctrl">
                        <span class="hint">Дял за нея</span>
                        <span class="set-field"><input class="input comm-input" data-id="${c.employeeId}" type="number" min="0" max="100" value="${c.percent}"><span class="set-field__u">%</span></span>
                        <button class="btn btn--gold comm-save" data-id="${c.employeeId}" style="--pad-y:.45rem;--pad-x:1rem;font-size:.82rem">Запази</button>
                    </div>
                </div>`).join('');
            cbox.querySelectorAll('.comm-input').forEach(inp => inp.addEventListener('input', () => {
                const card = inp.closest('.card');
                const v = Math.max(0, Math.min(100, +inp.value || 0));
                const b = card.querySelector('.comm-boss'); if (b) b.textContent = (100 - v) + '%';
                const bar = card.querySelector('.comm-bar__her'); if (bar) bar.style.width = v + '%';
            }));
            cbox.querySelectorAll('.comm-save').forEach(btn => btn.addEventListener('click', async () => {
                const inp = cbox.querySelector(`.comm-input[data-id="${btn.dataset.id}"]`);
                const percent = Math.max(0, Math.min(100, +inp.value || 0));
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
        // Собствена печалба за период (вижда само своята) + календар отдолу.
        const earnBox = document.createElement('div');
        earnBox.style.marginBottom = '2rem';
        const calBox = document.createElement('div');
        list.appendChild(earnBox);
        list.appendChild(calBox);

        periodBar(earnBox, async (body, from, to, all) => {
            body.innerHTML = `<div class="spinner"></div>`;
            try {
                const m = await API.get(`/me/earnings?from=${from}&to=${to}&all=${all}`);
                if (!m) { body.innerHTML = `<div class="alert alert--info">Няма данни за периода.</div>`; return; }
                body.innerHTML = `<div style="max-width:420px">${earnCard(m.name, false, [
                    { label: 'Изкарала', value: m.gross },
                    { label: `Удръжка (${deductLbl(m)})`, value: -(m.gross - m.take) },
                    { label: 'Ще вземеш', value: m.take, total: true }
                ], earnColor(m.employeeId))}</div>
                <p class="hint" style="margin-top:.7rem">${all ? 'Включени са и предстоящите записани часове.' : 'Само проведените часове.'}</p>`;
            } catch (err) {
                body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        });

        mountMyCalendar(calBox);
        return;
    }

    // ---- Клиент: предстоящи + минали часове ----
    title.textContent = 'Моите часове';
    sub.textContent = 'Твоите предстоящи и минали часове.';

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
                <div class="hint" style="margin-top:.35rem;display:flex;align-items:center;gap:.4rem">${Icon('calendar', { size: 14 })} ${fmt(b.startAt)} · ${((b.priceFinal != null ? b.priceFinal : b.priceSnapshot) || 0).toFixed(0)} €</div>
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

/* =====================================================================
   Профил:
   - клиент  → предстоящите му часове (може да отменя);
   - служител→ календар на графика + ръчно добавяне на телефонни часове;
   - шеф     → табло с раздели: Табло · Статистики · График · Настройки.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (!Session.isIn()) { location.href = 'auth.html?next=' + encodeURIComponent('account.html'); return; }

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
            setStatus: (id, st) => API.patch(`/bookings/${id}/status`, { status: st })
        });
    }
    async function mountReadonlyCalendar(container, staffId) {
        let services = [];
        try { services = await API.get(`/employees/${staffId}/services`); } catch (e) {}
        Calendar.mount(container, {
            editable: true, staffId: staffId,
            services: (services || []).map(s => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.durationMinutes })),
            fetchMonth: (f, t) => API.get(`/reports/employee-calendar?employeeId=${staffId}&from=${f}&to=${t}`),
            createBooking: (dto) => API.post(`/reports/bookings?employeeId=${staffId}`, dto),
            setStatus: (id, st) => API.patch(`/bookings/${id}/status`, { status: st })
        });
    }
    function mountAllCalendar(container) {
        Calendar.mount(container, {
            editable: false, showEmployee: true,
            fetchMonth: (f, t) => API.get(`/reports/calendar?from=${f}&to=${t}`)
        });
    }

    // Нетно разпределение: работничка = дела ѝ; шефът = своя дял + комисионните.
    // Шефът се разпознава по флага r.isBoss от backend-а (не по session id).
    function computeShares(rows, bossName) {
        // Шефът се разпознава по id-то от /employees (по роля) или флага от backend.
        const bossId = BOSS_ID || Session.userId();
        const byEmp = {};
        rows.forEach(r => {
            const e = byEmp[r.employeeId] || (byEmp[r.employeeId] = { id: r.employeeId, name: r.employeeName, isBoss: (!!r.isBoss) || (r.employeeId === bossId), rows: [], total: 0, count: 0, worker: 0, boss: 0, pct: r.workerPercent });
            e.rows.push(r); e.total += r.total; e.count += r.count; e.worker += (r.workerShare || 0); e.boss += (r.bossShare || 0);
        });
        const commissionToBoss = rows.reduce((s, r) => s + (r.bossShare || 0), 0);
        const persons = Object.values(byEmp).map(e => ({
            name: e.name, isBoss: e.isBoss, pct: e.pct,
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
        // Долна навигация тип мобилно приложение: График в средата, Настройки най-вдясно.
        box.innerHTML = `
            <div class="dash-panel" data-p="overview"><div class="spinner"></div></div>
            <div class="dash-panel" data-p="stats" hidden></div>
            <div class="dash-panel" data-p="calendar" hidden></div>
            <div class="dash-panel" data-p="noshow" hidden></div>
            <div class="dash-panel" data-p="settings" hidden></div>
            <nav class="dash-bottomnav" aria-label="Навигация на таблото">
                <button class="dash-tab" data-t="overview"><span class="dash-tab__ic">${Icon('crown', { size: 20 })}</span><span class="dash-tab__lb">Табло</span></button>
                <button class="dash-tab" data-t="stats"><span class="dash-tab__ic">${Icon('chart', { size: 20 })}</span><span class="dash-tab__lb">Статистики</span></button>
                <button class="dash-tab" data-t="calendar"><span class="dash-tab__ic">${Icon('calendar-check', { size: 20 })}</span><span class="dash-tab__lb">График</span></button>
                <button class="dash-tab" data-t="noshow"><span class="dash-tab__ic">${Icon('alert', { size: 20 })}</span><span class="dash-tab__lb">Некоректни</span></button>
                <button class="dash-tab" data-t="settings"><span class="dash-tab__ic">${Icon('gear', { size: 20 })}</span><span class="dash-tab__lb">Настройки</span></button>
            </nav>`;
        box.style.paddingBottom = '240px'; // въздух отдолу — удобно скролване под лентата

        // Лентата се закача директно към <body>, за да е ВИНАГИ залепена за
        // екрана (никой родителски елемент не може да я повлече при скрол).
        document.querySelectorAll('body > .dash-bottomnav').forEach(n => n.remove());
        const bottomNav = box.querySelector('.dash-bottomnav');
        document.body.appendChild(bottomNav);

        const tabs = [...bottomNav.querySelectorAll('.dash-tab')];
        const panels = {};
        box.querySelectorAll('.dash-panel').forEach(p => panels[p.dataset.p] = p);
        const loaded = {};
        const loaders = { overview: renderOverview, stats: renderStats, calendar: renderCalendarTab, noshow: renderNoShow, settings: renderSettings };

        function show(name) {
            tabs.forEach(t => t.classList.toggle('active', t.dataset.t === name));
            Object.entries(panels).forEach(([k, el]) => el.hidden = k !== name);
            if (!loaded[name]) { loaded[name] = true; loaders[name](panels[name]); }
        }
        tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.t)));
        // ?tab=calendar (от менюто „График") отваря директно съответния раздел.
        const wanted = new URLSearchParams(location.search).get('tab');
        show(loaders[wanted] ? wanted : 'overview');
    }

    // Компактна KPI карта: етикетът е ОТГОРЕ (ясно кое за какво е), стойността под него.
    const stat = (label, value, hint) => `
        <div class="card" style="flex:1;min-width:145px;padding:1rem 1.15rem;text-align:left">
            <div class="hint" style="font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;margin-bottom:.4rem">${label}</div>
            <div style="font-family:var(--font-display);font-size:1.4rem;color:var(--rose-deep);line-height:1.15;white-space:nowrap">${value}</div>
            ${hint ? `<div class="hint" style="font-size:.7rem;margin-top:.35rem">${hint}</div>` : ''}
        </div>`;

    // ---- Раздел ТАБЛО ----
    function renderOverview(box) {
        let period = 'week';
        box.innerHTML = `
            <div style="display:flex;gap:.5rem;margin-bottom:1.2rem;flex-wrap:wrap">
                <button class="btn ov-day" style="--pad-y:.5rem;--pad-x:1rem;font-size:.86rem">Днес</button>
                <button class="btn ov-week" style="--pad-y:.5rem;--pad-x:1rem;font-size:.86rem">Тази седмица</button>
                <button class="btn ov-month" style="--pad-y:.5rem;--pad-x:1rem;font-size:.86rem">Този месец</button>
            </div>
            <div class="ov-body"><div class="spinner"></div></div>`;
        const body = box.querySelector('.ov-body');
        const btns = { day: box.querySelector('.ov-day'), week: box.querySelector('.ov-week'), month: box.querySelector('.ov-month') };
        function setActive() { Object.entries(btns).forEach(([p, b]) => { b.classList.toggle('btn--primary', p === period); b.classList.toggle('btn--ghost', p !== period); }); }
        Object.entries(btns).forEach(([p, b]) => b.addEventListener('click', () => { period = p; setActive(); load(); }));
        setActive();

        async function load() {
            body.innerHTML = `<div class="spinner"></div>`;
            const label = period === 'day' ? 'днес' : (period === 'week' ? 'тази седмица' : 'този месец');
            try {
                const rep = await API.get(`/reports/revenue?period=${period}&date=${todayStr()}`);
                const rows = rep.breakdown || [];
                const count = rows.reduce((s, r) => s + (r.count || 0), 0);
                const avg = count ? rep.grandTotal / count : 0;
                const { persons } = computeShares(rows, rep.bossName);

                const people = persons.map(p => `
                    <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem">
                        <div>
                            <strong>${esc(p.name)}${p.isBoss ? ' 👑' : ''}</strong>
                            <div class="hint">${p.isBoss ? 'своите 100% + комисионните от екипа' : ('взема ' + p.pct + '% от своите процедури')}</div>
                        </div>
                        <span class="pill" style="font-size:1rem">${money(p.net)}</span>
                    </div>`).join('');

                body.innerHTML = `
                    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:1.4rem">
                        ${stat(`Оборот (${label})`, money(rep.grandTotal))}
                        ${stat('Проведени часове', count)}
                        ${stat('Среден чек', money(avg))}
                    </div>
                    ${count
                        ? `<h3 style="margin:0 0 .8rem">Кой колко взема</h3>${people}`
                        : `<div class="alert alert--info">Няма проведени часове за ${label}. Виж раздел „График" за предстоящите.</div>`}`;
            } catch (err) {
                body.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            }
        }
        load();
    }

    // ---- Раздел СТАТИСТИКИ ----
    async function renderStats(box) {
        box.innerHTML = `<div class="spinner"></div>`;
        const now = new Date();
        const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const to = `${now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear()}-${pad((now.getMonth() + 1) % 12 + 1)}-01`;
        const monthName = now.toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });
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
                perDay[k] = (perDay[k] || 0) + (b.priceSnapshot || 0);
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
                : (b.priceSnapshot || 0) * (100 - (comm[b.employeeId] != null ? comm[b.employeeId] : 100)) / 100;
            const bossProjected = (cal || []).filter(b => b.status === 'completed' || b.status === 'booked').reduce((s, b) => s + bossShareOf(b), 0);

            box.innerHTML = `
                <p class="hint" style="margin:0 0 1rem">Статистики за <b>${monthName}</b>.</p>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:1rem">
                    ${stat('Оборот (проведени)', money(rep.grandTotal))}
                    ${stat('Оборот общо до края', '≈ ' + money(projected), 'проведени + записани · приблизително')}
                    ${stat('Радина ще вземе', '≈ ' + money(bossProjected), 'нейният дял + комисионните · приблизително')}
                </div>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:1.6rem">
                    ${stat('Часове (общо)', totalBookings, completed + ' проведени')}
                    ${stat('Най-натоварен ден', busiest.label, busiest.value + ' часа')}
                </div>

                <h3 style="margin:0 0 .6rem">Разпределение на парите</h3>
                <div class="panel" style="margin-bottom:1.6rem">
                    ${persons.length ? Charts.doughnut(persons.map(p => ({ label: p.name, value: p.net }))) : '<p class="hint">Няма данни за месеца.</p>'}
                </div>

                <h3 style="margin:0 0 .6rem">Оборот по дни</h3>
                <div class="panel" style="margin-bottom:1.6rem">
                    ${dayBars.length ? Charts.bars(dayBars, { color: '#E29A93' }) : '<p class="hint">Още няма проведени часове този месец.</p>'}
                </div>

                <h3 style="margin:0 0 .6rem">Топ процедури (по оборот)</h3>
                <div class="panel" style="margin-bottom:1.6rem">${Charts.hbars(topSvc)}</div>

                <h3 style="margin:0 0 .6rem">Натовареност по дни от седмицата</h3>
                <div class="panel">${Charts.bars(wdBars, { color: '#B98BA0' })}</div>`;
        } catch (err) {
            box.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // ---- Раздел ГРАФИК ----
    async function renderCalendarTab(box) {
        box.innerHTML = `
            <label class="hint" style="display:block;margin-bottom:1rem">Специалист:
                <select id="boss-who" class="select" style="width:auto;min-width:230px;margin-top:.5rem"></select>
            </label>
            <div id="boss-cal"><div class="spinner"></div></div>`;
        const who = box.querySelector('#boss-who');
        const cal = box.querySelector('#boss-cal');
        let employees = [];
        try { employees = await API.get('/employees'); } catch (e) {}
        // Шефът е „Аз" — махаме го от списъка с работнички (по роля), за да не се дублира.
        const others = (employees || []).filter(e => e.role !== 'boss');
        const firstName = (Session.name() || '').split(' ')[0];
        who.innerHTML = `<option value="all">Целият салон</option><option value="me">Аз${firstName ? ' (' + esc(firstName) + ')' : ''}</option>` +
            others.map(e => `<option value="${e.id}">${esc(e.fullName)}</option>`).join('');
        who.addEventListener('change', () => mountFor(who.value));
        function mountFor(val) {
            cal.innerHTML = '';
            if (val === 'all') mountAllCalendar(cal);
            // „Аз" = шефът: през надеждния BOSS_ID (шефски ендпойнт), не през /me
            // (чийто токен може да е от преди презареждане на базата).
            else if (val === 'me') { if (BOSS_ID) mountReadonlyCalendar(cal, BOSS_ID); else mountMyCalendar(cal); }
            else mountReadonlyCalendar(cal, +val);
        }
        mountFor('all');
    }

    // ---- Раздел НЕКОРЕКТНИ КЛИЕНТИ ----
    async function renderNoShow(box) {
        box.innerHTML = `
            <h3 style="margin:0 0 .3rem">Некоректни клиенти</h3>
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
            body.innerHTML = rows.map(c => {
                const phone = c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="hint">без телефон</span>';
                const upcoming = c.upcomingCount > 0
                    ? `<span class="alert alert--err" style="padding:.12rem .5rem;font-size:.72rem;white-space:nowrap">⚠ има ${c.upcomingCount} предстоящ${c.upcomingCount === 1 ? '' : 'и'} час${c.upcomingCount === 1 ? '' : 'а'}</span>`
                    : `<span class="hint" style="font-size:.74rem">няма предстоящи</span>`;
                return `
                <div class="card" style="display:flex;align-items:center;gap:.9rem;padding:.7rem .9rem;border-left:7px solid #D9534F;background:#D9534F14;margin-bottom:.6rem">
                    <div style="flex:none;width:34px;height:34px;border-radius:9px;background:#D9534F;color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.25rem;font-weight:800">⚠</div>
                    <div style="flex:1;min-width:0">
                        <strong>${esc(c.clientName || 'Клиент')}</strong>
                        <div class="hint" style="margin-top:.15rem">${phone} · последно: ${fmtDate(c.lastNoShow)}</div>
                    </div>
                    <div style="text-align:right;display:flex;flex-direction:column;gap:.3rem;align-items:flex-end">
                        <span style="font-weight:700;color:#B02A26">${c.noShowCount}× не се яви</span>
                        ${upcoming}
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
            <h3 style="margin:0 0 .3rem">Натовареност на графика</h3>
            <p class="hint" style="margin:0 0 .9rem">Прагове за цветовете в календара (брой часове за целия салон на ден).</p>
            <div class="card" style="display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;margin-bottom:1.8rem">
                <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#E7B100"></span>
                <span class="hint">жълто над</span>
                <input class="input ld-yellow" type="number" min="1" max="100" style="width:80px">
                <span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:#D9534F;margin-left:.6rem"></span>
                <span class="hint">червено над</span>
                <input class="input ld-red" type="number" min="1" max="100" style="width:80px">
                <button class="btn btn--gold ld-save" style="--pad-y:.4rem;--pad-x:.9rem;font-size:.82rem">Запази</button>
            </div>

            <h3 style="margin:0 0 .3rem">Комисионни</h3>
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
            cbox.innerHTML = listc.map(c => `
                <div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:.6rem">
                    <strong>${esc(c.name)}</strong>
                    <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
                        <span class="hint">за нея</span>
                        <input class="input comm-input" data-id="${c.employeeId}" type="number" min="0" max="100" value="${c.percent}" style="width:90px;display:inline-block">
                        <span class="hint">% · за теб <b class="comm-boss">${100 - c.percent}%</b></span>
                        <button class="btn btn--gold comm-save" data-id="${c.employeeId}" style="--pad-y:.4rem;--pad-x:.9rem;font-size:.82rem">Запази</button>
                    </div>
                </div>`).join('');
            cbox.querySelectorAll('.comm-input').forEach(inp => inp.addEventListener('input', () => {
                const b = inp.closest('.card').querySelector('.comm-boss');
                const v = Math.max(0, Math.min(100, +inp.value || 0));
                if (b) b.textContent = (100 - v) + '%';
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
        mountMyCalendar(list);
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
        const actions = up
            ? `<button class="btn btn--ghost bk-cancel" data-id="${b.id}" style="--pad-y:.55rem;--pad-x:1rem;font-size:.85rem">Отмени</button>` : '';
        const rebook = !up
            ? `<a href="booking.html" class="btn btn--ghost" style="--pad-y:.55rem;--pad-x:1rem;font-size:.85rem">Запази пак</a>` : '';
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
                <div class="hint" style="margin-top:.35rem;display:flex;align-items:center;gap:.4rem">${Icon('calendar', { size: 14 })} ${fmt(b.startAt)} · ${b.priceSnapshot.toFixed(0)} €</div>
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

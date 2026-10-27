/* =====================================================================
   Резервация — поток от 4 стъпки (по-логичен ред):
   1) услуга (процедура) → 2) специалист, който я прави → 3) дата+час →
   4) потвърждение.
   Ползва: GET /services, /employees, /employees/{id}/services,
   /availability, POST /bookings (изисква вписан клиент).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // srv = {serviceId, serviceName}; emp = избран специалист;
    // sel = {price, durationMinutes} на този специалист за услугата.
    // durationMinutes тук е само за показване и е ВЕЧЕ с почивката (като в каталога).
    const REST_MIN = (window.BH_CONFIG && window.BH_CONFIG.REST_MIN) || 0;
    const state = { srv: null, emp: null, sel: null, date: null, slot: null };

    const panes = document.querySelectorAll('.bk-pane');
    const steps = document.querySelectorAll('.step');
    const $ = (id) => document.getElementById(id);

    // Предварителен избор:
    //   от каталога на началната страница: ?srv=<услуга>&label=<процедура>&auto=1
    //     (auto=1 → ако само 1 специалист я прави, той се избира автоматично)
    //   от страница "Услуги": ?srv=<услуга>  (без auto → потребителят винаги избира сам специалист)
    //   от "Екип" / "Моите часове": ?emp=<employeeId>  (по избор и &srv=<услуга> за директно повторение)
    const PRE = new URLSearchParams(location.search);
    const preSrv = PRE.get('srv');
    const preLabel = PRE.get('label');
    const preAuto = PRE.get('auto') === '1';
    const preEmp = PRE.get('emp');

    // Банер „Избрана процедура" (вижда се на всички стъпки).
    function showPickedBanner(txt, inPage) {
        const main = document.querySelector('.booking-panel-main');
        let b = document.getElementById('bk-picked');
        if (!b) {
            b = document.createElement('div');
            b.id = 'bk-picked'; b.className = 'alert alert--info';
            b.style.cssText = 'margin-bottom:1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap';
            main.prepend(b);
        }
        b.innerHTML = `<span>Избрана процедура: <strong>${esc(txt)}</strong></span>
            <span style="display:flex;gap:1rem;flex-wrap:wrap">${pfLink(state.emp)}<a href="booking.html" class="bk-change" style="text-decoration:underline;white-space:nowrap">смени процедура</a></span>`;
        if (inPage) b.querySelector('.bk-change').addEventListener('click', (e) => { e.preventDefault(); goStep(1); });
        bindPfLink(b, state.emp);
    }

    // „Виж портфолио“ на избрания специалист — модал, без да се губи прогресът.
    function pfLink(emp) {
        return emp && window.Portfolio
            ? `<button type="button" class="bk-pf-link">${Icon('camera', { size: 15 })} портфолио на ${esc(String(emp.fullName || '').split(' ')[0])}</button>` : '';
    }
    function bindPfLink(root, emp) {
        const l = root.querySelector('.bk-pf-link');
        if (l && emp) l.addEventListener('click', () => Portfolio.openEmployee(emp, { chooseLabel: 'Продължи със записването', onChoose: () => {} }));
    }

    // Банер за избран специалист (влизане през "Екип" / "Запази пак").
    function showEmployeeBanner(emp) {
        const main = document.querySelector('.booking-panel-main');
        let b = document.getElementById('bk-picked');
        if (!b) {
            b = document.createElement('div');
            b.id = 'bk-picked'; b.className = 'alert alert--info';
            b.style.cssText = 'margin-bottom:1.4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap';
            main.prepend(b);
        }
        b.innerHTML = `<span>Резервираш при: <strong>${esc(emp.fullName)}</strong></span>
            <span style="display:flex;gap:1rem;flex-wrap:wrap">${pfLink(emp)}<a href="booking.html" style="text-decoration:underline;white-space:nowrap">смени специалист</a></span>`;
        bindPfLink(b, emp);
    }

    // --- Навигация между стъпки ---
    function goStep(n) {
        curStep = n;
        panes.forEach(p => p.hidden = (+p.dataset.pane !== n));
        // Стъпка 1 е на цяла ширина (като каталога на началната страница), без обобщението.
        document.querySelector('.booking-grid').classList.toggle('is-picking', n === 1);
        if (n === 1 && fromCatalog) {
            fromCatalog = false;
            if (lockedEmp) showEmployeeBanner(lockedEmp);
            else { const b = $('bk-picked'); if (b) b.remove(); }
            state.srv = null; state.emp = null; state.sel = null; state.slot = null;
            updateSummary();
        }
        steps.forEach(s => {
            const num = +s.dataset.step;
            s.classList.toggle('active', num === n);
            s.classList.toggle('done', num < n);
        });
        updateBar();
        window.scrollTo({ top: document.querySelector('.steps').offsetTop - 120, behavior: 'smooth' });
    }

    // --- Обобщение ---
    function fmtTime(iso) { return iso ? iso.slice(11, 16) : '—'; }
    function fmtDateBG(d) {
        if (!d) return '';
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
    }
    function updateSummary() {
        $('sum-srv').textContent  = state.srv ? state.srv.serviceName : '—';
        $('sum-emp').textContent  = state.emp ? state.emp.fullName : '—';
        $('sum-dur').textContent  = state.sel ? state.sel.durationMinutes + ' мин' : '—';
        $('sum-time').textContent = state.slot ? `${fmtDateBG(state.date)}, ${fmtTime(state.slot)}` : '—';
        $('sum-price').textContent = state.sel ? (n => Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)))(state.sel.price) + ' €' : '—';
        $('bk-confirm').disabled = !(state.emp && state.srv && state.slot);
        updateBar();
    }

    // --- Телефон: лента долу „Твоят час … [Потвърди]" ---
    // Появява се, щом е избран час, и се скрива, когато истинският бутон „Потвърди часа" се вижда.
    let confirmVisible = false, curStep = 1;
    function updateBar() {
        const bar = $('bk-bar');
        if (!bar) return;
        const show = curStep === 3 && !!state.slot && !confirmVisible;
        if (show) { const d = new Date(state.date + 'T00:00:00'); $('bk-bar-when').textContent = `${d.getDate()} ${['яну','фев','мар','апр','май','юни','юли','авг','сеп','окт','ное','дек'][d.getMonth()]}, ${fmtTime(state.slot)}`; }
        bar.hidden = !show;
        document.body.classList.toggle('has-bk-bar', show);
    }
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { confirmVisible = es[0].isIntersecting; updateBar(); }, { threshold: .6 })
            .observe($('bk-confirm'));
    }
    // „Преглед" не потвърждава — само плъзга надолу до обобщението на резервацията.
    $('bk-bar-go').addEventListener('click', () => {
        const box = document.querySelector('.booking-panel-summary');
        const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 70;
        window.scrollTo({ top: box.getBoundingClientRect().top + window.scrollY - navH - 12, behavior: 'smooth' });
    });

    // --- Стъпка 1: каталогът от началната страница (категории → групи → „Запиши") ---
    // Всеки ред в каталога е конкретна услуга при конкретен специалист, така че
    // „Запиши" попълва и двете и води направо на дата и час (стъпка 2 се прескача).
    let fromCatalog = false;      // изборът е направен от каталога (банерът е наш)
    let specialistsShown = false; // стъпка 2 е заредена — иначе „Назад" от дата/час води към каталога
    let lockedEmp = null;         // влизане през „Екип" — банерът му се връща при смяна на процедурата
    function mountCatalog(empId) {
        window.BHCatalog.mount($('bk-services'), { emp: empId, onPick: pickFromCatalog });
    }
    function pickFromCatalog(row, label) {
        fromCatalog = true;
        specialistsShown = false;
        state.srv = { serviceId: row.serviceId, serviceName: label };
        state.emp = row.emp;
        state.sel = { price: row.price, durationMinutes: row.dur };
        state.slot = null;
        showPickedBanner(`${label} · при ${row.emp.fullName}`, true);
        updateSummary();
        goStep(3);
        initDate();
    }

    async function loadServices() {
        mountCatalog();
        // Предварителен избор от страница „Услуги" (?srv=) → маркирай услугата и прескочи напред.
        // auto=1 прескача и избора на специалист, ако само 1 човек я прави.
        if (!preSrv) return;
        try {
            const list = await API.get('/services');
            const s = (list || []).find(x => (x.name || '').toLowerCase() === preSrv.toLowerCase());
            if (!s) return;
            state.srv = { serviceId: s.id, serviceName: preLabel || s.name };
            state.emp = null; state.sel = null; state.slot = null;
            showPickedBanner(state.srv.serviceName);
            updateSummary();
            goStep(2);
            loadSpecialists(s.id, preAuto);
        } catch (err) { /* каталогът остава за ръчен избор */ }
    }

    // --- Влизане през "Екип" / "Запази пак": специалистът е вече избран ---
    // Показва само услугите, които ТОЗИ специалист предлага; изборът му отпада (стъпка 2 се пропуска).
    async function loadServicesForEmployee(empId) {
        const box = $('bk-services');
        box.innerHTML = `<div class="spinner"></div>`;
        try {
            const [employees, empServices, allServices] = await Promise.all([
                API.get('/employees'),
                API.get('/employees/' + empId + '/services'),
                API.get('/services')
            ]);
            const emp = (employees || []).find(e => String(e.id) === String(empId));
            if (!emp) {
                box.innerHTML = `<div class="alert alert--err">Специалистът не е намерен. Избери услуга по-долу.</div>`;
                loadServices();
                return;
            }
            if (!empServices || !empServices.length) {
                box.innerHTML = `<div class="alert alert--info">${esc(emp.fullName)} все още няма зададени услуги. Избери друг специалист от <a href="team.html">екипа</a>.</div>`;
                return;
            }
            showEmployeeBanner(emp);
            lockedEmp = emp;
            mountCatalog(emp.id);

            // Ако идваме от "Запази пак" с конкретна услуга — и той все още я предлага, скачаме направо на дата/час.
            if (preSrv) {
                const wanted = preSrv.toLowerCase();
                const match = empServices.find(es => {
                    const s = (allServices || []).find(x => x.id === es.serviceId);
                    return s && (s.name || '').toLowerCase() === wanted;
                });
                if (match) {
                    const s = (allServices || []).find(x => x.id === match.serviceId);
                    state.srv = { serviceId: match.serviceId, serviceName: preLabel || (s ? s.name : preSrv) };
                    state.emp = emp;
                    state.sel = { price: match.price, durationMinutes: match.durationMinutes + REST_MIN };
                    state.slot = null;
                    updateSummary();
                    goStep(3);
                    initDate();
                    return;
                }
            }

        } catch (err) {
            box.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // --- Стъпка 2: специалисти, които правят избраната услуга ---
    async function loadSpecialists(serviceId, auto) {
        specialistsShown = true;
        const box = $('bk-employees');
        box.innerHTML = `<div class="spinner"></div>`;
        try {
            const emps = await API.get('/employees');
            const lists = await Promise.all(
                (emps || []).map(e => API.get('/employees/' + e.id + '/services').catch(() => []))
            );
            // Само специалистите, които предлагат тази услуга (с тяхната цена/време).
            const providers = [];
            (emps || []).forEach((e, i) => {
                const es = (lists[i] || []).find(x => x.serviceId === serviceId);
                if (es) providers.push({ emp: e, price: es.price, durationMinutes: es.durationMinutes + REST_MIN });
            });
            if (!providers.length) {
                box.innerHTML = `<div class="alert alert--info">За тази услуга още няма свободен специалист. Избери друга услуга.</div>`;
                return;
            }
            box.innerHTML = providers.map(p => {
                const e = p.emp;
                const initial = (e.fullName || 'B').charAt(0).toUpperCase();
                const avatar = e.photoUrl
                    ? `<img src="${esc(e.photoUrl)}" alt="" style="width:52px;height:52px;border-radius:50%;object-fit:cover">`
                    : `<div class="brand__mark" style="width:52px;height:52px;font-size:1.2rem">${initial}</div>`;
                return `
                <button class="card bk-pick" data-id="${e.id}" style="display:flex;gap:1rem;align-items:center;text-align:left;width:100%">
                    ${avatar}
                    <div style="flex:1;min-width:0">
                        <strong style="font-size:1.05rem">${esc(e.fullName)}</strong>
                        <div class="team-card__role">${esc(e.jobTitle || 'Специалист')}</div>
                        ${window.Portfolio ? `<span class="bk-pf" role="button" tabindex="0" data-pf="${e.id}">${Icon('camera', { size: 14 })} Виж портфолио</span>` : ''}
                    </div>
                    <div style="text-align:right;white-space:nowrap">
                        <span class="price">${(n => Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)))(p.price)} <small>€</small></span>
                        <div class="hint">${p.durationMinutes} мин</div>
                    </div>
                </button>`;
            }).join('');
            const choose = (p) => {
                state.emp = p.emp;
                state.sel = { price: p.price, durationMinutes: p.durationMinutes };
                state.slot = null;
                updateSummary();
                goStep(3);
                initDate();
            };
            // „Виж портфолио“ вътре в картата: отваря модал (прогресът остава), а „Избери“ от модала избира специалиста.
            const openPf = (el) => {
                const p = providers.find(x => x.emp.id === +el.dataset.pf);
                if (p) Portfolio.openEmployee(p.emp, { serviceId: serviceId, onChoose: () => choose(p) });
            };
            box.querySelectorAll('.bk-pf').forEach(el => el.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); openPf(el); }
            }));
            box.querySelectorAll('.bk-pick').forEach(btn =>
                btn.addEventListener('click', (ev) => {
                    const pfEl = ev.target.closest('.bk-pf');
                    if (pfEl) { ev.preventDefault(); openPf(pfEl); return; }
                    const id = +btn.dataset.id;
                    choose(providers.find(x => x.emp.id === id));
                }));

            // Ако идваме от каталога и услугата се прави само от 1 специалист —
            // избираме го автоматично, за да остане само изборът на час.
            if (auto && providers.length === 1) choose(providers[0]);
        } catch (err) {
            box.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // --- Стъпка 3: ден и час — месечен календар ---
    // Отваря се месецът; дните със свободни часове са оцветени и показват колко свободни часа има.
    // Клик по ден -> отдолу излизат свободните часове. Бекендът дава часовете ден по ден
    // (/availability), затова проверяваме дните на месеца на порции по 7 (паралелно).
    const pad2 = n => String(n).padStart(2, '0');
    const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const MONTHS = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

    function todayIso() { return isoDate(new Date()); }
    // Часове се запазват най-много 6 месеца напред (същото правило е и в backend-а).
    const MAX_MONTHS = 6;
    function maxIso() { const d = new Date(); d.setMonth(d.getMonth() + MAX_MONTHS); return isoDate(d); }
    const ymOf = k => k.slice(0, 7);                       // '2026-10'
    const ymAdd = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };

    const BATCH = 7;
    // cal: кеш за текущия специалист + услуга. slots[k] = [] (няма) | [...] (свободни); месец -> 'loading' | 'done' | 'failed'
    let cal = null;
    function calKey() { return state.emp && state.srv ? state.emp.id + ':' + state.srv.serviceId : ''; }

    async function fetchSlots(k) {
        try {
            const r = await API.get(`/availability?employeeId=${state.emp.id}&serviceId=${state.srv.serviceId}&date=${k}`);
            return Array.isArray(r) ? r : [];
        } catch (e) { return null; }
    }

    // Старт на стъпка 3 (и при смяна на специалист/услуга).
    function initDate(force) {
        const key = calKey();
        if (!key) return;
        if (force || !cal || cal.key !== key) {
            cal = { key, ym: ymOf(todayIso()), slots: {}, months: {}, autoJump: true };
            state.date = null;
        }
        renderCal();
        renderSlots();
        loadMonth(cal.ym);
    }

    // Проверява всички дни на месеца (от днес нататък, до 6 месеца).
    async function loadMonth(ym) {
        const my = cal;
        if (!my || my.months[ym] === 'loading' || my.months[ym] === 'done') return;
        my.months[ym] = 'loading';
        renderCal();
        const t = todayIso(), last = maxIso();
        const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
        const days = [];
        for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
            const k = `${ym}-${pad2(d)}`;
            if (k >= t && k <= last && !(k in my.slots)) days.push(k);
        }
        let failed = false;
        for (let i = 0; i < days.length; i += BATCH) {
            const part = days.slice(i, i + BATCH);
            const res = await Promise.all(part.map(fetchSlots));
            if (cal !== my) return;   // сменена е услугата/специалистът
            if (res.every(r => r === null)) { failed = true; break; }
            part.forEach((k, j) => { if (res[j] !== null) my.slots[k] = res[j]; });
            if (my.ym === ym) { renderCal(); renderSlots(); }
        }
        my.months[ym] = failed ? 'failed' : 'done';
        // Ако в този месец няма нито един свободен ден — сами минаваме на следващия (само при първото отваряне).
        if (!failed && my.autoJump && my.ym === ym && !monthHasFree(ym) && ymAdd(ym, 1) <= ymOf(maxIso())) {
            my.ym = ymAdd(ym, 1);
            renderCal();
            loadMonth(my.ym);
            return;
        }
        if (my.ym === ym) my.autoJump = false;
        if (my.ym === ym) { renderCal(); renderSlots(); }
    }
    function monthHasFree(ym) { return Object.keys(cal.slots).some(k => ymOf(k) === ym && cal.slots[k].length); }

    function goMonth(n) {
        if (!cal) return;
        const ym = ymAdd(cal.ym, n);
        if (ym < ymOf(todayIso()) || ym > ymOf(maxIso())) return;
        cal.ym = ym; cal.autoJump = false;
        // Денят се избира само ръчно; избраният ден остава, докато не се цъкне друг.
        renderCal();
        renderSlots();
        loadMonth(ym);
    }

    function renderCal() {
        const box = $('bk-days');
        if (!box || !cal) return;
        const ym = cal.ym, y = +ym.slice(0, 4), m = +ym.slice(5, 7);
        const t = todayIso(), last = maxIso();
        const st = cal.months[ym];
        const first = new Date(y, m - 1, 1);
        const lead = (first.getDay() + 6) % 7;          // седмицата започва от понеделник
        const nDays = new Date(y, m, 0).getDate();
        let cells = '<span class="bk-cal__e"></span>'.repeat(lead);
        for (let d = 1; d <= nDays; d++) {
            const k = `${ym}-${pad2(d)}`;
            const s = cal.slots[k];
            const out = k < t || k > last;
            const free = s && s.length;
            const pending = !out && !s && st !== 'failed';
            const sel = k === state.date;
            const cls = `bk-cal__d${out ? ' is-out' : ''}${free ? ' is-free' : ''}${!out && s && !s.length ? ' is-full' : ''}${pending ? ' is-wait' : ''}${sel ? ' is-sel' : ''}${k === t ? ' is-today' : ''}`;
            const lbl = free ? `${d} ${MONTHS[m - 1]} — ${s.length} свободни часа` : `${d} ${MONTHS[m - 1]} — няма свободни часове`;
            cells += free
                ? `<button type="button" class="${cls}" data-k="${k}" aria-pressed="${sel}" aria-label="${lbl}"><b>${d}</b><small>${s.length}</small></button>`
                : `<span class="${cls}" aria-label="${out ? d : lbl}"><b>${d}</b></span>`;
        }
        const canPrev = ym > ymOf(t), canNext = ym < ymOf(last);
        box.innerHTML = `
            <div class="bk-cal__head">
                <button type="button" class="bk-cal__nav" data-n="-1" ${canPrev ? '' : 'disabled'} aria-label="Предишен месец">‹</button>
                <strong class="bk-cal__title">${MONTHS[m - 1]} ${y}</strong>
                <button type="button" class="bk-cal__nav" data-n="1" ${canNext ? '' : 'disabled'} aria-label="Следващ месец">›</button>
            </div>
            <div class="bk-cal__wd"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Нд</span></div>
            <div class="bk-cal__grid">${cells}</div>
            <div class="bk-cal__foot">${st === 'loading' ? '<span class="bk-cal__load">Проверяваме свободните часове…</span>'
                : st === 'failed' ? '<span class="bk-cal__err">Не успяхме да заредим часовете. <button type="button" class="bk-link" id="bk-retry">Опитай пак</button></span>'
                : st === 'done' && !monthHasFree(ym) ? `<span>През ${MONTHS[m - 1].toLowerCase()} няма свободни часове.${canNext ? ' Виж следващия месец →' : ''}</span>`
                : ''}</div>`;
        box.hidden = false;
        box.querySelectorAll('.bk-cal__nav').forEach(b => b.addEventListener('click', () => goMonth(+b.dataset.n)));
        box.querySelectorAll('.bk-cal__d[data-k]').forEach(b => b.addEventListener('click', () => pickDate(b.dataset.k)));
        const r = $('bk-retry');
        if (r) r.addEventListener('click', () => { delete cal.months[ym]; loadMonth(ym); });
    }

    function pickDate(k) {
        if (!cal || !cal.slots[k] || !cal.slots[k].length) return;
        if (state.date !== k) state.slot = null;
        state.date = k;
        updateSummary();
        renderCal();
        renderSlots();
        // На телефон часовете са под календара — плъзгаме до тях.
        if (window.matchMedia('(max-width: 720px)').matches) {
            const w = $('bk-slots-wrap');
            const top = w.getBoundingClientRect().top;
            if (top > window.innerHeight * .55) {
                const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 70;
                window.scrollTo({ top: top + window.scrollY - navH - 16, behavior: 'smooth' });
            }
        }
    }

    function fmtDateLong(k) {
        return new Date(k + 'T00:00:00').toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long' });
    }

    function renderSlots() {
        const wrap = $('bk-slots-wrap');
        if (!wrap) return;
        const slots = cal && state.date ? cal.slots[state.date] : null;
        if (!slots || !slots.length) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = `<h3 class="bk-h bk-h--time">Избери час</h3>
            <div class="slots bk-slots">` + slots.map(iso =>
            `<button type="button" class="slot${state.slot === iso ? ' selected' : ''}" data-iso="${esc(iso)}">${iso.slice(11, 16)}</button>`).join('') + `</div>`;
        wrap.querySelectorAll('.slot').forEach(b =>
            b.addEventListener('click', () => {
                wrap.querySelectorAll('.slot').forEach(x => x.classList.remove('selected'));
                b.classList.add('selected');
                state.slot = b.dataset.iso;
                updateSummary();
            }));
    }

    // След „часът е зает" (409): проверяваме отначало.
    function loadSlots() { state.slot = null; updateSummary(); initDate(true); }

    // --- Назад ---
    $('bk-back-1').addEventListener('click', () => goStep(1));
    $('bk-back-2').addEventListener('click', () => goStep(specialistsShown ? 2 : 1));

    // --- Потвърждение ---
    // Ключ за пазене на избора, докато потребителят влиза/се регистрира.
    const PENDING_KEY = 'bh_pending_booking';

    function savePending() {
        try {
            sessionStorage.setItem(PENDING_KEY, JSON.stringify({
                srv: state.srv, emp: state.emp, sel: state.sel,
                date: state.date, slot: state.slot,
                note: $('bk-note') ? $('bk-note').value : ''
            }));
        } catch (e) {}
    }
    function loadPending() {
        try {
            const raw = sessionStorage.getItem(PENDING_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function clearPending() {
        try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    }

    // Реално изпращане на резервацията към API-то (ползва се и от бутона,
    // и автоматично след връщане от вход/регистрация).
    async function doConfirm(noteOverride) {
        const btn = $('bk-confirm');
        if (btn) { btn.disabled = true; btn.style.opacity = .7; }
        try {
            await API.post('/bookings', {
                employeeId: state.emp.id,
                serviceId: state.srv.serviceId,
                startAt: state.slot,
                note: (noteOverride ?? ($('bk-note') ? $('bk-note').value : '')) || null
            });
            clearPending();
            // Успех → стъпка 4
            $('bk-result').innerHTML = `
                <div class="center">
                    <div class="service-card__icon ic--rose" style="margin:0 auto 1.2rem;width:70px;height:70px">${Icon('sparkle', { size: 30 })}</div>
                    <h2 style="margin-bottom:.6rem">Готово!</h2>
                    <p class="lead" style="max-width:420px;margin:0 auto 1.6rem">
                        Часът ти за <strong>${esc(state.srv.serviceName)}</strong> при
                        <strong>${esc(state.emp.fullName)}</strong> на
                        <strong>${fmtDateBG(state.date)}, ${state.slot.slice(11,16)}</strong> е запазен.
                    </p>
                    <p class="hint" style="max-width:420px;margin:-0.8rem auto 1.6rem">Изпратихме потвърждение на имейла ти, а ще ти напомним и преди самия час.</p>
                    <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap">
                        <a href="account.html" class="btn btn--primary">Моите часове →</a>
                        <a href="index.html" class="btn btn--ghost">Към началото</a>
                    </div>
                </div>`;
            steps.forEach(s => s.classList.add('done'));
            goStep(4);
            return true;
        } catch (err) {
            if (btn) { btn.disabled = false; btn.style.opacity = 1; }
            // Бекендът вече връща разбираемо съобщение и за двата 409 случая
            // (слотът е зает / вече имаш активен час) — показваме го directно.
            const msgBox = $('bk-note-msg');
            if (msgBox) msgBox.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
            if (err.status === 409) loadSlots(); // опресни часовете (ако слотът е зает)
            return false;
        }
    }

    $('bk-confirm').addEventListener('click', async () => {
        if (!(state.emp && state.srv && state.slot)) return;

        // Не е вписан (или сесията е изтекла) -> пазим избора, пращаме към вход
        // и след това часът се довършва сам.
        if (!Session.isIn()) {
            savePending();
            Session.goLogin({ next: 'booking.html' });
            return;
        }
        // Влязъл е служител/шеф -> предлагаме вход с клиентски профил.
        if (Session.role() !== 'client') {
            const ok = await confirmBox({
                title: 'Влязъл си като служител',
                text: 'Онлайн часове се запазват с клиентски профил. Да излезеш и да влезеш като клиент? Избраният час ще се запази.',
                ok: 'Влез като клиент', cancel: 'Отказ'
            });
            if (!ok) return;
            savePending();
            Session.clear();
            Session.goLogin({ next: 'booking.html' });
            return;
        }

        await doConfirm();
    });

    // Изтекла сесия по време на запазването (API-то пренасочва към вход) ->
    // избраното се пази и се довършва след влизане.
    Session.beforeLogin(() => { if (state.emp && state.srv && state.slot) savePending(); });

    // Ако се връщаме логнати с чакаща резервация (след вход/регистрация от
    // тази страница) — възстановяваме избора, показваме резюме и пращаме
    // автоматично, без потребителят да избира отново всичко.
    async function resumePendingIfAny() {
        if (!Session.isIn() || Session.role() !== 'client') return false;
        const pending = loadPending();
        if (!pending || !pending.emp || !pending.srv || !pending.slot) return false;

        state.srv = pending.srv;
        state.emp = pending.emp;
        state.sel = pending.sel;
        state.date = pending.date;
        state.slot = pending.slot;

        mountCatalog();
        showEmployeeBanner(state.emp);
        goStep(3);
        updateSummary();
        if ($('bk-note') && pending.note) $('bk-note').value = pending.note;

        await doConfirm(pending.note);
        return true;
    }

    // Старт
    resumePendingIfAny().then(resumed => {
        if (resumed) return;
        if (preEmp) loadServicesForEmployee(preEmp);
        else loadServices();
        updateSummary();
    });
});

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
            <a href="booking.html" style="text-decoration:underline;white-space:nowrap">смени процедура</a>`;
        if (inPage) b.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); goStep(1); });
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
            <a href="booking.html" style="text-decoration:underline;white-space:nowrap">смени специалист</a>`;
    }

    // --- Навигация между стъпки ---
    function goStep(n) {
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
        $('sum-price').textContent = state.sel ? state.sel.price.toFixed(0) + ' €' : '—';
        $('bk-confirm').disabled = !(state.emp && state.srv && state.slot);
    }

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
                    state.sel = { price: match.price, durationMinutes: match.durationMinutes };
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
                if (es) providers.push({ emp: e, price: es.price, durationMinutes: es.durationMinutes });
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
                    </div>
                    <div style="text-align:right;white-space:nowrap">
                        <span class="price">${p.price.toFixed(0)} <small>€</small></span>
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
            box.querySelectorAll('.bk-pick').forEach(btn =>
                btn.addEventListener('click', () => {
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

    // --- Стъпка 3: дата и свободни часове ---
    const pad2 = n => String(n).padStart(2, '0');
    const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const WD = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const MON = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];

    function todayIso() { return isoDate(new Date()); }

    function initDate() {
        const inp = $('bk-date');
        const iso = todayIso();
        inp.min = iso;
        if (!state.date || state.date < iso) state.date = iso;
        inp.value = state.date;
        renderDays();
        loadSlots();
    }

    // Красив избор на ден: чипове за следващите 14 дни.
    function renderDays() {
        const box = $('bk-days');
        if (!box) return;
        const base = new Date(todayIso() + 'T00:00:00');
        let html = '';
        for (let i = 0; i < 14; i++) {
            const d = new Date(base); d.setDate(base.getDate() + i);
            const k = isoDate(d);
            const sel = k === state.date;
            const top = i === 0 ? 'Днес' : (i === 1 ? 'Утре' : WD[d.getDay()]);
            const base_s = 'flex:none;min-width:62px;display:flex;flex-direction:column;align-items:center;gap:.15rem;padding:.55rem .4rem;border-radius:14px;cursor:pointer;transition:.15s;border:1px solid var(--line);background:var(--ivory)';
            const sel_s = 'flex:none;min-width:62px;display:flex;flex-direction:column;align-items:center;gap:.15rem;padding:.55rem .4rem;border-radius:14px;cursor:pointer;transition:.15s;border:1px solid transparent;background:var(--grad-rose);color:#fff;box-shadow:0 8px 20px rgba(206,122,120,.32)';
            html += `<button class="bk-day" data-k="${k}" style="${sel ? sel_s : base_s}">
                <span style="font-size:.72rem;font-weight:600;opacity:${sel ? '.95' : '.7'}">${top}</span>
                <span style="font-size:.82rem;font-weight:700">${d.getDate()} ${MON[d.getMonth()]}</span>
            </button>`;
        }
        box.innerHTML = html;
        box.querySelectorAll('.bk-day').forEach(b => b.addEventListener('click', () => pickDate(b.dataset.k)));
    }

    function pickDate(k, preselect) {
        state.date = k;
        state.slot = preselect || null;
        $('bk-date').value = k;
        updateSummary();
        renderDays();
        loadSlots(preselect);
    }

    async function loadSlots(preselect) {
        const wrap = $('bk-slots-wrap');
        if (!state.emp || !state.srv || !state.date) return;
        wrap.innerHTML = `<div class="spinner"></div>`;
        try {
            const q = `/availability?employeeId=${state.emp.id}&serviceId=${state.srv.serviceId}&date=${state.date}`;
            const slots = await API.get(q);
            if (!slots || !slots.length) {
                // Няма места за деня — предлагаме да намерим най-скорошния свободен час.
                wrap.innerHTML = `
                    <div class="alert alert--info" style="display:flex;align-items:center;gap:.5rem">${Icon('moon', { size: 16 })} За ${fmtDateBG(state.date)} няма свободни часове.</div>
                    <button class="btn btn--gold bk-find" style="margin-top:.9rem">Искаш ли да намерим най-скорошния свободен час? →</button>
                    <div class="bk-find-res" style="margin-top:1rem"></div>`;
                wrap.querySelector('.bk-find').addEventListener('click', findNext);
                return;
            }
            wrap.innerHTML = `<div class="slots">` + slots.map(iso =>
                `<button class="slot${preselect === iso ? ' selected' : ''}" data-iso="${esc(iso)}">${iso.slice(11, 16)}</button>`).join('') + `</div>`;
            wrap.querySelectorAll('.slot').forEach(b =>
                b.addEventListener('click', () => {
                    wrap.querySelectorAll('.slot').forEach(x => x.classList.remove('selected'));
                    b.classList.add('selected');
                    state.slot = b.dataset.iso;
                    updateSummary();
                }));
        } catch (err) {
            wrap.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
        }
    }

    // Търси напред (до 45 дни) първия ден със свободни часове.
    async function findNext() {
        const wrap = $('bk-slots-wrap');
        const res = wrap.querySelector('.bk-find-res');
        const btn = wrap.querySelector('.bk-find');
        if (btn) { btn.disabled = true; btn.style.opacity = .7; btn.textContent = 'Търсим…'; }
        if (res) res.innerHTML = `<div class="spinner"></div>`;

        const base = new Date(state.date + 'T00:00:00');
        for (let i = 1; i <= 45; i++) {
            const d = new Date(base); d.setDate(base.getDate() + i);
            const k = isoDate(d);
            let slots = [];
            try { slots = await API.get(`/availability?employeeId=${state.emp.id}&serviceId=${state.srv.serviceId}&date=${k}`); }
            catch (e) { slots = []; }
            if (slots && slots.length) {
                res.innerHTML = `
                    <div class="alert alert--ok" style="display:flex;align-items:center;gap:.5rem">${Icon('sparkle', { size: 16 })} Най-скорошен свободен час: <strong>${fmtDateBG(k)}</strong></div>
                    <div class="slots" style="margin-top:.8rem">` + slots.map(iso =>
                    `<button class="slot bk-found" data-k="${k}" data-iso="${esc(iso)}">${iso.slice(11, 16)}</button>`).join('') + `</div>`;
                res.querySelectorAll('.bk-found').forEach(b =>
                    b.addEventListener('click', () => pickDate(b.dataset.k, b.dataset.iso)));
                return;
            }
        }
        res.innerHTML = `<div class="alert alert--info">Няма свободни часове в следващите 45 дни. Пробвай друг специалист или се обади в салона.</div>`;
    }

    $('bk-date').addEventListener('change', (e) => {
        if (e.target.value) pickDate(e.target.value);
    });

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

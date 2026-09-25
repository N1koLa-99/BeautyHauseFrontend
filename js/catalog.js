/* =====================================================================
   Каталог с услуги (Studio24 стил, темата на Beauty House).
   Подредбата (категории/групи/имена) е в js/catalog-data.js, а ЦЕНИТЕ и
   ВРЕМЕТРАЕНЕТО се взимат от базата: GET /employees/{id}/services.
   Процедура, която я няма в базата, не се показва; услуга от базата, която
   я няма в подредбата, отива в „Други процедури" — нищо не се губи.
   Глобален достъп: window.BHCatalog.open(catKey, groupName) — за бутоните
   с плочките долу (пренасочва + отваря правилната категория).
   window.BHCatalog.mount(box, { emp, onPick }) — същият каталог другаде
   (стъпка 1 на резервацията): emp = само услугите на този специалист,
   onPick(row, label) = „Запиши" се обработва на място, без презареждане.
   ===================================================================== */
(function () {
function mount(box, opts = {}) {
    const E = window.esc || (s => String(s ?? ''));

    // Професионални икони за категориите (реални PNG икони).
    const IMG = (src, alt) => `<img class="cat__ic-img" src="img/${src}" alt="${alt}" loading="lazy">`;
    const ICONS = {
        nails: IMG('nail.png', 'Нокти'),
        face: IMG('FaceIcon.png', 'Лице'),
        wax: IMG('waxing.png', 'Епилация'),
        piercing: IMG('PiercingIcon.png', 'Пробиване'),
        all: IMG('AllIcon.png', 'Всички')
    };

    // ---- Цени от базата ----
    const norm = s => String(s || '').trim().toLowerCase();
    const firstName = n => String(n || '').trim().split(/\s+/)[0];
    const fmtMin = m => { const h = Math.floor(m / 60), r = m % 60; return h ? `${h} ч.${r ? ` ${r} мин.` : ''}` : `${r} мин.`; };
    const fmtDur = (a, b) => a === b ? fmtMin(a) : `${fmtMin(a)} – ${fmtMin(b)}`;
    const fmtPrice = p => `${Number(p) % 1 ? Number(p).toFixed(2) : Number(p)} €`;

    // Име на услуга -> [{ serviceId, emp, price, dur }] (по реда на специалистите).
    async function loadPrices() {
        const [services, employees] = await Promise.all([API.get('/services'), API.get('/employees')]);
        const emps = (employees || []).filter(e => e.isActive !== false && (!opts.emp || String(e.id) === String(opts.emp))).sort((a, b) => a.id - b.id);
        const lists = await Promise.all(emps.map(e => API.get('/employees/' + e.id + '/services').catch(() => [])));
        const active = new Map((services || []).filter(s => s.isActive !== false).map(s => [s.id, s.name]));
        const map = new Map();
        emps.forEach((e, i) => (lists[i] || []).forEach(es => {
            const name = active.get(es.serviceId);
            if (!name) return;
            const k = norm(name);
            if (!map.has(k)) map.set(k, { name, rows: [] });
            map.get(k).rows.push({ serviceId: es.serviceId, emp: e, price: es.price, dur: es.durationMinutes });
        }));
        return map;
    }

    // Подредбата + цените от базата -> това, което се показва.
    // Ред = { label, db, price, dur, emp?, multi } ; multi = услугата се прави от >1 специалист.
    function buildTabs(prices) {
        const used = new Set();
        const rowsFor = (db, label) => {
            const hit = prices.get(norm(db));
            if (!hit) return [];
            used.add(norm(db));
            const multi = hit.rows.length > 1;
            return hit.rows.map(r => ({ label: multi ? `${label ? label + ' ' : ''}при ${firstName(r.emp.fullName)}` : label, db: hit.name, serviceId: r.serviceId, price: r.price, dur: r.dur, emp: r.emp, multi }));
        };
        const empOrder = r => (r.emp ? r.emp.id : 0);
        const cats = BH_CATALOG.map(c => ({ key: c.key, label: c.label, groups: c.groups.map(g => ({
            name: g.name, _cat: c.key,
            items: g.items.map(it => {
                let rows;
                if (it.options) {
                    rows = it.options.flatMap((o, oi) => rowsFor(o.db, o.name).map(r => ({ ...r, oi })));
                    // Варианти на няколко специалисти: първо всички на единия, после на другия (като в Studio 24).
                    if (rows.some(r => r.multi)) rows.sort((a, b) => empOrder(a) - empOrder(b) || a.oi - b.oi);
                } else rows = rowsFor(it.db || it.name, '');
                return rows.length ? { name: it.name, rows } : null;
            }).filter(Boolean)
        })).filter(g => g.items.length) })).filter(c => c.groups.length);

        // Услуги от базата, които ги няма в подредбата.
        const extra = [...prices.entries()].filter(([k]) => !used.has(k)).map(([, v]) => ({ name: v.name, rows: rowsFor(v.name, '') }));
        const all = cats.flatMap(c => c.groups);
        if (extra.length) all.push({ name: 'Други процедури', _cat: '', items: extra });
        return [...cats, { key: 'all', label: 'Всички', groups: all }];
    }

    // Резервация на точния ред (услуга + специалист).
    function bookHref(row, label) {
        const q = `srv=${encodeURIComponent(row.db)}&label=${encodeURIComponent(label)}`;
        // При няколко специалисти редът вече е конкретен („при Радина") -> директно при нея.
        // auto=1: ако услугата се прави само от 1 специалист, той се избира автоматично.
        return row.multi ? `booking.html?emp=${row.emp.id}&${q}` : `booking.html?${q}&auto=1`;
    }

    let tabs = [];
    let tabKey = 'all';  // по подразбиране показваме всички процедури
    let groupIdx = 0;

    box.innerHTML = `
        <div class="cat">
            <div class="cat__tabs"></div>
            <div class="cat__panel"></div>
        </div>`;
    const tabsEl = box.querySelector('.cat__tabs');
    const panelEl = box.querySelector('.cat__panel');

    const count = g => g.items.length;   // брой процедури (като в Studio 24), не варианти
    const curTab = () => tabs.find(t => t.key === tabKey);

    // Форматира цена: „от 20 €" -> малкото „от" над числото за по-чист вид.
    function price(p) {
        const s = String(p || '').trim();
        const m = s.match(/^от\s+(.*)$/i);
        return m ? `<span class="cat__from">от</span> ${E(m[1])}` : E(s);
    }

    function renderTabs() {
        tabsEl.innerHTML = tabs.map(x => `
            <button class="cat__tab${x.key === tabKey ? ' is-active' : ''}" data-k="${x.key}">
                <span class="cat__tab-ic">${ICONS[x.key] || ICONS.all}</span>
                <span class="cat__tab-lb">${E(x.label)}</span>
            </button>`).join('');
        tabsEl.querySelectorAll('.cat__tab').forEach(b =>
            b.addEventListener('click', () => open(b.dataset.k)));
    }

    function renderPanel() {
        if (!tabKey) {
            panelEl.innerHTML = `<div class="cat__empty">${ICONS.all}<p>Избери категория горе, за да видиш процедурите, цените и времетраенето.</p></div>`;
            return;
        }
        const t = curTab();
        if (groupIdx >= t.groups.length) groupIdx = 0;
        panelEl.innerHTML = `
            <div class="cat__body">
                <div class="cat__groups-wrap">
                    <aside class="cat__groups">${t.groups.map((g, i) =>
                        `<button class="cat__group${i === groupIdx ? ' is-active' : ''}" data-i="${i}">
                            <span>${E(g.name)}</span><span class="cat__group-n">${count(g)}</span><span class="cat__group-arrow">›</span>
                        </button>`).join('')}</aside>
                    <span class="cat__groups-bar" aria-hidden="true"><i></i></span>
                </div>
                <div class="cat__items"></div>
            </div>`;
        const groupsEl = panelEl.querySelector('.cat__groups');
        groupsEl.querySelectorAll('.cat__group').forEach(b =>
            b.addEventListener('click', () => selectGroup(+b.dataset.i)));
        renderItems();
        setupScroller(groupsEl);
        requestAnimationFrame(() => centerActive(groupsEl, false));
    }

    // Сменя само списъка с процедури — редът с чиповете остава на място (без подскачане).
    function selectGroup(i) {
        groupIdx = i;
        const groupsEl = panelEl.querySelector('.cat__groups');
        groupsEl.querySelectorAll('.cat__group').forEach(b =>
            b.classList.toggle('is-active', +b.dataset.i === i));
        renderItems();
        centerActive(groupsEl, true);
    }

    // „Запиши" -> редът, който стои зад бутона (за opts.onPick).
    let picks = [];
    const pickAttr = (row, label) => `data-r="${picks.push({ row, label }) - 1}"`;

    function renderItems() {
        picks = [];
        const g0 = curTab().groups[groupIdx];
        const itemsEl = panelEl.querySelector('.cat__items');
        itemsEl.innerHTML = g0.items.map(it => itemHtml(it)).join('');
        itemsEl.querySelectorAll('.cat__opts-toggle').forEach(b => b.addEventListener('click', () => {
            const wrap = b.closest('.cat__item').querySelector('.cat__opts');
            if (wrap.hasAttribute('hidden')) { wrap.removeAttribute('hidden'); b.classList.add('is-open'); }
            else { wrap.setAttribute('hidden', ''); b.classList.remove('is-open'); }
        }));
    }

    // Избраният чип отива в средата на реда (на телефон, където редът се плъзга).
    function centerActive(wrap, smooth) {
        const act = wrap.querySelector('.cat__group.is-active');
        if (!act || wrap.scrollWidth <= wrap.clientWidth) return;
        const left = act.offsetLeft - (wrap.clientWidth - act.offsetWidth) / 2;
        wrap.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
    }

    // Избледнели ръбове + индикатор за позиция + еднократно „побутване", което подсказва плъзгане.
    let nudged = false;
    function setupScroller(wrap) {
        const box = wrap.parentElement;
        const bar = box.querySelector('.cat__groups-bar i');
        const update = () => {
            const max = wrap.scrollWidth - wrap.clientWidth;
            box.classList.toggle('no-scroll', max <= 2);
            if (max <= 2) return;
            wrap.classList.toggle('is-scrolled', wrap.scrollLeft > 4);
            wrap.classList.toggle('is-end', wrap.scrollLeft >= max - 4);
            const ratio = wrap.clientWidth / wrap.scrollWidth;
            const track = bar.parentElement.clientWidth;
            bar.style.setProperty('--bar-w', (ratio * 100) + '%');
            bar.style.setProperty('--bar-x', ((wrap.scrollLeft / max) * track * (1 - ratio)) + 'px');
        };
        wrap.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        requestAnimationFrame(update);

        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (nudged || reduce || !('IntersectionObserver' in window)) return;
        const io = new IntersectionObserver(entries => {
            if (!entries[0].isIntersecting) return;
            io.disconnect();
            if (nudged || wrap.scrollWidth <= wrap.clientWidth || wrap.scrollLeft > 4) return;
            nudged = true;
            wrap.classList.add('is-nudge');
            setTimeout(() => wrap.classList.remove('is-nudge'), 1200);
        }, { threshold: .9 });
        io.observe(wrap);
        wrap.addEventListener('pointerdown', () => { nudged = true; io.disconnect(); }, { once: true });
    }

    function itemHtml(it) {
        const rows = it.rows;
        const one = rows.length === 1 && !rows[0].label;
        const mins = rows.map(r => r.dur), prs = rows.map(r => r.price);
        const minP = Math.min(...prs), maxP = Math.max(...prs);
        const dur = fmtDur(Math.min(...mins), Math.max(...mins));
        if (one) {
            const r = rows[0];
            return `
            <div class="cat__item">
                <div class="cat__item-row">
                    <div class="cat__item-info">
                        <div class="cat__item-name">${E(it.name)}</div>
                        <div class="cat__item-dur">${E(dur)}</div>
                    </div>
                    <div class="cat__item-right"><span class="cat__price">${price(fmtPrice(r.price))}</span><a href="${bookHref(r, it.name)}" class="cat__pick" ${pickAttr(r, it.name)}>Запиши</a></div>
                </div>
            </div>`;
        }
        const head = minP === maxP ? fmtPrice(minP) : `от ${fmtPrice(minP)}`;
        return `
        <div class="cat__item">
            <div class="cat__item-row">
                <div class="cat__item-info">
                    <div class="cat__item-name">${E(it.name)}</div>
                    <div class="cat__item-dur">${E(dur)}</div>
                </div>
                <div class="cat__item-right"><span class="cat__price">${price(head)}</span><button class="cat__opts-toggle">опции <span class="cat__chev">⌄</span></button></div>
            </div>
            <div class="cat__opts" hidden>${rows.map(r => `
                <div class="cat__opt">
                    <div><div class="cat__opt-name">${E(r.label)}</div><div class="cat__opt-dur">${E(fmtMin(r.dur))}</div></div>
                    <div class="cat__opt-right"><span class="cat__price">${price(fmtPrice(r.price))}</span><a href="${bookHref(r, it.name + ' — ' + r.label)}" class="cat__pick cat__pick--sm" ${pickAttr(r, it.name + ' — ' + r.label)}>Запиши</a></div>
                </div>`).join('')}</div>
        </div>`;
    }

    let pendingOpen = null;   // клик по плочка преди цените да са заредени
    function open(catKey, groupName) {
        if (!tabs.length) { pendingOpen = [catKey, groupName]; return; }
        tabKey = tabs.find(x => x.key === catKey) ? catKey : 'all';
        const t = curTab();
        groupIdx = 0;
        if (t && groupName) {
            const gi = t.groups.findIndex(g => g.name.toLowerCase() === String(groupName).toLowerCase());
            if (gi >= 0) groupIdx = gi;
        }
        renderTabs(); renderPanel();
        const r = box.getBoundingClientRect();
        if (r.top < 60 || r.top > window.innerHeight * 0.5) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (opts.onPick) box.addEventListener('click', (e) => {
        const a = e.target.closest('.cat__pick[data-r]');
        if (!a) return;
        e.preventDefault();
        const p = picks[+a.dataset.r];
        if (p) opts.onPick(p.row, p.label);
    });

    // Отваряне през URL хеш: #cat=face&g=Мигли (за линкове от други страници).
    // Първо се зареждат цените от базата, после се рисува.
    const params = new URLSearchParams(opts.fromHash ? (location.hash || '').slice(1) : '');
    panelEl.innerHTML = `<div class="cat__empty"><div class="spinner"></div></div>`;
    loadPrices().then(prices => {
        tabs = buildTabs(prices);
        if (!tabs.find(t => t.key === tabKey)) tabKey = 'all';
        if (pendingOpen) open(...pendingOpen);
        else if (params.get('cat')) open(params.get('cat'), params.get('g'));
        else { renderTabs(); renderPanel(); }
    }).catch(() => {
        panelEl.innerHTML = `<div class="cat__empty">${ICONS.all}<p>Цените не могат да се заредят в момента. Опитай отново след малко.</p></div>`;
    });
    return { open };
}

window.BHCatalog = { mount, open() {} };

document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('bh-catalog');
    if (!box || !window.BH_CATALOG) return;
    const { open } = mount(box, { fromHash: true });
    // Публичен достъп за плочките/линковете долу.
    window.BHCatalog.open = open;

    // Линкове/плочки [data-open-cat] -> отварят каталога на правилната категория.
    document.querySelectorAll('[data-open-cat]').forEach(el =>
        el.addEventListener('click', (e) => { e.preventDefault(); open(el.dataset.openCat, el.dataset.openGroup || ''); }));
});
})();

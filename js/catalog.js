/* =====================================================================
   Каталог с услуги (Studio24 стил, темата на Beauty House).
   Показва 4 категории с икони; съдържанието се зарежда ЕДВА след избор.
   Глобален достъп: window.BHCatalog.open(catKey, groupName) — за бутоните
   с плочките долу (пренасочва + отваря правилната категория).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('bh-catalog');
    if (!box || !window.BH_CATALOG) return;
    const E = window.esc || (s => String(s ?? ''));

    // Професионални икони за категориите (реални PNG икони).
    const IMG = (src, alt) => `<img class="cat__ic-img" src="img/${src}" alt="${alt}" loading="lazy">`;
    const ICONS = {
        nails: IMG('nail.png', 'Нокти'),
        face: IMG('FaceIcon.png', 'Лице'),
        wax: IMG('waxing.png', 'Епилация'),
        all: IMG('AllIcon.png', 'Всички')
    };

    const tabs = BH_CATALOG.map(c => ({ key: c.key, label: c.label, groups: c.groups.map(g => ({ ...g, _cat: c.key })) }));
    tabs.push({ key: 'all', label: 'Всички', groups: BH_CATALOG.flatMap(c => c.groups.map(g => ({ ...g, _cat: c.key }))) });

    // Свързва процедура от каталога с реалната услуга в системата (за резервация).
    function dbService(cat, group, name) {
        const n = (name || '').toLowerCase(), g = (group || '').toLowerCase();
        if (cat === 'wax') return 'Кола маска';
        if (cat === 'nails') {
            if (n.includes('педикюр') && (n.includes('терапевт') || n.includes('класически'))) return 'Терапевтичен педикюр';
            if (n.includes('педикюр')) return 'Педикюр';
            return 'Маникюр';
        }
        if (cat === 'face') {
            if (g.includes('вежди')) return 'Ламиниране на вежди';
            if (g.includes('мигли')) {
                if (n.includes('ламинир') || n.includes('ботокс') || n.includes('lash lift') || n.includes('боядисв')) return 'Ламиниране на мигли';
                return 'Миглопластика';
            }
            return 'Терапии за лице';
        }
        return '';
    }
    function bookHref(cat, group, label, name) {
        const svc = dbService(cat, group, name || label);
        // auto=1: щом конкретната процедура се прави само от 1 специалист, той се избира автоматично
        // и остава само изборът на дата/час — тук потребителят вече е избрал точна процедура.
        return `booking.html?srv=${encodeURIComponent(svc)}&label=${encodeURIComponent(label)}&auto=1`;
    }

    let tabKey = 'all';  // по подразбиране показваме всички процедури
    let groupIdx = 0;

    box.innerHTML = `
        <div class="cat">
            <div class="cat__tabs"></div>
            <div class="cat__panel"></div>
        </div>`;
    const tabsEl = box.querySelector('.cat__tabs');
    const panelEl = box.querySelector('.cat__panel');

    const count = g => g.items.reduce((n, it) => n + 1 + (it.options ? it.options.length : 0), 0);
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

    function renderItems() {
        const g0 = curTab().groups[groupIdx];
        const itemsEl = panelEl.querySelector('.cat__items');
        itemsEl.innerHTML = g0.items.map(it => itemHtml(it, g0._cat || tabKey, g0.name)).join('');
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

    function itemHtml(it, cat, gname) {
        const has = it.options && it.options.length;
        const action = has
            ? `<button class="cat__opts-toggle">опции <span class="cat__chev">⌄</span></button>`
            : `<a href="${bookHref(cat, gname, it.name)}" class="cat__pick">Запиши</a>`;
        const opts = has ? `
            <div class="cat__opts" hidden>${it.options.map(o => `
                <div class="cat__opt">
                    <div><div class="cat__opt-name">${E(o.name)}</div><div class="cat__opt-dur">${E(o.dur || '')}</div></div>
                    <div class="cat__opt-right"><span class="cat__price">${price(o.price)}</span><a href="${bookHref(cat, gname, it.name + ' — ' + o.name, it.name)}" class="cat__pick cat__pick--sm">Запиши</a></div>
                </div>`).join('')}</div>` : '';
        return `
        <div class="cat__item">
            <div class="cat__item-row">
                <div class="cat__item-info">
                    <div class="cat__item-name">${E(it.name)}</div>
                    <div class="cat__item-dur">${E(it.dur || '')}</div>
                </div>
                <div class="cat__item-right"><span class="cat__price">${price(it.price)}</span>${action}</div>
            </div>
            ${opts}
        </div>`;
    }

    function open(catKey, groupName) {
        tabKey = catKey;
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

    // Публичен достъп за плочките/линковете долу.
    window.BHCatalog = { open };

    // Линкове/плочки [data-open-cat] -> отварят каталога на правилната категория.
    document.querySelectorAll('[data-open-cat]').forEach(el =>
        el.addEventListener('click', (e) => { e.preventDefault(); open(el.dataset.openCat, el.dataset.openGroup || ''); }));

    // Отваряне през URL хеш: #cat=face&g=Мигли (за линкове от други страници).
    const params = new URLSearchParams((location.hash || '').slice(1));
    if (params.get('cat')) open(params.get('cat'), params.get('g'));
    else { renderTabs(); renderPanel(); }
});

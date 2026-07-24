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
        return `booking.html?srv=${encodeURIComponent(svc)}&label=${encodeURIComponent(label)}`;
    }

    let tabKey = null;   // нищо не е избрано в началото
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
        const g0 = t.groups[groupIdx];
        const realCat = g0._cat || tabKey;
        panelEl.innerHTML = `
            <div class="cat__body">
                <aside class="cat__groups">${t.groups.map((g, i) =>
                    `<button class="cat__group${i === groupIdx ? ' is-active' : ''}" data-i="${i}">
                        <span>${E(g.name)}</span><span class="cat__group-n">${count(g)}</span><span class="cat__group-arrow">›</span>
                    </button>`).join('')}</aside>
                <div class="cat__items">${g0.items.map(it => itemHtml(it, realCat, g0.name)).join('')}</div>
            </div>`;
        panelEl.querySelectorAll('.cat__group').forEach(b =>
            b.addEventListener('click', () => { groupIdx = +b.dataset.i; renderPanel(); }));
        panelEl.querySelectorAll('.cat__opts-toggle').forEach(b => b.addEventListener('click', () => {
            const wrap = b.closest('.cat__item').querySelector('.cat__opts');
            if (wrap.hasAttribute('hidden')) { wrap.removeAttribute('hidden'); b.classList.add('is-open'); }
            else { wrap.setAttribute('hidden', ''); b.classList.remove('is-open'); }
        }));

        // След пре-рендиране скролът на чиповете се нулира — връщаме избрания в изглед.
        requestAnimationFrame(() => {
            const wrap = panelEl.querySelector('.cat__groups');
            const act = panelEl.querySelector('.cat__group.is-active');
            if (wrap && act && wrap.scrollWidth > wrap.clientWidth) {
                wrap.scrollLeft += act.getBoundingClientRect().left - wrap.getBoundingClientRect().left
                    - (wrap.clientWidth / 2 - act.offsetWidth / 2);
            }
        });
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

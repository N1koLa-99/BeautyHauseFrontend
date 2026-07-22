/* =====================================================================
   Услуги: тегли каталога (/services) и изчислява "от X лв" от цените,
   които специалистите са задали за всяка услуга.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('services-list');
    if (!box) return;

    // Икона + фонова снимка според ключова дума в името (визуален щрих).
    const CATS = [
        { test: /(коса|подстр|прич|боя|къдр|сешоар|балayage)/i, icon: 'scissors', photo: '1560066984-138dadb4c035' },
        { test: /(маникюр|нокт|педикюр|гел|лак)/i, icon: 'sparkle', photo: '1596178060810-72660aac0f04' },
        { test: /(лице|кожа|почист|маска|вежд|мигл)/i, icon: 'flower', photo: '1519699047748-de8e457a634e' },
        { test: /(масаж|спа|релакс)/i, icon: 'leaf', photo: '1519014816548-bf5fe059798b' },
        { test: /(грим|макиаж)/i, icon: 'wand', photo: '1522335789203-aabd1fc54bc9' }
    ];
    const catFor = (name) => CATS.find(c => c.test.test(name || '')) || { icon: 'gem', photo: '1512290923902-8a9f81dc236c' };

    function renderCards(services, minPrice) {
        box.innerHTML = services.map((s, i) => {
            const price = minPrice[s.id];
            const priceHtml = price !== undefined && price !== null
                ? `<span class="price">от ${Number(price).toFixed(0)} <small>€</small></span>`
                : `<span class="hint">Цена при избор</span>`;
            const cat = catFor(s.name);
            return `
            <article class="card service-card reveal" data-delay="${i % 3}" data-tilt="4">
                <figure class="ph service-card__photo">
                    <img src="https://images.unsplash.com/photo-${cat.photo}?auto=format&fit=crop&w=500&q=70" alt="" loading="lazy" onerror="this.closest('.ph')&&this.closest('.ph').classList.add('ph--broken')">
                    <span class="ph__mark">${Icon(cat.icon, { size: 26 })}</span>
                </figure>
                <div class="service-card__body">
                    <div class="service-card__icon">${Icon(cat.icon)}</div>
                    <h3>${esc(s.name)}</h3>
                    <p>${esc(s.description || 'Професионална грижа с внимание към детайла.')}</p>
                    <div class="service-card__meta">
                        ${priceHtml}
                        <a href="booking.html" class="nav__link">Запиши се <span class="btn__arrow">→</span></a>
                    </div>
                </div>
            </article>`;
        }).join('');
        revealNew(box);
    }

    // Резервен каталог (без сървър).
    function useFallback() {
        const fb = (window.BH_FALLBACK && BH_FALLBACK.services) || [];
        if (!fb.length) { box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Услугите се обновяват. Заповядай скоро отново.</p>`; return; }
        const minPrice = {};
        fb.forEach(s => { minPrice[s.id] = s.price; });
        renderCards(fb, minPrice);
    }

    try {
        const services = await API.get('/services');
        if (!services || services.length === 0) { useFallback(); return; }

        // Опит да съберем минимална цена за всяка услуга от всички специалисти.
        const minPrice = {}; // serviceId -> min price
        try {
            const employees = await API.get('/employees');
            const lists = await Promise.all(
                (employees || []).map(e => API.get('/employees/' + e.id + '/services').catch(() => []))
            );
            lists.flat().forEach(es => {
                if (es && typeof es.price === 'number') {
                    if (minPrice[es.serviceId] === undefined || es.price < minPrice[es.serviceId])
                        minPrice[es.serviceId] = es.price;
                }
            });
        } catch { /* цените са по избор — продължаваме без тях */ }

        renderCards(services, minPrice);
    } catch (err) {
        useFallback(); // без сървър → резервен каталог
    }
});

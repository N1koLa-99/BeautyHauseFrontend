/* =====================================================================
   Началната страница — само РЕАЛНИ отзиви.
   • Взимат се отзивите на всяка специалистка (/reviews/employee/{id} —
     и тези само със звезди, без текст) + общия /reviews; без дубли.
   • Над картите: средна оценка (без брой). В hero-то „5,0 ★ оценка".
   • Няма отзиви -> „Все още няма отзиви“ (нищо измислено).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('reviews-list');
    const section = document.getElementById('reviews-section');
    const stats = document.getElementById('hero-stats');
    if (!box && !stats) return;

    const reviews = await loadReviews();

    if (!reviews.length) {
        if (box && section) {
            box.innerHTML = `
            <div class="panel center" style="grid-column:1/-1;max-width:520px;margin:0 auto">
                <p style="margin:0 0 .4rem;font-weight:700">Все още няма отзиви</p>
                <p class="hint" style="margin:0">Била си при нас? След посещението можеш да оставиш отзив от „Моите часове“.</p>
            </div>`;
            section.hidden = false;
        }
        return;
    }

    const n = reviews.length;
    const avg = reviews.reduce((a, r) => a + clampR(r.rating), 0) / n;
    const avgTxt = avg.toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    if (box && section) {
        const shown = reviews.slice(0, 6);
        box.insertAdjacentHTML('beforebegin', `
            <div class="rv-summary reveal">
                <b class="rv-summary__avg">${avgTxt}</b>
                <span class="rv-summary__stars">${starRow(Math.round(avg), 20)}</span>
            </div>`);
        box.innerHTML = shown.map(reviewCard).join('');
        // 1–2 отзива -> центрирани, а не залепени вляво в мрежата от 3 колони.
        if (shown.length < 3) box.classList.add('testimonials--few');
        section.hidden = false;
        if (window.revealNew) revealNew(section);
    }
    if (stats) {
        stats.insertAdjacentHTML('afterbegin', `
            <div class="hero__stat">
                <strong><b>${avgTxt}</b><i aria-hidden="true">★</i></strong>
                <span>оценка</span>
            </div>`);
    }
});

async function loadReviews() {
    const byId = new Map();
    const add = (r, extra) => { if (r && r.id != null && !byId.has(r.id)) byId.set(r.id, Object.assign({}, r, extra || {})); };
    let emps = [];
    try { emps = (await API.get('/employees')) || []; } catch (e) {}
    const per = await Promise.all(emps.map(e =>
        API.get('/reviews/employee/' + e.id).then(x => ({ e, items: (x && x.items) || [] })).catch(() => ({ e, items: [] }))));
    per.forEach(({ e, items }) => items.forEach(r => add(r, { employeeName: e.fullName })));
    try { ((await API.get('/reviews?take=500')) || []).forEach(r => add(r)); } catch (e) {}
    return [...byId.values()].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function clampR(v) { return Math.max(1, Math.min(5, Math.round(v || 5))); }

function starRow(rating, size) {
    return Array.from({ length: 5 }, (_, k) =>
        `<span class="${k < rating ? '' : 'is-off'}">${Icon('star', { size })}</span>`).join('');
}

const RATING_LBL = { 5: 'Отлично', 4: 'Много добре', 3: 'Добре', 2: 'Задоволително', 1: 'Слабо' };

function reviewCard(r, i) {
    const rating = clampR(r.rating);
    const name = esc(r.clientName || 'Клиент');
    const initial = (r.clientName || 'К').trim().charAt(0).toUpperCase();
    const first = r.employeeName ? String(r.employeeName).split(' ')[0] : '';
    const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const hasText = r.comment && String(r.comment).trim();
    const body = hasText
        ? `<p class="rv-text">„${esc(r.comment)}“</p>`
        : `<div class="rv-score"><b>${rating},0</b><span>${RATING_LBL[rating]}</span></div>`;
    const svc = r.serviceName ? `<div class="rv-svc">${esc(r.serviceName)}</div>` : '';
    return `
    <article class="testimonial rv-card reveal" data-delay="${i % 3}">
        <div class="testimonial__stars rv-stars">${starRow(rating, 22)}</div>
        ${body}
        ${svc}
        <div class="testimonial__who">
            <div class="brand__mark" style="width:46px;height:46px;font-size:1.05rem;flex:none">${initial}</div>
            <div><b>${name}</b><span>${first ? 'при ' + esc(first) : 'Клиент на Beauty House'}${date ? ' · ' + date : ''}</span></div>
        </div>
    </article>`;
}

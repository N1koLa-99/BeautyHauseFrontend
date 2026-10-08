/* =====================================================================
   Началната страница — само РЕАЛНИ отзиви от /reviews.
   • Секцията „Отзиви" стои скрита, докато няма нито един видим отзив.
   • В hero-то „★ от N отзива" се показва само ако има отзиви
     (средната оценка и броят са изчислени от тях — нищо измислено).
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('reviews-list');
    const section = document.getElementById('reviews-section');
    const stats = document.getElementById('hero-stats');
    if (!box && !stats) return;
    let reviews = [];
    try { reviews = (await API.get('/reviews?take=500')) || []; } catch (e) { return; }
    if (!reviews.length) return;

    if (box && section) {
        box.innerHTML = reviews.slice(0, 6).map(reviewCard).join('');
        section.hidden = false;
        if (window.revealNew) revealNew(box);
    }
    if (stats) {
        const sum = reviews.reduce((a, r) => a + Math.max(1, Math.min(5, r.rating || 5)), 0);
        const avg = (sum / reviews.length).toFixed(1);
        const n = reviews.length;
        stats.insertAdjacentHTML('afterbegin', `
            <div class="hero__stat">
                <strong><b>${avg}</b><i aria-hidden="true">★</i></strong>
                <span>от ${n} ${n === 1 ? 'отзив' : 'отзива'}</span>
            </div>`);
    }
});

function reviewCard(r, i) {
    const rating = Math.max(1, Math.min(5, r.rating || 5));
    const stars = Array.from({ length: 5 }, (_, k) =>
        `<span style="${k < rating ? '' : 'opacity:.28'}">${Icon('star', { size: 16 })}</span>`).join('');
    const name = esc(r.clientName || 'Клиент');
    const initial = (r.clientName || 'К').trim().charAt(0).toUpperCase();
    const who = r.employeeName ? 'при ' + esc(r.employeeName) : 'Клиент на Beauty House';
    return `
    <article class="testimonial reveal" data-delay="${i % 3}">
        <div class="testimonial__stars">${stars}</div>
        <p>„${esc(r.comment)}“</p>
        <div class="testimonial__who">
            <div class="brand__mark" style="width:46px;height:46px;font-size:1.05rem;flex:none">${initial}</div>
            <div><b>${name}</b><span>${who}</span></div>
        </div>
    </article>`;
}

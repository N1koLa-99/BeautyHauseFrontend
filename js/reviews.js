/* =====================================================================
   Началната секция „Отзиви" — тегли реални отзиви от /reviews.
   Ако още няма — оставя статичните примери в HTML.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('reviews-list');
    if (!box) return;
    try {
        const reviews = await API.get('/reviews?take=6');
        if (reviews && reviews.length) {
            box.innerHTML = reviews.map(reviewCard).join('');
            if (window.revealNew) revealNew(box);
        }
    } catch (e) { /* при грешка оставяме статичните примери */ }
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

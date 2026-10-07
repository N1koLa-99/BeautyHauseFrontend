/* =====================================================================
   Екип: тегли всички активни служители от /employees и ги показва.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('team-list');
    if (!box) return;

    let list = null;
    // На компютър шефът (Радина) е в средата; на телефон остава първа (teamMobileOrder).
    const bossMiddle = (arr) => {
        const i = arr.findIndex(e => e.role === 'boss');
        if (i < 0) return arr;
        const rest = arr.filter((_, k) => k !== i);
        rest.splice(Math.floor(rest.length / 2), 0, arr[i]);
        return rest;
    };
    const paint = () => {
        if (!list) return;
        box.innerHTML = (isMobileLayout() ? teamMobileOrder([...list]) : bossMiddle([...list])).map((e, i) => teamCardHTML(e, i % 3)).join('');
        box.scrollLeft = 0;
        revealNew(box);
    };

    try {
        const employees = await API.get('/employees');
        if (!employees || employees.length === 0) {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Скоро тук ще видиш нашия екип.</p>`;
            return;
        }
        list = employees;
    } catch (err) {
        // Без сървър → резервен екип.
        const fb = (window.BH_FALLBACK && BH_FALLBACK.employees) || [];
        if (!fb.length) {
            box.innerHTML = `<div class="alert alert--err" style="grid-column:1/-1">${esc(err.message)}</div>`;
            return;
        }
        list = fb;
    }
    paint();
    onLayoutChange(paint);

    // Портфолио: клик по снимката/картата (или бутона „Портфолио“) -> модал със снимки и отзиви.
    // Линковете вътре в картата (соц. мрежи, „Запиши се“) работят както досега.
    if (window.Portfolio) {
        box.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            const card = e.target.closest('[data-pf-emp]');
            if (!card) return;
            const emp = list.find(x => String(x.id) === String(card.dataset.pfEmp));
            Portfolio.openEmployee(emp || card.dataset.pfEmp);
        });
        // Директен линк: team.html?pf=<id> отваря портфолиото.
        const pfId = new URLSearchParams(location.search).get('pf');
        if (pfId) {
            const emp = list.find(x => String(x.id) === String(pfId));
            if (emp) Portfolio.openEmployee(emp);
        }
    }
});

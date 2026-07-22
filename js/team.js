/* =====================================================================
   Екип: тегли всички активни служители от /employees и ги показва.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('team-list');
    if (!box) return;

    try {
        const employees = await API.get('/employees');
        if (!employees || employees.length === 0) {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Скоро тук ще видиш нашия екип.</p>`;
            return;
        }
        box.innerHTML = employees.map((e, i) => teamCardHTML(e, i % 3)).join('');
        revealNew(box);
    } catch (err) {
        // Без сървър → резервен екип.
        const fb = (window.BH_FALLBACK && BH_FALLBACK.employees) || [];
        if (fb.length) {
            box.innerHTML = fb.map((e, i) => teamCardHTML(e, i % 3)).join('');
            revealNew(box);
        } else {
            box.innerHTML = `<div class="alert alert--err" style="grid-column:1/-1">${esc(err.message)}</div>`;
        }
    }
});

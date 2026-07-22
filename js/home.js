/* =====================================================================
   Начална страница: зарежда преглед на екипа от API-то.
   При липса на връзка/данни показва любезно резервно съобщение.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('team-preview');
    if (!box) return;

    try {
        const employees = await API.get('/employees');
        if (!employees || employees.length === 0) {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Скоро тук ще видиш нашия екип.</p>`;
            return;
        }
        box.innerHTML = employees.slice(0, 3).map((e, i) => teamCardHTML(e, i)).join('');
        revealNew(box);
    } catch (err) {
        // Без сървър → показваме резервния екип.
        const fb = (window.BH_FALLBACK && BH_FALLBACK.employees) || [];
        if (fb.length) {
            box.innerHTML = fb.slice(0, 3).map((e, i) => teamCardHTML(e, i)).join('');
            revealNew(box);
        } else {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Запознай се с екипа на страница <a class="nav__link" href="team.html">Екип →</a></p>`;
        }
    }
});

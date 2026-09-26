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
        box.innerHTML = arrange(employees).map((e, i) => teamCardHTML(e, i)).join('');
        revealNew(box);
    } catch (err) {
        // Без сървър → показваме резервния екип.
        const fb = (window.BH_FALLBACK && BH_FALLBACK.employees) || [];
        if (fb.length) {
            box.innerHTML = arrange(fb).map((e, i) => teamCardHTML(e, i)).join('');
            revealNew(box);
        } else {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Запознай се с екипа на страница <a class="nav__link" href="team.html">Екип →</a></p>`;
        }
    }
});

/* Телефон: Радина → Анелия → Ирина. Десктоп: шефът в средата. */
function arrange(list) {
    const top = teamMobileOrder(list).slice(0, 3);
    return isMobileLayout() ? top : centerBoss(top);
}

/* Собственикът винаги застава в средната (издигнатата) карта на прегледа. */
function centerBoss(list) {
    const idx = list.findIndex(e => e.role === 'boss');
    if (idx > -1 && idx !== 1 && list.length > 1) {
        [list[1], list[idx]] = [list[idx], list[1]];
    }
    return list;
}

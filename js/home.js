/* =====================================================================
   Начална страница: зарежда преглед на екипа от API-то.
   При липса на връзка/данни показва любезно резервно съобщение.
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    const box = document.getElementById('team-preview');
    if (!box) return;

    let list = null;
    // Рисува картите според текущия размер (телефон: Радина първа; компютър: Радина в средата).
    const paint = () => {
        if (!list) return;
        box.innerHTML = arrange(list).map((e, i) => teamCardHTML(e, i)).join('');
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
        // Без сървър → показваме резервния екип.
        const fb = (window.BH_FALLBACK && BH_FALLBACK.employees) || [];
        if (!fb.length) {
            box.innerHTML = `<p class="hint center" style="grid-column:1/-1">Запознай се с екипа на страница <a class="nav__link" href="team.html">Екип →</a></p>`;
            return;
        }
        list = fb;
    }
    paint();
    // Смяна телефон ↔ компютър (завъртане, промяна на прозореца) -> пренареждаме.
    onLayoutChange(paint);

    // Портфолио: клик по снимката/картата или бутона „Портфолио“ -> модал (както в „Екип“).
    if (window.Portfolio) {
        box.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            const card = e.target.closest('[data-pf-emp]');
            if (!card) return;
            const emp = list.find(x => String(x.id) === String(card.dataset.pfEmp));
            Portfolio.openEmployee(emp || card.dataset.pfEmp);
        });
    }
});

/* Телефон: Радина → Анелия → Ирина. Десктоп: шефът в средата. */
function arrange(list) {
    const top = teamMobileOrder([...list]).slice(0, 3);
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

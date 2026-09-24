/* =====================================================================
   Hero заглавие „пишеща машина": първата фраза влиза с анимацията дума по дума,
   после се изтрива буква по буква и се изписва следващата — в цикъл.
   Всяка фраза е два реда; всеки ред = [обикновен текст, акцент].
   ===================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    const h1 = document.querySelector('.hero__title');
    if (!h1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const PHRASES = [
        [['Красотата е ', 'изкуство.'], ['Ти си ', 'платното.']],
        [['Детайлът е ', 'нашият почерк.'], ['Ти си ', 'вдъхновението.']],
        [['Грижа, която ', 'се вижда.'], ['Красота, която ', 'се усеща.']]
    ];
    const TYPE_MS = 62, DELETE_MS = 26, HOLD_MS = 3400, GAP_MS = 380, FIRST_HOLD_MS = 4200;

    // Екранните четци чуват една стабилна фраза, не всяка буква.
    h1.setAttribute('aria-label', 'Красотата е изкуство. Ти си платното.');

    const flat = p => p.flat().join('');
    const html = (p, n) => {
        // Първите n символа от фразата, с акцентите и прехода на нов ред.
        let left = n, out = '';
        p.forEach((line, li) => {
            line.forEach((part, pi) => {
                const t = part.slice(0, Math.max(0, left));
                left -= part.length;
                if (t) out += pi === 1 ? `<span class="tw-accent">${t}</span>` : t;
            });
            if (li === 0 && left > 0) out += '<br>';
        });
        return out;
    };

    // Заключва височината по най-високата фраза (при текущата ширина). На телефон героят е
    // закотвен долу — там заглавието просто расте нагоре и бутоните не мърдат, затова не заключваме.
    const content = h1.closest('.hero__content');
    function lockHeight() {
        h1.style.minHeight = '';
        if (content && getComputedStyle(content).alignItems === 'flex-end') return;
        const probe = h1.cloneNode(false);
        probe.removeAttribute('aria-label');
        probe.classList.add('is-typing');
        probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${h1.offsetWidth}px;min-height:0`;
        h1.parentNode.appendChild(probe);
        let max = h1.offsetHeight;
        PHRASES.forEach(p => { probe.innerHTML = html(p, flat(p).length); max = Math.max(max, probe.offsetHeight); });
        probe.remove();
        h1.style.minHeight = max + 'px';
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // Не въртим анимацията, докато табът е скрит или героят не се вижда.
    let visible = true;
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(e => { visible = e[0].isIntersecting; }).observe(h1);
    }
    const ready = async () => { while (document.hidden || !visible) await sleep(500); };

    async function run() {
        lockHeight();
        window.addEventListener('resize', () => requestAnimationFrame(lockHeight));
        await sleep(FIRST_HOLD_MS);
        await ready();

        const render = (p, n) => { h1.innerHTML = html(p, n) + '<span class="tw-caret" aria-hidden="true"></span>'; };
        h1.classList.add('is-typing');
        let i = 0;
        for (;;) {
            const cur = PHRASES[i], next = PHRASES[(i + 1) % PHRASES.length];
            h1.classList.add('is-busy');
            for (let n = flat(cur).length; n >= 0; n--) { render(cur, n); await sleep(DELETE_MS); }
            h1.classList.remove('is-busy');
            await sleep(GAP_MS);
            h1.classList.add('is-busy');
            const len = flat(next).length;
            for (let n = 1; n <= len; n++) {
                render(next, n);
                // лек човешки ритъм: по-дълга пауза след препинателен знак
                const ch = flat(next)[n - 1];
                await sleep(TYPE_MS + Math.random() * 45 + (/[.,—]/.test(ch) ? 220 : 0));
            }
            h1.classList.remove('is-busy');
            await sleep(HOLD_MS);
            await ready();
            i = (i + 1) % PHRASES.length;
        }
    }
    run();
});

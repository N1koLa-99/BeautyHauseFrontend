/* =====================================================================
   Микро-взаимодействия: 3D tilt на карти, преброяване на статистики,
   елегантен fallback за hotlinked снимки.
   Уважава prefers-reduced-motion.
   ===================================================================== */

/* Извиква се от img onerror="phFallback(this)" — показва градиент+икона
   вместо счупена снимка (напр. при бавна връзка или недостъпен hotlink). */
function phFallback(img) {
    const wrap = img.closest('.ph');
    if (wrap) wrap.classList.add('ph--broken');
}

(function () {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    document.addEventListener('DOMContentLoaded', () => {
        /* --- 3D tilt на карти при движение на мишката ([data-tilt] вече съществува в markup-а) --- */
        if (canHover && !reduce) {
            document.querySelectorAll('[data-tilt]').forEach((el) => {
                const strength = parseFloat(el.dataset.tilt) || 6;
                el.addEventListener('pointermove', (e) => {
                    const r = el.getBoundingClientRect();
                    const px = (e.clientX - r.left) / r.width - .5;
                    const py = (e.clientY - r.top) / r.height - .5;
                    el.style.setProperty('--ry', (px * strength * 2).toFixed(2) + 'deg');
                    el.style.setProperty('--rx', (py * -strength * 2).toFixed(2) + 'deg');
                });
                el.addEventListener('pointerleave', () => {
                    el.style.setProperty('--rx', '0deg');
                    el.style.setProperty('--ry', '0deg');
                });
            });

            /* --- Магнитни бутони — леко следват курсора ([data-magnetic]) --- */
            document.querySelectorAll('[data-magnetic]').forEach((el) => {
                el.addEventListener('pointermove', (e) => {
                    const r = el.getBoundingClientRect();
                    const mx = (e.clientX - r.left - r.width / 2) * .3;
                    const my = (e.clientY - r.top - r.height / 2) * .35;
                    el.style.transform = `translate(${mx.toFixed(1)}px, ${my.toFixed(1)}px)`;
                });
                el.addEventListener('pointerleave', () => { el.style.transform = ''; });
            });
        }

        /* --- Преброяване на числа при влизане в изгледа --- */
        const counters = document.querySelectorAll('[data-count]');
        if (counters.length) {
            const run = (el) => {
                const target = parseFloat(el.dataset.count);
                const suffix = el.dataset.suffix || '';
                const decimals = el.dataset.count.includes('.') ? 1 : 0;
                if (reduce) { el.textContent = target.toFixed(decimals) + suffix; return; }
                const dur = 1400;
                const t0 = performance.now();
                function tick(t) {
                    const p = Math.min(1, (t - t0) / dur);
                    const eased = 1 - Math.pow(1 - p, 3);
                    el.textContent = (target * eased).toFixed(decimals) + suffix;
                    if (p < 1) requestAnimationFrame(tick);
                }
                requestAnimationFrame(tick);
            };
            const io = new IntersectionObserver((entries) => {
                entries.forEach(e => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
            }, { threshold: 0.6 });
            counters.forEach(el => io.observe(el));
        }

        /* --- Видеата играят/декодират само докато реално се виждат на екрана —
           спира декодирането при скрол извън изгледа (основната причина за jank). --- */
        const videos = document.querySelectorAll('[data-scroll-video]');
        if (videos.length) {
            const pauseTimers = new WeakMap();
            const vio = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const el = entry.target;
                    if (entry.isIntersecting) {
                        clearTimeout(pauseTimers.get(el));
                        el.play().catch(() => {});
                    } else {
                        // Малко закъснение преди пауза — пести рестартиране на декодера
                        // при бавен скрол точно през ръба на секцията (причина за jank).
                        clearTimeout(pauseTimers.get(el));
                        pauseTimers.set(el, setTimeout(() => el.pause(), 400));
                    }
                });
            }, { threshold: 0.15, rootMargin: '200px 0px 200px 0px' });
            videos.forEach(v => vio.observe(v));
        }
    });
})();

/* =====================================================================
   Диаграми за таблото (HTML + CSS, без външни библиотеки).
   Charts.bars / Charts.hbars / Charts.doughnut връщат готов HTML.
   Стълбовете и лентите са в %, текстът е истински текст (не SVG) —
   еднакво четими на телефон и на компютър.
   ===================================================================== */
window.Charts = (function () {
    const C = ['#A59079', '#C4A98A', '#BFAEA2', '#7D6B5F', '#DBCFBE', '#8FB0A0', '#9A8B7E'];
    const money = v => Math.round(v || 0).toLocaleString('bg-BG');
    const esc = window.esc || (s => String(s ?? ''));

    // „Хубав“ таван на скалата: 87 -> 100, 430 -> 500, 13 -> 15.
    function niceMax(v) {
        if (v <= 0) return 1;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const f = v / p;
        const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
        return n * p;
    }

    // Вертикални стълбове: data = [{label, value, muted?}]
    // opts: { color, unit ('€' | ''), labelEvery (число), showValues ('all' | 'max' | 'auto'), highlightMax }
    function bars(data, opts) {
        const o = opts || {};
        if (!data.length) return `<p class="hint">Няма данни.</p>`;
        const color = o.color || '#A59079';
        const unit = o.unit || '';
        const fmt = v => money(v) + (unit ? ' ' + unit : '');
        const rawMax = Math.max(0, ...data.map(d => d.value || 0));
        const top = niceMax(rawMax);
        const many = data.length > 12;
        const show = o.showValues || (many ? 'max' : 'all');
        const every = o.labelEvery || 1;
        const maxIdx = data.findIndex(d => (d.value || 0) === rawMax && rawMax > 0);
        const ticks = [top, top / 2, 0];

        const cols = data.map((d, i) => {
            const v = d.value || 0;
            const h = v > 0 ? Math.max(1.5, v / top * 100) : 0;
            const isMax = i === maxIdx;
            const val = v > 0 && (show === 'all' || (show === 'max' && isMax));
            const lbl = (i % every === 0 || d.forceLabel) ? esc(d.label) : '';
            const cls = `ch-col${d.muted ? ' is-muted' : ''}${o.highlightMax && isMax ? ' is-max' : ''}${o.highlightMax && !isMax ? ' is-dim' : ''}`;
            return `<div class="${cls}" title="${esc(d.title || d.label)}: ${fmt(v)}">
                <div class="ch-col__bar-wrap">${val ? `<span class="ch-col__v" style="bottom:calc(${h}% + 4px)">${fmt(v)}</span>` : ''}
                    <div class="ch-col__bar" style="height:${h}%"></div></div>
                <span class="ch-col__x">${lbl}</span>
            </div>`;
        }).join('');

        return `<div class="ch-bars${many ? ' ch-bars--many' : ''}" style="--c:${color}">
            <div class="ch-bars__y">${ticks.map(t => `<span>${t.toLocaleString('bg-BG', { maximumFractionDigits: 1 })}</span>`).join('')}</div>
            <div class="ch-bars__plot">
                <div class="ch-bars__grid"><i></i><i></i><i></i></div>
                <div class="ch-bars__cols">${cols}</div>
            </div>
        </div>`;
    }

    // Хоризонтални ленти (класация): data = [{label, value}]
    function hbars(data, opts) {
        const o = opts || {};
        if (!data.length) return `<p class="hint">Няма данни.</p>`;
        const unit = o.unit == null ? '€' : o.unit;
        const max = Math.max(1, ...data.map(d => d.value));
        const total = data.reduce((s, d) => s + d.value, 0) || 1;
        return `<div class="ch-hb">${data.map((d, i) => `
            <div class="ch-hb__row">
                <div class="ch-hb__top">
                    <span class="ch-hb__n">${i + 1}</span>
                    <span class="ch-hb__lbl" title="${esc(d.label)}">${esc(d.label)}</span>
                    <b class="ch-hb__v">${money(d.value)}${unit ? ' ' + unit : ''}</b>
                    <span class="ch-hb__p">${Math.round(d.value / total * 100)}%</span>
                </div>
                <div class="ch-hb__track"><div class="ch-hb__fill" style="width:${(d.value / max * 100).toFixed(1)}%;background:${o.color || C[i % C.length]}"></div></div>
            </div>`).join('')}</div>`;
    }

    // Поничка + легенда: data = [{label, value}]
    function doughnut(data) {
        const items = data.filter(d => d.value > 0);
        const total = items.reduce((s, d) => s + d.value, 0) || 1;
        const cx = 110, cy = 110, r = 95, ri = 60;
        let a0 = -Math.PI / 2, paths = '';
        items.forEach((d, i) => {
            let a1 = a0 + (d.value / total) * Math.PI * 2;
            if (items.length === 1) a1 = a0 + Math.PI * 1.9999;
            const large = (a1 - a0) > Math.PI ? 1 : 0;
            const p = (ang, rad) => [(cx + rad * Math.cos(ang)).toFixed(2), (cy + rad * Math.sin(ang)).toFixed(2)];
            const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [xi1, yi1] = p(a1, ri), [xi0, yi0] = p(a0, ri);
            paths += `<path d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ri} ${ri} 0 ${large} 0 ${xi0} ${yi0} Z" fill="${C[i % C.length]}"/>`;
            a0 = a1;
        });
        const legend = items.map((d, i) => {
            const pct = Math.round(d.value / total * 100);
            return `<div style="display:flex;align-items:center;gap:.55rem;font-size:.95rem;margin-bottom:.5rem">
                <span style="width:14px;height:14px;border-radius:4px;background:${C[i % C.length]};display:inline-block;flex:none"></span>
                <span style="flex:1">${esc(d.label)}</span>
                <b>${money(d.value)} €</b><span class="hint">· ${pct}%</span>
            </div>`;
        }).join('');
        return `<div style="display:flex;gap:1.8rem;align-items:center;flex-wrap:wrap">
            <svg viewBox="0 0 220 220" width="220" height="220" style="flex:none;max-width:100%">${paths}
                <text x="110" y="104" text-anchor="middle" font-size="14" fill="#9A8B7E">Общо</text>
                <text x="110" y="126" text-anchor="middle" font-size="19" font-weight="700" fill="#7D6B5F">${money(total)} €</text>
            </svg>
            <div style="flex:1;min-width:230px">${legend}</div>
        </div>`;
    }

    return { bars, hbars, doughnut, colors: C };
})();

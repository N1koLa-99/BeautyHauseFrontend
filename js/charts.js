/* =====================================================================
   Леки диаграми с вградено SVG (без външни библиотеки).
   Charts.bars / Charts.hbars / Charts.doughnut връщат готов HTML.
   Големи и четими; при нужда се скролват настрани САМО самите диаграми.
   ===================================================================== */
window.Charts = (function () {
    const C = ['#E29A93', '#C7A16B', '#B98BA0', '#CE7A78', '#E7CFA6', '#8FB0A0', '#9A878C'];
    const money = v => Math.round(v || 0).toLocaleString('bg-BG');
    const esc = window.esc || (s => String(s ?? ''));

    // Обвивка: диаграмата пази естествения си размер и се скролва вътрешно.
    const scrollWrap = (svg) =>
        `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;padding-bottom:.35rem">${svg}</div>`;

    // Вертикални стълбове: data = [{label, value}]
    function bars(data, opts) {
        const o = opts || {};
        const color = o.color || '#E29A93';
        const h = o.height || 250;
        const n = Math.max(1, data.length);
        const w = Math.max(360, n * 58);
        const step = (w - 24) / n;
        const bw = Math.min(40, step - 14);
        const max = Math.max(1, ...data.map(d => d.value));
        const body = data.map((d, i) => {
            const x = 12 + i * step + (step - bw) / 2;
            const bh = (h - 58) * (d.value / max);
            const y = h - 32 - bh;
            return `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(0, bh).toFixed(1)}" rx="6" fill="${color}"/>
                <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="#6A585D">${d.value ? money(d.value) : ''}</text>
                <text x="${(x + bw / 2).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="12" fill="#9A878C">${esc(d.label)}</text>`;
        }).join('');
        return scrollWrap(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;min-width:${w}px">${body}</svg>`);
    }

    // Хоризонтални барове: data = [{label, value}]
    function hbars(data) {
        if (!data.length) return `<p class="hint">Няма данни.</p>`;
        const w = 560, rowH = 42, lblW = 180, h = data.length * rowH + 6;
        const max = Math.max(1, ...data.map(d => d.value));
        const body = data.map((d, i) => {
            const y = i * rowH + 6;
            const bw = (w - lblW - 86) * (d.value / max);
            return `
                <text x="0" y="${y + 20}" font-size="13" font-weight="500" fill="#3C2F33">${esc(d.label)}</text>
                <rect x="${lblW}" y="${y + 7}" width="${bw.toFixed(1)}" height="20" rx="10" fill="${C[i % C.length]}"/>
                <text x="${(lblW + bw + 8).toFixed(1)}" y="${y + 21}" font-size="12" font-weight="600" fill="#6A585D">${money(d.value)} €</text>`;
        }).join('');
        return scrollWrap(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;min-width:${w}px">${body}</svg>`);
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
            <svg viewBox="0 0 220 220" width="220" height="220" style="flex:none">${paths}
                <text x="110" y="104" text-anchor="middle" font-size="14" fill="#9A878C">Общо</text>
                <text x="110" y="126" text-anchor="middle" font-size="19" font-weight="700" fill="#CE7A78">${money(total)} €</text>
            </svg>
            <div style="flex:1;min-width:230px">${legend}</div>
        </div>`;
    }

    return { bars, hbars, doughnut, colors: C };
})();

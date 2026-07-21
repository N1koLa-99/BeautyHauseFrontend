/* =====================================================================
   Леки диаграми с вградено SVG (без външни библиотеки).
   Charts.bars / Charts.hbars / Charts.doughnut връщат готов HTML.
   ===================================================================== */
window.Charts = (function () {
    const C = ['#E29A93', '#C7A16B', '#B98BA0', '#CE7A78', '#E7CFA6', '#8FB0A0', '#9A878C'];
    const money = v => Math.round(v || 0).toLocaleString('bg-BG');
    const esc = window.esc || (s => String(s ?? ''));

    // Вертикални стълбове: data = [{label, value}]
    function bars(data, opts) {
        const o = opts || {};
        const color = o.color || '#E29A93';
        const h = o.height || 190;
        const n = Math.max(1, data.length);
        const w = Math.max(320, n * 46);
        const step = (w - 20) / n;
        const bw = Math.min(32, step - 12);
        const max = Math.max(1, ...data.map(d => d.value));
        const body = data.map((d, i) => {
            const x = 10 + i * step + (step - bw) / 2;
            const bh = (h - 46) * (d.value / max);
            const y = h - 26 - bh;
            return `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(0, bh).toFixed(1)}" rx="5" fill="${color}"/>
                <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#6A585D">${d.value ? money(d.value) : ''}</text>
                <text x="${(x + bw / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#9A878C">${esc(d.label)}</text>`;
        }).join('');
        return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%;min-width:${Math.min(w, 520)}px">${body}</svg></div>`;
    }

    // Хоризонтални барове: data = [{label, value}]
    function hbars(data) {
        if (!data.length) return `<p class="hint">Няма данни.</p>`;
        const w = 380, rowH = 32, lblW = 150, h = data.length * rowH + 4;
        const max = Math.max(1, ...data.map(d => d.value));
        const body = data.map((d, i) => {
            const y = i * rowH + 4;
            const bw = (w - lblW - 60) * (d.value / max);
            return `
                <text x="0" y="${y + 15}" font-size="11" fill="#3C2F33">${esc(d.label)}</text>
                <rect x="${lblW}" y="${y + 4}" width="${bw.toFixed(1)}" height="15" rx="7" fill="${C[i % C.length]}"/>
                <text x="${(lblW + bw + 6).toFixed(1)}" y="${y + 16}" font-size="10" fill="#6A585D">${money(d.value)} €</text>`;
        }).join('');
        return `<div style="overflow-x:auto"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="max-width:100%">${body}</svg></div>`;
    }

    // Поничка + легенда: data = [{label, value}]
    function doughnut(data) {
        const items = data.filter(d => d.value > 0);
        const total = items.reduce((s, d) => s + d.value, 0) || 1;
        const cx = 90, cy = 90, r = 78, ri = 48;
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
            return `<div style="display:flex;align-items:center;gap:.5rem;font-size:.88rem;margin-bottom:.4rem">
                <span style="width:12px;height:12px;border-radius:3px;background:${C[i % C.length]};display:inline-block;flex:none"></span>
                <span style="flex:1">${esc(d.label)}</span>
                <b>${money(d.value)} €</b><span class="hint">· ${pct}%</span>
            </div>`;
        }).join('');
        return `<div style="display:flex;gap:1.6rem;align-items:center;flex-wrap:wrap">
            <svg viewBox="0 0 180 180" width="180" height="180" style="flex:none">${paths}
                <text x="90" y="86" text-anchor="middle" font-size="12" fill="#9A878C">Общо</text>
                <text x="90" y="104" text-anchor="middle" font-size="15" font-weight="700" fill="#CE7A78">${money(total)} €</text>
            </svg>
            <div style="flex:1;min-width:200px">${legend}</div>
        </div>`;
    }

    return { bars, hbars, doughnut, colors: C };
})();

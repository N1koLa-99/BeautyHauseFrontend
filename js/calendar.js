/* =====================================================================
   Месечен календар за график на служител/шеф.
   Calendar.mount(container, cfg):
     cfg.editable     – true => може ръчно добавяне на час + маркиране
     cfg.staffId      – id-то на служителя (за свободни часове)
     cfg.services     – [{serviceId, serviceName, durationMinutes}] (за формата)
     cfg.fetchMonth(fromStr, toStr) -> Promise<bookings[]>
     cfg.createBooking(dto) -> Promise            (ако editable)
     cfg.setStatus(id, status) -> Promise         (ако editable)
   ===================================================================== */
window.Calendar = (function () {
    const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    const MON = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
        'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
    const STATUS = {
        booked:    { label: 'Запазен',   cls: 'alert--info' },
        completed: { label: 'Проведен',  cls: 'alert--ok' },
        cancelled: { label: 'Отменен',   cls: 'alert--err' },
        no_show:   { label: 'Не се яви', cls: 'alert--err' }
    };
    const pad = n => String(n).padStart(2, '0');
    const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
    const esc = window.esc || (s => String(s ?? ''));
    const minToHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    const hhmmToMin = v => { const p = (v || '').split(':'); return p.length < 2 ? null : (+p[0]) * 60 + (+p[1]); };
    const addMinIso = (iso, mins) => { const d = new Date(iso); d.setMinutes(d.getMinutes() + mins); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`; };
    const WDNAMES = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
    // 24-часови опции за час (стъпка 30 мин) — гарантира 24ч формат навсякъде.
    const timeOptions = (selected) => {
        let o = '';
        for (let m = 0; m < 24 * 60; m += 30) {
            const v = minToHHMM(m);
            o += `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`;
        }
        return o;
    };
    // Стабилен цвят за всеки специалист (по id).
    const EMP_COLORS = ['#E29A93', '#C7A16B', '#B98BA0', '#8FB0A0', '#7BA7C7', '#CE7A78'];
    const empColor = id => EMP_COLORS[Math.abs(+id || 0) % EMP_COLORS.length];

    function mount(container, cfg) {
        const now = new Date();
        let y = now.getFullYear(), m = now.getMonth();
        let selKey = key(y, m, now.getDate());
        let data = {};            // 'YYYY-MM-DD' -> [bookings]
        let selBk = null;         // избран час в дневната времева решетка
        // Прагове за натовареност (Радина ги задава от Настройки; пазят се локално).
        const loadY = parseInt(localStorage.getItem('bh_load_yellow'), 10) || 10;
        const loadR = parseInt(localStorage.getItem('bh_load_red'), 10) || 15;

        container.innerHTML = `
            <div class="cal">
                <div class="cal__bar" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
                    <button class="btn btn--ghost cal-prev" style="--pad-y:.4rem;--pad-x:.9rem">‹</button>
                    <strong class="cal-title" style="font-family:var(--font-display);font-size:1.3rem"></strong>
                    <button class="btn btn--ghost cal-next" style="--pad-y:.4rem;--pad-x:.9rem">›</button>
                </div>
                <div class="cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--line)"></div>
                <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-top:.8rem;font-size:.75rem;color:var(--muted);align-items:center">
                    <span>Натовареност:</span>
                    <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#4E9E76;margin-right:.3rem;vertical-align:middle"></span>до ${loadY}</span>
                    <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#E7B100;margin-right:.3rem;vertical-align:middle"></span>над ${loadY}</span>
                    <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#D9534F;margin-right:.3rem;vertical-align:middle"></span>над ${loadR}</span>
                </div>
                <div class="cal-detail" style="margin-top:2.4rem;padding-top:1.8rem;border-top:1px solid var(--line)"></div>
            </div>`;

        const grid = container.querySelector('.cal-grid');
        const titleEl = container.querySelector('.cal-title');
        const detail = container.querySelector('.cal-detail');
        container.querySelector('.cal-prev').addEventListener('click', () => { shift(-1); });
        container.querySelector('.cal-next').addEventListener('click', () => { shift(1); });

        function shift(d) {
            m += d;
            if (m < 0) { m = 11; y--; }
            if (m > 11) { m = 0; y++; }
            load();
        }

        async function load() {
            titleEl.textContent = `${MON[m]} ${y}`;
            grid.innerHTML = `<div class="spinner" style="grid-column:1/-1"></div>`;
            const from = key(y, m, 1);
            const to = `${m === 11 ? y + 1 : y}-${pad((m + 1) % 12 + 1)}-01`;
            try {
                const items = await cfg.fetchMonth(from, to);
                data = {};
                (items || []).forEach(b => {
                    const k = b.startAt.slice(0, 10);
                    (data[k] = data[k] || []).push(b);
                });
                paint();
            } catch (err) {
                grid.innerHTML = `<div class="alert alert--err" style="grid-column:1/-1">${esc(err.message)}</div>`;
            }
        }

        function paint() {
            const first = new Date(y, m, 1);
            const offset = (first.getDay() + 6) % 7;     // понеделник-базиран
            const days = new Date(y, m + 1, 0).getDate();
            const todayK = key(now.getFullYear(), now.getMonth(), now.getDate());

            // Google Calendar стил: плътна решетка, номер горе (днес — в кръгче),
            // лента „N ч." с цвят по натоварването.
            let html = WD.map(d => `<div style="text-align:center;font-size:.72rem;font-weight:600;letter-spacing:.06em;color:var(--muted);padding:.55rem 0;background:var(--ivory)">${d}</div>`).join('');
            for (let i = 0; i < offset; i++) html += `<div style="background:var(--ivory);opacity:.55;min-height:92px"></div>`;
            for (let d = 1; d <= days; d++) {
                const k = key(y, m, d);
                const cnt = (data[k] || []).length;
                const isSel = k === selKey;
                const isToday = k === todayK;
                const loadColor = cnt > loadR ? '#D9534F' : (cnt > loadY ? '#E7B100' : '#4E9E76');
                const dayNum = isToday
                    ? `<span style="width:26px;height:26px;border-radius:50%;background:var(--rose-deep);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:.85rem">${d}</span>`
                    : `<span style="width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-weight:500;font-size:.88rem;color:var(--ink)">${d}</span>`;
                html += `
                    <button class="cal-day" data-k="${k}" style="
                        min-height:88px;border:0;cursor:pointer;
                        background:${isSel ? 'var(--blush-soft)' : 'var(--ivory)'};
                        ${isSel ? 'box-shadow:inset 0 0 0 1.5px var(--rose);' : ''}
                        display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:.34rem .32rem .4rem">
                        <span style="display:flex;justify-content:center">${dayNum}</span>
                        ${cnt ? `<span title="${cnt} часа" style="display:block;font-size:.72rem;font-weight:600;line-height:1;background:${loadColor}22;color:${loadColor};box-shadow:inset 0 0 0 1px ${loadColor}55;border-radius:99px;text-align:center;padding:.24rem .2rem">${cnt} ч.</span>` : ''}
                    </button>`;
            }
            const used = offset + days;
            const trail = (7 - (used % 7)) % 7;
            for (let i = 0; i < trail; i++) html += `<div style="background:var(--ivory);opacity:.55;min-height:92px"></div>`;
            grid.innerHTML = html;
            grid.querySelectorAll('.cal-day').forEach(el =>
                el.addEventListener('click', () => { selKey = el.dataset.k; selBk = null; paint(); }));
            renderDetail();
        }

        function renderDetail() {
            const list = (data[selKey] || []).slice().sort((a, b) => a.startAt.localeCompare(b.startAt));
            const [yy, mm, dd] = selKey.split('-');
            const heading = `${+dd} ${MON[+mm - 1]} ${yy}`;
            const isPastDay = selKey < key(now.getFullYear(), now.getMonth(), now.getDate());

            // Часови обхват на деня.
            let span = '';
            if (list.length) {
                const first = list[0].startAt.slice(11, 16);
                const last = list.map(b => (b.endAt || b.startAt).slice(11, 16)).sort().slice(-1)[0];
                span = `<span class="hint">${list.length} ${list.length === 1 ? 'час' : 'часа'} · ${first}–${last}</span>`;
            }

            // Легенда с цветовете на специалистите (изглед „Целият салон"),
            // в реда на колоните: Ирина · Радина · Анелия.
            let legend = '';
            if (cfg.showEmployee && list.length) {
                const ORDER_L = ['ирина', 'радина', 'анелия'];
                const rankL = name => {
                    const n = (name || '').toLowerCase();
                    const i = ORDER_L.findIndex(o => n.includes(o));
                    return i === -1 ? ORDER_L.length : i;
                };
                const seenArr = [];
                list.forEach(b => { if (!seenArr.some(e => e.id === b.employeeId)) seenArr.push({ id: b.employeeId, name: b.employeeName }); });
                seenArr.sort((a, b) => rankL(a.name) - rankL(b.name) || String(a.name).localeCompare(String(b.name), 'bg'));
                legend = `<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin:.1rem 0 1rem">` +
                    seenArr.map(e => `<span style="display:inline-flex;align-items:center;font-size:.8rem;font-weight:600;color:#fff;background:${empColor(e.id)};border-radius:99px;padding:.22rem .75rem">${esc(e.name)}</span>`).join('') +
                    `</div>`;
            }

            // Карта с детайли/действия за ЕДИН час (отваря се при докосване на блок).
            const bookingCardHtml = (b) => {
                const st = STATUS[b.status] || { label: b.status, cls: 'alert--info' };
                const phone = b.clientPhone ? ` · <a href="tel:${esc(b.clientPhone)}">${esc(b.clientPhone)}</a>` : '';
                const flagged = b.noShowCount > 0;           // повторен нарушител (по тел./профил)
                const noShow = b.status === 'no_show';       // този час е пропуснат
                const red = flagged || noShow;               // червен акцент
                const col = empColor(b.employeeId);
                const edge = red ? '#D9534F' : col;
                const bg = red ? '#D9534F1F' : `${col}26`;

                // Ясна червена лента отгоре — веднага личи и в общия график.
                const bannerStyle = 'display:flex;align-items:center;gap:.45rem;background:#D9534F;color:#fff;font-weight:800;font-size:.74rem;letter-spacing:.02em;padding:.34rem .7rem';
                const banner = flagged
                    ? `<div style="${bannerStyle}"><span style="font-size:1.05rem;line-height:1">⚠</span> СЪМНИТЕЛЕН КЛИЕНТ · ${b.noShowCount}× не се е явявал(а)</div>`
                    : (noShow
                        ? `<div style="${bannerStyle}"><span style="font-size:1.05rem;line-height:1">⚠</span> НЕ СЕ ЯВИ</div>`
                        : '');
                const nameHtml = red
                    ? `<b style="color:#B02A26">${esc(b.clientName || 'Клиент')}</b>`
                    : esc(b.clientName || 'Клиент');
                // Статусът „Не се яви" — плътно червено, за да се забелязва лесно.
                const statusPill = noShow
                    ? `<span style="background:#D9534F;color:#fff;border-radius:99px;padding:.25rem .6rem;font-size:.72rem;font-weight:700;white-space:nowrap">Не се яви</span>`
                    : `<span class="alert ${st.cls}" style="padding:.25rem .55rem;font-size:.72rem;white-space:nowrap">${st.label}</span>`;

                // Действия според статуса (вкл. поправка при грешка).
                let actions = '';
                if (cfg.editable) {
                    if (b.status === 'booked')
                        actions = `
                        <button class="btn btn--gold cal-set" data-id="${b.id}" data-st="completed" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Проведен</button>
                        <button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="no_show" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Не се яви</button>`;
                    else if (b.status === 'no_show')
                        actions = `<button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="completed" title="Поправи: клиентът всъщност дойде" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">↩ Явил се</button>`;
                    else if (b.status === 'completed')
                        actions = `<button class="btn btn--ghost cal-set" data-id="${b.id}" data-st="no_show" title="Отбележи като неявил се" style="--pad-y:.35rem;--pad-x:.7rem;font-size:.76rem">Не се яви</button>`;
                }
                return `
                <div style="border-radius:12px;overflow:hidden;${red ? 'box-shadow:0 0 0 2px #D9534F' : ''}">
                    ${banner}
                    <div class="card" style="display:flex;flex-wrap:wrap;align-items:center;gap:.45rem .7rem;padding:.65rem .85rem;border-left:7px solid ${edge};background:${bg};border-radius:0">
                        <div style="font-weight:700;font-variant-numeric:tabular-nums;min-width:42px">${b.startAt.slice(11, 16)}</div>
                        <div style="flex:1 1 55%;min-width:130px">
                            <strong style="line-height:1.25">${esc(b.serviceName)}</strong>${cfg.showEmployee ? ` <span style="background:${col};color:#fff;border-radius:99px;padding:.08rem .55rem;font-size:.72rem;font-weight:600;white-space:nowrap">${esc(b.employeeName)}</span>` : ''}
                            <div class="hint" style="margin-top:.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nameHtml}${phone} · ${(b.priceSnapshot || 0).toFixed(0)} €</div>
                        </div>
                        <div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin-left:auto">
                            ${statusPill}
                            ${actions}
                        </div>
                    </div>
                </div>`;
            };

            // ---- Дневна времева решетка (Google стил, оптимизирана) ----
            const toMin = iso => (+iso.slice(11, 13)) * 60 + (+iso.slice(14, 16));
            let tlHtml = `<p class="hint">Няма часове за този ден.</p>`;
            if (list.length) {
                // Диапазон: само около реалните часове (компактно, без празни часове).
                let tStart = Math.min(...list.map(b => toMin(b.startAt)));
                let tEnd = Math.max(...list.map(b => b.endAt ? toMin(b.endAt) : toMin(b.startAt) + 30));
                tStart = Math.floor(tStart / 60) * 60;
                tEnd = Math.ceil(tEnd / 60) * 60;
                const PX = 1.8;                    // 108px на час — едро и четимо
                const GUT = 46;                    // колона за етикетите на часовете
                const LANE_MIN = 185;              // мин. ширина на колона — целият текст се вижда (скролва се настрани при нужда)
                const H = (tEnd - tStart) * PX;

                // Колони: в изглед „Целият салон" всяка специалистка има СВОЯ колона
                // (като Google с няколко календара); иначе — по застъпване.
                let laneOf = [], lanes = 1;
                if (cfg.showEmployee) {
                    // Фиксиран ред на колоните: Ирина · Радина · Анелия (после други).
                    const ORDER = ['ирина', 'радина', 'анелия'];
                    const rank = name => {
                        const n = (name || '').toLowerCase();
                        const i = ORDER.findIndex(o => n.includes(o));
                        return i === -1 ? ORDER.length : i;
                    };
                    const emps = [];
                    list.forEach(b => { if (!emps.some(e => e.id === b.employeeId)) emps.push({ id: b.employeeId, name: b.employeeName }); });
                    emps.sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name), 'bg'));
                    const empLane = {};
                    emps.forEach((e, i) => empLane[e.id] = i);
                    laneOf = list.map(b => empLane[b.employeeId]);
                    lanes = Math.max(1, emps.length);
                } else {
                    const laneEnd = [];
                    list.forEach((b, i) => {
                        const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30;
                        let l = laneEnd.findIndex(x => x <= s);
                        if (l === -1) { l = laneEnd.length; laneEnd.push(e); }
                        else laneEnd[l] = e;
                        laneOf[i] = l;
                    });
                    lanes = Math.max(1, laneEnd.length);
                }

                // Линии на всеки 15 мин (час — плътна, :30 — по-тъмен пунктир,
                // :15/:45 — лек пунктир) + етикети за час и половин час.
                let gridLines = '', gutLabels = '';
                for (let mm = tStart; mm <= tEnd; mm += 15) {
                    const top = (mm - tStart) * PX;
                    const isHour = mm % 60 === 0;
                    const isHalf = mm % 30 === 0 && !isHour;
                    const lineStyle = isHour ? 'solid var(--line)' : (isHalf ? 'dashed rgba(0,0,0,.10)' : 'dashed rgba(0,0,0,.05)');
                    gridLines += `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;border-top:1px ${lineStyle}"></div>`;
                    if (isHour)
                        gutLabels += `<span style="position:absolute;left:0;top:${(top - 8).toFixed(0)}px;font-size:.74rem;font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums">${minToHHMM(mm)}</span>`;
                    else if (isHalf)
                        gutLabels += `<span style="position:absolute;left:0;top:${(top - 7).toFixed(0)}px;font-size:.64rem;font-weight:500;color:var(--muted);opacity:.65;font-variant-numeric:tabular-nums">${minToHHMM(mm)}</span>`;
                }

                // Червена линия „сега" (само за днешния ден, в диапазона).
                let nowLine = '', nowDot = '';
                const nowD = new Date();
                if (selKey === key(nowD.getFullYear(), nowD.getMonth(), nowD.getDate())) {
                    const nm = nowD.getHours() * 60 + nowD.getMinutes();
                    if (nm >= tStart && nm <= tEnd) {
                        const top = (nm - tStart) * PX;
                        nowLine = `<div style="position:absolute;left:0;right:0;top:${top.toFixed(0)}px;border-top:2px solid #EA4335;z-index:3;pointer-events:none"></div>`;
                        nowDot = `<span style="position:absolute;right:-5px;top:${(top - 5).toFixed(0)}px;width:10px;height:10px;border-radius:50%;background:#EA4335;z-index:3"></span>`;
                    }
                }

                // Блокове — с достатъчно място за текста (2 реда услуга).
                const blocks = list.map((b, i) => {
                    const s = toMin(b.startAt), e = b.endAt ? toMin(b.endAt) : s + 30;
                    const top = (s - tStart) * PX;
                    const h = Math.max(34, (e - s) * PX - 3);
                    const col = empColor(b.employeeId);
                    const isNoShow = b.status === 'no_show';
                    const isFlagged = b.noShowCount > 0;
                    const bgc = isNoShow ? '#D9534F' : col;
                    const wPct = 100 / lanes, leftPct = laneOf[i] * wPct;
                    const mark = isFlagged ? ' ⚠' : (b.status === 'completed' ? ' ✓' : '');
                    const small = h < 50; // кратка услуга -> компактен едноредов изглед
                    const inner = small
                        ? `<div style="font-size:.72rem;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                               <span style="font-weight:800">${b.startAt.slice(11, 16)}</span>${mark} · ${esc(b.serviceName)}
                           </div>`
                        : `<div style="font-size:.72rem;font-weight:800;opacity:.95;line-height:1;white-space:nowrap">${b.startAt.slice(11, 16)}–${(b.endAt || '').slice(11, 16)}${mark}</div>
                           <div style="font-size:.82rem;font-weight:700;line-height:1.18;margin-top:.16rem;display:-webkit-box;-webkit-line-clamp:${h >= 68 ? 2 : 1};-webkit-box-orient:vertical;overflow:hidden">${esc(b.serviceName)}</div>
                           ${h >= 84 ? `<div style="font-size:.73rem;opacity:.92;margin-top:.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.clientName || 'Клиент')}</div>` : ''}`;
                    return `
                    <button class="tl-bk" data-id="${b.id}" style="position:absolute;top:${top.toFixed(0)}px;height:${h.toFixed(0)}px;
                        left:calc(${leftPct}% + 2px);width:calc(${wPct}% - 5px);
                        background:${bgc};${b.status === 'completed' ? 'opacity:.8;' : ''}border:0;border-radius:${small ? 8 : 11}px;color:#fff;
                        text-align:left;cursor:pointer;padding:${small ? '.15rem .5rem' : '.42rem .55rem'};overflow:hidden;
                        ${small ? 'display:flex;align-items:center;' : ''}
                        box-shadow:0 2px 8px rgba(0,0,0,.16);${selBk === b.id ? 'outline:2.5px solid var(--ink);outline-offset:1px;z-index:2;' : ''}">
                        ${small ? `<div style="min-width:0">${inner}</div>` : inner}
                    </button>`;
                }).join('');

                // Фиксирана часова колона + скрол само върху лентата с часовете.
                // Вертикалните жестове винаги скролват страницата (touch-action: pan-y
                // не се слага — pan-x в скрол зоната позволява настрани, а вертикално минава към страницата).
                tlHtml = `
                    <div style="display:flex;margin-top:.6rem">
                        <div style="flex:0 0 ${GUT}px;position:relative;height:${(H + 10).toFixed(0)}px">
                            ${gutLabels}
                            ${nowDot}
                        </div>
                        <div class="tl-wrap" style="flex:1;min-width:0;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch">
                            <div style="position:relative;height:${(H + 10).toFixed(0)}px;min-width:${(lanes * LANE_MIN)}px">
                                ${gridLines}
                                ${nowLine}
                                <div style="position:absolute;left:2px;right:2px;top:0;bottom:10px">${blocks}</div>
                            </div>
                        </div>
                    </div>`;
            }

            const selBooking = list.find(b => b.id === selBk);
            const selCard = selBooking
                ? `<div style="margin-top:1rem">${bookingCardHtml(selBooking)}</div>`
                : '';

            const addBtn = (cfg.editable && !isPastDay)
                ? `<button class="btn btn--primary cal-add" style="--pad-y:.55rem;--pad-x:1.1rem;font-size:.88rem;margin-top:1rem">+ Добави час</button>
                   <div class="cal-form"></div>`
                : '';

            const schedHtml = (cfg.editable && cfg.staffId)
                ? `<div class="panel sched-panel" style="margin-top:1.2rem"><div class="spinner"></div></div>`
                : '';

            detail.innerHTML = `
                <div style="display:flex;align-items:baseline;gap:.8rem;flex-wrap:wrap;margin:0 0 .3rem"><h3 style="margin:0">${heading}</h3>${span}</div>
                ${legend}
                ${tlHtml}
                <div class="tl-sel">${selCard}</div>
                ${addBtn}
                ${schedHtml}`;

            // Докосване на блок -> показва картата с детайли и действия.
            detail.querySelectorAll('.tl-bk').forEach(btn =>
                btn.addEventListener('click', () => {
                    selBk = +btn.dataset.id;
                    renderDetail();
                    const sel = detail.querySelector('.tl-sel');
                    if (sel) sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }));

            detail.querySelectorAll('.cal-set').forEach(btn =>
                btn.addEventListener('click', () => act(btn, () => cfg.setStatus(btn.dataset.id, btn.dataset.st))));
            const add = detail.querySelector('.cal-add');
            if (add) add.addEventListener('click', () => renderForm(detail.querySelector('.cal-form')));

            const sched = detail.querySelector('.sched-panel');
            if (sched) loadSchedule(sched, selKey);
        }

        async function act(btn, fn) {
            btn.disabled = true; btn.style.opacity = .7;
            try { await fn(); await load(); }
            catch (err) { alert(err.message); btn.disabled = false; btn.style.opacity = 1; }
        }

        function renderForm(box) {
            if (!box) return;
            if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = '0'; return; }
            box.dataset.open = '1';
            const svcOpts = (cfg.services || [])
                .map(s => `<option value="${s.serviceId}">${esc(s.serviceName)} · ${s.durationMinutes} мин</option>`).join('');
            box.innerHTML = `
                <div class="panel" style="margin-top:1rem;display:grid;gap:.9rem">
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Услуга</span>
                        <select class="select f-svc">${svcOpts || '<option value="">Нямаш зададени услуги</option>'}</select>
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Свободен час</span>
                        <select class="select f-slot"><option value="">Избери услуга…</option></select>
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Име на клиента</span>
                        <input class="input f-name" type="text" placeholder="напр. Мария (по телефон)">
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Телефон (по избор)</span>
                        <input class="input f-phone" type="tel" placeholder="+359…">
                    </label>
                    <label class="field" style="margin:0">
                        <span style="display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.4rem">Бележка (по избор)</span>
                        <input class="input f-note" type="text">
                    </label>
                    <button class="btn btn--primary f-save" style="justify-self:start">Запиши часа</button>
                    <div class="f-msg"></div>
                </div>`;

            const svc = box.querySelector('.f-svc');
            const slot = box.querySelector('.f-slot');
            const msg = box.querySelector('.f-msg');

            async function loadSlots() {
                const sid = svc.value;
                if (!sid) { slot.innerHTML = `<option value="">—</option>`; return; }
                slot.innerHTML = `<option value="">Зареждане…</option>`;
                try {
                    const times = await window.API.get(`/availability?employeeId=${cfg.staffId}&serviceId=${sid}&date=${selKey}`);
                    slot.innerHTML = (times && times.length)
                        ? times.map(t => `<option value="${t}">${t.slice(11, 16)}</option>`).join('')
                        : `<option value="">Няма свободни часове</option>`;
                } catch (err) {
                    slot.innerHTML = `<option value="">Грешка</option>`;
                }
            }
            svc.addEventListener('change', loadSlots);
            loadSlots();

            box.querySelector('.f-save').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const dto = {
                    serviceId: +svc.value,
                    startAt: slot.value,
                    guestName: box.querySelector('.f-name').value.trim(),
                    guestPhone: box.querySelector('.f-phone').value.trim() || null,
                    note: box.querySelector('.f-note').value.trim() || null
                };
                if (!dto.serviceId || !dto.startAt) { msg.innerHTML = `<div class="alert alert--err">Избери услуга и свободен час.</div>`; return; }
                if (!dto.guestName) { msg.innerHTML = `<div class="alert alert--err">Въведи име на клиента.</div>`; return; }
                btn.disabled = true; btn.style.opacity = .7;
                try {
                    await cfg.createBooking(dto);
                    await load();
                } catch (err) {
                    msg.innerHTML = `<div class="alert alert--err">${esc(err.message)}</div>`;
                    btn.disabled = false; btn.style.opacity = 1;
                }
            });
        }

        function reloadAll() { load(); }

        // Панел „Работно време" за избрания ден: ефективни часове + свободни
        // слотове (клик = блокирай) + блокирани (клик = освободи) + промяна.
        async function loadSchedule(box, dayKey) {
            box.innerHTML = `<div class="spinner"></div>`;
            let info;
            try {
                info = await window.API.get(`/schedule/day?employeeId=${cfg.staffId}&date=${dayKey}`);
            } catch (err) {
                box.innerHTML = `<div class="hint">Работното време е недостъпно (${esc(err.message)}).</div>`;
                return;
            }
            const wd = new Date(dayKey + 'T00:00:00').getDay();
            const hoursText = info.isOff ? 'Почивен ден' : `${minToHHMM(info.startMin)} – ${minToHHMM(info.endMin)}`;

            const chip = 'display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.28rem .7rem;font-size:.8rem;cursor:pointer;border:1px solid var(--line);background:var(--ivory)';
            const chipBlk = 'display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.28rem .7rem;font-size:.8rem;cursor:pointer;border:1px solid transparent;background:var(--grad-rose);color:#fff';

            const free = (info.freeSlots || []).map(s =>
                `<button class="sc-block" data-t="${s}" title="Блокирай (почивка)" style="${chip}">${s.slice(11, 16)} ✕</button>`
            ).join('') || '<span class="hint">Няма свободни слотове.</span>';

            const blocks = (info.blocks || []).map(b =>
                `<button class="sc-unblock" data-id="${b.id}" title="Освободи" style="${chipBlk}">${b.startAt.slice(11, 16)} ↺</button>`
            ).join('');

            box.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
                    <strong>Работно време: <span style="color:var(--rose-deep)">${hoursText}</span></strong>
                    <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                        <button class="btn btn--ghost sc-edit" style="--pad-y:.4rem;--pad-x:.8rem;font-size:.8rem">Промени часове</button>
                        <button class="btn btn--ghost sc-off" style="--pad-y:.4rem;--pad-x:.8rem;font-size:.8rem">${info.isOff ? 'Направи работен' : 'Почивен ден'}</button>
                    </div>
                </div>
                <div class="sc-form"></div>
                ${info.isOff ? '' : `
                <div style="margin-top:.9rem">
                    <div class="hint" style="margin-bottom:.4rem">Свободни слотове:</div>
                    <div style="display:flex;flex-wrap:wrap;gap:.4rem">${free}</div>
                    ${blocks ? `<div class="hint" style="margin:.8rem 0 .4rem">Почивки:</div><div style="display:flex;flex-wrap:wrap;gap:.4rem">${blocks}</div>` : ''}
                </div>`}`;

            box.querySelector('.sc-off').addEventListener('click', async () => {
                try {
                    if (info.isOff) await window.API.del(`/schedule/override?employeeId=${cfg.staffId}&date=${dayKey}`);
                    else await window.API.put('/schedule/override', { employeeId: cfg.staffId, date: dayKey, isOff: true });
                    reloadAll();
                } catch (err) { alert(err.message); }
            });
            box.querySelector('.sc-edit').addEventListener('click', () => schedForm(box.querySelector('.sc-form'), info, dayKey, wd));
            box.querySelectorAll('.sc-block').forEach(btn => btn.addEventListener('click', async () => {
                try {
                    await window.API.post('/schedule/block', { employeeId: cfg.staffId, startAt: btn.dataset.t, endAt: addMinIso(btn.dataset.t, 30) });
                    reloadAll();
                } catch (err) { alert(err.message); }
            }));
            box.querySelectorAll('.sc-unblock').forEach(btn => btn.addEventListener('click', async () => {
                try { await window.API.del(`/schedule/block/${btn.dataset.id}?employeeId=${cfg.staffId}`); reloadAll(); }
                catch (err) { alert(err.message); }
            }));
        }

        function schedForm(box, info, dayKey, wd) {
            if (box.dataset.open === '1') { box.innerHTML = ''; box.dataset.open = '0'; return; }
            box.dataset.open = '1';
            const from = info.isOff ? '09:00' : minToHHMM(info.startMin);
            const to = info.isOff ? '18:00' : minToHHMM(info.endMin);
            const lbl = 'display:block;font-size:.82rem;font-weight:600;color:var(--ink-soft);margin-bottom:.35rem';
            box.innerHTML = `
                <div class="panel" style="margin-top:.8rem;display:grid;gap:.7rem;max-width:360px">
                    <label class="field" style="margin:0"><span style="${lbl}">От</span><select class="select sc-from">${timeOptions(from)}</select></label>
                    <label class="field" style="margin:0"><span style="${lbl}">До</span><select class="select sc-to">${timeOptions(to)}</select></label>
                    <label class="field" style="margin:0"><span style="${lbl}">Приложи за</span>
                        <select class="select sc-scope">
                            <option value="day">Само този ден</option>
                            <option value="week">Всеки ${WDNAMES[wd]} нататък</option>
                        </select>
                    </label>
                    <button class="btn btn--primary sc-save" style="justify-self:start">Запази</button>
                </div>`;
            box.querySelector('.sc-save').addEventListener('click', async () => {
                const sm = hhmmToMin(box.querySelector('.sc-from').value);
                const em = hhmmToMin(box.querySelector('.sc-to').value);
                if (sm == null || em == null || em <= sm) { alert('Невалидни часове (краят трябва да е след началото).'); return; }
                const scope = box.querySelector('.sc-scope').value;
                try {
                    if (scope === 'day')
                        await window.API.put('/schedule/override', { employeeId: cfg.staffId, date: dayKey, startMin: sm, endMin: em, isOff: false });
                    else
                        await window.API.put('/schedule/hours', { employeeId: cfg.staffId, days: [{ weekday: wd, startMin: sm, endMin: em, isOff: false }] });
                    reloadAll();
                } catch (err) { alert(err.message); }
            });
        }

        load();
    }

    return { mount };
})();

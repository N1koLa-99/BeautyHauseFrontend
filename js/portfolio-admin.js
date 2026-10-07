/* =====================================================================
   Портфолио — управление (account.html):
     PortfolioAdmin.mountManager(box, { employeeId, employeeName })
         качване (галерия/камера, няколко наведнъж, прогрес) + преглед по
         процедура + изтриване с потвърждение. Служител -> своето; шеф -> всяко.
         Правата се проверяват и на сървъра.
     PortfolioAdmin.mountReviews(box)
         модерация на отзивите (само шеф): скрий / покажи / изтрий.
   ===================================================================== */
window.PortfolioAdmin = (function () {
    const E = window.esc || (s => String(s ?? ''));
    const I = (n, size) => Icon(n, { size: size || 18 });
    const MAX_BYTES = 10 * 1024 * 1024;
    const MAX_QUEUE = 20;
    const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    const EXT_OK = /\.(jpe?g|png|webp)$/i;
    const LAST_SRV = id => 'bh_pf_last_srv_' + id;

    const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

    // ---- Качване на една снимка (XHR — за да има прогрес) ----
    function uploadOne(empId, serviceId, caption, file, onProgress) {
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('serviceId', String(serviceId));
            if (caption) fd.append('caption', caption);
            fd.append('files', file, file.name || 'snimka.jpg');

            const xhr = new XMLHttpRequest();
            xhr.open('POST', BH_CONFIG.API_BASE + '/portfolio/employee/' + encodeURIComponent(empId));
            const t = localStorage.getItem('bh_token');
            if (t) xhr.setRequestHeader('Authorization', 'Bearer ' + t);
            xhr.timeout = 180000;
            xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
            xhr.onload = () => {
                let data = null;
                try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { }
                if (xhr.status === 401) {
                    try { Session.clear(); } catch (e) { }
                    if (Session.goLogin) Session.goLogin({ expired: true });
                    return reject(Object.assign(new Error('Сесията изтече. Влез отново.'), { fatal: true }));
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (data && data.failed && data.failed.length && !(data.added && data.added.length))
                        return reject(new Error(data.failed[0].error));
                    return resolve((data && data.added) || []);
                }
                if (xhr.status === 413) return reject(new Error('Снимката е твърде голяма за сървъра.'));
                reject(Object.assign(new Error((data && data.error) || ('Грешка (' + xhr.status + ')')), { fatal: xhr.status === 403 }));
            };
            xhr.onerror = () => reject(new Error('Няма връзка със сървъра. Провери интернета и опитай пак.'));
            xhr.ontimeout = () => reject(new Error('Качването отне твърде дълго. Опитай пак.'));
            xhr.send(fd);
        });
    }

    // ===============================================================
    //  Мениджър на портфолио за един служител
    // ===============================================================
    async function mountManager(box, o) {
        const empId = o.employeeId;
        box.innerHTML = `<div class="spinner"></div>`;

        let services = [], photos = [];
        try {
            [services, photos] = await Promise.all([
                API.get('/employees/' + empId + '/services'),
                API.get('/portfolio/manage/' + empId)
            ]);
            services = (services || []).slice().sort((a, b) => String(a.serviceName).localeCompare(String(b.serviceName), 'bg'));
            photos = photos || [];
        } catch (err) {
            box.innerHTML = `<div class="alert alert--err">${E(err.message)}</div>`;
            return;
        }

        let lastSrv = '';
        try { lastSrv = localStorage.getItem(LAST_SRV(empId)) || ''; } catch (e) { }
        if (!services.some(s => String(s.serviceId) === lastSrv)) lastSrv = '';

        box.innerHTML = `
            <div class="card pfm-up">
                <div class="pfm-up__head">${I('upload', 20)}<div><strong>Добави снимки</strong><div class="hint">Избери процедура и снимки — от галерията или директно с камерата.</div></div></div>
                ${services.length ? `
                <div class="pfm-row">
                    <div class="field">
                        <label>Процедура <span class="pfm-req">*</span></label>
                        <select class="input pfm-srv">
                            <option value="">Избери процедура…</option>
                            ${services.map(s => `<option value="${s.serviceId}"${String(s.serviceId) === lastSrv ? ' selected' : ''}>${E(s.serviceName)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field">
                        <label>Описание <span class="hint">(по избор)</span></label>
                        <input class="input pfm-cap" maxlength="300" placeholder="напр. Обемни мигли 3D">
                    </div>
                </div>
                <div class="pfm-pick">
                    <label class="btn btn--ghost pfm-pickbtn">${I('image', 17)} Избери снимки
                        <input type="file" class="pfm-file" accept="image/jpeg,image/png,image/webp" multiple hidden>
                    </label>
                    <label class="btn btn--ghost pfm-pickbtn pfm-cam">${I('camera', 17)} Снимай
                        <input type="file" class="pfm-file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden>
                    </label>
                </div>
                <p class="hint pfm-note">JPG, PNG или WebP · до 10 MB всяка · до ${MAX_QUEUE} наведнъж. Снимките се смаляват автоматично.</p>
                <div class="pfm-queue"></div>
                <div class="pfm-actions" hidden>
                    <button type="button" class="btn btn--primary pfm-send">${I('upload', 16)} <span>Качи</span></button>
                    <button type="button" class="btn btn--ghost pfm-clear">Изчисти</button>
                </div>
                <div class="pfm-msg"></div>` : `
                <div class="alert alert--info">${o.employeeName ? E(o.employeeName) + ' още няма' : 'Още нямаш'} зададени процедури — снимките се качват към конкретна процедура.</div>`}
            </div>
            <div class="pfm-list"></div>`;

        const listEl = box.querySelector('.pfm-list');
        let filter = 'all';

        // ---------- Списък с качените снимки ----------
        function paintList() {
            const bySrv = new Map();
            photos.forEach(p => {
                const k = p.serviceId || 0;
                if (!bySrv.has(k)) bySrv.set(k, { key: k, label: p.serviceName || 'Без процедура', n: 0 });
                bySrv.get(k).n++;
            });
            if (filter !== 'all' && !bySrv.has(filter)) filter = 'all';
            const chips = [{ key: 'all', label: 'Всички', n: photos.length }, ...[...bySrv.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), 'bg'))];
            const list = filter === 'all' ? photos : photos.filter(p => (p.serviceId || 0) === filter);

            listEl.innerHTML = `
                <div class="pfm-list__head"><strong>Качени снимки</strong> <span class="hint">${photos.length}</span></div>
                ${photos.length ? Portfolio.chipsHTML(chips, filter) : ''}
                ${list.length ? `<div class="pf-grid pfm-grid">${list.map((p, i) => `
                    <div class="pfm-tile" data-id="${p.id}">
                        <button type="button" class="pf-tile" data-i="${i}" aria-label="Отвори снимката">
                            <img src="${E(Portfolio.url(p.thumbnailUrl || p.imageUrl))}" alt="" loading="lazy" decoding="async">
                            <span class="pf-tile__cap">${E(p.serviceName || 'Без процедура')}</span>
                        </button>
                        <button type="button" class="pfm-del" data-id="${p.id}" aria-label="Изтрий снимката" title="Изтрий">${I('trash', 17)}</button>
                    </div>`).join('')}</div>`
                : Portfolio.emptyState('Още няма качени снимки. Добави първите отгоре.')}`;

            listEl.querySelectorAll('.pf-chip').forEach(c => c.addEventListener('click', () => {
                filter = c.dataset.k === 'all' ? 'all' : +c.dataset.k;
                paintList();
            }));
            Portfolio.bindGrid(listEl, list.map(p => Object.assign({}, p, { employeeName: o.employeeName || p.employeeName })));
            listEl.querySelectorAll('.pfm-del').forEach(b => b.addEventListener('click', () => removePhoto(+b.dataset.id, b)));
        }

        async function removePhoto(id, btn) {
            const ok = await confirmBox({
                title: 'Изтриване на снимка',
                text: 'Снимката ще изчезне от сайта (Екип, Услуги, Записване) и файлът ще бъде изтрит. Продължаваме ли?',
                ok: 'Изтрий', cancel: 'Отказ'
            });
            if (!ok) return;
            const tile = btn.closest('.pfm-tile');
            tile.classList.add('is-busy');
            try {
                await API.del('/portfolio/' + id);
                photos = photos.filter(p => p.id !== id);
                paintList();
                flash('Снимката е изтрита.', 'ok');
            } catch (err) {
                tile.classList.remove('is-busy');
                flash(err.message, 'err');
            }
        }

        // Съобщение над списъка (изчезва само).
        let flashTimer = 0;
        function flash(text, kind) {
            const m = box.querySelector('.pfm-msg') || listEl;
            let el = box.querySelector('.pfm-flash');
            if (!el) { el = document.createElement('div'); el.className = 'pfm-flash'; m.appendChild(el); }
            el.innerHTML = `<div class="alert alert--${kind === 'err' ? 'err' : 'ok'}">${E(text)}</div>`;
            clearTimeout(flashTimer);
            flashTimer = setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
        }

        paintList();
        if (!services.length) return;

        // ---------- Опашка за качване ----------
        const srvSel = box.querySelector('.pfm-srv');
        const capInp = box.querySelector('.pfm-cap');
        const queueEl = box.querySelector('.pfm-queue');
        const actions = box.querySelector('.pfm-actions');
        const sendBtn = box.querySelector('.pfm-send');
        const msgEl = box.querySelector('.pfm-msg');
        let queue = [];      // { id, file, url, status: ready|uploading|done|error|invalid, progress, error }
        let busy = false, seq = 0;

        function validate(f) {
            const typeOk = TYPES.includes((f.type || '').toLowerCase()) || (!f.type && EXT_OK.test(f.name || ''));
            if (!typeOk) return 'Само JPG, PNG или WebP.';
            if (f.size > MAX_BYTES) return `Над 10 MB (${fmtSize(f.size)}).`;
            if (f.size === 0) return 'Празен файл.';
            return '';
        }

        function addFiles(files) {
            msgEl.innerHTML = '';
            const arr = [...files];
            const room = MAX_QUEUE - queue.filter(q => q.status !== 'done').length;
            if (arr.length > room) msgEl.innerHTML = `<div class="alert alert--info">Може до ${MAX_QUEUE} снимки наведнъж — добавени са първите ${Math.max(0, room)}.</div>`;
            arr.slice(0, Math.max(0, room)).forEach(f => {
                const err = validate(f);
                queue.push({ id: ++seq, file: f, url: err ? '' : URL.createObjectURL(f), status: err ? 'invalid' : 'ready', progress: 0, error: err });
            });
            paintQueue();
        }

        function paintQueue() {
            const live = queue.filter(q => q.status !== 'done');
            actions.hidden = !live.length;
            const ready = queue.filter(q => q.status === 'ready' || q.status === 'error').length;
            sendBtn.disabled = busy || !ready;
            sendBtn.querySelector('span').textContent = busy ? 'Качване…' : (ready ? `Качи (${ready})` : 'Качи');
            box.querySelector('.pfm-clear').disabled = busy;
            queueEl.innerHTML = live.map(q => `
                <div class="pfm-q pfm-q--${q.status}" data-q="${q.id}">
                    <div class="pfm-q__th">${q.url ? `<img src="${q.url}" alt="">` : I('image', 20)}</div>
                    <div class="pfm-q__info">
                        <div class="pfm-q__name">${E(q.file.name || 'снимка')}</div>
                        <div class="pfm-q__sub">${q.status === 'uploading' ? `Качване… ${Math.round(q.progress * 100)}%`
                            : q.status === 'invalid' || q.status === 'error' ? `<span class="pfm-q__err">${E(q.error)}</span>`
                            : fmtSize(q.file.size)}</div>
                        ${q.status === 'uploading' ? `<div class="pfm-q__bar"><i style="width:${Math.round(q.progress * 100)}%"></i></div>` : ''}
                    </div>
                    ${q.status === 'uploading' ? `<div class="spinner pfm-q__spin"></div>`
                        : `<button type="button" class="pfm-q__x" data-q="${q.id}" aria-label="Махни"${busy ? ' disabled' : ''}>${I('close', 16)}</button>`}
                </div>`).join('');
            queueEl.querySelectorAll('.pfm-q__x').forEach(b => b.addEventListener('click', () => {
                const q = queue.find(x => x.id === +b.dataset.q);
                if (q && q.url) URL.revokeObjectURL(q.url);
                queue = queue.filter(x => x.id !== +b.dataset.q);
                paintQueue();
            }));
        }

        function setProgress(q) {
            const row = queueEl.querySelector(`.pfm-q[data-q="${q.id}"]`);
            if (!row) return;
            const pct = Math.round(q.progress * 100);
            const sub = row.querySelector('.pfm-q__sub'); if (sub) sub.textContent = `Качване… ${pct}%`;
            const bar = row.querySelector('.pfm-q__bar i'); if (bar) bar.style.width = pct + '%';
        }

        box.querySelectorAll('.pfm-file').forEach(inp => inp.addEventListener('change', () => {
            if (inp.files && inp.files.length) addFiles(inp.files);
            inp.value = '';      // същата снимка може да се избере пак
        }));
        srvSel.addEventListener('change', () => {
            srvSel.classList.remove('is-invalid');
            try { localStorage.setItem(LAST_SRV(empId), srvSel.value); } catch (e) { }
        });
        box.querySelector('.pfm-clear').addEventListener('click', () => {
            queue.forEach(q => q.url && URL.revokeObjectURL(q.url));
            queue = []; msgEl.innerHTML = ''; paintQueue();
        });

        sendBtn.addEventListener('click', async () => {
            const serviceId = +srvSel.value;
            if (!serviceId) {
                srvSel.classList.add('is-invalid');
                srvSel.focus();
                msgEl.innerHTML = `<div class="alert alert--err">Избери процедура — всяка снимка е към конкретна процедура.</div>`;
                return;
            }
            const todo = queue.filter(q => q.status === 'ready' || q.status === 'error');
            if (!todo.length) return;
            busy = true; msgEl.innerHTML = '';
            srvSel.disabled = true; capInp.disabled = true;
            todo.forEach(q => { q.status = 'uploading'; q.progress = 0; q.error = ''; });
            paintQueue();

            let ok = 0, fail = 0;
            for (const q of todo) {
                try {
                    const added = await uploadOne(empId, serviceId, capInp.value.trim(), q.file, p => { q.progress = p; setProgress(q); });
                    q.status = 'done'; ok++;
                    if (q.url) URL.revokeObjectURL(q.url);
                    photos = [...added, ...photos];
                } catch (err) {
                    q.status = 'error'; q.error = err.message; fail++;
                    if (err.fatal) { todo.filter(x => x.status === 'uploading').forEach(x => { x.status = 'error'; x.error = err.message; }); break; }
                }
                paintQueue();
            }
            queue = queue.filter(q => q.status !== 'done');
            busy = false;
            srvSel.disabled = false; capInp.disabled = false;
            if (ok && !fail) capInp.value = '';
            paintQueue();
            filter = 'all';
            paintList();
            msgEl.innerHTML = fail
                ? `<div class="alert alert--err">${ok ? `Качени: ${ok}. ` : ''}Неуспешни: ${fail} — виж причината до всяка снимка и натисни „Качи“ пак.</div>`
                : `<div class="alert alert--ok">${ok === 1 ? 'Снимката е качена' : `Качени са ${ok} снимки`} — вече се виждат в портфолиото.</div>`;
        });

        paintQueue();
    }

    // ===============================================================
    //  Модерация на отзиви (шеф)
    // ===============================================================
    async function mountReviews(box) {
        box.innerHTML = `<div class="spinner"></div>`;
        let all = [];
        try { all = (await API.get('/reviews/admin?status=all')) || []; }
        catch (err) { box.innerHTML = `<div class="alert alert--err">${E(err.message)}</div>`; return; }
        let filter = 'all';

        const fmtDate = iso => {
            const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
            return isNaN(d) ? '' : d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'short', year: 'numeric' });
        };

        function paint() {
            const vis = all.filter(r => r.isApproved).length;
            const chips = [
                { key: 'all', label: 'Всички', n: all.length },
                { key: 'visible', label: 'Видими', n: vis },
                { key: 'hidden', label: 'Скрити', n: all.length - vis }
            ];
            const list = all.filter(r => filter === 'all' || (filter === 'visible' ? r.isApproved : !r.isApproved));
            box.innerHTML = `
                <p class="hint" style="margin:0 0 .8rem">Скритите отзиви не се виждат на сайта (начална страница и портфолио), но остават тук. Изтриването е окончателно.</p>
                ${Portfolio.chipsHTML(chips, filter)}
                ${list.length ? `<div class="pfr-list">${list.map(r => `
                    <article class="card pfr${r.isApproved ? '' : ' is-hidden'}" data-id="${r.id}">
                        <div class="pfr__top">
                            ${Portfolio.stars(r.rating, 15)}
                            ${r.isApproved ? '' : `<span class="pfr__badge">${I('eye-off', 13)} Скрит</span>`}
                            <span class="hint pfr__date">${E(fmtDate(r.createdAt))}</span>
                        </div>
                        ${r.comment ? `<p class="pfr__txt">„${E(r.comment)}“</p>` : `<p class="pfr__txt hint">(само оценка, без коментар)</p>`}
                        <div class="pfr__who"><b>${E(r.clientName)}</b>${r.employeeName ? ` <span class="hint">→ ${E(r.employeeName)}${r.serviceName ? ' · ' + E(r.serviceName) : ''}</span>` : ''}</div>
                        <div class="pfr__acts">
                            <button type="button" class="btn btn--ghost pfr-toggle" data-id="${r.id}">${I(r.isApproved ? 'eye-off' : 'eye', 15)} ${r.isApproved ? 'Скрий' : 'Покажи'}</button>
                            <button type="button" class="btn btn--ghost pfr-del" data-id="${r.id}">${I('trash', 15)} Изтрий</button>
                        </div>
                    </article>`).join('')}</div>`
                : `<div class="pf-empty"><span class="pf-empty__ic">${I('star', 28)}</span><p>${filter === 'hidden' ? 'Няма скрити отзиви.' : 'Още няма отзиви.'}</p></div>`}
                <div class="pfr-msg"></div>`;

            box.querySelectorAll('.pf-chip').forEach(c => c.addEventListener('click', () => { filter = c.dataset.k; paint(); }));
            box.querySelectorAll('.pfr-toggle').forEach(b => b.addEventListener('click', async () => {
                const r = all.find(x => x.id === +b.dataset.id);
                if (!r) return;
                b.disabled = true;
                try {
                    await API.patch('/reviews/' + r.id + '/visibility', { hidden: r.isApproved });
                    r.isApproved = !r.isApproved;
                    paint();
                } catch (err) { b.disabled = false; showErr(err); }
            }));
            box.querySelectorAll('.pfr-del').forEach(b => b.addEventListener('click', async () => {
                const ok = await confirmBox({ title: 'Изтриване на отзив', text: 'Отзивът ще бъде изтрит окончателно. Ако искаш само да не се вижда — избери „Скрий“.', ok: 'Изтрий', cancel: 'Отказ' });
                if (!ok) return;
                b.disabled = true;
                try {
                    await API.del('/reviews/' + b.dataset.id);
                    all = all.filter(x => x.id !== +b.dataset.id);
                    paint();
                } catch (err) { b.disabled = false; showErr(err); }
            }));
        }
        function showErr(err) {
            const m = box.querySelector('.pfr-msg');
            if (m) m.innerHTML = `<div class="alert alert--err" style="margin-top:1rem">${E(err.message)}</div>`;
        }
        paint();
    }

    return { mountManager, mountReviews };
})();

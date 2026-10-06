/* =====================================================================
   Push известия на телефона (само за персонала: служителки и шеф).
   - регистрира /sw.js (само за известията — нищо не кешира);
   - StaffPush.mount(box) рисува блока „Известия на телефона“
     (в „Моят акаунт“ и в таблото на Радина → Настройки);
   - разрешение се иска САМО при натискане на „Включи известията“.
   ===================================================================== */
window.StaffPush = (function () {
    const E = window.esc || (s => String(s ?? ''));
    const I = (n, s) => (window.Icon ? Icon(n, { size: s || 18 }) : '');

    const isStaff = () => !!(window.Session && Session.isIn() && ['employee', 'boss'].includes(Session.role()));
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

    // ---- service worker ----
    let regPromise = null;
    function ensureSW() {
        if (!('serviceWorker' in navigator)) return Promise.resolve(null);
        if (!regPromise) {
            regPromise = navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
                .then(() => navigator.serviceWorker.ready)
                .catch(err => { regPromise = null; throw err; });
        }
        return regPromise;
    }

    // Клик по известие, когато страницата вече е отворена, но не е под service worker-а.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (e) => {
            const d = e.data || {};
            if (d.type === 'bh-open' && typeof d.url === 'string') {
                try { const u = new URL(d.url, location.href); if (u.origin === location.origin) location.href = u.href; } catch (err) { }
            }
        });
    }

    // ---- помощни ----
    function keyBytes(b64) {
        const pad = '='.repeat((4 - b64.length % 4) % 4);
        const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(raw, c => c.charCodeAt(0));
    }
    function sameKey(sub, b64) {
        try {
            const k = sub.options && sub.options.applicationServerKey;
            if (!k) return true;   // браузърът не казва -> приемаме, че е същият
            const a = new Uint8Array(k), b = keyBytes(b64);
            return a.length === b.length && a.every((v, i) => v === b[i]);
        } catch (e) { return true; }
    }
    let cfgPromise = null;
    const serverCfg = () => (cfgPromise = cfgPromise || API.get('/push/public-key').catch(err => { cfgPromise = null; throw err; }));
    const saveSub = (sub) => API.post('/push/subscriptions', sub.toJSON());

    // Тихо синхронизиране при всяко отваряне (веднъж на сесия): ако известията вече
    // са разрешени — абонаментът се записва отново на сървъра (браузърът понякога
    // го подменя, а и устройството минава към текущия профил).
    async function silentSync() {
        try {
            if (!isStaff() || !supported() || Notification.permission !== 'granted') return;
            if (sessionStorage.getItem('bh_push_sync') === Session.userId() + '') return;
            const cfg = await serverCfg();
            if (!cfg || !cfg.enabled) return;
            const reg = await ensureSW();
            let sub = await reg.pushManager.getSubscription();
            if (sub && !sameKey(sub, cfg.publicKey)) { await sub.unsubscribe(); sub = null; }
            if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
            await saveSub(sub);
            sessionStorage.setItem('bh_push_sync', Session.userId() + '');
        } catch (e) { /* без шум — блокът в Настройки показва състоянието */ }
    }

    // ---- блок „Известия на телефона“ ----
    function mount(box, opts) {
        const o = opts || {};
        box.innerHTML = `
            <div class="card push-card">
                <div class="push-head">
                    <span class="push-ic">${I('bell', 22)}</span>
                    <div class="push-head__t">
                        <strong>Известия на телефона</strong>
                        <span class="hint">${E(o.hint || 'Нов или отменен час — веднага на телефона, като от приложение.')}</span>
                    </div>
                    <span class="push-pill" hidden></span>
                </div>
                <div class="push-body"><div class="spinner"></div></div>
                <div class="push-actions"></div>
                <div class="push-msg"></div>
            </div>`;
        const pill = box.querySelector('.push-pill');
        const body = box.querySelector('.push-body');
        const actions = box.querySelector('.push-actions');
        const msg = box.querySelector('.push-msg');
        let cfg = null, reg = null;

        const say = (html, kind) => { msg.innerHTML = html ? `<div class="alert alert--${kind || 'info'}">${html}</div>` : ''; };
        const setPill = (txt, kind) => { pill.hidden = !txt; pill.textContent = txt || ''; pill.className = 'push-pill' + (kind ? ' push-pill--' + kind : ''); };
        const btn = (cls, icon, label) => `<button type="button" class="btn ${cls}" style="--pad-y:.6rem;--pad-x:1.2rem;font-size:.85rem">${I(icon, 17)}<span>${label}</span></button>`;
        async function busy(b, fn) {
            const all = [...actions.querySelectorAll('button')];
            all.forEach(x => { x.disabled = true; x.style.opacity = .7; });
            try { await fn(); } finally { all.forEach(x => { x.disabled = false; x.style.opacity = 1; }); }
        }

        function blockedHelp() {
            if (isIOS) return 'На iPhone: <b>Настройки → Известия → Beauty House</b> → включи „Разреши известия“. После се върни тук.';
            if (isAndroid) return standalone()
                ? 'Задръж иконата на Beauty House → <b>Информация за приложението → Известия</b> → разреши. После презареди.'
                : 'Натисни иконката вляво от адреса → <b>Разрешения → Известия → Разреши</b>. После презареди страницата.';
            return 'Натисни иконката вляво от адреса → <b>Известия → Разреши</b>. После презареди страницата.';
        }

        function paint(state) {
            actions.innerHTML = '';
            switch (state) {
                case 'ios-install':
                    setPill('Изключени', 'off');
                    body.innerHTML = `
                        <p class="push-text">На iPhone известията работят само когато сайтът е отворен от иконата на началния екран.</p>
                        <ol class="push-steps">
                            <li><span class="push-step__ic">${I('share', 18)}</span><span>Отвори сайта в <b>Safari</b> и натисни <b>Сподели</b> (квадратчето със стрелка).</span></li>
                            <li><span class="push-step__ic">${I('plus-square', 18)}</span><span>Избери <b>„Добави към начален екран“</b> → <b>Добави</b>.</span></li>
                            <li><span class="push-step__ic">${I('bell', 18)}</span><span>Отвори Beauty House <b>от новата иконка</b>, влез и натисни „Включи известията“ тук.</span></li>
                        </ol>
                        <p class="hint" style="margin:.2rem 0 0">Нужен е iOS 16.4 или по-нов. Ако вече имаш иконка отпреди — изтрий я и я добави отново.</p>`;
                    break;
                case 'unsupported':
                    setPill('Не се поддържат', 'off');
                    body.innerHTML = `<p class="push-text">${isIOS
                        ? 'Тази версия на iOS не поддържа известия от уеб приложения. Обнови iPhone до <b>iOS 16.4</b> или по-нов.'
                        : 'Този браузър не поддържа известия. На Android отвори сайта в <b>Chrome</b>, на iPhone — в <b>Safari</b> и го добави към началния екран.'}</p>`;
                    break;
                case 'server-off':
                    setPill('Изключени', 'off');
                    body.innerHTML = `<p class="push-text">Известията още не са настроени на сървъра. Щом бъдат — тук ще се появи бутон за включване.</p>`;
                    break;
                case 'blocked':
                    setPill('Блокирани', 'blocked');
                    body.innerHTML = `<p class="push-text">Известията са <b>блокирани от браузъра</b> за този сайт, затова не могат да се включат с бутон.</p>
                        <p class="hint" style="margin:.3rem 0 0">${blockedHelp()}</p>`;
                    break;
                case 'on':
                    setPill('Включени', 'on');
                    body.innerHTML = `<p class="push-text">Известията са включени на <b>това устройство</b>. Ако ползваш и друг телефон или таблет — включи ги и там.</p>`;
                    actions.innerHTML = btn('btn--gold push-test', 'bell', 'Изпрати тестово') + btn('btn--ghost push-off', 'bell-off', 'Изключи на това устройство');
                    actions.querySelector('.push-test').addEventListener('click', e => busy(e.currentTarget, onTest));
                    actions.querySelector('.push-off').addEventListener('click', e => busy(e.currentTarget, onDisable));
                    break;
                default: // 'off'
                    setPill('Изключени', 'off');
                    body.innerHTML = `<p class="push-text">Включи ги, за да получаваш известие на телефона при нов или отменен час — без да отваряш сайта.</p>`;
                    actions.innerHTML = btn('btn--gold push-on', 'bell', 'Включи известията');
                    actions.querySelector('.push-on').addEventListener('click', e => busy(e.currentTarget, onEnable));
            }
        }

        async function onEnable() {
            say('');
            // Разрешението се иска веднага при натискането (Safari иска да е директно от жеста).
            let perm;
            try { perm = await Notification.requestPermission(); }
            catch (e) { perm = Notification.permission; }
            if (perm === 'denied') { paint('blocked'); return; }
            if (perm !== 'granted') { say('Не позволи известията. Натисни бутона отново и избери „Разреши“.'); return; }
            try {
                reg = reg || await ensureSW();
                let sub = await reg.pushManager.getSubscription();
                if (sub && !sameKey(sub, cfg.publicKey)) { await sub.unsubscribe(); sub = null; }
                if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey) });
                await saveSub(sub);
                try { sessionStorage.setItem('bh_push_sync', Session.userId() + ''); } catch (e) { }
                paint('on');
                say('Готово — известията са включени. Натисни „Изпрати тестово“, за да провериш.', 'ok');
            } catch (err) {
                say(E(err && err.message ? err.message : 'Неуспешно включване. Опитай отново.'), 'err');
            }
        }

        async function onTest() {
            say('');
            try {
                const r = await API.post('/push/test');
                const n = (r && r.sent) || 0;
                say(`Изпратено${n > 1 ? ` до ${n} устройства` : ''}. Ако не се появи до минута — провери дали телефонът не е на „Не безпокойте“.`, 'ok');
            } catch (err) { say(E(err.message), 'err'); }
        }

        async function onDisable() {
            say('');
            try {
                const sub = reg && await reg.pushManager.getSubscription();
                if (sub) {
                    const endpoint = sub.endpoint;
                    await sub.unsubscribe().catch(() => { });
                    await API.del('/push/subscriptions?endpoint=' + encodeURIComponent(endpoint)).catch(() => { });
                }
                try { sessionStorage.removeItem('bh_push_sync'); } catch (e) { }
                paint('off');
                say('Известията са изключени на това устройство.', 'info');
            } catch (err) { say(E(err.message), 'err'); }
        }

        (async () => {
            if (isIOS && !standalone()) { paint('ios-install'); return; }
            if (!supported()) { paint('unsupported'); return; }
            try { cfg = await serverCfg(); }
            catch (err) { body.innerHTML = ''; say(E(err.message), 'err'); return; }
            if (!cfg || !cfg.enabled) { paint('server-off'); return; }
            try { reg = await ensureSW(); }
            catch (err) { body.innerHTML = ''; say('Не успях да подготвя известията: ' + E(err.message), 'err'); return; }
            if (Notification.permission === 'denied') { paint('blocked'); return; }
            let sub = null;
            try { sub = await reg.pushManager.getSubscription(); } catch (e) { }
            if (sub && Notification.permission === 'granted' && sameKey(sub, cfg.publicKey)) {
                paint('on');
                saveSub(sub).catch(() => { });   // сървърът да го има (и да е на текущия профил)
            } else paint('off');
        })();
    }

    // Регистрираме service worker-а и синхронизираме тихо — само за персонала.
    if (isStaff() && supported()) {
        const start = () => { ensureSW().then(silentSync).catch(() => { }); };
        if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
    }

    // „Моят акаунт“ (profile.html): блокът се показва само на служителките и шефа.
    function autoMount() {
        const pb = document.getElementById('push-box');
        if (pb && isStaff()) { pb.hidden = false; mount(pb); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();

    return { mount, ensureSW, isStaff };
})();

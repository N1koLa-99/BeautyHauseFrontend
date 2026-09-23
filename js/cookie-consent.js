/* =====================================================================
   Банер за бисквитки/локално съхранение — показва се веднъж, докато
   потребителят не натисне "Приемам". Съгласието се пази в localStorage.
   ===================================================================== */
(function () {
    const KEY = 'bh_cookies_ok';

    function alreadyAccepted() {
        try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
    }
    function accept() {
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
        const el = document.getElementById('cookie-banner');
        if (el) { el.classList.remove('cookie-banner--show'); setTimeout(() => el.remove(), 300); }
    }

    function mount() {
        if (alreadyAccepted()) return;
        if (document.getElementById('cookie-banner')) return;

        const el = document.createElement('div');
        el.id = 'cookie-banner';
        el.className = 'cookie-banner';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Съгласие за бисквитки');
        el.innerHTML = `
            <div class="cookie-banner__inner">
                <p class="cookie-banner__text">
                    Използваме само технически необходими данни в браузъра ти (напр. вход в профила), за да работи сайтът коректно.
                    Продължавайки да разглеждаш сайта, приемаш нашата <a href="privacy.html">Политика за поверителност</a>.
                </p>
                <div class="cookie-banner__actions">
                    <button type="button" class="btn btn--primary cookie-banner__accept" style="--pad-y:.6rem;--pad-x:1.3rem;font-size:.82rem">Приемам</button>
                </div>
            </div>`;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('cookie-banner--show'));
        el.querySelector('.cookie-banner__accept').addEventListener('click', accept);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();

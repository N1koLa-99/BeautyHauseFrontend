/* =====================================================================
   Service worker на Beauty House — САМО за push известията на персонала.
   Нарочно НЯМА „fetch" обработчик: нищо не се кешира и не се прихваща
   (сайтът, ?v= версиите и API отговорите работят точно както досега).
   ===================================================================== */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Известие от сървъра: { title, body, url, tag }
self.addEventListener('push', (e) => {
    let d = {};
    try { d = e.data ? e.data.json() : {}; }
    catch (err) { d = { body: e.data ? e.data.text() : '' }; }

    const title = d.title || 'Beauty House';
    const opts = {
        body: d.body || '',
        icon: '/img/favicon-192.png',
        badge: '/img/badge-96.png',          // малката бяла иконка в лентата на Android
        lang: 'bg',
        timestamp: Date.now(),
        data: { url: d.url || 'account.html' }
    };
    if (d.tag) { opts.tag = d.tag; opts.renotify = true; }   // същият час -> новото заменя старото
    e.waitUntil(self.registration.showNotification(title, opts));
});

// Клик по известието -> графикът на датата на часа (или „Курсове").
// Ако приложението вече е отворено — фокусира него, иначе отваря нов прозорец.
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = new URL((e.notification.data && e.notification.data.url) || 'account.html', self.registration.scope).href;

    e.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const mine = wins.filter(w => { try { return new URL(w.url).origin === self.location.origin; } catch (err) { return false; } });
        const win = mine.find(w => /\/account(\.html)?/.test(new URL(w.url).pathname)) || mine[0];
        if (win) {
            try { await win.focus(); } catch (err) { }
            try {
                if ('navigate' in win) { await win.navigate(url); return; }
            } catch (err) { /* страницата още не е под този service worker */ }
            win.postMessage({ type: 'bh-open', url });   // js/push.js я прехвърля сама
            return;
        }
        if (self.clients.openWindow) await self.clients.openWindow(url);
    })());
});

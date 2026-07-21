/* =====================================================================
   Конфигурация.
   По подразбиране фронтендът работи с ПУБЛИКУВАНОТО API в Azure —
   включително когато го отваряш локално (CORS е разрешен в backend-а).

   За разработка срещу локалния backend: сложи USE_LOCAL_BACKEND = true.
   ===================================================================== */
(function () {
    // ⚙️ Сложи true само ако искаш да разработваш срещу локалния backend.
    var USE_LOCAL_BACKEND = true;

    // Публикуваното API в Azure.
    var AZURE_API_BASE = 'https://beautyhouse.azurewebsites.net/api';

    // Локален backend (виж launchSettings.json).
    var LOCAL_API_BASE = 'https://localhost:7066/api';

    window.BH_CONFIG = {
        // Основен адрес на API-то (без завършващ слаш).
        API_BASE: USE_LOCAL_BACKEND ? LOCAL_API_BASE : AZURE_API_BASE,

        SALON: {
            name: 'Beauty House',
            phone: '+359 88 800 0000', // TODO: сложи реалния телефон
            email: '',
            address: 'пл. „Георги Измирлиев" 3, Горна Оряховица',
            hours: 'Пн–Пт 09:00–18:30 · Сб 10:00–14:30 · Нд почивен',
            facebook: 'https://www.facebook.com/BeautyHouse19R/',
            studio24: 'https://studio24.bg/beauty-house-s2278',
            mapsQuery: 'Beauty House, пл. Георги Измирлиев 3, Горна Оряховица',
            instagram: '#', tiktok: '#'
        }
    };
})();

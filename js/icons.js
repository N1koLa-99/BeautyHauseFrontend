/* =====================================================================
   Икон система — леки line-икони (SVG, stroke=currentColor), без emoji.
   Icon(name, opts) връща SVG markup за вграждане в innerHTML/template.
   ===================================================================== */
window.Icon = (function () {
    const PATHS = {
        scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.6 8.6 20 20M20 4 8.6 15.4M8.6 15.4l2.2-2.2"/>',
        sparkle: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/><path d="M12 9a3 3 0 0 0 3 3 3 3 0 0 0-3 3 3 3 0 0 0-3-3 3 3 0 0 0 3-3Z"/>',
        flower: '<circle cx="12" cy="12" r="2.4"/><path d="M12 3.5c1.7 0 3 1.5 3 3.3S13.7 12 12 12s-3-1.9-3-3.7 1.3-3.3 3-3.3ZM12 20.5c1.7 0 3-1.5 3-3.3S13.7 12 12 12s-3 1.9-3 3.7 1.3 3.3 3 3.3ZM3.5 12c0-1.7 1.5-3 3.3-3S12 10.3 12 12s-1.9 3-3.7 3-3.3-1.3-3.3-3ZM20.5 12c0 1.7-1.5 3-3.3 3S12 13.7 12 12s1.9-3 3.7-3 3.3 1.3 3.3 3Z"/>',
        leaf: '<path d="M5 20c8.5 0 14-5.5 14-15-9.5 0-15 5.5-15 15Z"/><path d="M6 19 15 10"/>',
        wand: '<path d="m15 4 1.3 2.7L19 8l-2.7 1.3L15 12l-1.3-2.7L11 8l2.7-1.3L15 4Z"/><path d="M5 21 17 9M5 21l3-1 1-3"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
        'calendar-check': '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M8.5 14.5l2.3 2.3L15.8 12"/>',
        'map-pin': '<path d="M12 21s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z"/><circle cx="12" cy="9" r="2.6"/>',
        phone: '<path d="M6.6 3.5 9 4.9c.6.35.8 1.1.5 1.7L8.4 9.1a12.3 12.3 0 0 0 6.5 6.5l2.5-1.1c.6-.3 1.35-.1 1.7.5l1.4 2.4c.4.65.25 1.5-.35 1.95l-2 1.5c-.6.45-1.35.6-2.05.4C9.9 19.9 4.1 14.1 2.75 8c-.15-.7 0-1.45.4-2.05l1.5-2c.45-.6 1.3-.75 1.95-.45Z"/>',
        mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7 8 6.2L20 7"/>',
        heart: '<path d="M12 20.5s-7.8-4.7-10-9.4C.4 7.9 2.3 4.6 5.7 4c2.2-.4 4.4.6 6.3 3 1.9-2.4 4.1-3.4 6.3-3 3.4.6 5.3 3.9 3.7 7.1-2.2 4.7-10 9.4-10 9.4Z"/>',
        star: '<path d="m12 3 2.7 5.9 6.3.7-4.7 4.4 1.3 6.3-5.6-3.2-5.6 3.2 1.3-6.3-4.7-4.4 6.3-.7L12 3Z"/>',
        'shield-check': '<path d="M12 3.2 19 6v6c0 5-3 8.2-7 9-4-.8-7-4-7-9V6l7-2.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
        flask: '<path d="M9.5 3.5h5M10.2 3.5v6.3L5.6 18a2 2 0 0 0 1.8 3h9.2a2 2 0 0 0 1.8-3l-4.6-8.2V3.5"/><path d="M7.4 15.5h9.2"/>',
        'sprout': '<path d="M12 21v-8.5"/><path d="M12 12.5C12 8 8.5 6 5 6c0 4.5 3 6.5 7 6.5ZM12 9.5C12 6 14.7 4.5 18 4.5c0 3.8-2.6 5.8-6 5.8"/>',
        moon: '<path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2Z"/>',
        crown: '<path d="M4 18h16l1-9-5 3-4-6-4 6-5-3 1 9Z"/><path d="M4 18h16v2.2H4z"/>',
        user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M4.5 20c1.4-3.6 4.3-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/>',
        'arrow-right': '<path d="M4 12h15.5M13.5 5.5 20 12l-6.5 6.5"/>',
        'chart': '<path d="M4 20h16"/><path d="M7 16.5v-5M12 16.5V6.5M17 16.5v-7.5"/>',
        'alert': '<path d="M12 4.2 21 19.4H3L12 4.2Z"/><path d="M12 10.2v4"/><path d="M12 16.9h.01"/>',
        'gear': '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.9v2.7M12 18.4v2.7M2.9 12h2.7M18.4 12h2.7M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/>',
        'chevron-down': '<path d="m5.5 8.5 6.5 6.5 6.5-6.5"/>',
        check: '<path d="m4.5 12.5 5 5 10-10"/>',
        gem: '<path d="M6 3h12l3.5 5.5L12 21 2.5 8.5 6 3Z"/><path d="M2.5 8.5h19M9 3l-2 5.5L12 21M15 3l2 5.5L12 21"/>',
        instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r="1"/>',
        facebook: '<path d="M14.5 21v-7.2h2.4l.4-3h-2.8V8.8c0-.87.24-1.46 1.5-1.46h1.6V4.7c-.28-.04-1.23-.12-2.34-.12-2.32 0-3.9 1.4-3.9 4V10.8H9v3h2.4V21h3.1Z"/>',
        tiktok: '<path d="M14 3.5c.5 2 2 3.4 4 3.6v3c-1.5 0-2.9-.4-4-1.2v6.4a5.2 5.2 0 1 1-5.2-5.2c.4 0 .8 0 1.2.1v3.1a2.2 2.2 0 1 0 1.5 2V3.5H14Z"/>'
    };

    function Icon(name, opts) {
        const o = opts || {};
        const size = o.size || 22;
        const cls = o.class ? ' ' + o.class : '';
        const body = PATHS[name] || PATHS.sparkle;
        return `<svg class="icon${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }
    return Icon;
})();

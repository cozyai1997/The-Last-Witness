(function (root) {
  'use strict';
  const paths = {
    person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
    place: '<path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="9" r="2.5"/>',
    tool: '<path d="m14 6 4-4a6 6 0 0 1-7 8L3 18a2.1 2.1 0 0 0 3 3l8-8a6 6 0 0 0 8-7l-4 4Z"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 5V2m6 4 2-2M12 8v5l3 2"/>',
    notebook: '<path d="M6 3h13v18H6zM3 6h5M3 10h5M3 14h5M3 18h5m7-11h4m-8 4h8m-8 4h6"/>',
    records: '<path d="M6 3h9l4 4v14H6ZM15 3v5h4M9 11h7m-7 4h5M3 7v15h12"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
    chat: '<path d="M21 11c0 5-4 8-9 8H8l-5 3 1-6a8 8 0 0 1-1-5c0-5 4-8 9-8s9 3 9 8Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>',
    search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    music: '<path d="M10 17V5l11-3v12M10 8l11-3"/><ellipse cx="6" cy="18" rx="4" ry="3"/><ellipse cx="17" cy="15" rx="4" ry="3"/>',
    settings: '<path d="m9 3 1-2h4l1 2 2 1 2-1 3 3-1 2 1 2 2 1v4l-2 1-1 2 1 2-3 3-2-1-2 1-1 2h-4l-1-2-2-1-2 1-3-3 1-2-1-2-2-1v-4l2-1 1-2-1-2 3-3 2 1Z" transform="translate(1 0) scale(.91)"/><circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    scale: '<path d="M12 3v18M5 21h14M3 6h18M6 6 2 15h8ZM18 6l-4 9h8Z"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/>'
  };
  function svg(name) {
    return '<svg class="console-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (paths[name] || paths.records) + '</svg>';
  }
  const api = Object.freeze({ svg, names: Object.freeze(Object.keys(paths)) });
  if (root) root.WitnessIcons = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : null));

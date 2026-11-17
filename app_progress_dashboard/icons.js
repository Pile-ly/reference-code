// The page's icons, drawn inline so nothing is fetched for them. Each is a
// 24x24 outline in the current text colour.

const PATHS = {
  check: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  minus: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12h7"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  refresh: '<path d="M19.5 10A8 8 0 1 0 18 16.5"/><path d="M20 4v6h-6"/><path d="M12 8.5v3.5"/><path d="M12 15.5h.01"/>',
  warning: '<path d="M12 3.5l9 15.5H3z"/><path d="M12 10v4"/><path d="M12 16.8h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  chat: '<path d="M4 5h16v11H9.5L5 19.5V16H4z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4"/><path d="M12 16.8h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
};

/** An `<svg>` element for icon `name`, hidden from screen readers. */
export function icon(name, className) {
  const template = document.createElement('template');
  template.innerHTML =
    `<svg class="icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    `${PATHS[name] ?? ''}</svg>`;
  return template.content.firstChild;
}

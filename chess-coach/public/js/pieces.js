// Original SVG piece set (45x45 viewBox). Hand-drawn for this project; MIT licensed like the rest of the repo.
const P = {
  p: `<circle cx="22.5" cy="12.5" r="5"/><path d="M17.200 30c0-6 2.200-9.500 5.300-11.500 3.100 2 5.300 5.500 5.300 11.500z"/><path d="M13 36.500c0-3 2.500-6.500 9.500-6.500s9.500 3.500 9.500 6.500z"/>`,
  r: `<path d="M12 20V10.500h5v3.500h3.500v-3.500h4v3.500H28v-3.500h5V20z"/><path d="M15 20h15l1.500 12h-18z"/><path d="M11.500 37v-4.500h22V37z"/><path class="d" d="M15.500 24.500h14M14.700 29h15.600"/>`,
  n: `<path d="M12 37c0-8.500 1.500-13.500 6.500-17-3-.5-6.500-.5-8.500 1.500l-.5-4.500L17.500 9 20 5l3.200 3.600C31.500 10.500 34.500 20 34.500 37z"/><circle class="e" cx="19.500" cy="14" r="1.400"/><path class="d" d="M12.800 18.500l3.200.2"/>`,
  b: `<circle cx="22.500" cy="8" r="2.800"/><path d="M22.500 10.500c6.500 3.500 9.500 8.500 9.500 13.500 0 3.500-3 5.500-4 8.500H17c-1-3-4-5-4-8.500 0-5 3-10 9.500-13.500z"/><path d="M11 37.500c3-3.500 6-3.500 11.500-3.500s8.500 0 11.500 3.500z"/><path class="d" d="M19.500 17.500l6.500 6.500M22.500 14.500v3"/>`,
  q: `<path d="M9.500 14l4.500 17.500h17L35.500 14l-6.500 8-3-12-3.500 12-3.500-12-3 12z"/><circle cx="9" cy="13" r="2.300"/><circle cx="16" cy="9" r="2.300"/><circle cx="22.500" cy="8" r="2.300"/><circle cx="29" cy="9" r="2.300"/><circle cx="36" cy="13" r="2.300"/><path d="M12.500 31.500h20l1.500 5.500H11z"/>`,
  k: `<path d="M21 3.500h3v3h3v3h-3v3.500h-3V9.500h-3v-3h3z"/><path d="M22.500 14c-9 0-14 4.500-14 9.500 0 4 3 6 6 7l-1.500 6.500h19L30.500 30.500c3-1 6-3 6-7 0-5-5-9.500-14-9.500z"/><path class="d" d="M14.500 31h16M15.500 26c4 2 10 2 14 0"/>`,
};

/** Returns an <svg> string for a piece ('w' | 'b', 'pnbrqk'). */
export function pieceSvg(color, type, cls = '') {
  return `<svg class="piece ${color} ${cls}" viewBox="3 2.5 39 39" aria-label="${color === 'w' ? 'white' : 'black'} ${type}"><g stroke-linejoin="round" stroke-linecap="round" stroke-width="1.6">${P[type]}</g></svg>`;
}

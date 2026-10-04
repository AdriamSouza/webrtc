/**
 * Lucide SVG Icons Minimalistas (Clean Stroke Icons)
 * Licença: MIT (Livre para uso comercial e pessoal)
 * https://lucide.dev
 */

const createSvg = (paths, size = 16, className = 'icon-svg') => `
  <svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    ${paths}
  </svg>
`.trim();

export const Icons = {
  // Transmissão e Logo
  cast: (size = 18) => createSvg(`
    <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <path d="M2 12a9 9 0 0 1 8 8"/>
    <path d="M2 16a5 5 0 0 1 4 4"/>
    <line x1="2" x2="2.01" y1="20" y2="20"/>
  `, size),

  zap: (size = 18) => createSvg(`
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  `, size),

  radio: (size = 18) => createSvg(`
    <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/>
    <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/>
    <circle cx="12" cy="12" r="2"/>
    <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/>
    <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
  `, size),

  // Telas e Câmeras
  monitor: (size = 18) => createSvg(`
    <rect width="20" height="14" x="2" y="3" rx="2"/>
    <line x1="8" x2="16" y1="21" y2="21"/>
    <line x1="12" x2="12" y1="17" y2="21"/>
  `, size),

  video: (size = 18) => createSvg(`
    <path d="m22 8-6 4 6 4V8Z"/>
    <rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>
  `, size),

  videoOff: (size = 18) => createSvg(`
    <path d="m2 2 20 20"/>
    <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8"/>
    <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z"/>
  `, size),

  // Áudio e Microfone
  mic: (size = 18) => createSvg(`
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" x2="12" y1="19" y2="22"/>
  `, size),

  micOff: (size = 18) => createSvg(`
    <line x1="2" x2="22" y1="2" y2="22"/>
    <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/>
    <path d="M5 10v2a7 7 0 0 0 12 5"/>
    <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
    <line x1="12" x2="12" y1="19" y2="22"/>
  `, size),

  volume2: (size = 18) => createSvg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
  `, size),

  volumeX: (size = 18) => createSvg(`
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
    <line x1="22" x2="16" y1="9" y2="15"/>
    <line x1="16" x2="22" y1="9" y2="15"/>
  `, size),

  // Layouts
  layoutGrid: (size = 18) => createSvg(`
    <rect width="7" height="7" x="3" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="3" rx="1"/>
    <rect width="7" height="7" x="14" y="14" rx="1"/>
    <rect width="7" height="7" x="3" y="14" rx="1"/>
  `, size),

  layoutStage: (size = 18) => createSvg(`
    <rect width="18" height="12" x="3" y="3" rx="1.5"/>
    <rect width="5" height="4" x="3" y="17" rx="1"/>
    <rect width="5" height="4" x="9.5" y="17" rx="1"/>
    <rect width="5" height="4" x="16" y="17" rx="1"/>
  `, size),

  layoutTheater: (size = 18) => createSvg(`
    <rect width="20" height="15" x="2" y="4.5" rx="2"/>
    <line x1="2" x2="22" y1="9" y2="9"/>
  `, size),

  // Controles de Janela / Navegação
  maximize: (size = 18) => createSvg(`
    <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
    <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
    <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
  `, size),

  minimize: (size = 18) => createSvg(`
    <path d="M4 14h6v6"/>
    <path d="M20 10h-6V4"/>
    <path d="M14 10l7-7"/>
    <path d="M3 21l7-7"/>
  `, size),

  minus: (size = 14) => createSvg(`
    <line x1="5" x2="19" y1="12" y2="12"/>
  `, size),

  x: (size = 16) => createSvg(`
    <line x1="18" x2="6" y1="6" y2="18"/>
    <line x1="6" x2="18" y1="6" y2="18"/>
  `, size),

  // Ações e Ferramentas
  copy: (size = 16) => createSvg(`
    <rect width="13" height="13" x="9" y="9" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  `, size),

  check: (size = 16) => createSvg(`
    <polyline points="20 6 9 17 4 12"/>
  `, size),

  messageSquare: (size = 18) => createSvg(`
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  `, size),

  activity: (size = 18) => createSvg(`
    <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
  `, size),

  users: (size = 18) => createSvg(`
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  `, size),

  user: (size = 16) => createSvg(`
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  `, size),

  shield: (size = 16) => createSvg(`
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
  `, size),

  lock: (size = 16) => createSvg(`
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  `, size),

  key: (size = 16) => createSvg(`
    <circle cx="7.5" cy="15.5" r="5.5"/>
    <path d="m21 2-9.6 9.6"/>
    <path d="m15.5 7.5 3 3L22 7l-3-3"/>
  `, size),

  plus: (size = 16) => createSvg(`
    <line x1="12" x2="12" y1="5" y2="19"/>
    <line x1="5" x2="19" y1="12" y2="12"/>
  `, size),

  logIn: (size = 16) => createSvg(`
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
    <polyline points="10 17 15 12 10 7"/>
    <line x1="15" x2="3" y1="12" y2="12"/>
  `, size),

  logOut: (size = 18) => createSvg(`
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" x2="9" y1="12" y2="12"/>
  `, size),

  shuffle: (size = 16) => createSvg(`
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/>
    <path d="m18 2 4 4-4 4"/>
    <path d="M2 6h1.9c1.5 0 2.8.9 3.4 2.2l.5 1"/>
    <path d="m18 14 4 4-4 4"/>
    <path d="M11.7 13.7l.6 1c.6 1.3 1.9 2.3 3.4 2.3H22"/>
  `, size),

  eye: (size = 16) => createSvg(`
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  `, size),

  eyeOff: (size = 16) => createSvg(`
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
    <line x1="2" x2="22" y1="2" y2="22"/>
  `, size),

  chevronUp: (size = 14) => createSvg(`
    <polyline points="18 15 12 9 6 15"/>
  `, size),

  chevronDown: (size = 14) => createSvg(`
    <polyline points="6 9 12 15 18 9"/>
  `, size),

  spotlight: (size = 16) => createSvg(`
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="3"/>
  `, size)
};

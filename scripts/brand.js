/**
 * Lincoln brand mark (SVG source of truth).
 *
 * Concept: an abstract "ascending" symbol — two stacked chevrons rising upward,
 * suggesting growth, value and momentum. Navy & white palette for a trustworthy,
 * banking feel.
 *
 * Geometry lives in a 100x100 viewBox so it renders crisp at any size and on
 * any background (full-bleed icon, transparent foreground, splash, wordmark).
 */

const NAVY = "#0B2350";        // brand navy
const NAVY_LIGHT = "#163E7E";  // gradient top
const NAVY_DARK = "#06173A";   // gradient bottom
const ACCENT = "#3D7BFF";      // bright blue accent
const WHITE = "#FFFFFF";
const BG_DARK = "#091830";      // app/splash background (deep navy)

/**
 * The Lincoln glyph: two stacked upward chevrons.
 * `top`/`bottom` set the two stroke colors; `scale` shrinks it inside a larger
 * canvas (safe zones / splash).
 */
function glyph({ top = WHITE, bottom = ACCENT, scale = 1, cx = 50, cy = 50 } = {}) {
  const t = 12; // chevron thickness
  return `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-50 -50)"
     fill="none" stroke-width="${t}" stroke-linecap="round" stroke-linejoin="round">
    <!-- lower chevron (accent) -->
    <polyline points="28,70 50,48 72,70" stroke="${bottom}"/>
    <!-- upper chevron (white) -->
    <polyline points="28,52 50,30 72,52" stroke="${top}"/>
  </g>`;
}

/** Rounded-square icon with a navy gradient and the chevron mark. */
function iconSquare({ size = 1024, radiusRatio = 0.225 } = {}) {
  const r = (size * radiusRatio) / size * 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${NAVY_LIGHT}"/>
        <stop offset="0.55" stop-color="${NAVY}"/>
        <stop offset="1" stop-color="${NAVY_DARK}"/>
      </linearGradient>
      <radialGradient id="shine" cx="0.3" cy="0.2" r="0.9">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/>
        <stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100" height="100" rx="${r}" fill="url(#g)"/>
    <rect width="100" height="100" rx="${r}" fill="url(#shine)"/>
    ${glyph({ scale: 0.9 })}
  </svg>`;
}

/** Transparent foreground for Android adaptive icon (mark inside safe zone). */
function adaptiveForeground({ size = 1024 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    ${glyph({ scale: 0.6 })}
  </svg>`;
}

/** Navy gradient background for the Android adaptive icon. */
function adaptiveBackground({ size = 1024 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${NAVY_LIGHT}"/>
        <stop offset="0.55" stop-color="${NAVY}"/>
        <stop offset="1" stop-color="${NAVY_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
  </svg>`;
}

/** Splash: deep-navy background with the icon centred and the wordmark beneath. */
function splash({ width = 1242, height = 2688 } = {}) {
  const cx = width / 2;
  const cy = height / 2;
  const iconSize = Math.min(width, height) * 0.34;
  const r = iconSize * 0.225;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${NAVY_LIGHT}"/>
        <stop offset="0.55" stop-color="${NAVY}"/>
        <stop offset="1" stop-color="${NAVY_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="${BG_DARK}"/>
    <g transform="translate(${cx - iconSize / 2} ${cy - iconSize / 2 - height * 0.04})">
      <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 100 100">
        <rect width="100" height="100" rx="${(r / iconSize) * 100}" fill="url(#g)"/>
        ${glyph({ scale: 0.9 })}
      </svg>
    </g>
    <text x="${cx}" y="${cy + iconSize * 0.62}" text-anchor="middle"
      font-family="Helvetica, Arial, sans-serif" font-size="${iconSize * 0.26}"
      font-weight="800" fill="#ffffff" letter-spacing="-1">Lincoln</text>
  </svg>`;
}

/** Horizontal wordmark for the web header / readme. */
function wordmark() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${NAVY_LIGHT}"/>
        <stop offset="0.55" stop-color="${NAVY}"/>
        <stop offset="1" stop-color="${NAVY_DARK}"/>
      </linearGradient>
    </defs>
    <rect x="0" y="16" width="64" height="64" rx="16" fill="url(#g)"/>
    <svg x="0" y="16" width="64" height="64" viewBox="0 0 100 100">${glyph({ scale: 0.9 })}</svg>
    <text x="84" y="62" font-family="Helvetica, Arial, sans-serif" font-size="46"
      font-weight="800" fill="#0B2350" letter-spacing="-1">Lincoln</text>
  </svg>`;
}

module.exports = {
  NAVY, NAVY_LIGHT, NAVY_DARK, ACCENT, WHITE, BG_DARK,
  glyph, iconSquare, adaptiveForeground, adaptiveBackground, splash, wordmark,
};

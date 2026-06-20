/**
 * Cuy Pay brand mark (SVG source of truth).
 *
 * Concept: a friendly guinea-pig ("cuy") mascot — a rounded white face with big
 * ears, navy eyes/nose and the guinea-pig's signature front teeth. Navy & white
 * palette for a trustworthy, playful fintech feel.
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
 * The Cuy Pay glyph: a front-facing guinea-pig mascot.
 * `scale` shrinks it inside a larger canvas (safe zones / splash).
 */
function glyph({ scale = 1, cx = 50, cy = 50 } = {}) {
  return `
  <g transform="translate(${cx} ${cy}) scale(${scale}) translate(-50 -50)">
    <!-- ears -->
    <g>
      <ellipse cx="33" cy="33" rx="11" ry="14" fill="${WHITE}" transform="rotate(-20 33 33)"/>
      <ellipse cx="67" cy="33" rx="11" ry="14" fill="${WHITE}" transform="rotate(20 67 33)"/>
      <ellipse cx="33" cy="34" rx="5" ry="7.5" fill="${ACCENT}" transform="rotate(-20 33 34)"/>
      <ellipse cx="67" cy="34" rx="5" ry="7.5" fill="${ACCENT}" transform="rotate(20 67 34)"/>
    </g>

    <!-- forehead tuft + head -->
    <path d="M50 21 L44 36 L56 36 Z" fill="${WHITE}"/>
    <ellipse cx="50" cy="57" rx="33" ry="30" fill="${WHITE}"/>

    <!-- cheeks -->
    <circle cx="26" cy="64" r="5" fill="${ACCENT}" opacity="0.30"/>
    <circle cx="74" cy="64" r="5" fill="${ACCENT}" opacity="0.30"/>

    <!-- whiskers -->
    <g stroke="${NAVY}" stroke-width="1.6" stroke-linecap="round" opacity="0.55">
      <line x1="30" y1="61" x2="16" y2="59"/>
      <line x1="30" y1="65" x2="15" y2="66"/>
      <line x1="70" y1="61" x2="84" y2="59"/>
      <line x1="70" y1="65" x2="85" y2="66"/>
    </g>

    <!-- eyes -->
    <circle cx="38" cy="55" r="5.5" fill="${NAVY}"/>
    <circle cx="62" cy="55" r="5.5" fill="${NAVY}"/>
    <circle cx="39.8" cy="53.2" r="1.9" fill="${WHITE}"/>
    <circle cx="63.8" cy="53.2" r="1.9" fill="${WHITE}"/>

    <!-- nose -->
    <path d="M50 68 C46 68 44 65 44 63 C44 61 47 61 50 62.5 C53 61 56 61 56 63 C56 65 54 68 50 68 Z" fill="${NAVY}"/>

    <!-- front teeth -->
    <rect x="46.5" y="69" width="7" height="8" rx="1.6" fill="${WHITE}" stroke="${NAVY}" stroke-width="1.6"/>
    <line x1="50" y1="69.5" x2="50" y2="76.5" stroke="${NAVY}" stroke-width="1.4"/>
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
      font-weight="800" fill="#ffffff" letter-spacing="-1">Cuy Pay</text>
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
      font-weight="800" fill="#0B2350" letter-spacing="-1">Cuy Pay</text>
  </svg>`;
}

module.exports = {
  NAVY, NAVY_LIGHT, NAVY_DARK, ACCENT, WHITE, BG_DARK,
  glyph, iconSquare, adaptiveForeground, adaptiveBackground, splash, wordmark,
};

#!/usr/bin/env node
// Generates CuyPay logo PNG — Tallinn tower mark
// Two variants: light (white tower on transparent) and dark (navy tower on transparent)
// Output size: 400x400 (4x scale from 100x100 viewBox)

const { PNG } = require('pngjs')
const fs = require('fs')
const path = require('path')

const SCALE = 4
const W = 100 * SCALE
const H = 100 * SCALE

const NAVY  = [11, 27, 50, 255]
const TEAL  = [0, 201, 167, 255]
const WHITE = [255, 255, 255, 255]
const TRANS = [0, 0, 0, 0]

// Fill a rectangle (in original 100x100 coords, scaled to SCALE)
function fillRect(data, x, y, w, h, color) {
  const x0 = Math.round(x * SCALE), y0 = Math.round(y * SCALE)
  const x1 = Math.round((x + w) * SCALE) - 1
  const y1 = Math.round((y + h) * SCALE) - 1
  for (let py = Math.max(0, y0); py <= Math.min(H-1, y1); py++) {
    for (let px = Math.max(0, x0); px <= Math.min(W-1, x1); px++) {
      const idx = (py * W + px) * 4
      // Blend with alpha
      const a = color[3] / 255
      data[idx]   = Math.round(data[idx]   * (1-a) + color[0] * a)
      data[idx+1] = Math.round(data[idx+1] * (1-a) + color[1] * a)
      data[idx+2] = Math.round(data[idx+2] * (1-a) + color[2] * a)
      data[idx+3] = Math.min(255, data[idx+3] + color[3])
    }
  }
}

// Fill a triangle (3 points in original coords)
function fillTriangle(data, pts, color) {
  const scaled = pts.map(([x,y]) => [x*SCALE, y*SCALE])
  const ys = scaled.map(p => p[1])
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(H-1, Math.ceil(Math.max(...ys)))
  for (let py = y0; py <= y1; py++) {
    const xs = []
    for (let i = 0; i < 3; i++) {
      const [ax,ay] = scaled[i], [bx,by] = scaled[(i+1)%3]
      if ((ay <= py && by > py) || (by <= py && ay > py)) {
        xs.push(ax + (py - ay) * (bx - ax) / (by - ay))
      }
    }
    if (xs.length >= 2) {
      xs.sort((a,b) => a-b)
      const px0 = Math.max(0, Math.ceil(xs[0]))
      const px1 = Math.min(W-1, Math.floor(xs[1]))
      for (let px = px0; px <= px1; px++) {
        const idx = (py * W + px) * 4
        const a = color[3] / 255
        data[idx]   = Math.round(data[idx]   * (1-a) + color[0] * a)
        data[idx+1] = Math.round(data[idx+1] * (1-a) + color[1] * a)
        data[idx+2] = Math.round(data[idx+2] * (1-a) + color[2] * a)
        data[idx+3] = Math.min(255, data[idx+3] + color[3])
      }
    }
  }
}

// Draw arch: a rectangle with a semicircle cut out at top center
function fillArch(data, x, y, w, h, color, holeColor) {
  fillRect(data, x, y, w, h, color)
  // Punch hole: semicircle
  const cx = (x + x + w) / 2 * SCALE
  const cy = (y + h) * SCALE
  const r = (w / 2 - 1) * SCALE
  for (let py = Math.round(y*SCALE); py <= Math.round((y+h)*SCALE); py++) {
    for (let px = Math.round(x*SCALE); px <= Math.round((x+w)*SCALE); px++) {
      const dx = px - cx, dy = py - cy
      if (dx*dx + dy*dy <= r*r && py <= cy) {
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const idx = (py * W + px) * 4
          data[idx]   = holeColor[0]
          data[idx+1] = holeColor[1]
          data[idx+2] = holeColor[2]
          data[idx+3] = holeColor[3]
        }
      }
    }
  }
}

function genLogo(bodyColor, bgColor) {
  const png = new PNG({ width: W, height: H, filterType: -1 })
  png.data.fill(0) // transparent

  const hole = bgColor // color of holes/windows = badge background

  // Tower base
  fillRect(png.data, 30, 53, 40, 35, bodyColor)
  // Tower mid section
  fillRect(png.data, 34, 34, 32, 23, bodyColor)
  // Left battlement
  fillRect(png.data, 27, 25, 11, 15, bodyColor)
  // Center battlement — teal accent
  fillRect(png.data, 41, 18, 18, 20, TEAL)
  // Right battlement
  fillRect(png.data, 62, 25, 11, 15, bodyColor)
  // Flag pole
  fillRect(png.data, 49, 6, 3, 17, TEAL)
  // Flag triangle: (52,6) → (68,13) → (52,20)
  fillTriangle(png.data, [[52,6],[68,13],[52,20]], TEAL)
  // Arch window mid: semicircle window
  fillArch(png.data, 42, 36, 16, 10, bodyColor, [...hole.slice(0,3), 120])
  // Lower left window
  fillRect(png.data, 35, 58, 11, 13, [...hole.slice(0,3), 130])
  // Lower right window
  fillRect(png.data, 54, 58, 11, 13, [...hole.slice(0,3), 130])
  // Door arch
  fillArch(png.data, 44, 69, 12, 20, bodyColor, [...hole.slice(0,3), 130])
  // Ground line
  fillRect(png.data, 14, 88, 72, 5, TEAL)

  return png
}

const outDir = path.join(__dirname, '..', 'public')

// Light: white tower (for dark/navy email header)
const light = genLogo(WHITE, NAVY)
const lightBuf = PNG.sync.write(light)
fs.writeFileSync(path.join(outDir, 'logo-email-light.png'), lightBuf)
console.log('logo-email-light.png', lightBuf.length, 'bytes')

// Dark: navy tower (for white email hero circle)
const dark = genLogo(NAVY, WHITE)
const darkBuf = PNG.sync.write(dark)
fs.writeFileSync(path.join(outDir, 'logo-email-dark.png'), darkBuf)
console.log('logo-email-dark.png', darkBuf.length, 'bytes')

// Spot checks
function check(data, label, x, y, note) {
  const px = Math.round(x*SCALE), py = Math.round(y*SCALE)
  const idx = (py * W + px) * 4
  console.log(`${label} @(${x},${y}): rgba(${data[idx]},${data[idx+1]},${data[idx+2]},${data[idx+3]}) — ${note}`)
}
check(light.data, 'light', 50, 70, 'tower body center → should be white')
check(light.data, 'light', 50, 20, 'center battlement → should be teal')
check(light.data, 'light', 50, 90, 'ground line → should be teal')
check(light.data, 'light', 5,  5,  'corner background → should be transparent')

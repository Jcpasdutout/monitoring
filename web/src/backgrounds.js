/**
 * Images de fond proposées dans les Réglages. Elles sont dessinées par l'application (dégradés CSS
 * ou SVG générés ici) : aucun fichier à télécharger, et chacune a une version claire et une sombre.
 * `css(dark)` renvoie la valeur de la propriété CSS `background`.
 */

const svg = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`

/** Suite pseudo-aléatoire reproductible : le dessin est le même à chaque chargement. */
function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

function mountains(dark) {
  const sky = dark ? ['#0b1022', '#27234a'] : ['#c9d8f5', '#f6e3d6']
  const layers = dark ? ['#2a2f52', '#1d2140', '#12152b'] : ['#9fb1d6', '#7489bd', '#4f5f96']
  const ridge = (y, amp, seed) => {
    const r = seeded(seed)
    let d = `M0 900 L0 ${y}`
    for (let x = 0; x <= 1600; x += 80) d += ` L${x} ${(y - r() * amp).toFixed(0)}`
    return `${d} L1600 900 Z`
  }
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>`
    + `<rect width="1600" height="900" fill="url(#s)"/><circle cx="1180" cy="230" r="70" fill="${dark ? '#e8e6ff' : '#fff6e8'}" opacity=".8"/>`
    + `<path d="${ridge(520, 200, 7)}" fill="${layers[0]}"/><path d="${ridge(640, 160, 31)}" fill="${layers[1]}"/>`
    + `<path d="${ridge(760, 110, 99)}" fill="${layers[2]}"/></svg>`) + ' center bottom / cover'
}

function network(dark) {
  const r = seeded(42)
  const pts = Array.from({ length: 70 }, () => [r() * 1600, r() * 900])
  let lines = ''
  pts.forEach((a, i) => pts.slice(i + 1).forEach((b) => {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (d < 190) lines += `<line x1="${a[0] | 0}" y1="${a[1] | 0}" x2="${b[0] | 0}" y2="${b[1] | 0}" stroke-opacity="${((1 - d / 190) * 0.6).toFixed(2)}"/>`
  }))
  const dots = pts.map(([x, y]) => `<circle cx="${x | 0}" cy="${y | 0}" r="${(2 + r() * 2.5).toFixed(1)}"/>`).join('')
  const bg = dark ? ['#0a0e1a', '#141b33'] : ['#eef2fb', '#e3e9f8']
  const fg = dark ? '#6d8cff' : '#5b6fd6'
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">`
    + `<defs><radialGradient id="g" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="${bg[1]}"/><stop offset="1" stop-color="${bg[0]}"/></radialGradient></defs>`
    + `<rect width="1600" height="900" fill="url(#g)"/><g stroke="${fg}" stroke-width="1.2">${lines}</g><g fill="${fg}">${dots}</g></svg>`) + ' center / cover'
}

function ocean(dark) {
  const c = dark ? ['#04121c', '#0b3046', '#0e4a63', '#126a80'] : ['#e6f4f8', '#b5dfe9', '#7cc4d6', '#3d9fbb']
  const wave = (y, a, ph) => {
    let d = `M0 ${y}`
    for (let x = 0; x <= 1600; x += 20) d += ` L${x} ${(y + Math.sin(x / 210 + ph) * a + Math.sin(x / 90 + ph * 2) * a / 4).toFixed(1)}`
    return `${d} L1600 900 L0 900 Z`
  }
  return svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">`
    + `<rect width="1600" height="900" fill="${c[0]}"/><path d="${wave(470, 40, 0)}" fill="${c[1]}"/>`
    + `<path d="${wave(600, 34, 2)}" fill="${c[2]}"/><path d="${wave(730, 28, 4)}" fill="${c[3]}"/></svg>`) + ' center bottom / cover'
}

export const BACKGROUNDS = [
  { id: 'none', name: 'Aucune', css: () => 'none' },
  {
    id: 'aurore', name: 'Aurore', css: (dark) => dark
      ? 'radial-gradient(60% 70% at 15% 20%, #3b2a8f 0%, transparent 60%), radial-gradient(50% 60% at 85% 30%, #0f5d73 0%, transparent 60%), radial-gradient(60% 60% at 60% 95%, #5a1f6e 0%, transparent 60%), #0b0d18'
      : 'radial-gradient(60% 70% at 15% 20%, #c9c4ff 0%, transparent 60%), radial-gradient(50% 60% at 85% 30%, #b6ecf2 0%, transparent 60%), radial-gradient(60% 60% at 60% 95%, #f5c9ea 0%, transparent 60%), #f3f3fb',
  },
  { id: 'montagnes', name: 'Montagnes', css: mountains },
  { id: 'reseau', name: 'Réseau', css: network },
  { id: 'ocean', name: 'Océan', css: ocean },
  {
    id: 'plan', name: 'Plan', css: (dark) => dark
      ? 'linear-gradient(#ffffff0d 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, #ffffff0d 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(#ffffff1f 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(90deg, #ffffff1f 1px, transparent 1px) 0 0 / 120px 120px, #0f2340'
      : 'linear-gradient(#1d4ed812 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, #1d4ed812 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(#1d4ed826 1px, transparent 1px) 0 0 / 120px 120px, linear-gradient(90deg, #1d4ed826 1px, transparent 1px) 0 0 / 120px 120px, #eef4ff',
  },
  {
    id: 'crepuscule', name: 'Crépuscule', css: (dark) => dark
      ? 'linear-gradient(160deg, #1a1033 0%, #4a1d4f 45%, #8a3b3b 80%, #c26a3a 100%)'
      : 'linear-gradient(160deg, #fde7d9 0%, #f8c9c4 40%, #d9c3f0 75%, #b9cdf5 100%)',
  },
]

/** Image personnelle envoyée sur le serveur (`version` change à chaque envoi). */
export function customBackground(version) {
  return `url("api/background?v=${version}") center / cover`
}

/** Valeur CSS du fond choisi, ou null s'il n'y en a pas. */
export function backgroundCss(id, dark, customVersion) {
  if (id === 'custom') return customVersion ? customBackground(customVersion) : null
  const bg = BACKGROUNDS.find((b) => b.id === id)
  return bg && bg.id !== 'none' ? bg.css(dark) : null
}

/**
 * Réduit une photo avant l'envoi (2560 px de large au plus, JPEG) : l'image reste nette en fond
 * d'écran et pèse quelques centaines de Ko au lieu de plusieurs Mo.
 */
export async function shrinkImage(file, max = 2560) {
  if (file.type === 'image/gif') return file // une image animée perdrait son animation
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error("impossible de lire l'image"))), 'image/jpeg', 0.85))
}

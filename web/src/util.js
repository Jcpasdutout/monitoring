import { useEffect, useState } from 'react'

/** État mémorisé dans le navigateur (localStorage), restauré au prochain chargement. */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved !== null ? JSON.parse(saved) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* navigation privée */ }
  }, [key, value])
  return [value, setValue]
}

function inFrame() {
  try { return window.self !== window.top } catch { return true } // cadre d'une autre origine
}

/**
 * Vrai quand l'interface est affichée à l'intérieur d'une autre page (panneau de l'add-on Home
 * Assistant via l'Ingress, carte ou panneau « page web » de HA), ou forcé avec ?integre dans
 * l'adresse. La page hôte a déjà son bandeau en haut : le menu de l'application devient alors
 * une petite barre flottante en bas à droite.
 */
export const EMBEDDED = inFrame()
  || window.location.pathname.includes('/api/hassio_ingress/')
  || new URLSearchParams(window.location.search).has('integre')

/** Vrai quand la page hôte est l'interface de Home Assistant (panneau de l'add-on via l'Ingress). */
export const IN_HOME_ASSISTANT = (() => {
  try {
    return window.parent !== window && !!window.parent.document.querySelector('home-assistant')
  } catch {
    return false // page hôte d'une autre origine
  }
})()

/**
 * Plein écran dans Home Assistant : demande à HA de masquer sa barre latérale et son bandeau
 * (son « mode kiosque »), ou de les réafficher. Message prévu par HA pour les panneaux d'add-ons.
 */
export function setHomeAssistantFullscreen(on) {
  if (!IN_HOME_ASSISTANT) return
  window.parent.postMessage(
    on ? { type: 'home-assistant/subscribe-properties', kioskMode: true }
      : { type: 'home-assistant/unsubscribe-properties' },
    '*',
  )
}

export const STATUS_LABEL = { ok: 'OK', warning: 'Alerte', error: 'Erreur', pending: 'En attente', paused: 'En pause' }

export function statusOf(probe) {
  if (!probe.enabled) return 'paused'
  return probe.last?.status || 'pending'
}

export function timeAgo(ts) {
  if (!ts) return 'jamais'
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts))
  if (s < 60) return `il y a ${s} s`
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`
  return new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export function formatInterval(s) {
  if (s % 3600 === 0) return `${s / 3600} h`
  if (s % 60 === 0) return `${s / 60} min`
  return `${s} s`
}

export function formatValue(v) {
  if (v === null || v === undefined) return '—'
  return Number.isInteger(v) ? v.toLocaleString('fr-FR') : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
}

/** Thèmes proposés par le bouton, dans l'ordre du cycle. « Transparent » n'a de sens que dans HA. */
export const THEMES = EMBEDDED ? ['light', 'dark', 'transparent'] : ['light', 'dark']

/** Lit le fond du thème Home Assistant (page parente, même origine via l'Ingress) : clair ou sombre ? */
function hostAppearance() {
  const fallback = { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', scheme: '', background: '' }
  try {
    const doc = window.parent.document
    const host = getComputedStyle(doc.documentElement)
    let bg = host.getPropertyValue('--primary-background-color').trim()
    if (!bg) bg = getComputedStyle(doc.body).backgroundColor
    // Convertit n'importe quelle couleur CSS en rgb(...) pour en calculer la luminosité.
    const probe = document.createElement('span')
    probe.style.color = bg
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number)
    probe.remove()
    const lum = rgb && (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
    return {
      theme: lum === undefined || rgb[3] === 0 ? fallback.theme : lum < 0.5 ? 'dark' : 'light',
      // Le navigateur ne laisse voir à travers le cadre que si les deux pages ont le même color-scheme.
      scheme: window.frameElement ? getComputedStyle(window.frameElement).colorScheme : '',
      // Image ou dégradé de fond défini par le thème HA : HA ne l'affiche que sur les tableaux de bord,
      // pas derrière le panneau de l'add-on, donc on le peint nous-mêmes.
      background: host.getPropertyValue('--lovelace-background').trim()
        || host.getPropertyValue('--ha-panel-background').trim(),
    }
  } catch {
    return fallback // page hôte d'une autre origine : on ne peut pas la lire
  }
}

/** Applique le thème choisi sur <html>. En mode transparent, suit le thème HA quand il change. */
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme !== 'transparent' || !EMBEDDED) {
    delete root.dataset.bg
    root.style.colorScheme = ''
    root.style.removeProperty('--ha-background')
    root.dataset.theme = theme === 'dark' ? 'dark' : 'light'
    return () => {}
  }
  const update = () => {
    const { theme: t, scheme, background } = hostAppearance()
    root.dataset.theme = t
    root.dataset.bg = 'transparent'
    root.style.colorScheme = scheme || ''
    if (background) root.style.setProperty('--ha-background', background)
    else root.style.removeProperty('--ha-background')
  }
  update()
  const observers = []
  try {
    const doc = window.parent.document
    for (const el of [doc.documentElement, doc.body, window.frameElement].filter(Boolean)) {
      const o = new MutationObserver(update)
      o.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })
      observers.push(o)
    }
  } catch { /* autre origine */ }
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', update)
  const timer = setInterval(update, 5000) // filet de sécurité (thème HA changé autrement)
  return () => {
    observers.forEach((o) => o.disconnect())
    mq.removeEventListener('change', update)
    clearInterval(timer)
  }
}

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

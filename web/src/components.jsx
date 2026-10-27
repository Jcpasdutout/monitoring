import { useEffect } from 'react'
import { X } from 'lucide-react'
import { STATUS_LABEL } from './util.js'

export function StatusDot({ status, pulse }) {
  return <span className={`dot dot-${status} ${pulse && status === 'error' ? 'pulse' : ''}`} />
}

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}><StatusDot status={status} />{STATUS_LABEL[status]}</span>
}

/** Courbe des dernières valeurs. */
export function Sparkline({ history, status }) {
  const pts = history.filter((h) => typeof h.value === 'number')
  if (pts.length < 2) return <div className="spark spark-empty" />
  const w = 200, h = 40, pad = 3
  const vals = pts.map((p) => p.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const span = max - min || 1
  const xy = pts.map((p, i) => [
    pad + (i * (w - 2 * pad)) / (pts.length - 1),
    h - pad - ((p.value - min) / span) * (h - 2 * pad),
  ])
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${xy.at(-1)[0].toFixed(1)},${h} L${xy[0][0].toFixed(1)},${h} Z`
  return (
    <svg className={`spark spark-${status}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path className="spark-area" d={area} />
      <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Une barre par vérification récente, colorée selon le statut. */
export function StatusBar({ history, size = 30 }) {
  const items = history.slice(-size)
  const blanks = Array.from({ length: size - items.length })
  return (
    <div className="statusbar">
      {blanks.map((_, i) => <span key={`b${i}`} className="sb sb-empty" />)}
      {items.map((h, i) => (
        <span key={i} className={`sb sb-${h.status}`}
          title={`${new Date(h.ts * 1000).toLocaleString('fr-FR')} — ${h.summary || ''}`} />
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true">
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  )
}

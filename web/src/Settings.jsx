import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Layers, LayoutGrid, List, Settings as Gear } from 'lucide-react'
import { Toggle } from './components.jsx'
import { isProblems, PROBLEMS } from './Dashboard.jsx'

/** Menu « roue crantée » : filtre, présentation, image de fond (children), masquage du bandeau et versions. */
export default function Settings({ children, filter, setFilter, total, problemCount, view, setView, autoHide, setAutoHide, version, addonVersion }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button className={`icon-btn icon-btn-bordered ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)}
        title="Réglages d'affichage" aria-expanded={open}>
        <Gear size={17} className="gear" />
      </button>
      {open && (
        <div className="menu-pop settings-pop">
          <div className="settings-section">
            <div className="settings-label">Sondes affichées</div>
            <div className="segmented segmented-full" role="group">
              <button className={!filter.length ? 'active' : ''} onClick={() => setFilter([])}>
                <Layers size={15} />Toutes<span className="seg-count">{total}</span>
              </button>
              <button className={isProblems(filter) ? 'active' : ''} onClick={() => setFilter(PROBLEMS)}>
                <AlertTriangle size={15} />Alertes et erreurs
                <span className={`seg-count ${problemCount ? 'seg-count-alert' : ''}`}>{problemCount}</span>
              </button>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-label">Présentation</div>
            <div className="segmented segmented-full" role="group">
              <button className={view !== 'list' ? 'active' : ''} onClick={() => setView('cards')}>
                <LayoutGrid size={15} />Cadre
              </button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
                <List size={15} />Liste
              </button>
            </div>
          </div>
          {children}
          {setAutoHide && (
            <div className="settings-section settings-row">
              <Toggle checked={autoHide} onChange={setAutoHide} label="Masquer automatiquement le bandeau" />
            </div>
          )}
          {version && (
            <div className="settings-version">
              {addonVersion && <span>Add-on {addonVersion}</span>}
              <span>Application {version}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

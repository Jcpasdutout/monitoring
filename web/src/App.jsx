import { useCallback, useEffect, useState } from 'react'
import { Activity, Blend, LayoutDashboard, ListChecks, Maximize2, Minimize2, Moon, RefreshCw, Sun } from 'lucide-react'
import { api } from './api.js'
import Account from './Account.jsx'
import BackgroundPicker from './Background.jsx'
import { backgroundCss } from './backgrounds.js'
import Dashboard, { filterProbes, normalizeFilter, PROBLEMS } from './Dashboard.jsx'
import Login from './Login.jsx'
import Probes from './Probes.jsx'
import Settings from './Settings.jsx'
import {
  applyTheme, EMBEDDED, IN_HOME_ASSISTANT, setHomeAssistantFullscreen, THEMES, usePersistentState, useRootTheme,
} from './util.js'

const REFRESH_MS = 10000

// Le bouton affiche le thème qu'on obtiendra en cliquant.
const THEME_BUTTON = {
  light: { icon: Sun, title: 'Passer en fond clair' },
  dark: { icon: Moon, title: 'Passer en fond sombre' },
  transparent: { icon: Blend, title: 'Passer en fond transparent (fond du thème Home Assistant)' },
}

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => setRoute(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export default function App() {
  const route = useHashRoute()
  const [types, setTypes] = useState([])
  const [probes, setProbes] = useState(null)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [auth, setAuth] = useState(null) // { setup_needed, user }
  const [savedFilter, setFilter] = usePersistentState('monitoring.filter', [])
  const filter = normalizeFilter(savedFilter)
  const [view, setView] = usePersistentState('monitoring.view', 'cards')
  const [autoHide, setAutoHide] = usePersistentState('monitoring.autoHide', true)
  const [savedTheme, setTheme] = usePersistentState('monitoring.theme', document.documentElement.dataset.theme || 'light')
  const theme = THEMES.includes(savedTheme) ? savedTheme : 'light'
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  const NextThemeIcon = THEME_BUTTON[nextTheme].icon

  useEffect(() => applyTheme(theme), [theme])

  // Image de fond (choix mémorisé dans ce navigateur ; l'image personnelle est sur le serveur).
  const [background, setBackground] = usePersistentState('monitoring.background', 'none')
  const [veil, setVeil] = usePersistentState('monitoring.backgroundVeil', 25)
  const [glass, setGlass] = usePersistentState('monitoring.backgroundGlass', true)
  const [bgInHa, setBgInHa] = usePersistentState('monitoring.backgroundTransparent', false)
  const rootTheme = useRootTheme()

  // Dans Home Assistant : plein écran (sans la barre latérale ni le bandeau de HA) ou non.
  const [haFullscreen, setHaFullscreen] = usePersistentState('monitoring.haFullscreen', false)
  useEffect(() => setHomeAssistantFullscreen(haFullscreen), [haFullscreen])

  const loadAuth = useCallback(() => api.auth().then(setAuth).catch(() => {}), [])
  useEffect(() => {
    loadAuth()
    window.addEventListener('monitoring:unauthorized', loadAuth)
    return () => window.removeEventListener('monitoring:unauthorized', loadAuth)
  }, [loadAuth])

  const load = useCallback(async () => {
    try {
      setProbes(await api.probes())
      setError(null)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'Serveur injoignable' : e.message)
    }
  }, [])

  useEffect(() => {
    api.types().then(setTypes).catch(() => {})
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind, id: Date.now() })
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const refreshAll = async () => {
    setRefreshing(true)
    await api.refresh().catch(() => {})
    setTimeout(async () => { await load(); setRefreshing(false) }, 3000)
  }

  const unread = (probes || [])
    .filter((p) => p.type === 'imap' && p.enabled && p.last?.status !== 'error')
    .reduce((a, p) => a + (p.last?.value || 0), 0)
  useEffect(() => {
    document.title = unread ? `(${unread}) Monitoring` : 'Monitoring'
  }, [unread])

  const customVersion = auth?.background || null
  const setCustomVersion = (v) => setAuth((a) => ({ ...a, background: v }))
  // En mode transparent (Home Assistant), le fond du thème HA reste visible sauf si on demande l'image.
  const bgCss = rootTheme.transparent && !bgInHa ? null : backgroundCss(background, rootTheme.dark, customVersion)

  const page = route.startsWith('/sondes') ? 'probes' : 'dashboard'
  const problemCount = probes ? filterProbes(probes, PROBLEMS).length : 0
  const worst = !probes ? 'ok'
    : filterProbes(probes, ['error']).length ? 'error'
    : filterProbes(probes, ['warning']).length ? 'warning' : 'ok'

  return (
    <div className={`app ${bgCss ? 'has-bg' : ''} ${bgCss && glass ? 'glass' : ''}`}>
      {bgCss && <div className="app-bg" style={{ background: bgCss }} />}
      {bgCss && <div className="app-veil" style={{ opacity: veil / 100 }} />}
      {/* Bandeau masqué (option) : une fine bande reste visible et le déplie au survol (ou au toucher).
          Dans Home Assistant, le menu flotte en bas à droite pour ne pas doubler le bandeau de HA. */}
      <div className={`topbar-zone ${EMBEDDED ? 'embedded' : autoHide ? 'autohide' : 'pinned'}`} tabIndex={-1}>
        {autoHide && !EMBEDDED && <div className={`topbar-strip strip-${error ? 'error' : worst}`} />}
      <header className="topbar">
        <div className="brand"><span className="logo"><Activity size={18} /></span>Monitoring</div>
        <nav className="tabs">
          <a href="#/" title="Tableau de bord" className={page === 'dashboard' ? 'active' : ''}><LayoutDashboard size={16} /><span>Tableau de bord</span></a>
          <a href="#/sondes" title="Sondes" className={page === 'probes' ? 'active' : ''}><ListChecks size={16} /><span>Sondes</span></a>
        </nav>
        <div className="topbar-right">
          {error && <span className="conn-error" title={error}>{EMBEDDED ? <span className="dot dot-error" /> : error}</span>}
          <button className="btn btn-ghost" onClick={refreshAll} disabled={refreshing} title="Relancer toutes les sondes">
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} /><span className="hide-sm">Actualiser</span>
          </button>
          {IN_HOME_ASSISTANT && (
            <button className="icon-btn icon-btn-bordered" onClick={() => setHaFullscreen(!haFullscreen)}
              title={haFullscreen ? "Réafficher l'interface de Home Assistant" : "Plein écran (masquer l'interface de Home Assistant)"}>
              {haFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          )}
          <button className="icon-btn icon-btn-bordered" onClick={() => setTheme(nextTheme)} title={THEME_BUTTON[nextTheme].title}>
            <NextThemeIcon size={17} />
          </button>
          <Settings filter={filter} setFilter={setFilter} total={probes?.length || 0} problemCount={problemCount}
            view={view} setView={setView} autoHide={autoHide} setAutoHide={EMBEDDED ? null : setAutoHide}
            version={auth?.version} addonVersion={auth?.addon_version}>
            <BackgroundPicker dark={rootTheme.dark} customVersion={customVersion} setCustomVersion={setCustomVersion}
              isAdmin={!!auth?.user} notify={notify}
              settings={{ background, setBackground, veil, setVeil, glass, setGlass,
                inHa: bgInHa, setInHa: EMBEDDED ? setBgInHa : null }} />
          </Settings>
          {auth?.user && (
            <Account user={auth.user} notify={notify}
              onLogout={async () => { await loadAuth(); await load(); notify('Déconnecté') }} />
          )}
        </div>
      </header>
      </div>

      <main className="content">
        {probes === null ? (
          <div className="empty">{error || 'Chargement…'}</div>
        ) : page === 'dashboard' ? (
          <Dashboard probes={probes} types={types} reload={load} notify={notify} filter={filter} setFilter={setFilter} view={view} loggedIn={!!auth?.user} />
        ) : !auth ? (
          <div className="empty">Chargement…</div>
        ) : !auth.user ? (
          <Login setupNeeded={auth.setup_needed}
            onDone={async (user) => { setAuth({ setup_needed: false, user }); await load() }} />
        ) : (
          <Probes probes={probes} types={types} reload={load} notify={notify} />
        )}
      </main>

      {toast && <div key={toast.id} className={`toast toast-${toast.kind}`}>{toast.message}</div>}
    </div>
  )
}

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Lock, Mail, Plus, Play, Trash2, X, XCircle } from 'lucide-react'
import { api } from './api.js'
import { Sparkline, StatusBadge, StatusBar, StatusDot } from './components.jsx'
import TypeIcon from './TypeIcon.jsx'
import { formatValue, shortDate, statusOf, timeAgo } from './util.js'

/** Sondes affichées pour chaque filtre (l'entête propose « all » et « problems »). */
/** Filtres des blocs du haut ; plusieurs peuvent être cochés (une sonde s'affiche si elle en vérifie au moins un). */
export const FILTERS = {
  ok: { label: 'OK', test: (p, st) => p.enabled && st === 'ok' },
  warning: { label: 'Alertes', test: (p, st) => p.enabled && st === 'warning' },
  error: { label: 'Erreurs', test: (p, st) => p.enabled && st === 'error' },
  mail: { label: 'Mails', test: (p) => p.enabled && p.type === 'imap' },
}
export const PROBLEMS = ['warning', 'error']

/** Normalise le filtre mémorisé (liste de clés ; ancien format : une chaîne). */
export function normalizeFilter(saved) {
  if (saved === 'problems') return PROBLEMS
  if (typeof saved === 'string') saved = saved === 'all' ? [] : [saved]
  return Array.isArray(saved) ? Object.keys(FILTERS).filter((k) => saved.includes(k)) : []
}

export const isProblems = (filter) => filter.length === 2 && PROBLEMS.every((k) => filter.includes(k))

export function filterProbes(probes, filter) {
  if (!filter.length) return probes
  return probes.filter((p) => filter.some((k) => FILTERS[k].test(p, statusOf(p))))
}

function Stat({ icon, label, value, tone, active, onClick }) {
  return (
    <button type="button" className={`stat stat-${tone} ${active ? 'stat-active' : ''}`} onClick={onClick}
      aria-pressed={active} title={active ? `Retirer « ${label} » du filtre` : `Ajouter « ${label} » au filtre`}>
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </button>
  )
}

function useRunNow(probe, reload, notify) {
  const [running, setRunning] = useState(false)
  const runNow = async () => {
    setRunning(true)
    try {
      await api.run(probe.id)
      await reload()
    } catch (e) {
      notify(e.message, 'error')
    }
    setRunning(false)
  }
  return [running, runNow]
}

/** Ligne compacte de la vue Liste. */
function ProbeRow({ probe, reload, notify }) {
  const [running, runNow] = useRunNow(probe, reload, notify)
  const status = statusOf(probe)
  const last = probe.last
  const unit = last?.details?.unit
  const showValue = last && status !== 'error' && status !== 'paused'
  return (
    <div className={`row row-${status}`}>
      <StatusDot status={status} pulse />
      <span className="type-chip type-chip-sm"><TypeIcon type={probe.type} size={13} /></span>
      <span className="row-name" title={probe.name}>{probe.name}</span>
      <span className="row-value">
        {showValue ? <>{formatValue(last.value)}{unit && <small> {unit}</small>}</> : '—'}
      </span>
      <span className={`row-summary ${status === 'error' ? 'summary-error' : ''}`} title={last?.summary}>
        {!probe.enabled ? 'Désactivée' : !last ? 'En attente…'
          : last.summary === `${last.value} ${unit}` ? '' : last.summary}
      </span>
      <span className="row-bar"><StatusBar history={probe.history} size={20} /></span>
      <span className="row-time muted small">{timeAgo(last?.ts)}</span>
      <button className="icon-btn" onClick={runNow} disabled={running} title="Vérifier maintenant">
        <Play size={14} className={running ? 'spin-slow' : ''} />
      </button>
    </div>
  )
}

/** Ligne d'aperçu d'un mail ; au survol, bouton pour le mettre à la corbeille (avec confirmation). */
function MailLine({ mail, probe, reload, notify }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      const r = await api.action(probe.id, 'delete_mail', { folder: mail.folder, uid: mail.uid })
      setGone(true)
      notify(`Mail déplacé dans « ${r.action.trash} »`)
      await reload()
    } catch (e) {
      notify(e.message, 'error')
      setBusy(false)
      setConfirming(false)
    }
  }

  if (gone) return null
  return (
    <li className={`mail ${confirming ? 'mail-confirm' : ''}`}>
      <div className="msg-top">
        <span className="msg-from">{mail.from}</span>
        <span className="muted small msg-date">{shortDate(mail.date)}</span>
        {mail.uid && (
          <button className="icon-btn mail-del" title="Mettre à la corbeille" onClick={() => setConfirming(true)}
            style={confirming ? { visibility: 'hidden' } : undefined}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="msg-subject">{mail.subject}</div>
      {confirming && (
        <div className="mail-ask">
          <span>Mettre ce mail à la corbeille ?</span>
          <button className="btn btn-danger btn-xs" onClick={remove} disabled={busy}>{busy ? '…' : 'Oui'}</button>
          <button className="btn btn-ghost btn-xs" onClick={() => setConfirming(false)} disabled={busy}>Non</button>
        </div>
      )}
    </li>
  )
}

function ProbeCard({ probe, reload, notify, loggedIn }) {
  const [running, runNow] = useRunNow(probe, reload, notify)
  const status = statusOf(probe)
  const last = probe.last
  const unit = last?.details?.unit
  const messages = last?.details?.messages || []
  const folders = last?.details?.folders
  const gauges = (status !== 'error' && last?.details?.gauges) || []

  return (
    <article className={`card card-${status}`}>
      <div className="card-head">
        <span className="type-chip"><TypeIcon type={probe.type} size={15} /></span>
        <div className="card-title">
          <h3>{probe.name}</h3>
          <span className="muted small">{timeAgo(last?.ts)}</span>
        </div>
        <button className="icon-btn" onClick={runNow} disabled={running} title="Vérifier maintenant">
          <Play size={15} className={running ? 'spin-slow' : ''} />
        </button>
      </div>

      <div className="card-main">
        <div className="metric">
          <span className="metric-value">{last && status !== 'error' ? formatValue(last.value) : '—'}</span>
          {unit && last && status !== 'error' && <span className="metric-unit">{unit}</span>}
        </div>
        <StatusBadge status={status} />
      </div>
      {!(probe.enabled && last && (last.summary === `${last.value} ${unit}` || gauges.length)) && (
        <p className={`summary ${status === 'error' ? 'summary-error' : ''}`}>
          {probe.enabled ? last?.summary || 'Première vérification en cours…' : 'Sonde désactivée'}
        </p>
      )}

      {gauges.length > 0 && probe.enabled && (
        <div className="gauges">
          {gauges.map((g, i) => (
            <div key={i} className={`gauge gauge-${g.level}`} title={g.text}>
              <div className="gauge-head">
                <span className="gauge-label">{g.label}</span>
                <span className="gauge-value">{g.pct !== null ? `${formatValue(g.pct)} %` : g.text}</span>
              </div>
              {g.pct !== null && <div className="gauge-track"><div className="gauge-fill" style={{ width: `${Math.min(100, g.pct)}%` }} /></div>}
              {g.pct !== null && <div className="gauge-text">{g.text}</div>}
            </div>
          ))}
        </div>
      )}
      {probe.type !== 'imap' && !gauges.length && <Sparkline history={probe.history} status={status} />}
      <StatusBar history={probe.history} />

      {folders && Object.keys(folders).length > 1 && (
        <div className="folders">
          {Object.entries(folders).map(([f, n]) => <span key={f} className="chip">{f} · {n ?? '?'}</span>)}
        </div>
      )}
      {probe.type === 'imap' && !loggedIn && status !== 'error' && last?.value > 0 && (
        <a className="locked-hint" href="#/sondes"><Lock size={13} />Connectez-vous pour voir l'aperçu des mails</a>
      )}
      {messages.length > 0 && (
        <ul className="messages">
          {messages.map((m) => (
            <MailLine key={`${m.folder}/${m.uid ?? m.subject}`} mail={m} probe={probe} reload={reload} notify={notify} />
          ))}
        </ul>
      )}
    </article>
  )
}

export default function Dashboard({ probes, reload, notify, filter, setFilter, view, loggedIn }) {
  if (!probes.length) {
    return (
      <div className="empty-state">
        <h2>Aucune sonde pour l'instant</h2>
        <p>Ajoutez une boîte mail, une API ou une machine à surveiller.</p>
        <a className="btn btn-primary" href="#/sondes?new=1"><Plus size={16} />Ajouter une sonde</a>
      </div>
    )
  }
  const active = probes.filter((p) => p.enabled)
  const count = (s) => active.filter((p) => statusOf(p) === s).length
  const unread = active.filter((p) => p.type === 'imap' && p.last?.status !== 'error')
    .reduce((a, p) => a + (p.last?.value || 0), 0)

  const shown = filterProbes(probes, filter)
  const toggle = (k) => setFilter(filter.includes(k) ? filter.filter((x) => x !== k) : [...filter, k])
  const problemsOnly = isProblems(filter)
  const groups = {}
  for (const p of shown) (groups[p.group] ??= []).push(p)
  const groupNames = Object.keys(groups).sort((a, b) => (!a) - (!b) || a.localeCompare(b, 'fr'))

  return (
    <>
      <section className="stats">
        <Stat icon={<CheckCircle2 size={20} />} label="OK" value={count('ok')} tone="ok"
          active={filter.includes('ok')} onClick={() => toggle('ok')} />
        <Stat icon={<AlertTriangle size={20} />} label="Alertes" value={count('warning')} tone="warning"
          active={filter.includes('warning')} onClick={() => toggle('warning')} />
        <Stat icon={<XCircle size={20} />} label="Erreurs" value={count('error')} tone="error"
          active={filter.includes('error')} onClick={() => toggle('error')} />
        <Stat icon={<Mail size={20} />} label="Mails non lus" value={unread} tone="accent"
          active={filter.includes('mail')} onClick={() => toggle('mail')} />
      </section>
      {filter.length > 0 && (
        <div className="filter-note">
          Filtre : <strong>{normalizeFilter(filter).map((k) => FILTERS[k].label).join(' + ')}</strong> · {shown.length} sonde{shown.length > 1 ? 's' : ''}
          <button className="link-btn" onClick={() => setFilter([])}><X size={14} />Tout afficher</button>
        </div>
      )}
      {!shown.length && (
        <div className={`empty-state ${problemsOnly ? 'all-good' : ''}`}>
          {problemsOnly && <CheckCircle2 size={32} />}
          <h2>{problemsOnly ? 'Tout va bien' : 'Rien à afficher'}</h2>
          <p>{problemsOnly ? 'Aucune sonde en alerte ou en erreur.' : 'Aucune sonde ne correspond au filtre.'}</p>
        </div>
      )}
      {groupNames.map((name) => [name, groups[name]]).map(([name, list]) => (
        <section key={name} className="group">
          <h2 className="group-title">{name || 'Sans groupe'}<span className="group-count">{list.length}</span></h2>
          {view === 'list' ? (
            <div className="list">
              {list.map((p) => <ProbeRow key={p.id} probe={p} reload={reload} notify={notify} />)}
            </div>
          ) : (
            <div className="grid">
              {list.map((p) => <ProbeCard key={p.id} probe={p} reload={reload} notify={notify} loggedIn={loggedIn} />)}
            </div>
          )}
        </section>
      ))}
    </>
  )
}

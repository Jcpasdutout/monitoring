import { useEffect, useState } from 'react'
import { Copy, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { api } from './api.js'
import { Modal, StatusDot, Toggle } from './components.jsx'
import ProbeForm from './ProbeForm.jsx'
import TypeIcon from './TypeIcon.jsx'
import { formatInterval, statusOf, STATUS_LABEL, timeAgo } from './util.js'

export default function Probes({ probes, types, reload, notify }) {
  const [editing, setEditing] = useState(null) // null | {} (nouvelle) | sonde
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(null)
  const typeLabel = Object.fromEntries(types.map((t) => [t.type, t.label]))

  useEffect(() => {
    if (window.location.hash.includes('new=1')) {
      setEditing({})
      window.history.replaceState(null, '', '#/sondes')
    }
  }, [])

  const toggle = async (p, enabled) => {
    try {
      await api.update(p.id, { enabled })
      await reload()
    } catch (e) { notify(e.message, 'error') }
  }

  const runNow = async (p) => {
    setBusy(p.id)
    try {
      const r = await api.run(p.id)
      notify(`${p.name} : ${r.summary}`, r.status === 'error' ? 'error' : 'info')
      await reload()
    } catch (e) { notify(e.message, 'error') }
    setBusy(null)
  }

  const confirmDelete = async () => {
    try {
      await api.remove(deleting.id)
      notify(`Sonde « ${deleting.name} » supprimée`)
      setDeleting(null)
      await reload()
    } catch (e) { notify(e.message, 'error') }
  }

  const groups = [...new Set(probes.map((p) => p.group).filter(Boolean))]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sondes</h1>
          <p className="muted">{probes.length} sonde{probes.length > 1 ? 's' : ''} configurée{probes.length > 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} />Nouvelle sonde</button>
      </div>

      {probes.length === 0 ? (
        <div className="empty-state">
          <h2>Aucune sonde</h2>
          <p>Commencez par ajouter votre boîte mail Free.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sonde</th><th className="hide-sm">Type</th><th className="hide-sm">Groupe</th>
                <th className="hide-sm">Fréquence</th><th>État</th><th>Active</th><th />
              </tr>
            </thead>
            <tbody>
              {probes.map((p) => {
                const st = statusOf(p)
                return (
                  <tr key={p.id} className={p.enabled ? '' : 'row-off'}>
                    <td>
                      <div className="cell-name">
                        <span className="type-chip"><TypeIcon type={p.type} size={14} /></span>
                        <div>
                          <div className="strong">{p.name}</div>
                          <div className="muted small ellipsis">{p.config.url || p.config.user || p.config.host}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hide-sm muted">{typeLabel[p.type] || p.type}</td>
                    <td className="hide-sm">{p.group ? <span className="chip">{p.group}</span> : <span className="muted">—</span>}</td>
                    <td className="hide-sm muted">{formatInterval(p.interval)}</td>
                    <td>
                      <div className="cell-status" title={p.last?.summary}>
                        <StatusDot status={st} />
                        <div>
                          <div>{STATUS_LABEL[st]}</div>
                          <div className="muted small">{timeAgo(p.last?.ts)}</div>
                        </div>
                      </div>
                    </td>
                    <td><Toggle checked={p.enabled} onChange={(v) => toggle(p, v)} /></td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Vérifier maintenant" onClick={() => runNow(p)} disabled={busy === p.id}>
                          <Play size={15} className={busy === p.id ? 'spin-slow' : ''} />
                        </button>
                        <button className="icon-btn" title="Modifier" onClick={() => setEditing(p)}><Pencil size={15} /></button>
                        <button className="icon-btn hide-sm" title="Dupliquer"
                          onClick={() => setEditing({ ...p, id: undefined, name: `${p.name} (copie)`, has_secret: false, copyOf: p.id })}>
                          <Copy size={15} />
                        </button>
                        <button className="icon-btn danger" title="Supprimer" onClick={() => setDeleting(p)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProbeForm
          probe={editing}
          types={types}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => { setEditing(null); notify(msg); await reload() }}
        />
      )}

      {deleting && (
        <Modal title="Supprimer la sonde ?" onClose={() => setDeleting(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setDeleting(null)}>Annuler</button>
            <button className="btn btn-danger" onClick={confirmDelete}><Trash2 size={16} />Supprimer</button>
          </>}>
          <p>« {deleting.name} » et son historique seront supprimés définitivement.</p>
        </Modal>
      )}
    </>
  )
}

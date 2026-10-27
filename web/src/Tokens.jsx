import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { api } from './api.js'
import { Modal } from './components.jsx'
import { timeAgo } from './util.js'

/** Jetons d'accès en lecture seule, pour Home Assistant ou un autre outil. */
export default function TokensModal({ onClose, notify }) {
  const [tokens, setTokens] = useState(null)
  const [name, setName] = useState('Home Assistant')
  const [created, setCreated] = useState(null) // jeton tout juste créé, affiché une seule fois
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(() => api.tokens().then(setTokens).catch((e) => setError(e.message)), [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await api.createToken(name)
      setCreated({ ...res, name })
      setCopied(false)
      load()
    } catch (err) { setError(err.message) }
  }

  const remove = async (t) => {
    if (!window.confirm(`Supprimer le jeton « ${t.name} » ? Ce qui l'utilise n'aura plus accès.`)) return
    await api.removeToken(t.id).catch((e) => setError(e.message))
    if (created?.id === t.id) setCreated(null)
    notify('Jeton supprimé')
    load()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      window.prompt('Copiez le jeton :', created.token)
    }
  }

  return (
    <Modal title="Jetons d'accès" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn btn-primary" onClick={onClose}>Fermer</button></>}>
      <div className="stack">
        <p className="muted tokens-intro">
          Un jeton permet à Home Assistant (ou à un autre outil) de lire l'état des sondes.
          Il ne permet pas de modifier les sondes.
        </p>

        {created && (
          <div className="alert alert-ok">
            <div className="alert-head"><strong>Jeton « {created.name} » créé</strong></div>
            <div className="token-reveal">
              <code>{created.token}</code>
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copié' : 'Copier'}
              </button>
            </div>
            <small className="help">Copiez-le maintenant : il ne sera plus jamais affiché.</small>
          </div>
        )}

        <form className="token-new" onSubmit={create}>
          <div className="field">
            <label htmlFor="t-name">Nom du nouveau jeton</label>
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
          <button className="btn btn-primary" type="submit"><Plus size={15} />Créer</button>
        </form>

        {error && <div className="alert alert-error">{error}</div>}

        {tokens === null ? <div className="muted">Chargement…</div>
          : !tokens.length ? <div className="muted">Aucun jeton pour l'instant.</div>
          : (
            <ul className="token-list">
              {tokens.map((t) => (
                <li key={t.id}>
                  <div>
                    <strong>{t.name}</strong> <span className="muted">…{t.hint}</span>
                    <div className="help">Créé {timeAgo(t.created_at)} · {t.last_used ? `utilisé ${timeAgo(t.last_used)}` : 'jamais utilisé'}</div>
                  </div>
                  <button className="icon-btn" onClick={() => remove(t)} title="Supprimer ce jeton"><Trash2 size={16} /></button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Modal>
  )
}

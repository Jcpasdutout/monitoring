import { useEffect, useRef, useState } from 'react'
import { ChevronDown, House, KeyRound, LogOut, UserRound } from 'lucide-react'
import { api } from './api.js'
import { Modal } from './components.jsx'
import TokensModal from './Tokens.jsx'

function PasswordModal({ onClose, notify }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas')
    try {
      await api.changePassword(current, password)
      notify('Mot de passe modifié')
      onClose()
    } catch (err) { setError(err.message) }
  }

  return (
    <Modal title="Changer le mot de passe" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" type="submit" form="pw-form">Enregistrer</button>
      </>}>
      <form id="pw-form" className="stack" onSubmit={submit}>
        <div className="field">
          <label htmlFor="p-cur">Mot de passe actuel</label>
          <input id="p-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="p-new">Nouveau mot de passe</label>
          <input id="p-new" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          <small className="help">8 caractères minimum</small>
        </div>
        <div className="field">
          <label htmlFor="p-new2">Confirmer</label>
          <input id="p-new2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </form>
    </Modal>
  )
}

export default function Account({ user, onLogout, notify }) {
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [tokens, setTokens] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const logout = async () => {
    setOpen(false)
    await api.logout().catch(() => {})
    onLogout()
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)}>
        <UserRound size={16} /><span className="hide-sm">{user}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu-pop">
          <button onClick={() => { setOpen(false); setChanging(true) }}><KeyRound size={15} />Changer le mot de passe</button>
          <button onClick={() => { setOpen(false); setTokens(true) }}><House size={15} />Jetons d'accès (Home Assistant)</button>
          <button onClick={logout}><LogOut size={15} />Se déconnecter</button>
        </div>
      )}
      {changing && <PasswordModal onClose={() => setChanging(false)} notify={notify} />}
      {tokens && <TokensModal onClose={() => setTokens(false)} notify={notify} />}
    </div>
  )
}

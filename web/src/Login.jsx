import { useState } from 'react'
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react'
import { api } from './api.js'

export default function Login({ setupNeeded, onDone }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (setupNeeded && password !== confirm) return setError('Les deux mots de passe ne correspondent pas')
    setBusy(true)
    try {
      const r = setupNeeded ? await api.setup(login, password) : await api.login(login, password)
      onDone(r.user)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <span className="login-icon">{setupNeeded ? <ShieldCheck size={22} /> : <KeyRound size={22} />}</span>
        <h1>{setupNeeded ? 'Créer le compte administrateur' : 'Connexion administrateur'}</h1>
        <p className="muted">
          {setupNeeded
            ? 'Ce compte protégera la gestion des sondes. Le tableau de bord reste consultable sans connexion.'
            : 'La gestion des sondes est réservée à l’administrateur.'}
        </p>
        <div className="field">
          <label htmlFor="l-login">Identifiant</label>
          <input id="l-login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="l-pw">Mot de passe</label>
          <input id="l-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={setupNeeded ? 'new-password' : 'current-password'} required minLength={setupNeeded ? 8 : undefined} />
          {setupNeeded && <small className="help">8 caractères minimum</small>}
        </div>
        {setupNeeded && (
          <div className="field">
            <label htmlFor="l-pw2">Confirmer le mot de passe</label>
            <input id="l-pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
        )}
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {setupNeeded ? <ShieldCheck size={16} /> : <LogIn size={16} />}
          {setupNeeded ? 'Créer le compte' : 'Se connecter'}
        </button>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { api } from './api.js'
import { Modal, Toggle } from './components.jsx'

/** Export : télécharge un fichier JSON avec toutes les sondes (et, au choix, leur historique).
 *  Avec un mot de passe d'export, les mots de passe des sondes sont inclus, chiffrés avec lui. */
export function ExportModal({ onClose, notify }) {
  const [history, setHistory] = useState(false)
  const [withSecrets, setWithSecrets] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e?.preventDefault()
    setError(null)
    if (withSecrets) {
      if (password.length < 8) return setError("Le mot de passe de l'export doit faire au moins 8 caractères.")
      if (password !== confirm) return setError('Les deux mots de passe ne sont pas identiques.')
    }
    setBusy(true)
    try {
      const { blob, name } = await api.exportBackup(history, withSecrets ? password : '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      notify('Export téléchargé')
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Exporter les sondes" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" type="submit" form="export-form" disabled={busy}>
          <Download size={15} />{busy ? 'Export…' : 'Télécharger'}
        </button>
      </>}>
      <form id="export-form" className="stack" onSubmit={submit}>
        <p className="muted backup-intro">
          Le fichier contient toutes les sondes et leurs réglages. Il permet de les restaurer
          ou de les copier vers une autre installation (par exemple l'add-on Home Assistant).
        </p>
        <Toggle checked={history} onChange={setHistory} label="Inclure l'historique des résultats" />
        <Toggle checked={withSecrets} onChange={setWithSecrets} label="Inclure les mots de passe des sondes" />
        {withSecrets ? (<>
          <div className="field">
            <label htmlFor="e-pw">Mot de passe de l'export</label>
            <input id="e-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" minLength={8} required />
            <small className="help">8 caractères minimum. Il te sera demandé à l'import : note-le bien.</small>
          </div>
          <div className="field">
            <label htmlFor="e-pw2">Confirmer</label>
            <input id="e-pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password" required />
          </div>
        </>) : (
          <div className="alert alert-warning">
            Les mots de passe des sondes ne seront pas dans le fichier : il faudra les ressaisir après l'import.
          </div>
        )}
        <small className="help">
          Les mots de passe sont chiffrés dans le fichier avec ce mot de passe.
          Le compte administrateur et les jetons d'accès ne sont pas exportés.
        </small>
        {error && <div className="alert alert-error">{error}</div>}
      </form>
    </Modal>
  )
}

/** Import : lit un fichier d'export, puis ajoute ses sondes ou remplace toutes les sondes. */
export function ImportModal({ onClose, notify, onImported }) {
  const [file, setFile] = useState(null)
  const [info, setInfo] = useState(null) // aperçu du fichier choisi
  const [replace, setReplace] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pick = async (e) => {
    const f = e.target.files?.[0]
    setFile(null); setInfo(null); setError(null)
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (data?.format !== 'monitoring-backup' || !Array.isArray(data.probes)) throw new Error()
      setFile(f)
      setInfo({
        count: data.probes.length,
        history: data.probes.reduce((a, p) => a + (p.history?.length || 0), 0),
        date: data.exported_at ? new Date(data.exported_at).toLocaleString('fr-FR') : null,
        version: data.app_version,
        protected: data.probes.some((p) => p?.secret_enc),
        plain: data.probes.some((p) => p?.secret),
        noSecrets: data.with_secrets === false,
      })
    } catch {
      setError("Ce fichier n'est pas une sauvegarde de Monitoring.")
    }
  }

  const submit = async () => {
    if (replace && !window.confirm('Toutes les sondes actuelles et leur historique seront supprimés, '
      + 'puis remplacés par ceux du fichier. Continuer ?')) return
    if (info?.protected && !password) return setError("Saisis le mot de passe choisi lors de l'export.")
    setBusy(true); setError(null)
    try {
      const res = await api.importBackup(file, replace, info?.protected ? password : '')
      notify(`${res.imported} sonde${res.imported > 1 ? 's' : ''} importée${res.imported > 1 ? 's' : ''}`)
      await onImported?.()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Importer une sauvegarde" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className={`btn ${replace ? 'btn-danger' : 'btn-primary'}`} onClick={submit} disabled={!file || busy}>
          <Upload size={15} />{busy ? 'Import…' : replace ? 'Remplacer les sondes' : 'Importer'}
        </button>
      </>}>
      <div className="stack">
        <div className="field">
          <label htmlFor="b-file">Fichier d'export (.json)</label>
          <input id="b-file" type="file" accept=".json,application/json" onChange={pick} />
        </div>
        {info && (
          <div className="alert alert-ok">
            {info.count} sonde{info.count > 1 ? 's' : ''}
            {info.history ? `, ${info.history} résultat${info.history > 1 ? 's' : ''} d'historique` : ', sans historique'}
            {info.date && <> · exporté le {info.date}</>}
            {info.version && <> · version {info.version}</>}
          </div>
        )}
        {info?.protected && (
          <div className="field">
            <label htmlFor="b-pw">Mot de passe de l'export</label>
            <input id="b-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="off" />
            <small className="help">Celui choisi lors de l'export : il protège les mots de passe des sondes.</small>
          </div>
        )}
        {info?.noSecrets && (
          <div className="alert alert-warning">
            Ce fichier ne contient pas les mots de passe des sondes : il faudra les ressaisir après l'import.
          </div>
        )}
        {info?.plain && (
          <div className="alert alert-warning">
            Ce fichier (ancienne version) contient les mots de passe en clair : supprime-le après l'import.
          </div>
        )}
        <div className="field">
          <label>Que faire des sondes actuelles ?</label>
          <div className="segmented segmented-full" role="group">
            <button type="button" className={!replace ? 'active' : ''} onClick={() => setReplace(false)}>Les garder (ajouter)</button>
            <button type="button" className={replace ? 'active' : ''} onClick={() => setReplace(true)}>Les remplacer</button>
          </div>
          <small className="help">
            {replace ? 'Les sondes actuelles et leur historique seront supprimés avant l\'import.'
              : 'Les sondes du fichier sont ajoutées à celles qui existent déjà.'}
          </small>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>
    </Modal>
  )
}

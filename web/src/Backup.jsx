import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { api } from './api.js'
import { Modal, Toggle } from './components.jsx'

/** Export : télécharge un fichier JSON avec toutes les sondes (et, au choix, leur historique). */
export function ExportModal({ onClose, notify }) {
  const [history, setHistory] = useState(false)

  return (
    <Modal title="Exporter les sondes" onClose={onClose}
      footer={<>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <a className="btn btn-primary" href={api.exportUrl(history)} download
          onClick={() => { notify('Export téléchargé'); onClose() }}>
          <Download size={15} />Télécharger
        </a>
      </>}>
      <div className="stack">
        <p className="muted backup-intro">
          Le fichier contient toutes les sondes et leurs réglages. Il permet de les restaurer
          ou de les copier vers une autre installation (par exemple l'add-on Home Assistant).
        </p>
        <Toggle checked={history} onChange={setHistory} label="Inclure l'historique des résultats" />
        <div className="alert alert-warning">
          Le fichier contient les mots de passe des sondes en clair : gardez-le en lieu sûr.
          Le compte administrateur et les jetons d'accès ne sont pas exportés.
        </div>
      </div>
    </Modal>
  )
}

/** Import : lit un fichier d'export, puis ajoute ses sondes ou remplace toutes les sondes. */
export function ImportModal({ onClose, notify, onImported }) {
  const [file, setFile] = useState(null)
  const [info, setInfo] = useState(null) // aperçu du fichier choisi
  const [replace, setReplace] = useState(false)
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
      })
    } catch {
      setError("Ce fichier n'est pas une sauvegarde de Monitoring.")
    }
  }

  const submit = async () => {
    if (replace && !window.confirm('Toutes les sondes actuelles et leur historique seront supprimés, '
      + 'puis remplacés par ceux du fichier. Continuer ?')) return
    setBusy(true); setError(null)
    try {
      const res = await api.importBackup(file, replace)
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

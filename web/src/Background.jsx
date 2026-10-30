import { useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { api } from './api.js'
import { BACKGROUNDS, backgroundCss, shrinkImage } from './backgrounds.js'
import { Toggle } from './components.jsx'

/** Galerie « Image de fond » du menu Réglages. */
export default function BackgroundPicker({ settings, dark, customVersion, setCustomVersion, isAdmin, notify }) {
  const { background, setBackground, veil, setVeil, glass, setGlass, inHa, setInHa } = settings
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const items = [...BACKGROUNDS, ...(customVersion ? [{ id: 'custom', name: 'Mon image' }] : [])]
  const current = items.find((b) => b.id === background) || BACKGROUNDS[0]

  const upload = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const { background: version } = await api.uploadBackground(await shrinkImage(file))
      setCustomVersion(version)
      setBackground('custom')
      notify('Image de fond enregistrée')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeCustom = async () => {
    try {
      await api.removeBackground()
      setCustomVersion(null)
      if (background === 'custom') setBackground('none')
      notify('Image supprimée')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-label settings-label-row">Image de fond<span>{current.name}</span></div>
      <div className="bg-gallery">
        {items.map((b) => (
          <div key={b.id} className="bg-thumb-wrap">
            <button className={`bg-thumb ${b.id === 'none' ? 'bg-thumb-none' : ''} ${b.id === current.id ? 'active' : ''}`}
              style={b.id === 'none' ? undefined : { background: backgroundCss(b.id, dark, customVersion) }}
              onClick={() => setBackground(b.id)} aria-pressed={b.id === current.id} title={b.name}>
              <span>{b.name}</span>
            </button>
            {b.id === 'custom' && isAdmin && (
              <button className="bg-thumb-del" onClick={removeCustom} title="Supprimer mon image" aria-label="Supprimer mon image">
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {isAdmin && (
          <button className="bg-thumb bg-thumb-add" onClick={() => fileRef.current.click()} disabled={busy}
            title={customVersion ? 'Remplacer mon image' : 'Importer une image depuis cet appareil'}>
            <ImagePlus size={18} /><span>{busy ? 'Envoi…' : 'Importer'}</span>
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={upload} />
      {!isAdmin && <div className="settings-hint">Connecte-toi (page Sondes) pour importer ta propre image.</div>}
      {current.id !== 'none' && (
        <div className="bg-options">
          <label className="bg-veil">
            <span>Voile</span>
            <input type="range" min="0" max="80" step="5" value={veil} onChange={(e) => setVeil(+e.target.value)} />
            <output>{veil} %</output>
          </label>
          <Toggle checked={glass} onChange={setGlass} label="Cartes en verre dépoli" />
          {setInHa && <Toggle checked={inHa} onChange={setInHa} label="Garder l'image en mode transparent" />}
        </div>
      )}
    </div>
  )
}

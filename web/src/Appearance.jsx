import { useRef, useState } from 'react'
import { Blend, Image, ImagePlus, Moon, Sun, X } from 'lucide-react'
import { api } from './api.js'
import { BACKGROUNDS, backgroundCss, shrinkImage } from './backgrounds.js'
import { Toggle } from './components.jsx'
import { THEMES } from './util.js'

const THEME_CHOICES = {
  dark: { icon: Moon, label: 'Sombre' },
  light: { icon: Sun, label: 'Clair' },
  image: { icon: Image, label: 'Image' },
  transparent: { icon: Blend, label: 'Transparent', title: 'Fond du thème Home Assistant' },
}

/**
 * Thème (Sombre / Clair / Image, plus Transparent dans Home Assistant) et, en mode Image, la galerie.
 * Recliquer sur l'image choisie bascule entre sa version claire et sa version sombre ; l'interface
 * (cartes, textes) suit la version affichée.
 */
export default function Appearance({ theme, setTheme, settings, customVersion, setCustomVersion, isAdmin, notify }) {
  const { background, setBackground, variant, setVariant, veil, setVeil, glass, setGlass } = settings
  const dark = variant === 'dark'
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const items = [...BACKGROUNDS, ...(customVersion ? [{ id: 'custom', name: 'Mon image' }] : [])]
  const current = items.find((b) => b.id === background) || items[0]

  const pick = (id) => (id === current.id ? setVariant(dark ? 'light' : 'dark') : setBackground(id))

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
      if (background === 'custom') setBackground(BACKGROUNDS[0].id)
      notify('Image supprimée')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  return (
    <>
      <div className="settings-section">
        <div className="settings-label">Thème</div>
        <div className={`segmented segmented-full ${THEMES.length > 3 ? 'segmented-compact' : ''}`} role="group">
          {THEMES.map((t) => {
            const { icon: Icon, label, title } = THEME_CHOICES[t]
            return (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)} title={title}>
                <Icon size={15} />{label}
              </button>
            )
          })}
        </div>
      </div>
      {theme === 'image' && (
        <div className="settings-section">
          <div className="settings-label settings-label-row">
            Image de fond<span>{current.name} · {dark ? 'sombre' : 'claire'}</span>
          </div>
          <div className="bg-gallery">
            {items.map((b) => {
              const active = b.id === current.id
              return (
                <div key={b.id} className="bg-thumb-wrap">
                  <button className={`bg-thumb ${active ? 'active' : ''}`}
                    style={{ background: backgroundCss(b.id, dark, customVersion) }}
                    onClick={() => pick(b.id)} aria-pressed={active}
                    title={active ? `Cliquer pour la version ${dark ? 'claire' : 'sombre'}` : b.name}>
                    <span>{b.name}</span>
                    {active && <i className="bg-thumb-mode">{dark ? <Moon size={11} /> : <Sun size={11} />}</i>}
                  </button>
                  {b.id === 'custom' && isAdmin && (
                    <button className="bg-thumb-del" onClick={removeCustom} title="Supprimer mon image" aria-label="Supprimer mon image">
                      <X size={12} />
                    </button>
                  )}
                </div>
              )
            })}
            {isAdmin && (
              <button className="bg-thumb bg-thumb-add" onClick={() => fileRef.current.click()} disabled={busy}
                title={customVersion ? 'Remplacer mon image' : 'Importer une image depuis cet appareil'}>
                <ImagePlus size={18} /><span>{busy ? 'Envoi…' : 'Importer'}</span>
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={upload} />
          <div className="settings-hint">
            Clique à nouveau sur l'image choisie pour passer en version {dark ? 'claire' : 'sombre'}.
            {!isAdmin && ' Connecte-toi (page Sondes) pour importer ta propre image.'}
          </div>
          <div className="bg-options">
            <label className="bg-veil">
              <span>Voile</span>
              <input type="range" min="0" max="80" step="5" value={veil} onChange={(e) => setVeil(+e.target.value)} />
              <output>{veil} %</output>
            </label>
            <Toggle checked={glass} onChange={setGlass} label="Cartes en verre dépoli" />
          </div>
        </div>
      )}
    </>
  )
}

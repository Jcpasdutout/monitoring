import { useEffect, useMemo, useRef, useState } from 'react'
import { FlaskConical, Save } from 'lucide-react'
import { api } from './api.js'
import { Modal, StatusBadge, Toggle } from './components.jsx'
import TypeIcon from './TypeIcon.jsx'

const INTERVALS = [
  [30, '30 secondes'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'],
  [900, '15 minutes'], [1800, '30 minutes'], [3600, '1 heure'],
]

function defaults(type) {
  const cfg = {}
  for (const f of type?.fields || []) {
    if (f.default !== undefined && f.default !== null) cfg[f.key] = f.kind === 'list' ? f.default.join(', ') : f.default
  }
  return cfg
}

function toForm(probe, type) {
  const cfg = { ...defaults(type) }
  const kinds = Object.fromEntries((type?.fields || []).map((f) => [f.key, f.kind]))
  for (const [k, v] of Object.entries(probe.config || {})) {
    if (v !== null && v !== undefined) cfg[k] = Array.isArray(v) && kinds[k] !== 'multiselect' ? v.join(', ') : v
  }
  return cfg
}

function Field({ field, value, onChange }) {
  const id = `f-${field.key}`
  let input
  if (field.kind === 'bool') {
    return (
      <div className="field field-inline">
        <Toggle checked={!!value} onChange={onChange} label={field.label} />
        {field.help && <small className="help">{field.help}</small>}
      </div>
    )
  }
  if (field.kind === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="field field-full">
        <label>{field.label}</label>
        <div className="checks">
          {field.options.map((o) => (
            <label key={o.value} className={`check-chip ${selected.includes(o.value) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
        {field.help && <small className="help">{field.help}</small>}
      </div>
    )
  }
  if (field.kind === 'select') {
    input = (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  } else if (field.kind === 'textarea') {
    input = <textarea id={id} rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else {
    input = (
      <input id={id} type={field.kind === 'number' ? 'number' : 'text'} value={value ?? ''}
        onChange={(e) => onChange(e.target.value)} required={field.required} />
    )
  }
  return (
    <div className={`field ${field.kind === 'textarea' ? 'field-full' : ''}`}>
      <label htmlFor={id}>{field.label}{field.required && <span className="req">*</span>}</label>
      {input}
      {field.help && <small className="help">{field.help}</small>}
    </div>
  )
}

export default function ProbeForm({ probe, types, groups, onClose, onSaved }) {
  const isNew = !probe.id
  const [typeId, setTypeId] = useState(probe.type || null)
  const type = useMemo(() => types.find((t) => t.type === typeId), [types, typeId])
  const [name, setName] = useState(probe.name || '')
  const [group, setGroup] = useState(probe.group || '')
  const [interval, setInterval] = useState(probe.interval || 120)
  const [enabled, setEnabled] = useState(probe.enabled ?? true)
  const [config, setConfig] = useState(() => toForm(probe, types.find((t) => t.type === probe.type)))
  const [secret, setSecret] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const resultRef = useRef(null)
  useEffect(() => {
    if (testResult || error) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [testResult, error])

  const pickType = (t) => {
    setTypeId(t.type)
    setConfig(defaults(t))
    if (!group && t.type === 'imap') setGroup('Mails')
  }

  const payload = () => {
    const body = { type: typeId, name, group, interval: Number(interval), enabled, config }
    if (secret) body.secret = secret
    else if (probe.copyOf) body.copy_secret_from = probe.copyOf
    return body
  }

  const test = async () => {
    setTesting(true); setTestResult(null); setError(null)
    try {
      setTestResult(await api.test({ ...payload(), name: name || 'test', id: probe.id || probe.copyOf }))
    } catch (e) { setError(e.message) }
    setTesting(false)
  }

  const save = async (e) => {
    e?.preventDefault()
    setSaving(true); setError(null)
    try {
      if (isNew) await api.create(payload())
      else await api.update(probe.id, payload())
      onSaved(isNew ? `Sonde « ${name} » ajoutée` : `Sonde « ${name} » enregistrée`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  if (!type) {
    return (
      <Modal title="Nouvelle sonde" onClose={onClose}>
        <p className="muted">Que voulez-vous surveiller ?</p>
        <div className="type-picker">
          {types.map((t) => (
            <button key={t.type} className="type-option" onClick={() => pickType(t)}>
              <span className="type-chip type-chip-lg"><TypeIcon type={t.type} size={20} /></span>
              <span><strong>{t.label}</strong><small>{t.description}</small></span>
            </button>
          ))}
        </div>
      </Modal>
    )
  }

  const secretPlaceholder = probe.has_secret ? '•••••••• (inchangé)'
    : probe.copyOf ? 'Laisser vide pour reprendre celui de la sonde copiée' : ''

  return (
    <Modal
      wide
      title={<span className="title-with-icon"><TypeIcon type={type.type} size={18} />{isNew ? `Nouvelle sonde · ${type.label}` : `Modifier « ${probe.name} »`}</span>}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={test} disabled={testing}>
          <FlaskConical size={16} className={testing ? 'spin-slow' : ''} />{testing ? 'Test…' : 'Tester'}
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button type="submit" form="probe-form" className="btn btn-primary" disabled={saving}><Save size={16} />Enregistrer</button>
      </>}
    >
      <form id="probe-form" onSubmit={save}>
        <div className="form-section">
          <h4>Général</h4>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="f-name">Nom<span className="req">*</span></label>
              <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
                placeholder={type.type === 'imap' ? 'ex. Mail perso' : type.type === 'http' ? 'ex. API météo' : 'ex. Freebox'} />
            </div>
            <div className="field">
              <label htmlFor="f-group">Groupe</label>
              <input id="f-group" list="groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="ex. Mails, Serveurs" />
              <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="f-interval">Fréquence</label>
              <select id="f-interval" value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
                {!INTERVALS.some(([v]) => v === interval) && <option value={interval}>{interval} s</option>}
                {INTERVALS.map(([v, l]) => <option key={v} value={v}>Toutes les {l}</option>)}
              </select>
            </div>
            <div className="field field-inline">
              <Toggle checked={enabled} onChange={setEnabled} label="Sonde active" />
            </div>
          </div>
        </div>

        <div className="form-section">
          <h4>Paramètres</h4>
          <div className="form-grid">
            {type.fields.filter((f) => !f.advanced).map((f) => (
              <Field key={f.key} field={f} value={config[f.key]}
                onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
            ))}
            {type.secret && (
              <div className="field">
                <label htmlFor="f-secret">{type.secret}</label>
                <input id="f-secret" type="password" autoComplete="new-password" value={secret}
                  onChange={(e) => setSecret(e.target.value)} placeholder={secretPlaceholder} />
                <small className="help">Stocké uniquement sur votre serveur, jamais réaffiché.</small>
              </div>
            )}
          </div>
        </div>

        {type.fields.some((f) => f.advanced) && (
          <details className="form-section advanced">
            <summary>Options avancées</summary>
            <div className="form-grid">
              {type.fields.filter((f) => f.advanced).map((f) => (
                <Field key={f.key} field={f} value={config[f.key]}
                  onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
              ))}
            </div>
          </details>
        )}
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {testResult && (
        <div className={`alert alert-${testResult.status}`}>
          <div className="alert-head"><StatusBadge status={testResult.status} /><span className="muted small">{testResult.duration_ms} ms</span></div>
          <div>{testResult.summary}</div>
        </div>
      )}
      <div ref={resultRef} />
    </Modal>
  )
}

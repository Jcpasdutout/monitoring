import { Gauge, Globe, Mail, Radar, Server } from 'lucide-react'

const ICONS = { imap: Mail, http: Globe, ping: Radar, snmp: Server }

export default function TypeIcon({ type, size = 16 }) {
  const Icon = ICONS[type] || Gauge
  return <Icon size={size} />
}

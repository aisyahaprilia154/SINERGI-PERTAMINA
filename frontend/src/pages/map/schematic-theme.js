import { OPERATIONAL_NETWORK_COLORS } from '../../domain/network-colors.js'

export const SCHEMATIC_CATEGORY_STYLES = {
  cctv: { color: '#9698f4', label: 'CCTV' },
  'fiber-optic': { color: OPERATIONAL_NETWORK_COLORS['fiber-optic'], label: 'Fiber optic' },
  power: { color: OPERATIONAL_NETWORK_COLORS.power, label: 'Power PLN' },
  peripheral: { color: '#a88af3', label: 'Peripheral' },
  infrastructure: { color: OPERATIONAL_NETWORK_COLORS.infrastructure, label: 'Infrastruktur' },
  lan: { color: OPERATIONAL_NETWORK_COLORS.lan, label: 'LAN' },
}

export const SCHEMATIC_THEME = {
  background: '#f8fafc',
  backgroundSubtle: '#ffffff',
  grid: '#dbe2e9',
  text: '#172231',
  textSecondary: '#657184',
  textMuted: '#8a94a3',
  border: '#dbe2e9',
  edgeUnderlay: '#ffffff',
  selected: '#172638',
  warning: '#cc8b25',
}

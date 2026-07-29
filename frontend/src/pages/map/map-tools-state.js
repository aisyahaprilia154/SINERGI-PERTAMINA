export const TRACE_STATES = Object.freeze([
  'idle',
  'selecting_start',
  'selecting_end',
  'calculating',
  'result',
  'no_path',
  'error',
])

const TRACE_INSTRUCTIONS = Object.freeze({
  selecting_start: {
    step: '1',
    icon: null,
    title: 'Pilih titik awal',
    description: 'Klik aset pada peta untuk memulai tracing.',
  },
  selecting_end: {
    step: '2',
    icon: null,
    title: 'Pilih titik tujuan',
    description: 'Klik aset tujuan pada jaringan yang sama.',
  },
  calculating: {
    step: null,
    icon: 'progress_activity',
    title: 'Mencari jalur',
    description: 'Sistem sedang menelusuri relasi aset.',
  },
  result: {
    step: null,
    icon: 'check',
    title: 'Jalur koneksi ditampilkan',
    description: 'Hasil tracing tetap aktif sampai dihentikan.',
  },
  no_path: {
    step: null,
    icon: 'route',
    title: 'Jalur tidak ditemukan',
    description: 'Kedua aset belum memiliki relasi yang tersambung.',
  },
  error: {
    step: null,
    icon: 'priority_high',
    title: 'Tracing tidak dapat diselesaikan',
    description: 'Terjadi kesalahan saat menelusuri relasi aset.',
  },
})

export function createTracingState(overrides = {}) {
  return {
    status: 'idle',
    fromId: null,
    toId: null,
    path: [],
    relations: [],
    candidates: [],
    error: null,
    explanation: null,
    ...overrides,
  }
}

export function reduceTracingState(state, action) {
  const current = createTracingState(state)
  switch (action?.type) {
    case 'reset':
      return createTracingState()
    case 'select-start':
      return createTracingState({ status: 'selecting_start' })
    case 'start-selected':
      return createTracingState({
        status: action.candidates?.length ? 'selecting_end' : 'no_path',
        fromId: action.assetId,
        path: [action.assetId],
        candidates: action.candidates || [],
        error: action.candidates?.length
          ? null
          : 'Tidak ada tujuan yang tersambung dari aset awal.',
      })
    case 'calculate':
      return {
        ...current,
        status: 'calculating',
        toId: action.assetId,
        error: null,
      }
    case 'result':
      return {
        ...current,
        status: 'result',
        path: action.path || [],
        relations: action.relations || [],
        explanation: action.explanation || null,
        error: null,
      }
    case 'no-path':
      return {
        ...current,
        status: 'no_path',
        path: current.fromId ? [current.fromId] : [],
        relations: [],
        explanation: null,
        error: action.message || TRACE_INSTRUCTIONS.no_path.description,
      }
    case 'error':
      return {
        ...current,
        status: 'error',
        error: action.message || TRACE_INSTRUCTIONS.error.description,
      }
    default:
      return current
  }
}

export function getTraceInstruction(state) {
  const instruction = TRACE_INSTRUCTIONS[state?.status]
  if (!instruction) return null
  if (state.status === 'result' && state.path?.length) {
    return {
      ...instruction,
      description: `${state.path.length} aset berada pada jalur topologi terkonfirmasi.`,
    }
  }
  if (state.status === 'error' && state.error) {
    return { ...instruction, description: state.error }
  }
  return instruction
}

export function isTracingSelectionState(status) {
  return status === 'selecting_start' || status === 'selecting_end'
}

export function calculateMapSafeArea({
  stageRect,
  contextRect,
  toolbarRect,
  bottomToolsRect,
  sidebarRect,
  drawerRect,
  sidebarOpen = false,
  drawerOpen = false,
  compactPanels = false,
  spacing = 16,
} = {}) {
  const width = Math.max(0, stageRect?.width || 0)
  const height = Math.max(0, stageRect?.height || 0)
  const relativeBottom = (rect) => rect
    ? Math.max(0, rect.bottom - stageRect.top)
    : 0
  const panelWidth = (rect) => Math.max(0, Math.min(width, rect?.width || 0))
  const panelHeight = (rect) => Math.max(0, Math.min(height, rect?.height || 0))

  let left = spacing
  let right = spacing
  let bottom = spacing
  const top = Math.min(
    Math.max(spacing, relativeBottom(contextRect), relativeBottom(toolbarRect)) + spacing,
    Math.max(spacing, height - spacing),
  )

  if (sidebarOpen) left += panelWidth(sidebarRect)
  if (drawerOpen && compactPanels) bottom += panelHeight(drawerRect)
  else if (drawerOpen) right += panelWidth(drawerRect)
  if (bottomToolsRect) bottom = Math.max(
    bottom,
    Math.max(0, stageRect.bottom - bottomToolsRect.top) + spacing,
  )

  const maximumHorizontalInset = Math.max(spacing, width - 180)
  return {
    left: Math.min(left, maximumHorizontalInset),
    right: Math.min(right, maximumHorizontalInset),
    top,
    bottom: Math.min(bottom, Math.max(spacing, height - 120)),
  }
}

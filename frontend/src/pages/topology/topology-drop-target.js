// A device wins over its enclosing frame, including invalid device targets.
// Never turn a rejected connection into an accidental placement change.
export function resolveTopologyDropTarget({ sourceId, targetId, box, model }) {
  if (targetId) {
    if (targetId === sourceId) return { kind: 'invalid', message: 'Pilih perangkat lain' }
    const target = model.nodeById.get(targetId)
    if (!target) return { kind: 'invalid', message: 'Perangkat tidak tersedia' }
    if ((model.adjacency.get(sourceId) ?? []).some(item => item.id === targetId)) {
      return { kind: 'invalid', message: 'Kedua perangkat sudah terhubung' }
    }
    return { kind: 'connect', targetId, message: `Hubungkan ke ${target.name || targetId}` }
  }
  if (box && ['confirmed', 'empty', 'excluded'].includes(box.kind)) {
    return { kind: 'move', box, message: `Pindahkan ke ${box.label || box.name || 'frame ini'}` }
  }
  return { kind: 'invalid', message: 'Pilih frame yang tersedia untuk menempatkan aset.' }
}

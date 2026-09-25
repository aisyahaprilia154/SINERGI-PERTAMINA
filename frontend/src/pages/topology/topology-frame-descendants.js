export function frameMoveAssetIds(layoutNodes = [], rootId) {
  const byId = new Map(layoutNodes.map(node => [node.id, node]))
  const root = byId.get(rootId)
  if (!root) return [rootId]
  const sourceFrameId = root.mountingBoxId ?? null
  const children = new Map()
  for (const node of layoutNodes) {
    const parentId = node.parentId ?? node.layoutParentId
    if (!parentId) continue
    const list = children.get(parentId) ?? []
    list.push(node)
    children.set(parentId, list)
  }
  const result = [rootId]
  const seen = new Set(result)
  for (let index = 0; index < result.length; index++) {
    for (const child of children.get(result[index]) ?? []) {
      if (seen.has(child.id) || (child.mountingBoxId ?? null) !== sourceFrameId) continue
      seen.add(child.id)
      result.push(child.id)
    }
  }
  return result
}

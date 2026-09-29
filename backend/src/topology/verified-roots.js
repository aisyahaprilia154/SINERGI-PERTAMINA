export function verifiedRootNodes(graph) {
  return graph.nodes.filter(node => ['root', 'core'].includes(
    String(node.topologyRole ?? '').trim().toLowerCase(),
  ))
}

export function graphValidationErrorCount(validation) {
  return Number(validation?.summary?.errors)
    || (validation?.issues ?? []).filter(({ severity }) => severity === 'error').length
}

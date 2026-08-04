export function placeTopologyNode({ node, x, y, width, height }) {
  const iconInset = 25
  return {
    ...node,
    diagram: {
      x,
      y,
      width,
      height,
      nodeX: x + iconInset,
      nodeY: y + height / 2,
      labelX: x + 48,
      labelY: y + 21,
    },
  }
}

export function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

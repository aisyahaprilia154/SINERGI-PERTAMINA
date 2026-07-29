export function assetPointRadiusExpression() {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    13, radiusByState(4),
    17, radiusByState(7),
    20, radiusByState(10),
  ]
}

function radiusByState(defaultRadius) {
  return [
    'case',
    ['get', 'selected'], 11,
    ['get', 'trace'], 9,
    defaultRadius,
  ]
}

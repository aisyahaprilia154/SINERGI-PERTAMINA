// A search result is not proof of physical installation. This limit applies
// to automatic mounting only; explicitly reviewed assignments are preserved.
export const MAX_AUTOMATIC_MOUNTING_DISTANCE_METERS = 5

export function unsafeAutomaticMount(relation) {
  if (relation?.provenance !== 'spatial_inference') return false
  const distance = relation.distanceMeters
  return typeof distance !== 'number' || !Number.isFinite(distance)
    || distance < 0 || distance > MAX_AUTOMATIC_MOUNTING_DISTANCE_METERS
}

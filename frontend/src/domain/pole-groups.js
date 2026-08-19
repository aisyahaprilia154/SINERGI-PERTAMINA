export const MOUNTING_RELATION_TYPE = 'mounted_on'

export function buildPoleGroups({ assets = [], mountingRelations = [] } = {}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const groups = new Map()
  mountingRelations
    .filter((relation) => (
      relation?.relationType === MOUNTING_RELATION_TYPE
        && relation?.verificationStatus !== 'rejected'
        && relation?.verificationStatus !== 'revoked'
    ))
    .forEach((relation) => {
      const asset = assetById.get(relation.sourceAssetId)
      const pole = assetById.get(relation.targetAssetId)
      if (!asset || !pole || asset.id === pole.id) return
      let group = groups.get(pole.id)
      if (!group) {
        group = {
          id: `pole-group:${pole.id}`,
          poleAssetId: pole.id,
          pole,
          assetIds: [],
          assets: [],
          relations: [],
          count: 0,
          coordinate: Array.isArray(pole.coordinate)
            ? [...pole.coordinate]
            : null,
        }
        groups.set(pole.id, group)
      }
      if (!group.assetIds.includes(asset.id)) {
        group.assetIds.push(asset.id)
        group.assets.push(asset)
      }
      group.relations.push({ ...relation })
      group.count = group.assetIds.length + 1
    })

  return [...groups.values()]
    .map((group) => ({
      ...group,
      assetIds: [group.poleAssetId, ...group.assetIds],
      assets: [group.pole, ...group.assets],
      childCount: group.assetIds.length,
    }))
    .sort((left, right) => (
      String(left.pole?.name || left.poleAssetId).localeCompare(
        String(right.pole?.name || right.poleAssetId),
        'id',
      )
    ))
}

export function poleGroupForAsset(poleGroups = [], assetId) {
  return poleGroups.find(({ assetIds }) => assetIds.includes(assetId)) ?? null
}

export function mountingRelationsForAsset(mountingRelations = [], assetId) {
  return mountingRelations.filter((relation) => (
    relation.sourceAssetId === assetId || relation.targetAssetId === assetId
  ))
}

export function mountedChildrenForPole(mountingRelations = [], poleAssetId) {
  return mountingRelations
    .filter((relation) => (
      relation.relationType === MOUNTING_RELATION_TYPE
        && relation.targetAssetId === poleAssetId
    ))
    .map((relation) => relation.sourceAssetId)
}

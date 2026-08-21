export function renderPathTopologySvg(layout) {
  return `<svg class="topology-svg path-topology-svg" xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"
    role="img" aria-labelledby="path-topology-title path-topology-description">
    <title id="path-topology-title">Diagram Topologi ${escapeXml(layout.area?.name ?? '')}</title>
    <desc id="path-topology-description">Diagram jalur dari core ke kelompok tiang berdasarkan relasi terkonfirmasi.</desc>
    <defs>
      <filter id="path-card-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0b1f3a" flood-opacity=".12"/>
      </filter>
    </defs>
    <style>${styles()}</style>
    <rect class="path-bg" width="${layout.width}" height="${layout.height}"/>
    ${renderHeader(layout)}
    <g class="path-edges">${layout.edges.map(renderEdge).join('')}</g>
    <g class="path-lanes">${layout.lanes.map(renderLane).join('')}</g>
    ${layout.core ? renderCore(layout.core) : ''}
    ${renderPoleSection(layout.extendedSection)}
    ${renderAssetSection(layout.connectedSection)}
    ${renderEndpointSection(layout.uninstalledSection)}
    ${renderLegend(layout.footerY)}
  </svg>`
}

function renderHeader(layout) {
  const stats = layout.stats
  return `<g class="diagram-header">
    <text class="diagram-title" x="34" y="38">Diagram Topologi · ${escapeXml(layout.area?.name ?? 'Area')}</text>
    <text class="diagram-subtitle" x="34" y="64">${escapeXml(layout.area?.name ?? '')}</text>
    <g class="diagram-stats" transform="translate(1330 23)">
      ${statLine('Total tiang', stats.poleCount, 0)}
      ${statLine('Total JB', stats.jbCount, 25)}
      ${statLine('Total CCTV', stats.cctvCount, 50)}
    </g>
  </g>`
}

function statLine(label, value, y) {
  return `<text x="0" y="${y + 12}">${escapeXml(label)}</text><text x="132" y="${y + 12}">:</text>
    <text class="stat-value" x="150" y="${y + 12}">${value} unit</text>`
}

function renderCore(core) {
  return `<g class="path-core asset-target${classes(core)}" tabindex="0" role="button"
      data-node-id="${attr(core.id)}" aria-label="${attr(`${core.name}, core`)}">
    <rect class="core-card" x="${core.x}" y="${core.y}" width="${core.width}" height="${core.height}" rx="11"/>
    <text class="core-name" x="${core.x + core.width / 2}" y="${core.y + 24}" text-anchor="middle">${escapeXml(shorten(core.name, 30))}</text>
    <rect class="core-icon" x="${core.x + core.width / 2 - 22}" y="${core.y + 34}" width="44" height="38" rx="6"/>
    <path class="core-glyph" d="M ${core.x + core.width / 2 - 12} ${core.y + 45}h24v5h-24z M ${core.x + core.width / 2 - 12} ${core.y + 55}h24v5h-24z"/>
    <text class="core-label" x="${core.x + core.width / 2}" y="${core.y + 91}" text-anchor="middle">CORE</text>
  </g>`
}

function renderLane(lane) {
  const endX = lane.blocks.length
    ? lane.blocks.at(-1).x + lane.blocks.at(-1).width + 18
    : 1540
  return `<g class="path-lane" data-lane-id="${attr(lane.id)}">
    <text class="lane-title" x="34" y="${lane.y + 11}">${escapeXml(lane.name)}</text>
    <line class="lane-divider" x1="28" y1="${lane.y + lane.height + 18}" x2="1572" y2="${lane.y + lane.height + 18}"/>
    <line class="lane-bus" x1="${lane.blocks[0]?.x ?? 140}" y1="${lane.busY}" x2="${endX}" y2="${lane.busY}"/>
    ${lane.blocks.map((block) => `<line class="lane-drop" x1="${block.anchorX}" y1="${lane.busY}" x2="${block.anchorX}" y2="${block.y}"/>`).join('')}
    ${lane.blocks.map(renderPoleBlock).join('')}
  </g>`
}

function renderPoleBlock(block) {
  const totalChildren = block.assets.length
  const summary = [
    block.cctvAssets.length ? `CCTV ${block.cctvAssets.length}` : '',
    block.jbAssets.length ? `JB ${block.jbAssets.length}` : '',
    block.otherAssets.length ? `Lainnya ${block.otherAssets.length}` : '',
  ].filter(Boolean).join(' · ') || 'Tanpa perangkat terpasang'
  if (block.collapsed) {
    return `<g class="pole-block collapsed${block.selected ? ' selected' : ''}${block.dimmed ? ' dimmed' : ''}"
        data-pole-group-toggle="${attr(block.id)}" tabindex="0" role="button">
      <rect class="pole-outline" x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" rx="9"/>
      <text class="pole-title" x="${block.x + 14}" y="${block.y + 26}">${escapeXml(shorten(block.pole.name, 22))} · ${totalChildren} aset</text>
      <text class="pole-summary" x="${block.x + 14}" y="${block.y + 47}">${escapeXml(summary)}</text>
      <text class="collapse-mark" x="${block.x + block.width - 16}" y="${block.y + 28}">+</text>
    </g>`
  }
  const cards = layoutMountedCards(block)
  return `<g class="pole-block${block.selected ? ' selected' : ''}${block.dimmed ? ' dimmed' : ''}"
      data-pole-group-toggle="${attr(block.id)}" tabindex="0" role="button"
      aria-label="${attr(`${block.pole.name}, ${totalChildren} aset terpasang`)}">
    <rect class="pole-outline" x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" rx="9"/>
    <text class="pole-title asset-target" data-node-id="${attr(block.pole.id)}" x="${block.x + block.width / 2}" y="${block.y + 23}" text-anchor="middle">${escapeXml(shorten(block.pole.name, 24))} · ${totalChildren} aset</text>
    <text class="pole-summary" x="${block.x + block.width / 2}" y="${block.y + 42}" text-anchor="middle">${escapeXml(summary)}</text>
    ${cards.map(renderMountedCard).join('')}
    <text class="collapse-mark" x="${block.x + block.width - 13}" y="${block.y + 20}">−</text>
  </g>`
}

function layoutMountedCards(block) {
  const all = [...block.jbAssets, ...block.cctvAssets, ...block.otherAssets]
  const result = []
  let cursorY = block.y + 54
  all.forEach((asset, index) => {
    const jb = isJb(asset)
    const width = jb ? block.width - 48 : (block.width - 46) / 2
    const nonJbIndex = all.slice(0, index).filter((item) => !isJb(item)).length
    if (jb) {
      result.push({ asset, x: block.x + 24, y: cursorY, width, height: 28 })
      cursorY += 36
    } else {
      const column = nonJbIndex % 2
      const row = Math.floor(nonJbIndex / 2)
      result.push({ asset, x: block.x + 15 + column * (width + 16), y: cursorY + row * 36, width, height: 28 })
    }
  })
  return result.slice(0, 5)
}

function renderMountedCard({ asset, x, y, width, height }) {
  return `<g class="mounted-card asset-target${classes(asset)}" data-node-id="${attr(asset.id)}"
      tabindex="0" role="button" aria-label="${attr(`${asset.name}, ${asset.type}`)}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5"/>
    <text x="${x + width / 2}" y="${y + 18}" text-anchor="middle">${escapeXml(shorten(asset.name, width > 130 ? 20 : 11))}</text>
  </g>`
}

function renderPoleSection(section) {
  return `<g class="diagram-section extended-section">
    <text class="section-title" x="${section.x}" y="${section.y + 20}">${section.title}</text>
    ${section.blocks.length ? section.blocks.map(renderPoleBlock).join('') : renderEmpty(section.x, section.y + 48, 'Tidak ada kelompok JB extended pada area ini.')}
  </g>`
}

function renderAssetSection(section) {
  return `<g class="diagram-section connected-section">
    <text class="section-title" x="${section.x}" y="${section.y + 20}">${section.title}</text>
    ${section.assets.length ? section.assets.map((asset) => `<g class="fallback-card asset-target${classes(asset)}"
      data-node-id="${attr(asset.id)}" tabindex="0" role="button">
      <rect x="${asset.x}" y="${asset.y}" width="${asset.width}" height="${asset.height}" rx="7"/>
      <text class="fallback-name" x="${asset.x + 12}" y="${asset.y + 23}">${escapeXml(shorten(asset.name, 22))}</text>
      <text class="fallback-type" x="${asset.x + 12}" y="${asset.y + 42}">${escapeXml(shorten(asset.type, 24))}</text>
    </g>`).join('') : renderEmpty(section.x, section.y + 48, 'Tidak ada perangkat tanpa tiang.')}
  </g>`
}

function renderEndpointSection(section) {
  return `<g class="diagram-section unresolved-section">
    <text class="section-title" x="${section.x}" y="${section.y + 20}">${section.title}</text>
    ${section.endpoints.length ? section.endpoints.map((endpoint) => `<g class="endpoint-card"
      data-unresolved-id="${attr(endpoint.id)}" tabindex="0" role="button">
      <rect x="${endpoint.x}" y="${endpoint.y}" width="${endpoint.width}" height="${endpoint.height}" rx="8"/>
      <text class="endpoint-name" x="${endpoint.x + endpoint.width / 2}" y="${endpoint.y + 28}" text-anchor="middle">${escapeXml(shorten(endpoint.name, 26))}</text>
      <line x1="${endpoint.x + 24}" y1="${endpoint.y + 48}" x2="${endpoint.x + endpoint.width - 24}" y2="${endpoint.y + 48}"/>
      <text class="endpoint-id" x="${endpoint.x + endpoint.width / 2}" y="${endpoint.y + 66}" text-anchor="middle">${escapeXml(shorten(endpoint.id, 30))}</text>
    </g>`).join('') : renderEmpty(section.x, section.y + 48, 'Tidak ada endpoint unresolved pada area ini.')}
  </g>`
}

function renderEdge(edge) {
  const path = edge.points.map((point, index) => `${index ? 'L' : 'M'} ${round(point.x)} ${round(point.y)}`).join(' ')
  const status = edge.status ?? (edge.kind === 'recommendation' ? 'recommended' : 'confirmed')
  return `<path class="path-edge ${edge.family} ${status} ${edge.kind}${edge.traced ? ' traced' : ''}"
    d="${path}" data-edge-id="${attr(edge.id)}"><title>${escapeXml(statusLabel(status))}</title></path>`
}

function renderLegend(y) {
  return `<g class="path-legend" transform="translate(28 ${y})">
    <rect class="legend-bg" width="1120" height="52" rx="8"/>
    ${legendLine(22, '#1554c0', '', 'LAN · biru')}
    ${legendLine(210, '#198b42', '', 'Fiber optic · hijau')}
    ${legendLine(424, '#ed8b00', '8 6', 'Saran koneksi')}
    ${legendLine(644, '#e53935', '8 6', 'Belum terhubung')}
    <rect class="legend-pole" x="856" y="15" width="38" height="24" rx="5"/>
    <text x="910" y="32">Satu tiang · blok fisik</text>
  </g>`
}

function legendLine(x, color, dash, label) {
  return `<line x1="${x}" y1="26" x2="${x + 45}" y2="26" stroke="${color}" stroke-width="3"${dash ? ` stroke-dasharray="${dash}"` : ''}/><text x="${x + 58}" y="32">${label}</text>`
}

function renderEmpty(x, y, message) {
  return `<text class="section-empty" x="${x}" y="${y}">${escapeXml(message)}</text>`
}

function styles() {
  return `
    .path-bg{fill:#fff}.diagram-title{font:700 27px Inter,Arial,sans-serif;fill:#0b1b3e}.diagram-subtitle{font:500 16px Inter,Arial,sans-serif;fill:#102a59}.diagram-stats text{font:650 14px Inter,Arial,sans-serif;fill:#0b1b3e}.diagram-stats .stat-value{font-weight:750}
    .core-card{fill:#fff;stroke:#173c75;stroke-width:1.4;filter:url(#path-card-shadow)}.core-icon{fill:#0867c7}.core-glyph{fill:#fff}.core-name,.core-label{font:750 15px Inter,Arial,sans-serif;fill:#0b1b3e}.core-label{font-size:14px}
    .lane-title,.section-title{font:750 15px Inter,Arial,sans-serif;fill:#0b1b3e}.lane-divider{stroke:#a9bdd5;stroke-width:1.2}.lane-bus,.lane-drop{stroke:#1554c0;stroke-width:2.6;fill:none}
    .pole-outline{fill:#fff;fill-opacity:.96;stroke:#2f9a51;stroke-width:1.4;stroke-dasharray:9 5}.pole-block{cursor:pointer}.pole-block.selected .pole-outline{stroke:#0b62c4;stroke-width:3}.pole-block.dimmed,.asset-target.dimmed{opacity:.2}.pole-title{font:750 14px Inter,Arial,sans-serif;fill:#0b1b3e}.pole-summary{font:500 11px Inter,Arial,sans-serif;fill:#223b64}.collapse-mark{font:700 16px Inter,Arial,sans-serif;fill:#507095}
    .mounted-card rect,.fallback-card rect{fill:#fff;stroke:#244c84;stroke-width:1.1;filter:url(#path-card-shadow)}.mounted-card text{font:650 11px Inter,Arial,sans-serif;fill:#0b1b3e}.asset-target{cursor:pointer}.asset-target.selected rect,.asset-target.selected.core-card{stroke:#0b62c4;stroke-width:3}
    .path-edge{fill:none;stroke:#1554c0;stroke-width:2.4;stroke-linecap:square;stroke-linejoin:round}.path-edge.fiber-optic{stroke:#198b42}.path-edge.recommended,.path-edge.review{stroke:#ed8b00;stroke-dasharray:9 7}.path-edge.unresolved{stroke:#e53935;stroke-dasharray:9 7}.path-edge.cross{stroke-width:1.7;opacity:.8}.path-edge.traced{stroke:#7c3aed;stroke-width:5}
    .fallback-name{font:700 12px Inter,Arial,sans-serif;fill:#0b1b3e}.fallback-type{font:500 10px Inter,Arial,sans-serif;fill:#64748b}.endpoint-card{cursor:pointer}.endpoint-card rect{fill:#fff;stroke:#f02828;stroke-width:1.5;stroke-dasharray:9 5}.endpoint-card line{stroke:#f02828;stroke-width:1}.endpoint-name,.endpoint-id{font:700 12px Inter,Arial,sans-serif;fill:#e21717}.endpoint-id{font-size:10px}.section-empty{font:500 11px Inter,Arial,sans-serif;fill:#77869b}
    .legend-bg{fill:#fff;stroke:#7890ad;stroke-width:1}.path-legend text{font:500 13px Inter,Arial,sans-serif;fill:#0b1b3e}.legend-pole{fill:#fff;stroke:#2f9a51;stroke-width:1.2;stroke-dasharray:7 4}
    [tabindex]:focus{outline:none}[tabindex]:focus .pole-outline,[tabindex]:focus rect{stroke:#0b62c4;stroke-width:3}
  `
}

function classes(asset) {
  return `${asset?.selected ? ' selected' : ''}${asset?.dimmed ? ' dimmed' : ''}`
}

function isJb(asset) {
  return /junction|\bjb\b|joint box/i.test(`${asset?.type ?? ''} ${asset?.name ?? ''}`)
}

function statusLabel(status) {
  return { confirmed: 'Relasi terkonfirmasi', recommended: 'Saran koneksi', review: 'Perlu review', unresolved: 'Belum terhubung' }[status] ?? status
}

function shorten(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function round(value) {
  return Math.round(Number(value) * 10) / 10
}

function attr(value) {
  return escapeXml(value)
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

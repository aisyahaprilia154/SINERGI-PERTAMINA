import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anchoredZoomScrollPosition,
  centeredScrollPosition,
  computeFitZoom,
  computeReadableZoom,
  effectiveViewportFor,
  zoomSurfaceMetrics,
} from '../src/pages/topology/topology-viewport.js'

test('readable fit never shrinks a detail diagram below 60 percent', () => {
  assert.equal(computeReadableZoom({ viewportWidth: 600, layoutWidth: 1800 }), 0.6)
  assert.equal(computeReadableZoom({ viewportWidth: 1200, layoutWidth: 900 }), 1)
})

test('summary fit can expose a large diagram down to 35 percent', () => {
  assert.equal(computeFitZoom({ viewportWidth: 600, layoutWidth: 1800 }), 0.35)
})

test('fit uses the limiting width or height ratio for a tall diagram', () => {
  assert.equal(computeFitZoom({
    viewportWidth: 900,
    viewportHeight: 600,
    layoutWidth: 1200,
    layoutHeight: 2400,
    minZoom: .1,
    horizontalPadding: 0,
    verticalPadding: 0,
  }), .25)
})

test('effective viewport excludes the drawer and inspector while preserving padding', () => {
  assert.deepEqual(effectiveViewportFor({
    viewportWidth: 1200,
    viewportHeight: 800,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 78,
    paddingBottom: 54,
    overlayLeft: 304,
    overlayRight: 360,
  }), {
    width: 536,
    height: 668,
    centerX: 548,
    centerY: 334,
    left: 304,
    right: 840,
    top: 78,
    bottom: 746,
  })
})

test('centering uses the visible viewport rather than resetting the diagram origin', () => {
  assert.deepEqual(centeredScrollPosition({
    point: { x: 800, y: 500 },
    zoom: 0.75,
    viewportWidth: 600,
    viewportHeight: 400,
  }), { left: 300, top: 175 })

  assert.deepEqual(centeredScrollPosition({
    point: { x: 800, y: 500 },
    zoom: 0.75,
    viewportWidth: 600,
    viewportHeight: 400,
    viewportCenterX: 420,
    viewportCenterY: 260,
  }), { left: 180, top: 115 })
})

test('zoom surface grows with the scaled diagram so no edge is clipped', () => {
  assert.deepEqual(zoomSurfaceMetrics({
    layoutWidth: 2000,
    layoutHeight: 1200,
    zoom: 1.35,
    viewportWidth: 1280,
    viewportHeight: 720,
  }), {
    width: 2760,
    height: 1734,
    frameLeft: 30,
    frameTop: 84,
  })
})

test('zoom keeps the same graph coordinate below the pointer', () => {
  assert.deepEqual(anchoredZoomScrollPosition({
    scrollLeft: 400,
    scrollTop: 160,
    anchorX: 300,
    anchorY: 200,
    oldZoom: 0.8,
    newZoom: 1.2,
    oldFrameLeft: 30,
    oldFrameTop: 84,
    newFrameLeft: 30,
    newFrameTop: 84,
  }), {
    left: 735,
    top: 298,
  })
})

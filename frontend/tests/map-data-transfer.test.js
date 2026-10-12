import test from 'node:test'
import assert from 'node:assert/strict'
import {renderMapDataTransferDialog} from '../src/pages/map/map-data-transfer-dialog.js'
import {collectSelectedNetworkAssetIds} from '../src/pages/map/active-dataset-kml-export.js'
test('map upload stages data for preview and has no replacement mode',()=>{
 const html=renderMapDataTransferDialog({state:{mode:'import',busy:false},activeContext:{datasetId:'shared'}})
 assert.match(html,/Unggah dan lihat preview/);assert.ok(!html.includes('replace_active'));assert.ok(!html.includes('name="branchId"'))
})
test('operational export preserves the selected network asset scope',()=>{
 assert.deepEqual(collectSelectedNetworkAssetIds([{id:'lan',nodeIds:['jb','printer'],assetIds:['cable']}],new Set(['lan'])).sort(),['cable','jb','printer'])
})

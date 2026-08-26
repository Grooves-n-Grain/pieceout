import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLayerType, LayerType } from '../js/layerTagger.js';

test('generated layer names auto-classify', () => {
    assert.equal(detectLayerType('CUT'), LayerType.CUT);
    assert.equal(detectLayerType('POCKET-6.35mm'), LayerType.POCKET);
    assert.equal(detectLayerType('DRILL-6.2mm'), LayerType.CUT);
    assert.equal(detectLayerType('GUIDE'), LayerType.IGNORE);
    assert.equal(detectLayerType('Guide cut lines'), LayerType.IGNORE, 'ignore keywords win');
});

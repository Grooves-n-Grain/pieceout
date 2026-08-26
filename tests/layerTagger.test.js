import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLayerType, LayerType } from '../js/layerTagger.js';

test('generated layer names auto-classify', () => {
    assert.equal(detectLayerType('CUT'), LayerType.CUT);
    assert.equal(detectLayerType('POCKET-6.35mm'), LayerType.POCKET);
    assert.equal(detectLayerType('DRILL-6.2mm'), LayerType.CUT);
    assert.equal(detectLayerType('GUIDE'), LayerType.IGNORE);
    assert.equal(detectLayerType('Guide cut lines'), LayerType.IGNORE, 'ignore keywords win');
    assert.equal(detectLayerType('Engrave Labels'), LayerType.POCKET, 'label is a substring, not a real ignore keyword');
    assert.equal(detectLayerType('Reference Cut Line'), LayerType.CUT, 'reference is a substring, not a real ignore keyword');
});

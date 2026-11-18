import test from 'node:test';
import assert from 'node:assert/strict';
import { shardRanges, decodeRecords, formatP, nativeIJK, scenePosition } from '../src/resource.js';

test('shard ranges preserve pairs across boundaries and empty lookups',()=>{
  assert.deepEqual(shardRanges(7,19,8),[{shard:0,start:7,end:8},{shard:1,start:0,end:8},{shard:2,start:0,end:3}]);
  assert.deepEqual(shardRanges(8,8,8),[]);
  assert.throws(()=>shardRanges(-1,5,8));
});
test('record decoder preserves real stored logP and negative T',()=>{
  const b=new ArrayBuffer(32); const v=new DataView(b);
  v.setUint32(0,2075297,true);v.setFloat32(4,-9.25,true);v.setFloat64(8,350.123456789,true);
  v.setUint32(16,21,true);v.setFloat32(20,10.5,true);v.setFloat64(24,14.25,true);
  assert.deepEqual(decodeRecords(b),[{other:2075297,t:-9.25,lp:350.123456789},{other:21,t:10.5,lp:14.25}]);
  assert.throws(()=>decodeRecords(new ArrayBuffer(15)));
});
test('formatting never turns an underflow P into a reported zero',()=>{
  assert.equal(formatP(450.25),'5.623 × 10⁻⁴⁵¹');
  assert.equal(formatP(14),'1.000 × 10⁻¹⁴');
  assert.equal(formatP(NaN),'Not available');
});
test('coordinate decoding and scene transform use the native affine',()=>{
  assert.deepEqual(nativeIJK((77*218+122)*182+99,[182,218,182]),[77,122,99]);
  assert.deepEqual(scenePosition([90,126,72]),[0,-.05,0]);
  const p=scenePosition([91,125,73]);
  assert.ok(p[0]>0 && p[1]>-.05 && p[2]<0);
});

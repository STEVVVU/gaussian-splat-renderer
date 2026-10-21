import assert from 'node:assert/strict';
import { decodeHeader, readRawVertex, nShCoeffs } from '../src/utils/plyreader.ts';
import { syntheticScene } from '../src/utils/synthetic.ts';
const scene=syntheticScene();
const [count,properties,data]=decodeHeader(scene);
assert.equal(count,6); assert.equal(nShCoeffs(1),4);
let offset=0; const vertices=[];
for(let i=0;i<count;i++) { const [next,v]=readRawVertex(offset,data,properties);offset=next;vertices.push(v); }
assert.deepEqual(vertices.map(v=>v.z),[3,3,4,2.5,-2,3]);
assert(vertices[1].rot_3>0.3); assert(vertices[5].x===100);
assert.throws(()=>decodeHeader(scene.slice(0,scene.byteLength-1)),/truncated/);
assert.throws(()=>decodeHeader(new ArrayBuffer(0)),/header/);
assert.throws(()=>nShCoeffs(4),/degree/);
const invalid=scene.slice(0); new DataView(invalid).setFloat32(scene.byteLength-data.byteLength,NaN,true);
const [,badProperties,badData]=decodeHeader(invalid);
assert.throws(()=>readRawVertex(0,badData,badProperties),/Non-finite/);
const ascii=new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 1\nend_header\n').buffer;
assert.throws(()=>decodeHeader(ascii),/little endian/);
const c0=.28209479177387814;
assert(Math.abs(vertices[0].f_dc_0*c0+.5-1)<1e-6);
// Independent expected covariance, projected conic and ordering for identity camera.
const focal=500, z=3, sx=Math.exp(vertices[0].scale_0), sy=Math.exp(vertices[0].scale_1);
const xx=(focal/z*sx)**2+(focal*vertices[0].x/z**2*Math.exp(vertices[0].scale_2))**2+.3;
const yy=(focal/z*sy)**2+.3;
assert(xx>400&&xx<450); assert(yy>2499&&yy<2501);
const bits=new Uint32Array(new Float32Array([2.5,3,4]).buffer);
const order=Array.from(bits, (b,i)=>({key:(~b)>>>0,index:i})).sort((a,b)=>a.key-b.key);
assert.deepEqual(order.map(v=>v.index),[2,1,0]);
console.log(JSON.stringify({checks:14,fixturePoints:count,visibleAtIdentity:4,expectedFarToNear:[2,0,1,3],referenceCovariancePixels:[xx,0,yy],status:'pass'},null,2));

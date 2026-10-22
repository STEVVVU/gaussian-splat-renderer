const properties = ['x','y','z','opacity','rot_0','rot_1','rot_2','rot_3','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2'];

export function benchmarkScene(count: number): ArrayBuffer {
  if (![16384,131072,524288].includes(count)) throw new Error('Use a frozen benchmark scene size');
  const header = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\ncomment owned procedural room benchmark seed 565\nelement vertex '+count+'\n'+properties.map(name=>'property float '+name+'\n').join('')+'end_header\n');
  const buffer = new ArrayBuffer(header.length+count*properties.length*4);
  new Uint8Array(buffer).set(header);
  const view = new DataView(buffer);
  let seed = 565, offset = header.length;
  const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  const scale = Math.sqrt(30/count)*.8;
  for (let i=0;i<count;i++) {
    const u=random(),v=random(),surface=i%5;
    let x=(u-.5)*6,y=(v-.5)*3.5,z=7;
    let color=[.45,.5,.55];
    if (surface===0) { y=-1.5;z=2+v*6;color=[.55,.5,.4]; }
    if (surface>=2) {
      const center=surface-3, angle=u*Math.PI*2, height=1-2*v, radius=Math.sqrt(1-height*height);
      x=center*1.8+radius*Math.cos(angle)*.65;y=height*.8-.35;z=4.5+radius*Math.sin(angle)*.65;
      color=surface===2?[.8,.2,.15]:surface===3?[.15,.6,.3]:[.2,.35,.85];
    }
    const values=[x,y,z,Math.log(.7/.3),1,0,0,0,Math.log(scale),Math.log(scale),Math.log(scale*.6),...color.map(c=>(c-.5)/.28209479177387814)];
    for (const value of values) { view.setFloat32(offset,value,true);offset+=4; }
  }
  return buffer;
}

export function cpuSort(keys: Uint32Array, indices: Uint32Array, count: number): Uint32Array {
  if (!Number.isInteger(count)||count<0||count>keys.length||count>indices.length) throw new Error('Invalid active pair count');
  const pairs = new BigUint64Array(count), words = new Uint32Array(pairs.buffer);
  const low = new Uint8Array(new Uint32Array([1]).buffer)[0]===1?0:1;
  for (let i=0;i<count;i++) { words[2*i+low]=i;words[2*i+1-low]=keys[i]; }
  pairs.sort();
  return Uint32Array.from({length:count},(_,i)=>indices[words[2*i+low]]);
}

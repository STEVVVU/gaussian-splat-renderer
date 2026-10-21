// Owned synthetic mechanism fixture; no external scene assets.
export function syntheticScene(): ArrayBuffer {
  const names=['x','y','z','opacity','rot_0','rot_1','rot_2','rot_3','scale_0','scale_1','scale_2','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:9},(_,i)=>'f_rest_'+i)];
  const points=[
    [-0.7,0,3,0.9,0.12,0.3,0.12,1,0.1,0.1,0],
    [0.7,0,3,0.9,0.3,0.1,0.1,0.1,1,0.1,Math.PI/4],
    [0,0.5,4,0.7,0.3,0.3,0.12,0.1,0.1,1,0],
    [0,0.5,2.5,0.6,0.14,0.14,0.12,1,0.2,0.1,0],
    [0,0,-2,0.9,0.1,0.1,0.1,1,1,0,0],
    [100,0,3,0.9,0.1,0.1,0.1,1,1,0,0],
  ];
  const header=new TextEncoder().encode('ply\nformat binary_little_endian 1.0\ncomment Splatforge owned synthetic fixture\nelement vertex '+points.length+'\n'+names.map(n=>'property float '+n+'\n').join('')+'end_header\n');
  const buffer=new ArrayBuffer(header.length+points.length*names.length*4);
  new Uint8Array(buffer).set(header); const view=new DataView(buffer); let offset=header.length;
  for (const [x,y,z,alpha,sx,sy,sz,r,g,b,angle] of points) {
    const values=[x,y,z,Math.log(alpha/(1-alpha)),Math.cos(angle/2),0,0,Math.sin(angle/2),Math.log(sx),Math.log(sy),Math.log(sz),(r-.5)/.28209479177387814,(g-.5)/.28209479177387814,(b-.5)/.28209479177387814,0,0,.25,0,0,0,0,0,0];
    values.forEach(value=>{view.setFloat32(offset,value,true);offset+=4;});
  }
  return buffer;
}

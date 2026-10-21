import { PointCloud } from '../utils/load';
import preprocessWGSL from '../shaders/preprocess.wgsl';
import renderWGSL from '../shaders/gaussian.wgsl';
import { get_sorter, c_histogram_block_rows, C } from '../sort/sort';
import { Renderer } from './renderer';

export interface GaussianRenderer extends Renderer {
  setScale: (scale: number) => void;
  destroy: () => void;
  readback: (width: number, height: number) => Promise<{visible: number; indices: number[]; splats: number[]; keys: number[]; samples: {xy:number[]; actual:number[]; expected:number[]; error:number}[]}>;
}

export default function get_renderer(pc: PointCloud, device: GPUDevice,
  presentation_format: GPUTextureFormat, camera_buffer: GPUBuffer): GaussianRenderer {
  const sorter = get_sorter(pc.num_points, device);
  const buffer = (label: string, size: number, usage: number) => device.createBuffer({label, size, usage});
  const splats = buffer('projected splats', pc.num_points*48, GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
  const settings = buffer('render settings', 16, GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  const indirect = buffer('draw indirect', 16, GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
  device.queue.writeBuffer(indirect, 0, new Uint32Array([6,0,0,0]));
  const setScale = (scale: number) => device.queue.writeBuffer(settings, 0, new Float32Array([scale,pc.sh_deg,0,0]));
  setScale(1);
  const preprocess = device.createComputePipeline({label:'Gaussian preprocess',layout:'auto',compute:{
    module:device.createShaderModule({label:'Gaussian preprocess',code:preprocessWGSL}),entryPoint:'preprocess',
    constants:{workgroupSize:C.histogram_wg_size,sortKeyPerThread:c_histogram_block_rows}}});
  const group = (pipeline: GPUComputePipeline|GPURenderPipeline, index: number, buffers: GPUBuffer[]) => device.createBindGroup({
    layout:pipeline.getBindGroupLayout(index),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
  const globals = group(preprocess,0,[camera_buffer,settings]);
  const scene = group(preprocess,1,[pc.gaussian_3d_buffer,pc.sh_buffer,splats]);
  const sorting = group(preprocess,2,[sorter.sort_info_buffer,sorter.ping_pong[0].sort_depths_buffer,
    sorter.ping_pong[0].sort_indices_buffer,sorter.sort_dispatch_indirect_buffer]);
  const module = device.createShaderModule({label:'Gaussian quads',code:renderWGSL});
  const pipeline = device.createRenderPipeline({label:'Gaussian alpha quads',layout:'auto',
    vertex:{module,entryPoint:'vs_main'},fragment:{module,entryPoint:'fs_main',targets:[{format:presentation_format,
      blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
    primitive:{topology:'triangle-list'}});
  const rendering = group(pipeline,0,[camera_buffer,splats,sorter.ping_pong[0].sort_indices_buffer]);
  return {
    camera_buffer, setScale,
    frame(encoder, view) {
      device.queue.writeBuffer(sorter.sort_info_buffer,0,new Uint32Array([0]));
      device.queue.writeBuffer(sorter.sort_dispatch_indirect_buffer,0,new Uint32Array([0,1,1]));
      const compute = encoder.beginComputePass({label:'Gaussian projection'});
      compute.setPipeline(preprocess); compute.setBindGroup(0,globals); compute.setBindGroup(1,scene); compute.setBindGroup(2,sorting);
      compute.dispatchWorkgroups(Math.ceil(pc.num_points/C.histogram_wg_size)); compute.end();
      encoder.copyBufferToBuffer(sorter.sort_info_buffer,0,indirect,4,4);
      sorter.sort(encoder);
      const pass = encoder.beginRenderPass({label:'Gaussian draw',colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0.015,g:0.02,b:0.03,a:1}}]});
      pass.setPipeline(pipeline); pass.setBindGroup(0,rendering); pass.drawIndirect(indirect,0); pass.end();
    },
    async readback(width, height) {
      if (pc.num_points>4096) throw new Error("Diagnostics are limited to 4096 Gaussians; load the synthetic scene");
      const sizes=[4,pc.num_points*4,pc.num_points*48,pc.num_points*4];
      const sources=[sorter.sort_info_buffer,sorter.ping_pong[0].sort_indices_buffer,splats,sorter.ping_pong[0].sort_depths_buffer];
      const copies=sizes.map((size,i)=>buffer('diagnostic readback '+i,size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));
      const texture=device.createTexture({label:'diagnostic frame',size:[width,height],format:presentation_format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      const rowBytes=Math.ceil(width*4/256)*256;
      const pixels=buffer('diagnostic pixels',rowBytes*height,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
      try {
        const encoder=device.createCommandEncoder();
        this.frame(encoder,texture.createView());
        encoder.copyTextureToBuffer({texture},{buffer:pixels,bytesPerRow:rowBytes},[width,height]);
        copies.forEach((copy,i)=>encoder.copyBufferToBuffer(sources[i],0,copy,0,sizes[i]));
        device.queue.submit([encoder.finish()]);
        await Promise.all([...copies,pixels].map(copy=>copy.mapAsync(GPUMapMode.READ)));
        const visible=new Uint32Array(copies[0].getMappedRange())[0];
        const indices=Array.from(new Uint32Array(copies[1].getMappedRange())).slice(0,visible);
        const projected=Array.from(new Float32Array(copies[2].getMappedRange()));
        const rgba=new Uint8Array(pixels.getMappedRange());
        const samples=indices.map(index=>{
          const o=index*12;
          const x=Math.max(0,Math.min(width-1,Math.floor((projected[o]+1)*width/2)));
          const y=Math.max(0,Math.min(height-1,Math.floor((1-projected[o+1])*height/2)));
          const expected=[.015,.02,.03];
          for (const i of indices) {
            const q=i*12;
            const dx=x+.5-(projected[q]+1)*width/2;
            const dy=y+.5-(1-projected[q+1])*height/2;
            if (Math.abs(dx)>projected[q+2]||Math.abs(dy)>projected[q+2]) continue;
            const power=-.5*(projected[q+4]*dx*dx+2*projected[q+5]*dx*dy+projected[q+6]*dy*dy);
            const alpha=Math.min(.99,projected[q+7]*Math.exp(power));
            if (alpha<1/255||power>0) continue;
            for(let channel=0;channel<3;channel++) expected[channel]=Math.min(1,Math.max(0,projected[q+8+channel]*alpha+expected[channel]*(1-alpha)));
          }
          const offset=y*rowBytes+x*4;
          const channels=presentation_format.startsWith('bgra')?[2,1,0]:[0,1,2];
          const actual=channels.map(channel=>rgba[offset+channel]/255);
          return {xy:[x,y],actual,expected,error:Math.max(...actual.map((v,c)=>Math.abs(v-expected[c])))};
        });
        return {visible,indices,splats:projected,keys:Array.from(new Uint32Array(copies[3].getMappedRange())).slice(0,visible),samples};
      } finally { copies.forEach(copy=>copy.destroy()); pixels.destroy(); texture.destroy(); }
    },
    destroy() { splats.destroy(); settings.destroy(); indirect.destroy(); sorter.destroy(); },
  };
}

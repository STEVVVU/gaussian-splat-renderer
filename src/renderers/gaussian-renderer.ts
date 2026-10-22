import { PointCloud } from '../utils/load';
import preprocessWGSL from '../shaders/preprocess.wgsl';
import renderWGSL from '../shaders/gaussian.wgsl';
import presentWGSL from '../shaders/present.wgsl';
import { get_sorter, c_histogram_block_rows, C } from '../sort/sort';
import { Renderer } from './renderer';
import { cpuSort } from '../utils/benchmark';
import { Float16Array } from '@petamoriken/float16';

export interface GaussianRenderer extends Renderer {
  frame: (encoder: GPUCommandEncoder, view: GPUTextureView, query?: GPUQuerySet) => void;
  referenceFrame: (getView: () => GPUTextureView, capturePairs?:boolean) => Promise<{readbackMs:number;sortMs:number;pairs?:{keys:number[];indices:number[]}}>;
  allocationBytes: number;
  resize: (width: number, height: number) => void;
  setScale: (scale: number) => void;
  destroy: () => void;
  readback: (width: number, height: number, reference?: boolean, large?:boolean, diagnosticFormat?: 'rgba16float') => Promise<{visible: number; indices: number[]; splats: number[]; keys: number[]; imageSha256:string; imageBytes?:Uint8Array;textureFormat:GPUTextureFormat;referencePairs?:{keys:number[];indices:number[]}; samples: {xy:number[]; actual:number[]; expected:number[]; error:number;unorm8Diagnostic?:{expected:number[];error:number;contributions:number}}[]}>;
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
    vertex:{module,entryPoint:'vs_main'},fragment:{module,entryPoint:'fs_main',targets:[{format:'rgba16float',
      blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
    primitive:{topology:'triangle-list'}});
  const rendering = group(pipeline,0,[camera_buffer,splats,sorter.ping_pong[0].sort_indices_buffer]);
  const presentModule=device.createShaderModule({label:'Gaussian presentation',code:presentWGSL});
  const presentPipeline=device.createRenderPipeline({label:'Gaussian presentation',layout:'auto',
    vertex:{module:presentModule,entryPoint:'vs_main'},fragment:{module:presentModule,entryPoint:'fs_main',targets:[{format:presentation_format}]},
    primitive:{topology:'triangle-list'}});
  let accumulation: GPUTexture | undefined;
  let accumulationView: GPUTextureView | undefined;
  let presentationGroup: GPUBindGroup | undefined;
  let accumulationSize: [number,number] = [0,0];
  function resize(width: number,height: number) {
    if(width===accumulationSize[0]&&height===accumulationSize[1])return;
    accumulation?.destroy();
    accumulation=device.createTexture({label:'Gaussian float accumulation',size:[width,height],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    accumulationView=accumulation.createView();accumulationSize=[width,height];
    presentationGroup=device.createBindGroup({layout:presentPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:accumulationView}]});
  }
  function present(encoder: GPUCommandEncoder,view: GPUTextureView,query?:GPUQuerySet) {
    const pass=encoder.beginRenderPass({label:'Gaussian presentation',...(query?{timestampWrites:{querySet:query,endOfPassWriteIndex:3}}:{}),colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(presentPipeline);pass.setBindGroup(0,presentationGroup!);pass.draw(3);pass.end();
  }
  function renderFrame(encoder: GPUCommandEncoder,view: GPUTextureView,query?:GPUQuerySet) {
    if(!accumulationView)throw new Error('Gaussian renderer size is not set');
    projection(encoder,query);sorter.sort(encoder);draw(encoder,accumulationView,query);present(encoder,view,query);
  }
  let referenceRead: GPUBuffer | undefined;
  function projection(encoder: GPUCommandEncoder, query?: GPUQuerySet) {
    device.queue.writeBuffer(sorter.sort_info_buffer,0,new Uint32Array([0]));
    device.queue.writeBuffer(sorter.sort_dispatch_indirect_buffer,0,new Uint32Array([0,1,1]));
    const compute = encoder.beginComputePass({label:'Gaussian projection',...(query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{})});
    compute.setPipeline(preprocess); compute.setBindGroup(0,globals); compute.setBindGroup(1,scene); compute.setBindGroup(2,sorting);
    compute.dispatchWorkgroups(Math.ceil(pc.num_points/C.histogram_wg_size)); compute.end();
    encoder.copyBufferToBuffer(sorter.sort_info_buffer,0,indirect,4,4);
  }
  function draw(encoder: GPUCommandEncoder, view: GPUTextureView, query?: GPUQuerySet) {
    const pass = encoder.beginRenderPass({label:'Gaussian draw',...(query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:2}}:{}),colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0.015,g:0.02,b:0.03,a:1}}]});
    pass.setPipeline(pipeline); pass.setBindGroup(0,rendering); pass.drawIndirect(indirect,0); pass.end();
  }
  async function referenceFrame(getView: () => GPUTextureView, capturePairs=false) {
    referenceRead ??= buffer('CPU sort reference readback',4+pc.num_points*8,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    const started=performance.now();
    const encoder=device.createCommandEncoder();projection(encoder);
    encoder.copyBufferToBuffer(sorter.sort_info_buffer,0,referenceRead,0,4);
    encoder.copyBufferToBuffer(sorter.ping_pong[0].sort_depths_buffer,0,referenceRead,4,pc.num_points*4);
    encoder.copyBufferToBuffer(sorter.ping_pong[0].sort_indices_buffer,0,referenceRead,4+pc.num_points*4,pc.num_points*4);
    device.queue.submit([encoder.finish()]);
    await referenceRead.mapAsync(GPUMapMode.READ);
    const raw=referenceRead.getMappedRange();
    const count=new Uint32Array(raw,0,1)[0];
    const readbackMs=performance.now()-started, sortStarted=performance.now();
    const sorted=cpuSort(new Uint32Array(raw,4,pc.num_points),new Uint32Array(raw,4+pc.num_points*4,pc.num_points),count);
    const sortMs=performance.now()-sortStarted;
    const pairs=capturePairs?{keys:Array.from(new Uint32Array(raw,4,count)),indices:Array.from(new Uint32Array(raw,4+pc.num_points*4,count))}:undefined;
    referenceRead.unmap();
    device.queue.writeBuffer(sorter.ping_pong[0].sort_indices_buffer,0,sorted);
    // A canvas view acquired before mapAsync may expire while the readback waits.
    // Acquire only for this synchronous encode/submit section, after CPU sorting.
    const drawing=device.createCommandEncoder();
    draw(drawing,accumulationView!);present(drawing,getView());
    device.queue.submit([drawing.finish()]);
    return {readbackMs,sortMs,...(pairs?{pairs}:{})};
  }
  return {
    camera_buffer, setScale, referenceFrame, resize,
    get allocationBytes() { return pc.gaussian_3d_buffer.size+pc.sh_buffer.size+splats.size+settings.size+indirect.size+sorter.allocationBytes+(referenceRead?.size??0)+(accumulation?.width??0)*(accumulation?.height??0)*8; },
    frame(encoder, view, query) {
      renderFrame(encoder, view, query);
    },
    async readback(width, height, reference=false, large=false, diagnosticFormat) {
      if (pc.num_points>4096 && !large) throw new Error("Diagnostics are limited to 4096 Gaussians; load the synthetic scene");
      resize(width,height);
      const textureFormat=diagnosticFormat??presentation_format;
      const bytesPerPixel=diagnosticFormat?8:4;
      const sizes=[4,pc.num_points*4,pc.num_points*48,pc.num_points*4];
      const sources=[sorter.sort_info_buffer,sorter.ping_pong[0].sort_indices_buffer,splats,sorter.ping_pong[0].sort_depths_buffer];
      const copies=sizes.map((size,i)=>buffer('diagnostic readback '+i,size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ));
      const texture=device.createTexture({label:'diagnostic frame',size:[width,height],format:textureFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      const rowBytes=Math.ceil(width*bytesPerPixel/256)*256;
      const pixels=buffer('diagnostic pixels',rowBytes*height,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
      try {
        const encoder=device.createCommandEncoder();
        // Float diagnostics replay the immediately preceding capture's projection and draw order.
        const referenceResult=reference&&!diagnosticFormat?await referenceFrame(()=>texture.createView(),large):undefined;
        if (diagnosticFormat) draw(encoder,texture.createView());
        else if (!reference) renderFrame(encoder,texture.createView());
        encoder.copyTextureToBuffer({texture},{buffer:pixels,bytesPerRow:rowBytes},[width,height]);
        copies.forEach((copy,i)=>encoder.copyBufferToBuffer(sources[i],0,copy,0,sizes[i]));
        device.queue.submit([encoder.finish()]);
        await Promise.all([...copies,pixels].map(copy=>copy.mapAsync(GPUMapMode.READ)));
        const visible=new Uint32Array(copies[0].getMappedRange())[0];
        const indices=Array.from(new Uint32Array(copies[1].getMappedRange())).slice(0,visible);
        const projected=Array.from(new Float32Array(copies[2].getMappedRange()));
        const rgba=new Uint8Array(pixels.getMappedRange());
        const floatPixels=diagnosticFormat?new Float16Array(rgba.buffer,rgba.byteOffset,rgba.byteLength/2):undefined;
        const sampleIndices=indices.length>32?Array.from({length:32},(_,i)=>indices[Math.floor(i*indices.length/32)]):indices;
        const samples=sampleIndices.map(index=>{
          const o=index*12;
          const x=Math.max(0,Math.min(width-1,Math.floor((projected[o]+1)*width/2)));
          const y=Math.max(0,Math.min(height-1,Math.floor((1-projected[o+1])*height/2)));
          const expected=[.015,.02,.03];
          const unorm8=large?expected.map(value=>Math.round(value*255)/255):undefined;
          let contributions=0;
          for (const i of indices) {
            const q=i*12;
            const dx=x+.5-(projected[q]+1)*width/2;
            const dy=y+.5-(1-projected[q+1])*height/2;
            if (Math.abs(dx)>projected[q+2]||Math.abs(dy)>projected[q+2]) continue;
            const power=-.5*(projected[q+4]*dx*dx+2*projected[q+5]*dx*dy+projected[q+6]*dy*dy);
            const alpha=Math.min(.99,projected[q+7]*Math.exp(power));
            if (alpha<1/255||power>0) continue;
            contributions++;
            for(let channel=0;channel<3;channel++) expected[channel]=Math.min(1,Math.max(0,projected[q+8+channel]*alpha+expected[channel]*(1-alpha)));
            if(unorm8)for(let channel=0;channel<3;channel++)unorm8[channel]=Math.round(Math.min(1,Math.max(0,projected[q+8+channel]*alpha+unorm8[channel]*(1-alpha)))*255)/255;
          }
          const offset=y*rowBytes+x*4;
          const actual=diagnosticFormat?Array.from({length:3},(_,channel)=>floatPixels![(y*rowBytes+x*8)/2+channel]):
            (presentation_format.startsWith('bgra')?[2,1,0]:[0,1,2]).map(channel=>rgba[offset+channel]/255);
          return {xy:[x,y],actual,expected,error:Math.max(...actual.map((v,c)=>Math.abs(v-expected[c]))),...(unorm8?{unorm8Diagnostic:{expected:unorm8,error:Math.max(...actual.map((v,c)=>Math.abs(v-unorm8[c]))),contributions}}:{})};
        });
        const imageSha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rgba)),byte=>byte.toString(16).padStart(2,'0')).join('');
        return {visible,indices,splats:projected,keys:Array.from(new Uint32Array(copies[3].getMappedRange())).slice(0,visible),imageSha256,textureFormat,...(large?{imageBytes:rgba.slice()}:{}),...(referenceResult?.pairs?{referencePairs:referenceResult.pairs}:{}),samples};
      } finally { copies.forEach(copy=>copy.destroy()); pixels.destroy(); texture.destroy(); }
    },
    destroy() { referenceRead?.destroy(); accumulation?.destroy(); splats.destroy(); settings.destroy(); indirect.destroy(); sorter.destroy(); },
  };
}

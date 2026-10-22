import { mat4 } from 'wgpu-matrix';
import { syntheticScene } from '../utils/synthetic';
import { load } from '../utils/load';
import { Pane } from 'tweakpane';
import * as TweakpaneFileImportPlugin from 'tweakpane-plugin-file-import';
import { default as get_renderer_gaussian, GaussianRenderer } from './gaussian-renderer';
import { default as get_renderer_pointcloud } from './point-cloud-renderer';
import { Camera, load_camera_presets} from '../camera/camera';
import { CameraControl } from '../camera/camera-control';
import { time, timeReturn } from '../utils/simple-console';
import { benchmarkScene } from '../utils/benchmark';

export interface Renderer {
  frame: (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => void,
  camera_buffer: GPUBuffer,
}

export default async function init(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice,
  adapter: object
) {
  let ply_file_loaded = false;

  let renderers: { pointcloud?: Renderer, gaussian?: Renderer } = {};
  let gaussian_renderer: GaussianRenderer | undefined;
  let pointcloud_renderer: Renderer | undefined;
  let renderer: Renderer | undefined;
  let cameras;
  let benchmarking=false;
  let benchmarkEvidence: unknown;
  const status=document.createElement("p"); status.id="status"; status.setAttribute("role","status"); status.textContent="Load a PLY or the owned synthetic scene. Drag to look; right-drag to pan; wheel to move."; document.body.append(status);
  const diagnostics=document.createElement("pre"); diagnostics.id="diagnostics"; document.body.append(diagnostics);
  device.addEventListener("uncapturederror",event=>{status.textContent="GPU error: "+(event as GPUUncapturedErrorEvent).error.message;});

  const camera = new Camera(canvas, device);
  const control = new CameraControl(camera);

  const observer = new ResizeObserver(() => {
    if (benchmarking) return;
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    camera.on_update_canvas();
  });
  observer.observe(canvas);

  const presentation_format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentation_format,
    alphaMode: 'opaque',
  });


  // Tweakpane: easily adding tweak control for parameters.
  const params = {
    fps: 0.0,
    gaussian_multiplier: 1,
    renderer: 'gaussian',
    ply_file: '',
    cam_file: '',
  };

  const pane = new Pane({
    title: 'Config',
    expanded: true,
  });
  pane.registerPlugin(TweakpaneFileImportPlugin);
  {
    pane.addMonitor(params, 'fps', {
      readonly:true
    });
  }
  {
    pane.addInput(params, 'renderer', {
      options: {
        pointcloud: 'pointcloud',
        gaussian: 'gaussian',
      }
    }).on('change', (e) => {
      renderer = renderers[e.value];
    });
  }
  {
    pane.addInput(params, 'ply_file', {
      view: 'file-input',
      lineCount: 3,
      filetypes: ['.ply'],
      invalidFiletypeMessage: "We can't accept those filetypes!"
    })
    .on('change', async (file) => {
      const uploadedFile = file.value;
      if (uploadedFile) {
        try { await install(await load(uploadedFile,device)); } catch(error) { showError(error); }
      }else{
        ply_file_loaded = false;
      }
    });
  }
  {
    pane.addInput(params, 'cam_file', {
      view: 'file-input',
      lineCount: 3,
      filetypes: ['.json'],
      invalidFiletypeMessage: "We can't accept those filetypes!"
    })
    .on('change', async (file) => {
      const uploadedFile = file.value;
      if (uploadedFile) {
        cameras=await load_camera_presets(file.value);
        camera.set_preset(cameras[0]);

      }else{

      }
    });
  }
  {
    pane.addInput(
      params,
      'gaussian_multiplier',
      {min: 0, max: 1.5}
    ).on('change', (e) => {
      gaussian_renderer?.setScale(e.value);
    });
  }

  pane.addButton({title:'Load synthetic scene'}).on('click', async () => {
    try {
      camera.set_preset({position:new Float32Array([0,0,0]),rotation:mat4.identity()});
      await install(await load(syntheticScene(),device)); synthetic=true;
    } catch(error) { showError(error); }
  });
  pane.addButton({title:'GPU diagnostics'}).on('click', async () => {
    try {
      if (!gaussian_renderer) throw new Error('Load a scene first');
      const output=document.querySelector('#diagnostics') as HTMLElement;
      if (output.textContent) { output.textContent=''; return; }
      const result=await gaussian_renderer.readback(canvas.width,canvas.height);
      const indices=result.indices;
      const checks=synthetic ? {
        visible:result.visible===4,
        culling:!indices.includes(4)&&!indices.includes(5),
        sort:indices[0]===2&&indices[3]===3&&new Set(indices.slice(1,3)).size===2&&indices.slice(1,3).every(i=>i===0||i===1),
        finite:result.splats.slice(0,48).every(Number.isFinite),
        alphaComposition:result.samples.every(sample=>sample.error<.012),
        viewDependentSH:[0,1,2,3].every(i=>{
          const positions=[[-.7001953125,0,3],[.7001953125,0,3],[0,.5,4],[0,.5,2.5]];
          const base=[1,.1,.1,1];
          const d=positions[i].map((v,c)=>v-camera.position[c]);
          const expected=Math.max(0,base[i]-.4886025119029199*.25*d[0]/Math.hypot(...d));
          return Math.abs(result.splats[i*12+8]-expected)<.002;
        }),
        positiveConics:[0,1,2,3].every(i=>result.splats[i*12+4]>0&&result.splats[i*12+6]>0),
      } : undefined;
      output.textContent=JSON.stringify({viewport:[canvas.width,canvas.height],camera:Array.from(camera.position),checks, ...result},null,2);
    } catch(error) { showError(error); }
  });
  pane.addButton({title:'Benchmark'}).on('click', async () => {
    if (benchmarking) return;
    benchmarking=true;
    pane.disabled=true;
    status.textContent='Benchmark running; keep this tab visible and camera still';
    const results: object[]=[];
    let failureDiagnostics: object|undefined;
    const query=device.features.has('timestamp-query')?device.createQuerySet({type:'timestamp',count:4}):undefined;
    const resolved=query?device.createBuffer({size:32,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}):undefined;
    const read=query?device.createBuffer({size:32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}):undefined;
    const distribution=(values:number[])=>{
      if (!values.length||values.some(value=>!Number.isFinite(value)||value<=0)) throw new Error('Invalid benchmark samples');
      const sorted=[...values].sort((a,b)=>a-b);
      return {samples:values,p50:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],range:[sorted[0],sorted[sorted.length-1]]};
    };
    try {
      await device.queue.onSubmittedWorkDone();
      for (const count of [16384,131072,524288]) for (const [width,height] of [[640,360],[1280,720]]) {
        canvas.width=width;canvas.height=height;camera.on_update_canvas();
        camera.set_preset({position:new Float32Array([0,0,0]),rotation:mat4.identity()});
        await install(await load(benchmarkScene(count),device));
        const active=gaussian_renderer!;
        active.setScale(1);
        const measure=async (cpu:boolean)=>{
          const started=performance.now();
          performance.mark('splatforge-frame-start');
          let detail: object|undefined;
          let gpuMs:number|null=null,stages:object|null=null;
          if (cpu) detail=await active.referenceFrame(()=>context.getCurrentTexture().createView());
          else {
            const encoder=device.createCommandEncoder();
            active.frame(encoder,context.getCurrentTexture().createView(),query);
            if (query&&resolved&&read) {encoder.resolveQuerySet(query,0,4,resolved,0);encoder.copyBufferToBuffer(resolved,0,read,0,32);}
            device.queue.submit([encoder.finish()]);
          }
          await device.queue.onSubmittedWorkDone();
          performance.mark('splatforge-frame-end');
          const wallMs=performance.measure(cpu?'splatforge-cpu-sort-roundtrip':'splatforge-gpu-radix','splatforge-frame-start','splatforge-frame-end').duration;
          performance.clearMarks('splatforge-frame-start');performance.clearMarks('splatforge-frame-end');
          performance.clearMeasures(cpu?'splatforge-cpu-sort-roundtrip':'splatforge-gpu-radix');
          if (!cpu&&read) {
            await read.mapAsync(GPUMapMode.READ);
            const values=new BigUint64Array(read.getMappedRange());
            gpuMs=Number(values[3]-values[0])/1e6;
            stages={projectionMs:Number(values[1]-values[0])/1e6,sortAndInterpassMs:Number(values[2]-values[1])/1e6,drawMs:Number(values[3]-values[2])/1e6};
            read.unmap();
          }
          return {wallMs,gpuMs,stages,detail,hostEnvelopeMs:performance.now()-started};
        };
        for (const cpu of [false,true]) for(let i=0;i<10;i++) await measure(cpu);
        const gpu=await active.readback(width,height,false,true);
        const gpuFloat=await active.readback(width,height,false,true,'rgba16float');
        const cpu=await active.readback(width,height,true,true);
        const cpuFloat=await active.readback(width,height,true,true,'rgba16float');
        let maxImageError=0,totalError=0;
        if (!gpu.imageBytes||!cpu.imageBytes||gpu.imageBytes.length!==cpu.imageBytes.length) throw new Error('Missing full quality images');
        for(let i=0;i<gpu.imageBytes.length;i++) {const error=Math.abs(gpu.imageBytes[i]-cpu.imageBytes[i]);maxImageError=Math.max(maxImageError,error);totalError+=error;}
        const checks={visible:gpu.visible>count/4&&gpu.visible===cpu.visible,unique:new Set(gpu.indices).size===gpu.visible,sorted:gpu.keys.every((key,i)=>i===0||key>=gpu.keys[i-1]),finite:gpu.splats.every(Number.isFinite),cpuComposition:gpu.samples.every(sample=>sample.error<.012)&&cpu.samples.every(sample=>sample.error<.012),equalQuality:maxImageError<=3};
        if (Object.values(checks).some(pass=>!pass)) {
          const inspect=(keys:number[],indices:number[])=>{
            const positions=new Map<number,number>(),duplicates:object[]=[],inversions:object[]=[],invalid:object[]=[];
            indices.forEach((index,position)=>{if(positions.has(index)&&duplicates.length<16)duplicates.push({index,first:positions.get(index),position});if(!positions.has(index))positions.set(index,position);if(index>=count&&invalid.length<16)invalid.push({index,position});if(position&&keys[position]<keys[position-1]&&inversions.length<16)inversions.push({position,previous:keys[position-1],key:keys[position],previousIndex:indices[position-1],index});});
            return {uniqueCount:positions.size,duplicates,inversions,invalid};
          };
          const imageDifferences:{x:number;y:number;channel:number;gpu:number;cpu:number}[]=[];
          for(let i=0;i<gpu.imageBytes.length&&imageDifferences.length<16;i++)if(Math.abs(gpu.imageBytes[i]-cpu.imageBytes[i])>3)imageDifferences.push({x:Math.floor(i/4)%width,y:Math.floor(i/(width*4)),channel:i%4,gpu:gpu.imageBytes[i],cpu:cpu.imageBytes[i]});
          const cpuKeysByIndex=new Map<number,number>();
          cpu.referencePairs?.indices.forEach((index,i)=>cpuKeysByIndex.set(index,cpu.referencePairs!.keys[i]));
          const cpuSortedKeys=cpu.indices.map(index=>cpuKeysByIndex.get(index)!);
          const gpuSet=new Set(gpu.indices),missingCpuIndices=cpu.indices.filter(index=>!gpuSet.has(index));
          const pairKeyMismatches:object[]=[];
          gpu.indices.forEach((index,position)=>{const expected=cpuKeysByIndex.get(index);if(expected!==gpu.keys[position]&&pairKeyMismatches.length<16)pairKeyMismatches.push({position,index,key:gpu.keys[position],expected});});
          // Preserve actual projected f32 rows for offline raster/blend diagnosis.
          // This executes only after a failed quality gate, never in timed work.
          const worst=(result:typeof gpu)=>result.samples.reduce((a,b)=>a.error>=b.error?a:b);
          const pixels=[worst(gpu).xy,worst(cpu).xy,...imageDifferences.map(({x,y})=>[x,y]),...(count===16384&&width===640&&height===360?[[463,69]]:[])];
          const tracePixels=pixels.filter((xy,i)=>pixels.findIndex(other=>other[0]===xy[0]&&other[1]===xy[1])===i);
          const compositionTrace=(result:typeof gpu)=>tracePixels.map(([x,y])=>({
            xy:[x,y],textureBytes:Array.from(result.imageBytes!.slice((y*width+x)*4,(y*width+x)*4+4)),
            // A one-pixel diagnostic margin also retains just-outside quads.
            projectedRows:result.indices.flatMap((index,drawPosition)=>{
              const o=index*12,radius=result.splats[o+2];
              const dx=x+.5-(result.splats[o]+1)*width/2,dy=y+.5-(1-result.splats[o+1])*height/2;
              return Math.abs(dx)<=radius+1&&Math.abs(dy)<=radius+1?[{index,drawPosition,projected:result.splats.slice(o,o+12)}]:[];
            })
          }));
          const originalFailure={scope:'Owned procedural scene only; full key/index arrays for the first failed workload. CPU input pairs are captured before native sorting. No timed-region instrumentation or tolerance change.',count,width,height,textureFormat:presentation_format,checks,maxImageError,gpu:{visible:gpu.visible,keys:gpu.keys,indices:gpu.indices,inspection:inspect(gpu.keys,gpu.indices),composition:gpu.samples,compositionTrace:compositionTrace(gpu),imageSha256:gpu.imageSha256},cpuReference:{visible:cpu.visible,inputPairs:cpu.referencePairs,sortedKeys:cpuSortedKeys,indices:cpu.indices,inspection:inspect(cpuSortedKeys,cpu.indices),composition:cpu.samples,compositionTrace:compositionTrace(cpu),imageSha256:cpu.imageSha256},pairKeyMismatches,missingFromGpu:missingCpuIndices.slice(0,64),missingFromGpuCount:missingCpuIndices.length,imageDifferences};
          failureDiagnostics=originalFailure;
          let floatDiagnostic:object;
          try {
            const same=(a:number[],b:number[])=>a.length===b.length&&a.every((value,i)=>value===b[i]);
            const floatPathMatchesOriginal={gpuProjected:same(gpuFloat.splats,gpu.splats),gpuIndices:same(gpuFloat.indices,gpu.indices),gpuKeys:same(gpuFloat.keys,gpu.keys),cpuProjected:same(cpuFloat.splats,cpu.splats),cpuIndices:same(cpuFloat.indices,cpu.indices),cpuKeys:same(cpuFloat.keys,cpu.keys)};
            floatDiagnostic={textureFormat:'rgba16float',gpu:{samples:gpuFloat.samples,imageSha256:gpuFloat.imageSha256},cpuReference:{samples:cpuFloat.samples,imageSha256:cpuFloat.imageSha256},projectedDataAndOrderEquality:floatPathMatchesOriginal,comparisonInputsMatch:Object.values(floatPathMatchesOriginal).every(Boolean)};
          } catch(error) {
            floatDiagnostic={error:String(error)};
          }
          failureDiagnostics={...originalFailure,floatDiagnostic};
          diagnostics.textContent=JSON.stringify(floatDiagnostic,null,2);
          throw new Error('Benchmark quality failed '+JSON.stringify({count,width,height,checks,maxImageError}));
        }
        const samples=[[] as Awaited<ReturnType<typeof measure>>[],[] as Awaited<ReturnType<typeof measure>>[]];
        for(let repeat=0;repeat<7;repeat++) for(let position=0;position<2;position++) {
          const side=(repeat+position)%2;
          for(let frame=0;frame<20;frame++) samples[side].push(await measure(side===1));
        }
        const final=await active.readback(width,height,false,true);
        if (final.visible!==gpu.visible||final.samples.some(sample=>sample.error>=.012)||!final.splats.every(Number.isFinite)) throw new Error('Post-campaign image oracle failed');
        results.push({count,width,height,checks,maxImageError,meanImageError:totalError/gpu.imageBytes.length,imageHashes:{gpu:gpu.imageSha256,cpu:cpu.imageSha256,final:final.imageSha256},visible:gpu.visible,logicalGpuBytes:active.allocationBytes+camera.uniform_buffer.size+width*height*4,cpuSortScratchBytes:gpu.visible*12,sides:samples.map((values,side)=>({name:side?'CPU native typed-array sort with GPU roundtrip':'GPU radix sort',wallFrameMs:distribution(values.map(v=>v.wallMs)),gpuFrameMs:side||!query?null:distribution(values.map(v=>v.gpuMs!)),raw:values})),offered:280,finished:280,failed:0});
      }
      benchmarkEvidence={pass:true,adapter,userAgent:navigator.userAgent,seed:565,workloadVersion:1,warmupFramesPerSide:10,repeatsPerSide:7,framesPerRepeat:20,timing:'Browser UserTiming around actual production projection/sort/draw and queue completion; no RAF/vsync. GPU timestamps only for radix path when supported; CPU baseline includes readback/native stable typed-array sort/upload. Logical bytes are not physical VRAM. Allocation, compilation, warmup, timestamp readback and image checks excluded.',results};
      status.textContent='Benchmark PASS; export benchmark';
    } catch(error) {
      benchmarkEvidence={pass:false,error:String(error),adapter,failureDiagnostics,completed:results};showError(error);
    } finally {
      query?.destroy();resolved?.destroy();read?.destroy();
      benchmarking=false;pane.disabled=false;canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;camera.on_update_canvas();gaussian_renderer?.setScale(params.gaussian_multiplier);
    }
  });
  pane.addButton({title:'Export benchmark'}).on('click',()=>{
    if (!benchmarkEvidence) {showError(new Error('Run Benchmark first'));return;}
    const json=JSON.stringify(benchmarkEvidence,null,2);
    diagnostics.textContent=json;
    const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='splatforge-benchmark.json';anchor.click();URL.revokeObjectURL(url);
  });
  function showError(error: unknown) { (document.querySelector('#status') as HTMLElement).textContent=String(error); }
  let synthetic=false;
  let currentCloud: Awaited<ReturnType<typeof load>>;
  async function install(pc: Awaited<ReturnType<typeof load>>) {
    device.pushErrorScope('validation');
    const nextPoint=get_renderer_pointcloud(pc,device,presentation_format,camera.uniform_buffer);
    const nextGaussian=get_renderer_gaussian(pc,device,presentation_format,camera.uniform_buffer);
    nextGaussian.resize(canvas.width,canvas.height);
    const error=await device.popErrorScope();
    if (error) { nextGaussian.destroy(); pc.gaussian_3d_buffer.destroy(); pc.sh_buffer.destroy(); throw new Error(error.message); }
    gaussian_renderer?.destroy(); currentCloud?.gaussian_3d_buffer.destroy(); currentCloud?.sh_buffer.destroy();
    currentCloud=pc; gaussian_renderer=nextGaussian; pointcloud_renderer=nextPoint;
    gaussian_renderer.setScale(params.gaussian_multiplier);
    renderers={pointcloud:nextPoint,gaussian:nextGaussian}; renderer=renderers[params.renderer];
    ply_file_loaded=true; synthetic=false; diagnostics.textContent="";
    (document.querySelector('#status') as HTMLElement).textContent='Loaded '+pc.num_points+' Gaussians | SH degree '+pc.sh_deg;
  }
  document.addEventListener('keydown', (event) => {
    switch(event.key) {
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7':
      case '8':
      case '9':
        const i = parseInt(event.key);
        console.log(`set to camera preset ${i}`);
        if (cameras?.[i]) camera.set_preset(cameras[i]);
        break;
    }
  });

  function frame() {
    if (!benchmarking && ply_file_loaded && renderer) {
      params.fps=1.0/timeReturn()*1000.0;
      time();
      gaussian_renderer?.resize(canvas.width,canvas.height);
      const encoder = device.createCommandEncoder();
      const texture_view = context.getCurrentTexture().createView();
      renderer.frame(encoder, texture_view);
      device.queue.submit([encoder.finish()]);
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

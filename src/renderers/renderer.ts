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

export interface Renderer {
  frame: (encoder: GPUCommandEncoder, texture_view: GPUTextureView) => void,
  camera_buffer: GPUBuffer,
}

export default async function init(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice
) {
  let ply_file_loaded = false;

  let renderers: { pointcloud?: Renderer, gaussian?: Renderer } = {};
  let gaussian_renderer: GaussianRenderer | undefined;
  let pointcloud_renderer: Renderer | undefined;
  let renderer: Renderer | undefined;
  let cameras;
  const status=document.createElement("p"); status.id="status"; status.setAttribute("role","status"); status.textContent="Load a PLY or the owned synthetic scene. Drag to look; right-drag to pan; wheel to move."; document.body.append(status);
  const diagnostics=document.createElement("pre"); diagnostics.id="diagnostics"; document.body.append(diagnostics);
  device.addEventListener("uncapturederror",event=>{status.textContent="GPU error: "+(event as GPUUncapturedErrorEvent).error.message;});

  const camera = new Camera(canvas, device);
  const control = new CameraControl(camera);

  const observer = new ResizeObserver(() => {
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
  function showError(error: unknown) { (document.querySelector('#status') as HTMLElement).textContent=String(error); }
  let synthetic=false;
  let currentCloud: Awaited<ReturnType<typeof load>>;
  async function install(pc: Awaited<ReturnType<typeof load>>) {
    device.pushErrorScope('validation');
    const nextPoint=get_renderer_pointcloud(pc,device,presentation_format,camera.uniform_buffer);
    const nextGaussian=get_renderer_gaussian(pc,device,presentation_format,camera.uniform_buffer);
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
    if (ply_file_loaded && renderer) {
      params.fps=1.0/timeReturn()*1000.0;
      time();
      const encoder = device.createCommandEncoder();
      const texture_view = context.getCurrentTexture().createView();
      renderer.frame(encoder, texture_view);
      device.queue.submit([encoder.finish()]);
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

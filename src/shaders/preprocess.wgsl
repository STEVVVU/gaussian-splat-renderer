const SH_C0: f32 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2 = array<f32,5>(
    1.0925484305920792,
    -1.0925484305920792,
    0.31539156525252005,
    -1.0925484305920792,
    0.5462742152960396
);
const SH_C3 = array<f32,7>(
    -0.5900435899266435,
    2.890611442640554,
    -0.4570457994644658,
    0.3731763325901154,
    -0.4570457994644658,
    1.445305721320277,
    -0.5900435899266435
);

override workgroupSize: u32;
override sortKeyPerThread: u32;

struct DispatchIndirect {
    dispatch_x: atomic<u32>,
    dispatch_y: u32,
    dispatch_z: u32,
}

struct SortInfos {
    keys_size: atomic<u32>,  // instance_count in DrawIndirect
    //data below is for info inside radix sort 
    padded_size: u32, 
    passes: u32,
    even_pass: u32,
    odd_pass: u32,
}

struct CameraUniforms {
    view: mat4x4<f32>,
    view_inv: mat4x4<f32>,
    proj: mat4x4<f32>,
    proj_inv: mat4x4<f32>,
    viewport: vec2<f32>,
    focal: vec2<f32>
};

struct RenderSettings {
    gaussian_scaling: f32,
    sh_deg: f32,
}

struct Gaussian {
    pos_opacity: array<u32,2>,
    rot: array<u32,2>,
    scale: array<u32,2>
};

struct Splat {
    center_radius: vec4<f32>,
    conic_opacity: vec4<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> settings: RenderSettings;
@group(1) @binding(0) var<storage, read> gaussians: array<Gaussian>;
@group(1) @binding(1) var<storage, read> sh_coeff: array<u32>;
@group(1) @binding(2) var<storage, read_write> splats: array<Splat>;
@group(2) @binding(0)
var<storage, read_write> sort_infos: SortInfos;
@group(2) @binding(1)
var<storage, read_write> sort_depths : array<u32>;
@group(2) @binding(2)
var<storage, read_write> sort_indices : array<u32>;
@group(2) @binding(3)
var<storage, read_write> sort_dispatch: DispatchIndirect;

/// reads the ith sh coef from the storage buffer 
fn sh_coef(splat_idx: u32, c_idx: u32) -> vec3<f32> {
    let offset = splat_idx * 48u + c_idx * 3u;
    let a = unpack2x16float(sh_coeff[offset / 2u]);
    let b = unpack2x16float(sh_coeff[(offset + 1u) / 2u]);
    let c = unpack2x16float(sh_coeff[(offset + 2u) / 2u]);
    return vec3<f32>(a[offset % 2u], b[(offset + 1u) % 2u], c[(offset + 2u) % 2u]);
}

// spherical harmonics evaluation with Condon–Shortley phase
fn computeColorFromSH(dir: vec3<f32>, v_idx: u32, sh_deg: u32) -> vec3<f32> {
    var result = SH_C0 * sh_coef(v_idx, 0u);

    if sh_deg > 0u {

        let x = dir.x;
        let y = dir.y;
        let z = dir.z;

        result += - SH_C1 * y * sh_coef(v_idx, 1u) + SH_C1 * z * sh_coef(v_idx, 2u) - SH_C1 * x * sh_coef(v_idx, 3u);

        if sh_deg > 1u {

            let xx = dir.x * dir.x;
            let yy = dir.y * dir.y;
            let zz = dir.z * dir.z;
            let xy = dir.x * dir.y;
            let yz = dir.y * dir.z;
            let xz = dir.x * dir.z;

            result += SH_C2[0] * xy * sh_coef(v_idx, 4u) + SH_C2[1] * yz * sh_coef(v_idx, 5u) + SH_C2[2] * (2.0 * zz - xx - yy) * sh_coef(v_idx, 6u) + SH_C2[3] * xz * sh_coef(v_idx, 7u) + SH_C2[4] * (xx - yy) * sh_coef(v_idx, 8u);

            if sh_deg > 2u {
                result += SH_C3[0] * y * (3.0 * xx - yy) * sh_coef(v_idx, 9u) + SH_C3[1] * xy * z * sh_coef(v_idx, 10u) + SH_C3[2] * y * (4.0 * zz - xx - yy) * sh_coef(v_idx, 11u) + SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * sh_coef(v_idx, 12u) + SH_C3[4] * x * (4.0 * zz - xx - yy) * sh_coef(v_idx, 13u) + SH_C3[5] * z * (xx - yy) * sh_coef(v_idx, 14u) + SH_C3[6] * x * (xx - 3.0 * yy) * sh_coef(v_idx, 15u);
            }
        }
    }
    result += 0.5;

    return  max(vec3<f32>(0.), result);
}

// Quaternion storage uses the Gaussian PLY convention (w,x,y,z).
fn rotation(q: vec4<f32>) -> mat3x3<f32> {
    let w=q.x; let x=q.y; let y=q.z; let z=q.w;
    return mat3x3<f32>(
        vec3<f32>(1.-2.*(y*y+z*z), 2.*(x*y+w*z), 2.*(x*z-w*y)),
        vec3<f32>(2.*(x*y-w*z), 1.-2.*(x*x+z*z), 2.*(y*z+w*x)),
        vec3<f32>(2.*(x*z+w*y), 2.*(y*z-w*x), 1.-2.*(x*x+y*y)));
}

@compute @workgroup_size(workgroupSize,1,1)
fn preprocess(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if idx >= arrayLength(&gaussians) { return; }
    let g = gaussians[idx];
    let a = unpack2x16float(g.pos_opacity[0]);
    let b = unpack2x16float(g.pos_opacity[1]);
    let world = vec3<f32>(a, b.x);
    let view = camera.view * vec4<f32>(world, 1.);
    let clip = camera.proj * view;
    if view.z <= 0.01 || clip.z < 0. || clip.z > clip.w || settings.gaussian_scaling <= 0. { return; }
    let ndc = clip.xy / clip.w;
    let rawq = vec4<f32>(unpack2x16float(g.rot[0]), unpack2x16float(g.rot[1]));
    let q = rawq / max(length(rawq), 1e-8);
    let scale = exp(vec3<f32>(unpack2x16float(g.scale[0]), unpack2x16float(g.scale[1]).x)) * settings.gaussian_scaling;
    let r = rotation(q);
    let m = mat3x3<f32>(r[0]*scale.x, r[1]*scale.y, r[2]*scale.z);
    let covariance = m * transpose(m);
    let v = mat3x3<f32>(camera.view[0].xyz, camera.view[1].xyz, camera.view[2].xyz);
    let cv = v * covariance * transpose(v);
    // Jacobian in framebuffer pixels; camera projection already flips NDC Y.
    let iz = 1. / view.z;
    let jx = vec3<f32>(camera.focal.x*iz, 0., -camera.focal.x*view.x*iz*iz);
    let jy = vec3<f32>(0., camera.focal.y*iz, -camera.focal.y*view.y*iz*iz);
    let xx = dot(jx, cv*jx) + 0.3;
    let xy = dot(jx, cv*jy);
    let yy = dot(jy, cv*jy) + 0.3;
    let determinant = xx*yy-xy*xy;
    if !(determinant > 0. && determinant < 3.4e38) { return; }
    let mid = 0.5*(xx+yy);
    let radius = ceil(3.*sqrt(mid + length(vec2<f32>(0.5*(xx-yy), xy))));
    if !(radius > 0. && radius < 3.4e38) { return; }
    let extent = 2.*radius/camera.viewport;
    if any(abs(ndc) > vec2<f32>(1.2) + extent) { return; }
    let opacity = 1. / (1.+exp(-b.y));
    if opacity < 1./255. { return; }
    let delta = world-camera.view_inv[3].xyz;
    let direction = delta/max(length(delta), 1e-8);
    splats[idx].center_radius = vec4<f32>(ndc, radius, clip.z/clip.w);
    splats[idx].conic_opacity = vec4<f32>(yy, -xy, xx, opacity) / vec4<f32>(determinant, determinant, determinant, 1.);
    splats[idx].color = vec4<f32>(computeColorFromSH(direction, idx, u32(settings.sh_deg)), 1.);
    let slot = atomicAdd(&sort_infos.keys_size, 1u);
    // Positive view depth has monotonic IEEE bits; complement sorts far to near.
    sort_depths[slot] = ~bitcast<u32>(view.z);
    sort_indices[slot] = idx;
    if slot % (workgroupSize*sortKeyPerThread) == 0u {
        atomicAdd(&sort_dispatch.dispatch_x, 1u);
    }
}

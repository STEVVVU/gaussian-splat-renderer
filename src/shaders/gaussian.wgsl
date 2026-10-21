struct CameraUniforms {
    view: mat4x4<f32>, view_inv: mat4x4<f32>, proj: mat4x4<f32>, proj_inv: mat4x4<f32>,
    viewport: vec2<f32>, focal: vec2<f32>,
};
struct Splat { center_radius: vec4<f32>, conic_opacity: vec4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> splats: array<Splat>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) offset: vec2<f32>,
    @location(1) @interpolate(flat) conic_opacity: vec4<f32>,
    @location(2) @interpolate(flat) color: vec3<f32>,
};
@vertex fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let corners = array<vec2<f32>,6>(vec2<f32>(-1.,-1.),vec2<f32>(1.,-1.),vec2<f32>(-1.,1.),vec2<f32>(-1.,1.),vec2<f32>(1.,-1.),vec2<f32>(1.,1.));
    let s = splats[indices[instance]];
    let offset = corners[vertex]*s.center_radius.z;
    var out: VertexOutput;
    out.position = vec4<f32>(s.center_radius.xy + 2.*offset/camera.viewport, s.center_radius.w, 1.);
    out.offset = vec2<f32>(offset.x, -offset.y);
    out.conic_opacity = s.conic_opacity;
    out.color = s.color.rgb;
    return out;
}
@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let d = in.offset;
    let c = in.conic_opacity;
    let power = -0.5*(c.x*d.x*d.x + 2.*c.y*d.x*d.y + c.z*d.y*d.y);
    let alpha = min(0.99, c.w*exp(power));
    if power > 0. || alpha < 1./255. { discard; }
    return vec4<f32>(in.color*alpha, alpha);
}

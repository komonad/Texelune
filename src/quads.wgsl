struct View { size: vec2<f32>, scroll_delta: f32, pad: f32 }
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlas_sampler: sampler;
struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) textured: u32,
}
@vertex fn vs(@builtin(vertex_index) index: u32,
    @location(0) bounds: vec4<f32>, @location(1) uv: vec4<f32>, @location(2) color: vec4<f32>) -> Vertex {
    let corners = array<vec2<f32>, 6>(vec2(0.,0.), vec2(1.,0.), vec2(0.,1.), vec2(0.,1.), vec2(1.,0.), vec2(1.,1.));
    let corner = corners[index];
    let point = bounds.xy + corner * bounds.zw - vec2(0., view.scroll_delta);
    var out: Vertex;
    out.position = vec4(point / view.size * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
    out.uv = uv.xy + corner * uv.zw;
    out.color = color;
    out.textured = select(0u, 1u, uv.z > 0.);
    return out;
}
@fragment fn fs(in: Vertex) -> @location(0) vec4<f32> {
    let sampled = textureSample(atlas, atlas_sampler, in.uv);
    return select(in.color, sampled * in.color, in.textured != 0u);
}

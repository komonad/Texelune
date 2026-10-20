use crate::layout::Patch;
use bytemuck::{Pod, Zeroable};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use wasm_bindgen::prelude::*;
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Quad {
    bounds: [f32; 4],
    uv: [f32; 4],
    color: [f32; 4],
}
struct GpuTimer {
    queries: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    readback: wgpu::Buffer,
    busy: Arc<AtomicBool>,
    pending: bool,
}

#[wasm_bindgen]
pub struct Renderer {
    theme: crate::theme::Theme,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    bind: wgpu::BindGroup,
    uniform: wgpu::Buffer,
    instances: wgpu::Buffer,
    caret: wgpu::Buffer,
    texture: wgpu::Texture,
    count: u32,
    capacity: usize,
    lost: Arc<AtomicBool>,
    timer: Option<GpuTimer>,
    frames: u32,
    sample_requested: bool,
    caret_height: f32,
    offscreen: Option<wgpu::Texture>,
    adapter_name: String,
}

#[wasm_bindgen]
impl Renderer {
    pub async fn create(canvas: web_sys::HtmlCanvasElement) -> Result<Renderer, JsValue> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..Default::default()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(error)?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(error)?;
        let timestamp_features = adapter.features() & wgpu::Features::TIMESTAMP_QUERY;
        let adapter_name = adapter.get_info().name;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("texelune"),
                required_features: timestamp_features,
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::MemoryUsage,
                ..Default::default()
            })
            .await
            .map_err(error)?;
        let lost = Arc::new(AtomicBool::new(false));
        let lost_callback = lost.clone();
        device.set_device_lost_callback(move |_, message| {
            lost_callback.store(true, Ordering::Relaxed);
            web_sys::console::error_1(&JsValue::from_str(&message));
        });
        let config = surface
            .get_default_config(&adapter, 800, 600)
            .ok_or_else(|| JsValue::from_str("surface configuration unavailable"))?;
        surface.configure(&device, &config);
        let shader = device.create_shader_module(wgpu::include_wgsl!("quads.wgsl"));
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("text and rectangles"), layout: None,
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs"), compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout { array_stride: 48, step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4] }] },
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some("fs"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: config.format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })] }),
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(), multiview: None, cache: None,
        });
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("glyph atlas"),
            size: wgpu::Extent3d {
                width: 2048,
                height: 2048,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("viewport"),
            contents: bytemuck::cast_slice(&[800f32, 600., 0., 0.]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(
                        &texture.create_view(&Default::default()),
                    ),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let capacity = 4096;
        let instances = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (capacity * 48) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let caret = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 48,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let timer = if !timestamp_features.is_empty() {
            Some(GpuTimer {
                queries: device.create_query_set(&wgpu::QuerySetDescriptor {
                    label: Some("render timestamps"),
                    ty: wgpu::QueryType::Timestamp,
                    count: 2,
                }),
                resolve: device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: 16,
                    usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                    mapped_at_creation: false,
                }),
                readback: device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: 16,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                }),
                busy: Arc::new(AtomicBool::new(false)),
                pending: false,
            })
        } else {
            None
        };
        Ok(Self {
            theme: crate::theme::Theme::default(),
            surface,
            device,
            queue,
            config,
            pipeline,
            bind,
            uniform,
            instances,
            caret,
            texture,
            count: 0,
            capacity,
            lost,
            timer,
            frames: 0,
            sample_requested: false,
            caret_height: 25.,
            offscreen: None,
            adapter_name,
        })
    }
    pub fn invalidate(&mut self) {
        self.count = 0;
    }
    pub fn set_font_size(&mut self, size: f32) {
        self.caret_height = size.clamp(10., 40.) * 28. / 17. - 3.;
    }
    pub fn resource_bytes(&self) -> usize {
        2048 * 2048 * 4
            + self.capacity * 48
            + 48
            + 16
            + if self.timer.is_some() { 32 } else { 0 }
            + self.offscreen.as_ref().map_or(0, |texture| {
                texture.width() as usize * texture.height() as usize * 4
            })
    }
    pub fn timestamp_supported(&self) -> bool {
        self.timer.is_some()
    }
    pub fn request_sample(&mut self) {
        self.sample_requested = self.timer.is_some();
    }
    pub fn set_theme(&mut self, value: JsValue) -> Result<(), JsValue> {
        self.theme = serde_wasm_bindgen::from_value(value)?;
        Ok(())
    }
    pub fn adapter_name(&self) -> String {
        self.adapter_name.clone()
    }
    pub fn draw_offscreen(&mut self, width: f32, height: f32, delta: f32) -> Result<(), JsValue> {
        if self.lost.load(Ordering::Relaxed) {
            return Err(JsValue::from_str("WebGPU device lost"));
        }
        let texture = self.offscreen.get_or_insert_with(|| {
            self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("benchmark target"),
                size: wgpu::Extent3d {
                    width: self.config.width,
                    height: self.config.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.config.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
        });
        let view = texture.create_view(&Default::default());
        self.draw_view(width, height, delta, 0., 0., false, &view, false);
        Ok(())
    }
    pub fn end_benchmark(&mut self) {
        self.offscreen = None;
    }
    pub fn gpu_sample(&mut self) -> Option<js_sys::Promise> {
        let timer = self.timer.as_mut()?;
        if !timer.pending {
            return None;
        }
        timer.pending = false;
        let buffer = timer.readback.clone();
        let busy = timer.busy.clone();
        let period = self.queue.get_timestamp_period() as f64;
        let (sender, receiver) = futures_channel::oneshot::channel();
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = sender.send(result);
            });
        Some(wasm_bindgen_futures::future_to_promise(async move {
            let mapped = receiver.await.map_err(error).and_then(|r| r.map_err(error));
            if let Err(e) = mapped {
                busy.store(false, Ordering::Relaxed);
                return Err(e);
            }
            let view = buffer.slice(..).get_mapped_range();
            let first = u64::from_le_bytes(view[..8].try_into().unwrap());
            let last = u64::from_le_bytes(view[8..16].try_into().unwrap());
            let ms = last.saturating_sub(first) as f64 * period / 1_000_000.;
            drop(view);
            buffer.unmap();
            busy.store(false, Ordering::Relaxed);
            Ok(JsValue::from_f64(ms))
        }))
    }
    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.clamp(1, 8192);
        let height = height.clamp(1, 8192);
        if self.config.width != width || self.config.height != height {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
        }
    }
    pub fn upload(&mut self, values: &[f32]) -> Result<(), JsValue> {
        if !values.len().is_multiple_of(12) {
            return Err(JsValue::from_str("invalid instance buffer"));
        }
        let count = values.len() / 12;
        if count > self.capacity {
            self.capacity = count.next_power_of_two();
            self.instances = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: (self.capacity * 48) as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
        }
        if !values.is_empty() {
            self.queue
                .write_buffer(&self.instances, 0, bytemuck::cast_slice(values));
        }
        self.count = count as u32;
        Ok(())
    }
    pub fn patch(&mut self, value: JsValue) -> Result<(), JsValue> {
        let patches: Vec<Patch> = serde_wasm_bindgen::from_value(value)?;
        self.write_patches(patches);
        Ok(())
    }
    pub fn draw(
        &mut self,
        width: f32,
        height: f32,
        delta: f32,
        x: f32,
        y: f32,
        caret_visible: bool,
    ) -> Result<bool, JsValue> {
        self.draw_frame(width, height, delta, x, y, caret_visible)
    }
    pub fn submitted(&self) -> js_sys::Promise {
        let (sender, receiver) = futures_channel::oneshot::channel();
        self.queue.on_submitted_work_done(move || {
            let _ = sender.send(());
        });
        wasm_bindgen_futures::future_to_promise(async move {
            receiver.await.map_err(error)?;
            Ok(JsValue::UNDEFINED)
        })
    }
}
impl Renderer {
    fn write_patches(&self, patches: Vec<Patch>) {
        for patch in patches {
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: patch.x,
                        y: patch.y,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &patch.data,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(patch.w * 4),
                    rows_per_image: Some(patch.h),
                },
                wgpu::Extent3d {
                    width: patch.w,
                    height: patch.h,
                    depth_or_array_layers: 1,
                },
            );
        }
    }
    fn draw_frame(
        &mut self,
        width: f32,
        height: f32,
        delta: f32,
        x: f32,
        y: f32,
        caret_visible: bool,
    ) -> Result<bool, JsValue> {
        if self.lost.load(Ordering::Relaxed) {
            return Err(JsValue::from_str("WebGPU device lost"));
        }
        let output = match self.surface.get_current_texture() {
            Ok(output) => output,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(e) => return Err(error(e)),
        };
        let view = output.texture.create_view(&Default::default());
        self.draw_view(width, height, delta, x, y, caret_visible, &view, true);
        output.present();
        Ok(true)
    }
    #[allow(clippy::too_many_arguments)]
    fn draw_view(
        &mut self,
        width: f32,
        height: f32,
        delta: f32,
        x: f32,
        y: f32,
        caret_visible: bool,
        view: &wgpu::TextureView,
        timestamps: bool,
    ) {
        self.queue.write_buffer(
            &self.uniform,
            0,
            bytemuck::cast_slice(&[width, height, delta, 0.]),
        );
        let caret = Quad {
            bounds: [x, y + delta, 1.5, self.caret_height],
            uv: [0.; 4],
            color: self.theme.caret,
        };
        self.queue
            .write_buffer(&self.caret, 0, bytemuck::bytes_of(&caret));
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.frames = self.frames.wrapping_add(1);
        let sample = timestamps
            && (self.sample_requested || self.frames.is_multiple_of(12))
            && self
                .timer
                .as_ref()
                .is_some_and(|t| !t.busy.load(Ordering::Relaxed));
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: self.theme.background[0] as f64,
                            g: self.theme.background[1] as f64,
                            b: self.theme.background[2] as f64,
                            a: self.theme.background[3] as f64,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: if sample {
                    self.timer
                        .as_ref()
                        .map(|t| wgpu::RenderPassTimestampWrites {
                            query_set: &t.queries,
                            beginning_of_pass_write_index: Some(0),
                            end_of_pass_write_index: Some(1),
                        })
                } else {
                    None
                },
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            if self.count > 0 {
                pass.set_vertex_buffer(0, self.instances.slice(..));
                pass.draw(0..6, 0..self.count);
            }
            if caret_visible {
                pass.set_vertex_buffer(0, self.caret.slice(..));
                pass.draw(0..6, 0..1);
            }
        }
        if sample {
            self.sample_requested = false;
            let timer = self.timer.as_mut().unwrap();
            encoder.resolve_query_set(&timer.queries, 0..2, &timer.resolve, 0);
            encoder.copy_buffer_to_buffer(&timer.resolve, 0, &timer.readback, 0, 16);
            timer.busy.store(true, Ordering::Relaxed);
            timer.pending = true;
        }
        self.queue.submit(Some(encoder.finish()));
    }
}
fn error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

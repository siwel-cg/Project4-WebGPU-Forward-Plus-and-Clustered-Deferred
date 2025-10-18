import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution

    sceneUniformsBindGroupLayoutNODEPTH: GPUBindGroupLayout;
    sceneUniformsBindGroupNODEPTH: GPUBindGroup;

    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    linearDepthTexture: GPUTexture;
    linearDepthTextureView: GPUTextureView;

    depthPrePassPipeline: GPURenderPipeline;
    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here

        this.sceneUniformsBindGroupLayoutNODEPTH = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // CAMERA
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform"}
                }
            ]
        });

        // CREATE BIND GROUP "BLUE-PRINT": What is the type of the binding and what can acess that data (doesn't specify the actual data). binding number and visibility is important: MUST MATCH IN SHADER AND BING GROUP INITIALIZATION
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // CAMERA
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform"}
                },
                {   // LIGHTSET
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage"}
                },
                { // DEPTH TEXTURE
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "unfilterable-float" }
                }
            ]
        });

        // ALOCATE MEMORY FOR DEPTH: size of screen
        this.depthTexture = renderer.device.createTexture
        ({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.depthTextureView = this.depthTexture.createView();

        // CREATE NEW THING FOR DEPTH BUT LINEAR B)
        this.linearDepthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "r32float",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
        });
        this.linearDepthTextureView = this.linearDepthTexture.createView();

        // BINDS ACTUAL CPU DATA TO THESE GPU BUFFERS
        this.sceneUniformsBindGroupNODEPTH = renderer.device.createBindGroup
        ({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayoutNODEPTH,

            entries: [
                { // CAMERA
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer}
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup
        ({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,

            entries: [
                { // CAMERA
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer}
                },
                { // LIGHTS
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer}
                },
                { // DEPTH
                    binding: 2,
                    resource: this.linearDepthTextureView 
                }
            ]
        });

        this.depthPrePassPipeline = renderer.device.createRenderPipeline({
            layout: renderer.device.createPipelineLayout({
                label: "depth prepass pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayoutNODEPTH,
                    renderer.modelBindGroupLayout
                ]
            }),
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "depth prepass vert shader",
                    code: shaders.naiveVertSrc  // Reuse your existing vertex shader
                }),
                buffers: [renderer.vertexBufferLayout]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "depth prepass frag shader",
                    code: `
                        struct FragmentInput
                        {
                            @builtin(position) fragCoord: vec4f,
                            @location(3) nearPlane: f32,
                            @location(4) farPlane: f32
                        }

                        @fragment
                        fn main(in: FragmentInput) -> @location(0) f32
                        {
                            let n = in.nearPlane;
                            let f = in.farPlane;
                            
                            let d = in.fragCoord.z;
                            let z_ndc = d * 2.0 - 1.0; 
                            let linearDepth = (2.0 * n * f) / (f + n - z_ndc * (f - n));
                            
                            let linear = clamp(linearDepth / 30.0, 0.0, 1.0);
                            
                            return linear;
                        }
                    `
                }),
                targets: [{format: "r32float"}]
            }
        });

        this.pipeline = renderer.device.createRenderPipeline({
            // BINDS LAYOUTS TO THE PIPELINE?
            layout: renderer.device.createPipelineLayout({
                label: "forward+ pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            // depthStencil: { // 
            //     depthWriteEnabled: true,
            //     depthCompare: "less",
            //     format: "depth24plus"
            // },
            vertex: { // REUSE NAIVE VERTEX SHADER
                module: renderer.device.createShaderModule({
                    label: "forward+ vert shader",
                    code: shaders.naiveVertSrc
                }),
                buffers: [ renderer.vertexBufferLayout ]
            },
            fragment: { // USE FORWARD+ FRAG SHADER
                module: renderer.device.createShaderModule({
                    label: "forward+ frag shader",
                    code: shaders.forwardPlusFragSrc,
                }),
                targets: [
                    {
                        format: renderer.canvasFormat,
                    }
                ]
            }
        }); 
    }

    override draw() {
        // TODO-2: run the Forward+ rendering pass:
        // - run the clustering compute shader
        // - run the main rendering pass, using the computed clusters for efficient lighting


        // RENDER DEPTH PRE PASS FOR COMPUTE SHADER
        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();
        const depthPrePass = encoder.beginRenderPass({
            label: "depth pre-pass",
            colorAttachments: [{
                view: this.linearDepthTextureView,
                loadOp: "clear", storeOp: "store",
                clearValue: [0,0,0,0],
            }],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        
        depthPrePass.setPipeline(this.depthPrePassPipeline);
        depthPrePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroupNODEPTH);
        
        this.scene.iterate(node => {
            depthPrePass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            // No material binding needed for depth-only
        }, primitive => {
            depthPrePass.setVertexBuffer(0, primitive.vertexBuffer);
            depthPrePass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            depthPrePass.drawIndexed(primitive.numIndices);
        });
        depthPrePass.end();

        // TODO: RUN COMPUTE SHADER HERE OR SOMETHING TO GET THE CLUSTERS



        // FINAL OUTPUT WHICH WILL USE CLUSTERS FOR LIGHTING (NEEDS UPDATING)
        const renderPass = encoder.beginRenderPass({
            label: "naive render pass",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 0],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
            // ,
            // depthStencilAttachment: {
            //     view: this.depthTextureView,
            //     depthClearValue: 1.0,
            //     depthLoadOp: "load",
            //     depthStoreOp: "store"
            // }
        });
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        
        this.scene.iterate(node => {
            renderPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            renderPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            renderPass.setVertexBuffer(0, primitive.vertexBuffer);
            renderPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            renderPass.drawIndexed(primitive.numIndices);
        });

        renderPass.end();

        renderer.device.queue.submit([encoder.finish()]);
    }
}

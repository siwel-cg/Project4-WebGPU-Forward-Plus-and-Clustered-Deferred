import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ForwardPlusRenderer extends renderer.Renderer {
    // TODO-2: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;

    pipeline: GPURenderPipeline;

    constructor(stage: Stage) {
        super(stage);

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for Forward+ here

        // CREATE BIND GROUP "BLUE-PRINT": What is the type of the binding and what can acess that data (doesn't specify the actual data). binding number and visibility is important: MUST MATCH IN SHADER AND BING GROUP INITIALIZATION
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                { // CAMERA
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform"}
                },
                {   // LIGHTSET
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "read-only-storage"}
                },
                // { // DEPTH TEXTURE
                //     binding: 2,
                //     visibility: GPUShaderStage.FRAGMENT,
                //     texture: { sampleType: "unfilterable-float" }
                // }, 
                { // CLUSTER PARAMS
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform"}
                },
                { // CLUSTER LIGHT COUNTS
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "storage"}
                },
                { // CLUSTER LIGHT INDICES
                    binding: 5,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: { type: "storage"}
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

        // BINDS ACTUAL CPU DATA TO THESE GPU BUFFERS
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
                // { // DEPTH
                //     binding: 2,
                //     resource: this.linearDepthTextureView 
                // },
                //  // CLUSTER PARAMS
                {
                    binding: 3,
                    resource: { buffer: this.lights.clusterParamsBuffer}
                },
                { // CLUSTER LIGHT COUNT
                    binding: 4,
                    resource: { buffer: this.lights.clusterLightCountBuffer}
                },
                { // CLUSTER LIGHT IDX
                    binding: 5,
                    resource: { buffer: this.lights.clusterLightIdxBuffer}
                }
            ]
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
            depthStencil: { // 
                depthWriteEnabled: true,
                depthCompare: "less",
                format: "depth24plus"
            },
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



        const encoder = renderer.device.createCommandEncoder();
        const canvasTextureView = renderer.context.getCurrentTexture().createView();

        // RUN COMPUTE SHADER STUFF
        this.lights.populateClusterParamsBuffer();
        this.lights.clearClusterCounts();
        
        this.lights.doLightClustering(encoder);


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
            ,
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
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

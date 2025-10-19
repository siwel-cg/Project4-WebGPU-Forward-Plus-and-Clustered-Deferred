import { vec3 } from "wgpu-matrix";
import { device } from "../renderer";

import * as shaders from '../shaders/shaders';
import { Camera } from "./camera";
import { canvas, fovYDegrees } from "../renderer" // GET SCREEN ZISE 

// h in [0, 1]
function hueToRgb(h: number) {
    let f = (n: number, k = (n + h * 6) % 6) => 1 - Math.max(Math.min(k, 4 - k, 1), 0);
    return vec3.lerp(vec3.create(1, 1, 1), vec3.create(f(5), f(3), f(1)), 0.8);
}

export class Lights {
    private camera: Camera;

    numLights = 100; // STARTING WITH 100 
    static readonly maxNumLights = 5000;
    static readonly numFloatsPerLight = 8; // vec3f is aligned at 16 byte boundaries

    static readonly lightIntensity = 0.1;

    lightsArray = new Float32Array(Lights.maxNumLights * Lights.numFloatsPerLight);
    lightSetStorageBuffer: GPUBuffer;

    timeUniformBuffer: GPUBuffer;

    moveLightsComputeBindGroupLayout: GPUBindGroupLayout;
    moveLightsComputeBindGroup: GPUBindGroup;
    moveLightsComputePipeline: GPUComputePipeline;

    // TODO-2: add layouts, pipelines, textures, etc. needed for light clustering here

    // DEFAULT CLUSTER PARAMS:
    clusterWidth = 128;
    clusterHeight = 128;
    zSlice = 256;
    maxLightPerCluster = 500;

    tileX = 0;
    tileY = 0;
    numClusters = 0;

    clusterParamsBuffer: GPUBuffer;
    clusterLightCountBuffer: GPUBuffer;
    clusterLightIdxBuffer: GPUBuffer;

    clusterBindGroupLayout: GPUBindGroupLayout;
    clusterBindGroup: GPUBindGroup;
    clusterComputePipeline: GPUComputePipeline;

    constructor(camera: Camera) {
        this.camera = camera;

        this.lightSetStorageBuffer = device.createBuffer({
            label: "lights",
            size: 16 + this.lightsArray.byteLength, // 16 for numLights + padding
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        this.populateLightsBuffer();
        this.updateLightSetUniformNumLights();

        this.timeUniformBuffer = device.createBuffer({
            label: "time uniform",
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.moveLightsComputeBindGroupLayout = device.createBindGroupLayout({
            label: "move lights compute bind group layout",
            entries: [
                { // lightSet
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                { // time
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                }
            ]
        });

        this.moveLightsComputeBindGroup = device.createBindGroup({
            label: "move lights compute bind group",
            layout: this.moveLightsComputeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.lightSetStorageBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.timeUniformBuffer }
                }
            ]
        });

        this.moveLightsComputePipeline = device.createComputePipeline({
            label: "move lights compute pipeline",
            layout: device.createPipelineLayout({
                label: "move lights compute pipeline layout",
                bindGroupLayouts: [ this.moveLightsComputeBindGroupLayout ]
            }),
            compute: {
                module: device.createShaderModule({
                    label: "move lights compute shader",
                    code: shaders.moveLightsComputeSrc
                }),
                entryPoint: "main"
            }
        });

        // TODO-2: initialize layouts, pipelines, textures, etc. needed for light clustering here

        this.tileX = Math.ceil(canvas.width  / this.clusterWidth);
        this.tileY = Math.ceil(canvas.height / this.clusterHeight);
        this.numClusters = this.tileX * this.tileY * this.zSlice;

        this.clusterParamsBuffer = device.createBuffer({
            label: "cluster params",
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.clusterLightCountBuffer = device.createBuffer({
            label: "cluster light count",
            size: this.numClusters * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.clusterLightIdxBuffer = device.createBuffer({
            label: "cluster light idxs",
            size: this.numClusters * this.maxLightPerCluster * 4,
            usage: GPUBufferUsage.STORAGE
        });

        this.populateClusterParamsBuffer();
        
        this.clusterBindGroupLayout = device.createBindGroupLayout({
            label: "bind cluster group layout",
            entries: [
                { // CLUSTER PARAMS
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform"}
                },
                { // LIGHTS
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage"}
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage"}
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage"}
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform"}
                }
            ]
        });

        this.clusterBindGroup = device.createBindGroup({
            label: "bind cluster bind group",
            layout: this.clusterBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.clusterParamsBuffer}
                },
                {
                    binding: 1,
                    resource: { buffer: this.lightSetStorageBuffer}
                },
                {
                    binding: 2,
                    resource: { buffer: this.clusterLightCountBuffer}
                },
                {
                    binding: 3,
                    resource: { buffer: this.clusterLightIdxBuffer}
                },
                {
                    binding: 4,
                    resource: { buffer: this.camera.uniformsBuffer}
                }
            ]
        });

        this.clusterComputePipeline = device.createComputePipeline({
           label: "cluster compute pipeline",
           layout: device.createPipelineLayout({
                label: "cluster compute pipeline layout",
                bindGroupLayouts: [ this.clusterBindGroupLayout]
           }),
           compute: {
                module: device.createShaderModule({
                    label: "cluster compute shader",
                    code: shaders.clusteringComputeSrc
                }),
                entryPoint: "main"
           }
        });
    }

    populateClusterParamsBuffer() {
        const u = new Uint32Array(12);          // 12 * 4 = 48 bytes
        const f = new Float32Array(u.buffer);
        const fovYRad = fovYDegrees * (Math.PI / 180);

        u[0] = canvas.width;
        u[1] = canvas.height;
        u[2] = this.clusterWidth;
        u[3] = this.clusterHeight;

        f[4] = Camera.nearPlane;                // byte 16
        f[5] = Camera.farPlane;                 // byte 20
        f[6] = fovYRad;                         // byte 24
        u[7] = this.zSlice;                     // byte 28
        u[8] = this.maxLightPerCluster;         // byte 32
        // bytes 36..47 padding (u[9..11] unused)

        device.queue.writeBuffer(this.clusterParamsBuffer, 0, u);
    }

    clearClusterCounts() {
        device.queue.writeBuffer(
            this.clusterLightCountBuffer, 0, new Uint8Array(this.numClusters * 4) 
        );
    }

    private populateLightsBuffer() {
        for (let lightIdx = 0; lightIdx < Lights.maxNumLights; ++lightIdx) {
            // light pos is set by compute shader so no need to set it here
            const lightColor = vec3.scale(hueToRgb(Math.random()), Lights.lightIntensity);
            this.lightsArray.set(lightColor, (lightIdx * Lights.numFloatsPerLight) + 4);
        }

        device.queue.writeBuffer(this.lightSetStorageBuffer, 16, this.lightsArray);
    }

    updateLightSetUniformNumLights() {
        device.queue.writeBuffer(this.lightSetStorageBuffer, 0, new Uint32Array([this.numLights]));
    }

    doLightClustering(encoder: GPUCommandEncoder) {
        // TODO-2: run the light clustering compute pass(es) here
        // implementing clustering here allows for reusing the code in both Forward+ and Clustered Deferred
        const tileX = Math.ceil(canvas.width / this.clusterWidth);
        const tileY = Math.ceil(canvas.height / this.clusterHeight);

        const pass = encoder.beginComputePass({ label: "cluster stub" });
        pass.setPipeline(this.clusterComputePipeline);
        pass.setBindGroup(0, this.clusterBindGroup);

        const wgx = 4, wgy = 4, wgz = 4;
        const gx = Math.ceil(tileX / wgx);
        const gy = Math.ceil(tileY / wgy);
        const gz = Math.ceil(this.zSlice / wgz);

        pass.dispatchWorkgroups(gx, gy, gz);
        pass.end();
    }

    // CHECKITOUT: this is where the light movement compute shader is dispatched from the host
    onFrame(time: number) {
        device.queue.writeBuffer(this.timeUniformBuffer, 0, new Float32Array([time]));

        // not using same encoder as render pass so this doesn't interfere with measuring actual rendering performance
        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.moveLightsComputePipeline);

        computePass.setBindGroup(0, this.moveLightsComputeBindGroup);

        const workgroupCount = Math.ceil(this.numLights / shaders.constants.moveLightsWorkgroupSize);
        computePass.dispatchWorkgroups(workgroupCount);

        computePass.end();

        device.queue.submit([encoder.finish()]);
    }
}

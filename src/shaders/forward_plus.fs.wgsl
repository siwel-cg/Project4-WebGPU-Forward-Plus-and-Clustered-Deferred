// TODO-2: implement the Forward+ fragment shader

// See naive.fs.wgsl for basic fragment shader setup; this shader should use light clusters instead of looping over all lights

// ------------------------------------
// Shading process:
// ------------------------------------
// Determine which cluster contains the current fragment.
// Retrieve the number of lights that affect the current fragment from the cluster’s data.
// Initialize a variable to accumulate the total light contribution for the fragment.
// For each light in the cluster:
//     Access the light's properties using its index.
//     Calculate the contribution of the light based on its position, the fragment’s position, and the surface normal.
//     Add the calculated contribution to the total light accumulation.
// Multiply the fragment’s diffuse color by the accumulated light contribution.
// Return the final color, ensuring that the alpha component is set appropriately (typically to 1).
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(3) var<uniform> params: ClusterParams;
@group(0) @binding(4) var<storage, read_write> clusterCounts: array<u32>;
@group(0) @binding(5) var<storage, read_write> clusterIdx: array<u32>;

@group(2) @binding(0) var diffuseTex: texture_2d<f32>;
@group(2) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @builtin(position) fragCoord: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
    @location(3) nearPlane: f32,
    @location(4) farPlane: f32
}

fn hash3(u: u32) -> vec3f {
  let x = f32(((u * 1664525u) ^ 1013904223u) & 1023u) / 1023.0;
  let y = f32(((u * 22695477u) ^ 1u)        & 1023u) / 1023.0;
  let z = f32(((u * 1103515245u) ^ 12345u)  & 1023u) / 1023.0;
  return vec3f(x, y, z);
}

fn tilesXY() -> vec2<u32> {
    let tx = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let ty = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;
    return vec2<u32>(tx, ty);
}

fn clusterId(ix:u32, iy:u32, iz:u32) -> u32 {
    let t = tilesXY();
    return (iz * t.y + iy) * t.x + ix;
}

fn sliceZ_fromDepth_log(d: f32, n: f32, f: f32, zSlices: u32) -> u32 {
    let t = log(clamp(d, n, f) / n) / log(f / n);
    return u32(floor(clamp(t, 0.0, 0.999999) * f32(zSlices)));
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let n = in.nearPlane;
    let f = in.farPlane;
    
    // RENDER CLUSTERS WITH HASH COLORS
    // let tileX = u32(in.fragCoord.x) / params.tileSize.x;
    // let tileY = u32(in.fragCoord.y) / params.tileSize.y;

    //let dwow = in.fragCoord.z;
    // let z_ndc = dwow * 2.0 - 1.0; 
    // let linearDepth = (2.0 * n * f) / (f + n - z_ndc * (f - n));
    // let linear = clamp(linearDepth / 100.0, 0.0, 1.0);

    // let z = clamp(linear, n, f);
    // let dist = log(z / n) / log(f / n);
    // let slice = u32(floor(dist * f32(params.zSlices))); 
    // let magic = clamp(slice, 0, params.zSlices - 1u);

    // return vec4(hash3(tileX + tileY + magic), 1.0);

    // Alpha test
    let albedo = textureSample(diffuseTex, diffuseTexSampler, in.uv);
    if (albedo.a < 0.5) {
        discard;
    }

    let tilesX = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let tilesY = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;
    let indexX = min(u32(in.fragCoord.x) / params.tileSize.x, tilesX - 1u);
    let indexY = min(u32(in.fragCoord.y) / params.tileSize.y, tilesY - 1u);

    // THIS IS KIND OF JANK, BUT IT"S THE ONLY THING THAT SEEMED TO GIVE ANY SEMI-ACCURATE [0,1] DEPTH RANGE VALUES. 
    let dwow = in.fragCoord.z;
    let z_ndc = dwow * 2.0 - 1.0; 
    let linearDepth = (2.0 * n * f) / (f + n - z_ndc * (f - n));
    let depth = clamp(linearDepth / 100.0, 0.0, 1.0); // CHANGE 100.0 based on scene depth

    let logZIndex = sliceZ_fromDepth_log(depth, n, f, params.zSlices);

    let clusterIndex = clusterId(indexX, indexY, logZIndex);

    let base  = clusterIndex * params.maxLightsPerCluster;
    let count = clusterCounts[clusterIndex];

    let N = normalize(in.nor);
    var total = vec3f(0.0, 0.0, 0.0);

    for (var k:u32 = 0u; k < count; k = k + 1u) {
        let li = clusterIdx[base + k];
        if (li < lightSet.numLights) {
            let L = lightSet.lights[li];
            total += calculateLightContrib(L, in.pos, normalize(in.nor));
        }
    }

    return vec4f(albedo.rgb * total, 1.0);
}

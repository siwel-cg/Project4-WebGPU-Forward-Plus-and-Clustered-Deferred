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

@group(${bindGroup_scene}) @binding(1) var<storage, read> lightSet: LightSet;
@group(${bindGroup_scene}) @binding(2) var depthTex: texture_depth_2d; 

@group(${bindGroup_material}) @binding(0) var diffuseTex: texture_2d<f32>;
@group(${bindGroup_material}) @binding(1) var diffuseTexSampler: sampler;

struct FragmentInput
{
    @builtin(position) fragCoord: vec4f,
    @location(0) pos: vec3f,
    @location(1) nor: vec3f,
    @location(2) uv: vec2f,
    @location(3) nearPlane: f32,
    @location(4) farPlane: f32
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4f
{
    let n = 0.1;
    let f = 1000.0;
    
    // Method 2: Proper linearization without remapping
    let d = textureLoad(depthTex, vec2i(in.fragCoord.xy), 0);
    let z_ndc = d * 2.0 - 1.0; 
    let linearDepth = (2.0 * n * f) / (f + n - z_ndc * (f - n));
    
    // Scale to visible range
    let normalized = clamp(linearDepth / 50.0, 0.0, 1.0);
    

    
    return vec4(normalized, normalized, normalized, 1.0);
    // let depth = textureLoad(depthTex, vec2i(in.fragCoord.xy), 0);
    // return vec4(depth, depth, depth, 1.0);
}

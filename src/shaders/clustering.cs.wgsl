// TODO-2: implement the light clustering compute shader

// ------------------------------------
// Calculating cluster bounds:
// ------------------------------------
// For each cluster (X, Y, Z):
//     - Calculate the screen-space bounds for this cluster in 2D (XY).
//     - Calculate the depth bounds for this cluster in Z (near and far planes).
//     - Convert these screen and depth bounds into view-space coordinates.
//     - Store the computed bounding box (AABB) for the cluster.

// ------------------------------------
// Assigning lights to clusters:
// ------------------------------------
// For each cluster:
//     - Initialize a counter for the number of lights in this cluster.

//     For each light:
//         - Check if the light intersects with the cluster’s bounding box (AABB).
//         - If it does, add the light to the cluster's light list.
//         - Stop adding lights if the maximum number of lights is reached.

//     - Store the number of lights assigned to this cluster.

@group(0) @binding(0) var<uniform> params: ClusterParams;
@group(0) @binding(1) var<storage, read> lightSet: LightSet;
@group(0) @binding(2) var<storage, read_write> clusterCounts  : array<u32>;
@group(0) @binding(3) var<storage, read_write> clusterIndices : array<u32>;
@group(0) @binding(4) var<uniform> uCamera : CameraUniforms;

fn clusterAABB_view_log(idxX:u32, idxY:u32, d0:f32, d1:f32) -> vec4<f32> {
    let tilesX = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let tilesY = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;

    let xMin = 2.0 * (f32(idxX) / f32(tilesX)) - 1.0;
    let xMax = 2.0 * (f32(idxX + 1u) / f32(tilesX)) - 1.0;
    let yMin = 2.0 * (f32(idxY) / f32(tilesY)) - 1.0;
    let yMax = 2.0 * (f32(idxY + 1u) / f32(tilesY)) - 1.0;

    let tanY = tan(0.5 * params.fovYRadians);
    let aspect = f32(params.screenSize.x) / f32(params.screenSize.y);
    let Sx = aspect * tanY;
    let Sy = tanY;

    let viewX = array<f32,4>( d0*xMin*Sx, d0*xMax*Sx, d1*xMin*Sx, d1*xMax*Sx );
    let viewY = array<f32,4>( d0*yMin*Sy, d0*yMax*Sy, d1*yMin*Sy, d1*yMax*Sy );

    var xmin = viewX[0];
    var xmax = viewX[0];
    var ymin = viewY[0];
    var ymax = viewY[0];

    for (var i = 1u; i < 4u; i++) {
        xmin = min(xmin, viewX[i]);
        xmax = max(xmax, viewX[i]);
        ymin = min(ymin, viewY[i]);
        ymax = max(ymax, viewY[i]);
    }
    return vec4<f32>(xmin, xmax, ymin, ymax);
}

fn sphereAABB_intersect(pos:vec3<f32>, rad:f32, aabbXY:vec4<f32>, zmin:f32, zmax:f32) -> bool {
    let qx = clamp(pos.x, aabbXY.x, aabbXY.y);
    let qy = clamp(pos.y, aabbXY.z, aabbXY.w);
    let qz = clamp(pos.z, zmin, zmax);
    let dx = qx - pos.x;
    let dy = qy - pos.y;
    let dz = qz - pos.z;
    return (dx*dx + dy*dy + dz*dz) <= (rad*rad);
}

@compute
@workgroup_size(4, 4, 4) 
fn main(@builtin(global_invocation_id) globalIdx : vec3u) {
    let n  = params.near;
    let f  = params.far;

    // cluster dims
    let tileX = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let tileY = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;

    if (globalIdx.x >= tileX || globalIdx.y >= tileY || globalIdx.z >= params.zSlices) {
        return;
    }

    let idxX = globalIdx.x;
    let idxY = globalIdx.y;
    let idxZ = globalIdx.z;

    let r  = f / n;
    let zN = f32(params.zSlices);
    let t0 = f32(idxZ) / zN;
    let t1 = f32(idxZ + 1u) / zN;
    let depthMax = n * pow(r, t0);
    let depthMin = n * pow(r, t1);

    let zMin = -depthMin;
    let zMax = -depthMax;

    let aabbXY = clusterAABB_view_log(idxX, idxY, depthMax, depthMin);

    let outIdx = (idxZ * tileY + idxY) * tileX + idxX;

    let base  = outIdx * params.maxLightsPerCluster;
    var count : u32 = 0u;
    let lightRad = 20.0;
    for (var i = 0u; i < lightSet.numLights; i = i + 1u) {
        let P = vec4f(lightSet.lights[i].pos, 1.0);
        let Pvs = (uCamera.viewMat * P).xyz;
        if (sphereAABB_intersect(Pvs, lightRad, aabbXY, zMin, zMax)) {
            if (count < params.maxLightsPerCluster) {
                clusterIndices[base + count] = i;
                count = count + 1u;
            }
        }
    }
    clusterCounts[outIdx] = count;
}
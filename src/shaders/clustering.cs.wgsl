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

fn clusterAABB_view_log(ix:u32, iy:u32, d0:f32, d1:f32) -> vec4<f32> {
    let tilesX = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let tilesY = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;
    let x0 = 2.0 * f32(ix) / f32(tilesX) - 1.0;
    let x1 = 2.0 * f32(ix + 1u) / f32(tilesX) - 1.0;
    let y0 = 2.0 * f32(iy) / f32(tilesY) - 1.0;
    let y1 = 2.0 * f32(iy + 1u) / f32(tilesY) - 1.0;

    // projection scales
    let tanY   = tan(0.5 * params.fovYRadians);
    let aspect = f32(params.screenSize.x) / f32(params.screenSize.y);
    let Sx = aspect * tanY;
    let Sy = tanY;

    // candidates at (d0,d1) × (x0/x1 or y0/y1)
    let X = array<f32,4>( d0*x0*Sx, d0*x1*Sx, d1*x0*Sx, d1*x1*Sx );
    let Y = array<f32,4>( d0*y0*Sy, d0*y1*Sy, d1*y0*Sy, d1*y1*Sy );

    var xmin = X[0]; var xmax = X[0];
    var ymin = Y[0]; var ymax = Y[0];
    for (var i=1u; i<4u; i++) {
        xmin = min(xmin, X[i]); xmax = max(xmax, X[i]);
        ymin = min(ymin, Y[i]); ymax = max(ymax, Y[i]);
    }
    return vec4<f32>(xmin, xmax, ymin, ymax);
}

fn sphereAABB_intersect(C:vec3<f32>, R:f32, aabbXY:vec4<f32>, zmin:f32, zmax:f32) -> bool {
    let qx = clamp(C.x, aabbXY.x, aabbXY.y);
    let qy = clamp(C.y, aabbXY.z, aabbXY.w);
    let qz = clamp(C.z, zmin, zmax);
    let dx = qx - C.x; let dy = qy - C.y; let dz = qz - C.z;
    return (dx*dx + dy*dy + dz*dz) <= (R*R);
}

@compute
@workgroup_size(4, 4, 4) 
fn main(@builtin(global_invocation_id) gid : vec3u) {

    // cluster dims
    let tileX = (params.screenSize.x + params.tileSize.x - 1u) / params.tileSize.x;
    let tileY = (params.screenSize.y + params.tileSize.y - 1u) / params.tileSize.y;

    // bounds check for 3D grid
    if (gid.x >= tileX || gid.y >= tileY || gid.z >= params.zSlices) { return; }

    // decode (ix,iy,iz) is now just gid.xyz
    let idxX = gid.x;
    let idxY = gid.y;
    let idxZ = gid.z;

    // --- log slice depths [d0,d1] (positive depths) ---
    let n  = params.near;
    let f  = params.far;
    let r  = f / n;
    let zN = f32(params.zSlices);
    let t0 = f32(idxZ) / zN;
    let t1 = f32(idxZ + 1u) / zN;
    let d0 = n * pow(r, t0);   // near side of this slice
    let d1 = n * pow(r, t1);   // far  side of this slice

    // view-space z interval (camera looks down -Z)
    let zmin = -d1;
    let zmax = -d0;

    // XY AABB over [d0,d1]
    let aabbXY = clusterAABB_view_log(idxX, idxY, d0, d1);

    // flat index for outputs (unchanged buffers/layout)
    let flat = (idxZ * tileY + idxY) * tileX + idxX;

    let base  = flat * params.maxLightsPerCluster;
    var count : u32 = 0u;

    let lightRad = 20.0;
    for (var i = 0u; i < lightSet.numLights; i = i + 1u) {
        let P = vec4f(lightSet.lights[i].pos, 1.0);
        let Pvs = (uCamera.viewMat * P).xyz;
        if (sphereAABB_intersect(Pvs, lightRad, aabbXY, zmin, zmax)) {
            if (count < params.maxLightsPerCluster) {
                clusterIndices[base + count] = i;
                count = count + 1u;
            }
        }
    }
    clusterCounts[flat] = count;
}
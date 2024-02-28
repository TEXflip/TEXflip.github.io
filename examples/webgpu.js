let camera = document.getElementById("camera")
camera.addEventListener("load", main());

NUM_POINTS = 1000;

function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277,
        h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4), h2 ^= h1, h3 ^= h1, h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function splitmix32(a) {
    return function () {
        a |= 0; a = a + 0x9e3779b9 | 0;
        var t = a ^ a >>> 16; t = Math.imul(t, 0x21f0aaad);
        t = t ^ t >>> 15; t = Math.imul(t, 0x735a2d97);
        return ((t = t ^ t >>> 15) >>> 0) / 4294967296;
    }
}

function main() {
    navigator.mediaDevices.getUserMedia({ video: 1, audio: 0 }).then(
        (stream) => {
            try {
                if ('srcObject' in camera)
                    camera.srcObject = stream;
                else
                    camera.src = window.URL.createObjectURL(stream);
            } catch (err) {
                camera.src = stream;
            }
            let stream_settings = stream.getVideoTracks()[0].getSettings();
            // console.log(stream_settings);
            load_canvas(camera, stream_settings);
        }).catch(
            (err) => {
                console.log(err);
                camera.addEventListener("loadedmetadata", function () {
                    load_canvas(this, { height: this.videoHeight, width: this.videoWidth });
                }, false);
            }
        );
}

async function setup_webgpu() {
    const canvas = document.querySelector("canvas");
    if (!navigator.gpu) {
        throw new Error("WebGPU not supported on this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error("No appropriate GPUAdapter found.");
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    context.configure({
        device: device,
        format: navigator.gpu.getPreferredCanvasFormat(),
    });
    return { device, canvas, context };
}

async function load_canvas(camera, size) {
    camera.play();
    let height = size.height;
    let width = size.width;
    console.log(height, width);
    const { device, canvas, context } = await setup_webgpu();
    context.configure({
        device: device,
        format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    });
    canvas.width = width;
    canvas.height = height;

    // prepare the points

    var seed = cyrb128("42");
    var rand = splitmix32(seed[0]);
    let points = new Float32Array(2 * NUM_POINTS).fill(0);
    for (let i = 0; i < NUM_POINTS; i++) {
        let x = parseInt(rand() * width);
        let y = parseInt(rand() * height);
        points[2 * i] = x;
        points[2 * i + 1] = y;
    }

    let weights = new Uint32Array(NUM_POINTS).fill(0);
    let counts = new Uint32Array(NUM_POINTS).fill(0);
    let avg_weights = new Float32Array(NUM_POINTS).fill(0);
    let centroids_x = new Uint32Array(NUM_POINTS).fill(0);
    let centroids_y = new Uint32Array(NUM_POINTS).fill(0);
    let locks = new Uint32Array(NUM_POINTS).fill(0);

    // create some buffers on the GPU to hold our computation

    const points_buffer = device.createBuffer({
        label: 'points_buffer',
        size: points.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const centroids_x_buffer = device.createBuffer({
        label: 'centroids_x_buffer',
        size: centroids_x.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const centroids_y_buffer = device.createBuffer({
        label: 'centroids_y_buffer',
        size: centroids_y.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const weight_buffer = device.createBuffer({
        label: 'weight_buffer',
        size: weights.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const count_buffer = device.createBuffer({
        label: 'count_buffer',
        size: counts.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const avg_weight_buffer = device.createBuffer({
        label: 'avg_weight_buffer',
        size: avg_weights.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    // RESULT BUFFERS
    const result_weight_buffer = device.createBuffer({
        label: 'result_weight_buffer',
        size: weights.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const result_count_buffer = device.createBuffer({
        label: 'result_count_buffer',
        size: counts.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const result_centroid_x_buffer = device.createBuffer({
        label: 'result_centroid_x_buffer',
        size: centroids_x.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const result_centroid_y_buffer = device.createBuffer({
        label: 'result_centroid_y_buffer',
        size: centroids_y.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(points_buffer, 0, points);
    device.queue.writeBuffer(centroids_x_buffer, 0, centroids_x);
    device.queue.writeBuffer(centroids_y_buffer, 0, centroids_y);
    device.queue.writeBuffer(weight_buffer, 0, weights);
    device.queue.writeBuffer(count_buffer, 0, counts);
    device.queue.writeBuffer(avg_weight_buffer, 0, avg_weights);

    const module = device.createShaderModule({
        label: 'voronoi',
        code: /* wgsl */`

        const NUM_POINTS = 1000u;
        const WIDTH = 640u;
        const HEIGHT = 480u;
        const FLOAT_MULT_PREC = 1000.0;
        
        struct Locks {
            locks: array<atomic<u32>, 1000>,
        };

        @group(0) @binding(7) var<storage, read_write> locks: Locks;

        fn lock(location: u32) -> bool {
            let lock_ptr = &locks.locks[location];
            let original_lock_value = atomicLoad(lock_ptr);
            if (original_lock_value > 0u) {
                return false;
            }
            return atomicAdd(lock_ptr, 1u) == original_lock_value;
        }
        
        fn unlock(location: u32) {
            atomicStore(&locks.locks[location], 0u);
        }

        @group(0) @binding(0) var in_texture: texture_external; // sRGB color space normalized
        @group(0) @binding(1) var<storage, read_write> im_out: array<u32>;
        
        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;
        @group(0) @binding(3) var<storage, read_write> centroids_x: array<atomic<u32>>;
        @group(0) @binding(4) var<storage, read_write> centroids_y: array<atomic<u32>>;
        @group(0) @binding(5) var<storage, read_write> weights: array<atomic<u32>>;
        @group(0) @binding(6) var<storage, read_write> counts: array<atomic<u32>>;
        // @group(0) @binding(1) var<storage, read> datain: array<f32>;
        
        fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
            let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0f)), c.y);
        }
        
        fn vec3_to_u32(v: vec3<f32>) -> u32 {
            let r = u32(255 * v.x);
            let g = u32(255 * v.y);
            let b = u32(255 * v.z);
            return 0xff000000 | (b << 16) | (g << 8) | r;
        }
        
        @compute @workgroup_size(1,1,1) fn centorid_computation(@builtin(global_invocation_id) id: vec3u) {
            let pixel = textureLoad(in_texture, id.xy);
            let i = u32(id.y * WIDTH + id.x);
            var min_dist = 1000000.0;
            var min_index = 0u;

            if (i < 1000) {
                atomicStore(&centroids_x[i], 0u);
                atomicStore(&centroids_y[i], 0u);
                atomicStore(&weights[i], 0u);
                atomicStore(&counts[i], 0u);
            }

            for (var j = 0u; j < NUM_POINTS; j++) {
                let dist = distance(points[j], vec2<f32>(f32(id.x), f32(id.y)));
                if (dist < min_dist) {
                    min_dist = dist;
                    min_index = j;
                }
            }

            let weight_f = 1 - (pixel.x + pixel.y + pixel.z) / 3.0;
            let weight = u32(255 - 85 * (pixel.x + pixel.y + pixel.z));

            atomicAdd(&centroids_x[min_index], u32(round(f32(id.x) * weight_f * FLOAT_MULT_PREC)));
            atomicAdd(&centroids_y[min_index], u32(round(f32(id.y) * weight_f * FLOAT_MULT_PREC)));
            atomicAdd(&weights[min_index], weight);
            atomicAdd(&counts[min_index], 1u);

            // if (i < 1000) {
                // if (weights[i] > 0) {
                //     centroids[i] = centroids[i] / weights[i];
                //     avg_weights[i] = weights[i] / max(f32(counts[i]), 1);
                // } else {
                //     centroids[i] = vec2<f32>(points[i]);
                // }
                // centroids[i].x = points[i].x;
                // centroids[i].y = points[i].y;
                // points[i] = vec2<f32>(centroids[i].x, centroids[i].y);
            // }

            // let sw = avg_weights[i] * 120.0;
            let i_col = hsv2rgb(vec3<f32>(f32(min_index) / (1000), 1.0, 1.0));
            im_out[i] = vec3_to_u32(i_col);
        }
        `,
    });

    const module2 = device.createShaderModule({
        label: 'voronoi 2',
        code: /* wgsl */`
        @group(0) @binding(0) var<storage, read_write> im_out: array<u32>;
        @group(0) @binding(1) var<storage, read_write> centroids_x: array<atomic<u32>>;
        @group(0) @binding(2) var<storage, read_write> centroids_y: array<atomic<u32>>;
        @group(0) @binding(4) var<storage, read_write> weights: array<u32>;
        @group(0) @binding(5) var<storage, read_write> counts: array<u32>;
        @compute @workgroup_size(1,1,1) fn centorid_computation2(@builtin(global_invocation_id) id: vec3u) {
            let i = u32(id.y * 640 + id.x);
            let c = counts[i];
            im_out[i] = weights[id.x];
        }
        `,
    });

    const pipeline = device.createComputePipeline({
        label: 'doubling compute pipeline',
        layout: 'auto',
        compute: {
            module: module,
            entryPoint: 'centorid_computation',
        },
    });

    const pipeline2 = device.createComputePipeline({
        label: 'centroid 2',
        layout: 'auto',
        compute: {
            module: module2,
            entryPoint: 'centorid_computation2',
        },
    });


    // create a buffer on the GPU to hold our computation
    // input and output
    const write_buffer = device.createBuffer({
        label: 'write buffer',
        size: 4 * width * height,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    async function render_pass() {
        frame_texture = device.importExternalTexture({
            source: camera
        });

        const bind_group = device.createBindGroup({
            label: 'bindGroup 0',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: frame_texture },
                { binding: 1, resource: { buffer: write_buffer } },
                { binding: 2, resource: { buffer: points_buffer } },
                { binding: 3, resource: { buffer: centroids_x_buffer } },
                { binding: 4, resource: { buffer: centroids_y_buffer } },
                { binding: 5, resource: { buffer: weight_buffer } },
                { binding: 6, resource: { buffer: count_buffer } },
                // { binding: 7, resource: { buffer: locks_buffer } },
            ],
        });

        // const bind_group2 = device.createBindGroup({
        //     label: 'bindGroup 1',
        //     layout: pipeline2.getBindGroupLayout(0),
        //     entries: [
        //         { binding: 0, resource: { buffer: write_buffer } },
        //         { binding: 4, resource: { buffer: weight_buffer } },
        //         { binding: 5, resource: { buffer: count_buffer } },
        //     ],
        // });
        // device.queue.writeBuffer(centroids_buffer, 0, centroids);   


        const encoder = device.createCommandEncoder();
        // encoder.clearBuffer(centroids_buffer);
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind_group);
        pass.dispatchWorkgroups(width, height);
        pass.end();

        // const pass2 = encoder.beginComputePass();
        // pass2.setPipeline(pipeline2);
        // pass2.setBindGroup(0, bind_group2);
        // pass2.dispatchWorkgroups(width, height);
        // pass2.end();

        encoder.copyBufferToTexture(
            { buffer: write_buffer, bytesPerRow: 4 * width, rowsPerImage: height },
            { texture: context.getCurrentTexture() },
            { width, height, depthOrArrayLayers: 1 }
        )

        encoder.copyBufferToBuffer(weight_buffer, 0, result_weight_buffer, 0, weights.byteLength);
        encoder.copyBufferToBuffer(count_buffer, 0, result_count_buffer, 0, counts.byteLength);
        encoder.copyBufferToBuffer(centroids_x_buffer, 0, result_centroid_x_buffer, 0, centroids_x.byteLength);
        encoder.copyBufferToBuffer(centroids_y_buffer, 0, result_centroid_y_buffer, 0, centroids_y.byteLength);

        device.queue.submit([encoder.finish()]);

        await result_weight_buffer.mapAsync(GPUMapMode.READ);
        await result_count_buffer.mapAsync(GPUMapMode.READ);
        await result_centroid_x_buffer.mapAsync(GPUMapMode.READ);
        await result_centroid_y_buffer.mapAsync(GPUMapMode.READ);

        const result_weights = new Uint32Array(result_weight_buffer.getMappedRange());
        const result_counts = new Uint32Array(result_count_buffer.getMappedRange());
        const result_centroids_x = new Uint32Array(result_centroid_x_buffer.getMappedRange());
        const result_centroids_y = new Uint32Array(result_centroid_y_buffer.getMappedRange());

        let max_weight = 0;
        for (let i = 0; i < NUM_POINTS; i++) {
            let c_x = result_centroids_x[i] / 1000;
            let c_y = result_centroids_y[i] / 1000;
            if (result_weights[i] > 0) {
                let weight = result_weights[i] / 255;
                c_x /= weight;
                c_y /= weight;
                avg_weights[i] = weight / (result_counts[i] || 1);
                if (avg_weights[i] > max_weight) {
                    max_weight = avg_weights[i];
                }
            }
            points[2 * i] = c_x;
            points[2 * i + 1] = c_y;
        }

        device.queue.writeBuffer(points_buffer, 0, points);

        // console.log(points);

        result_weight_buffer.unmap();
        result_count_buffer.unmap();
        result_centroid_x_buffer.unmap();
        result_centroid_y_buffer.unmap();

        camera.requestVideoFrameCallback(render_pass);
    }

    camera.requestVideoFrameCallback(render_pass);

    document.addEventListener("keydown", function (event) {
        if (event.code === "Space") {
            render_pass();
        }
    });


}
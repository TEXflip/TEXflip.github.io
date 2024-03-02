let camera = document.getElementById("camera")
camera.addEventListener("load", main());

NUM_POINTS = 3000;

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
    // context.configure({
    //     device: device,
    //     format: "rgba8unorm",
    //     usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST,
    // });
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
    let centroids = new Uint32Array(2 * NUM_POINTS).fill(0);

    // create some buffers on the GPU to hold our computation

    const points_buffer = device.createBuffer({
        label: 'points_buffer',
        size: points.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const centroids_buffer = device.createBuffer({
        label: 'centroids_buffer',
        size: centroids.byteLength,
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
    const weightmax_buffer = device.createBuffer({
        label: 'weightmax_buffer',
        size: 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const res_weightmax_buffer = device.createBuffer({
        label: 'weightmax_buffer',
        size: 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const consts_buffer = device.createBuffer({
        size: 3 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const constants = new Uint32Array(3);

    device.queue.writeBuffer(points_buffer, 0, points);
    device.queue.writeBuffer(centroids_buffer, 0, centroids);
    device.queue.writeBuffer(weight_buffer, 0, weights);
    device.queue.writeBuffer(count_buffer, 0, counts);
    device.queue.writeBuffer(avg_weight_buffer, 0, avg_weights);
    device.queue.writeBuffer(consts_buffer, 0, new Uint32Array([NUM_POINTS, width, height]));

    const module = device.createShaderModule({
        label: 'voronoi',
        code: /* wgsl */`

        struct ConstDataStruct {
            N_POINTS: u32,
            WIDTH: u32,
            HEIGHT: u32,
        };

        const NUM_POINTS = 1000u;
        const WIDTH = 640u;
        const HEIGHT = 480u;
        const FLOAT_MULT_PREC = 1000.0;

        @group(0) @binding(0) var in_texture: texture_external; // sRGB color space normalized
        @group(0) @binding(1) var<storage, read_write> idx_map: array<u32>;
        
        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;
        @group(0) @binding(3) var<storage, read_write> centroids: array<atomic<u32>>;
        @group(0) @binding(5) var<storage, read_write> weights: array<atomic<u32>>;
        @group(0) @binding(6) var<storage, read_write> counts: array<atomic<u32>>;
        @group(0) @binding(7) var<uniform> constData: ConstDataStruct;
        
        @compute @workgroup_size(1,1,1) fn centorid_computation(@builtin(global_invocation_id) id: vec3u) {
            let pixel = textureLoad(in_texture, id.xy);
            let i = id.y * constData.WIDTH + id.x;
            var min_dist = 1000000.0;
            var min_index = 0u;

            if (i < constData.N_POINTS) {
                atomicStore(&centroids[2 * i], 0u);
                atomicStore(&centroids[2 * i + 1], 0u);
                atomicStore(&weights[i], 0u);
                atomicStore(&counts[i], 0u);
            }

            for (var j = 0u; j < constData.N_POINTS; j++) {
                let dist = distance(points[j], vec2<f32>(f32(id.x), f32(id.y)));
                if (dist < min_dist) {
                    min_dist = dist;
                    min_index = j;
                }
            }
            idx_map[i] = min_index;

            let weight = u32(85 * (pixel.x + pixel.y + pixel.z));
            let weight_f = f32(weight) / 256.0;

            atomicAdd(&centroids[2 * min_index], u32(round(f32(id.x) * weight_f * FLOAT_MULT_PREC)));
            atomicAdd(&centroids[2 * min_index + 1], u32(round(f32(id.y) * weight_f * FLOAT_MULT_PREC)));
            atomicAdd(&weights[min_index], weight);
            atomicAdd(&counts[min_index], 1u);
        }
        `,
    });

    const module2 = device.createShaderModule({
        label: 'voronoi 2',
        code: /* wgsl */`
        const FLOAT_MULT_PREC = 1000.0;
        
        @group(0) @binding(0) var<storage, read_write> points: array<vec2<f32>>;
        @group(0) @binding(1) var<storage, read_write> centroids: array<u32>;
        @group(0) @binding(2) var<storage, read_write> weights: array<u32>;
        @group(0) @binding(3) var<storage, read_write> counts: array<u32>;
        @group(0) @binding(4) var<storage, read_write> avg_weights: array<u32>;
        @group(0) @binding(5) var<storage, read_write> weight_max: atomic<u32>;
        @compute @workgroup_size(1) fn points_update(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            var c_x = f32(centroids[2*i]) / FLOAT_MULT_PREC;
            var c_y = f32(centroids[2*i+1]) / FLOAT_MULT_PREC;
            if (weights[i] > 0) {
                let weight = f32(weights[i]) / 256.0;
                c_x /= weight;
                c_y /= weight;
                avg_weights[i] = weights[i] / max(counts[i], 1u);
                atomicMax(&weight_max, avg_weights[i]);
            }
            points[i].x = c_x;
            points[i].y = c_y;
        }
        `,
    });

    const rend_module = device.createShaderModule({
        label: 'render module',
        code:  /* wgsl */`
        struct ConstDataStruct {
            N_POINTS: u32,
            WIDTH: u32,
            HEIGHT: u32,
        };

        const pos : array<vec2<f32>, 6> = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, 1.0),
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(1.0, 1.0),
            vec2<f32>(1.0, -1.0)
        );

        @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {  
            return vec4f(pos[vertexIndex], 0.0, 0.0);
        }
        
        @group(0) @binding(0) var<storage, read> points: array<vec2<f32>>;
        @group(0) @binding(1) var<storage, read> avg_weights: array<u32>;
        @group(0) @binding(2) var<storage, read> weight_max: u32;
        @group(0) @binding(3) var<storage, read_write> idx_map: array<u32>;
        @group(0) @binding(4) var<uniform> constData: ConstDataStruct;
        @fragment fn fs(@builtin(position) coord_in: vec4<f32>) -> @location(0) vec4f {
            var col = vec3f(0.0, 0.0, 0.0);
            let c = coord_in.xy - vec2f(0.5, 0.5);
            let p_idx = idx_map[u32(c.y * f32(constData.WIDTH) + c.x)];
            let weight = f32(avg_weights[p_idx]) / 256.0;
            let point = points[p_idx];

            let dist = distance(point, coord_in.xy);

            let th = 800 * weight / f32(weight_max);
            if (dist < th) {
                var c_d = dist / th;
                c_d = 1.0 - c_d*c_d*c_d;
                col = vec3f(c_d, c_d, c_d);
            }
            // let idx_f32 = f32(p_idx) / 1000.0;
            // col = vec3f(idx_f32, idx_f32, idx_f32);

            return vec4f(col, 1);
        }
        `,
    });

    const pipeline = device.createComputePipeline({
        label: 'centorid_computation',
        layout: 'auto',
        compute: {
            module: module,
            entryPoint: 'centorid_computation',
        },
    });

    const pipeline2 = device.createComputePipeline({
        label: 'points update',
        layout: 'auto',
        compute: {
            module: module2,
            entryPoint: 'points_update',
        },
    });

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: presentationFormat,
    });

    const rend_pipeline = device.createRenderPipeline({
        label: 'our hardcoded red triangle pipeline',
        layout: 'auto',
        vertex: {
            module: rend_module,
            entryPoint: 'vs',
        },
        fragment: {
            module: rend_module,
            entryPoint: 'fs',
            targets: [{ format: presentationFormat }],
        },
    });


    // create a buffer on the GPU to hold our computation
    // input and output
    const index_buffer = device.createBuffer({
        label: 'index buffer',
        size: 4 * width * height,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    const renderPassDescriptor = {
        label: 'our basic canvas renderPass',
        colorAttachments: [
            {
                // view: <- to be filled out when we render
                clearValue: [0.3, 0.3, 0.3, 1],
                loadOp: 'clear',
                storeOp: 'store',
            },
        ],
    };

    const comp1_bind_group_desc = {
        label: 'bindGroup 0',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: undefined },
            { binding: 1, resource: { buffer: index_buffer } },
            { binding: 2, resource: { buffer: points_buffer } },
            { binding: 3, resource: { buffer: centroids_buffer } },
            { binding: 5, resource: { buffer: weight_buffer } },
            { binding: 6, resource: { buffer: count_buffer } },
            { binding: 7, resource: { buffer: consts_buffer } },
        ],
    }

    const comp2_bind_group_desc = {
        label: 'bindGroup 1',
        layout: pipeline2.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: points_buffer } },
            { binding: 1, resource: { buffer: centroids_buffer } },
            { binding: 2, resource: { buffer: weight_buffer } },
            { binding: 3, resource: { buffer: count_buffer } },
            { binding: 4, resource: { buffer: avg_weight_buffer } },
            { binding: 5, resource: { buffer: weightmax_buffer } },
        ],
    }

    const rend_boind_group_desc = {
        label: 'bindGroup 2',
        layout: rend_pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: points_buffer } },
            { binding: 1, resource: { buffer: avg_weight_buffer } },
            { binding: 2, resource: { buffer: weightmax_buffer } },
            { binding: 3, resource: { buffer: index_buffer } },
            { binding: 4, resource: { buffer: consts_buffer } },
        ],
    }

    async function render_pass() {
        frame_texture = device.importExternalTexture({
            source: camera
        });

        comp1_bind_group_desc.entries[0].resource = frame_texture;

        const encoder = device.createCommandEncoder();

        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, device.createBindGroup(comp1_bind_group_desc));
        pass.dispatchWorkgroups(width, height);
        pass.end();

        encoder.clearBuffer(weightmax_buffer)

        const pass2 = encoder.beginComputePass();
        pass2.setPipeline(pipeline2);
        pass2.setBindGroup(0, device.createBindGroup(comp2_bind_group_desc));
        pass2.dispatchWorkgroups(NUM_POINTS);
        pass2.end();

        encoder.copyBufferToBuffer(weightmax_buffer, 0, res_weightmax_buffer, 0, 4);

        renderPassDescriptor.colorAttachments[0].view =
            context.getCurrentTexture().createView();

        const pass3 = encoder.beginRenderPass(renderPassDescriptor);
        pass3.setPipeline(rend_pipeline);
        pass3.setBindGroup(0, device.createBindGroup(rend_boind_group_desc));
        pass3.draw(6);  // call our vertex shader 3 times
        pass3.end();

        device.queue.submit([encoder.finish()]);

        camera.requestVideoFrameCallback(render_pass);
        // let time = performance.now();
        // console.log("FPS = ", 1000 / (time - last_time));
        // last_time = time;
    }

    let last_time = performance.now();
    camera.requestVideoFrameCallback(render_pass);

    document.addEventListener("keydown", function (event) {
        if (event.code === "Space") {
            render_pass();
        }
    });


}
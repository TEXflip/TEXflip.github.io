let camera = document.getElementById("camera")
camera.addEventListener("load", main());

NUM_POINTS = 1000;

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

    let points_list = [];
    for (let i = 0; i < NUM_POINTS; i++) {
        let x = parseInt(Math.random() * width);
        let y = parseInt(Math.random() * height);
        points_list.push([x, y]);
    }
    points = new Float32Array(points_list.flat());

    let weights = new Float32Array(points_list.length).fill(0);
    let counts = new Uint32Array(points_list.length).fill(0);
    let avg_weights = new Float32Array(points_list.length).fill(0);
    let centroids = new Float32Array(2 * points_list.length).fill(0);

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
        size: centroids.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const count_buffer = device.createBuffer({
        label: 'count_buffer',
        size: centroids.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const avg_weight_buffer = device.createBuffer({
        label: 'avg_weight_buffer',
        size: centroids.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const result_centroids_buffer = device.createBuffer({
        label: 'result_centroids_buffer',
        size: centroids.byteLength,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(points_buffer, 0, points);
    device.queue.writeBuffer(centroids_buffer, 0, centroids);
    device.queue.writeBuffer(weight_buffer, 0, weights);
    device.queue.writeBuffer(count_buffer, 0, counts);
    device.queue.writeBuffer(avg_weight_buffer, 0, avg_weights);

    const module = device.createShaderModule({
        label: 'voronoi',
        code: /* wgsl */`
        @group(0) @binding(0) var in_texture: texture_external; // sRGB color space normalized
        @group(0) @binding(1) var<storage, read_write> im_out: array<u32>;

        @group(0) @binding(2) var<storage, read_write> points: array<vec2<f32>>;
        @group(0) @binding(3) var<storage, read_write> centroids: array<vec2<f32>>;
        @group(0) @binding(4) var<storage, read_write> weights: array<f32>;
        @group(0) @binding(5) var<storage, read_write> counts: array<u32>;
        @group(0) @binding(6) var<storage, read_write> avg_weights: array<f32>;
        // @group(0) @binding(1) var<storage, read> datain: array<f32>;
        
        @compute @workgroup_size(1) fn centorid_computation(@builtin(global_invocation_id) id: vec3u) {
            let pixel = textureLoad(in_texture, id.xy);
            let i = id.y * 640 + id.x;
            var min_dist = 1000000.0;
            var min_index = 0u;

            if (i < 1000) {
                centroids[i] = vec2<f32>(0.0, 0.0);
                weights[i] = 0.0;
                counts[i] = 0u;
                avg_weights[i] = 0.0;
            }

            workgroupBarrier();

            for (var j = 0u; j < 1000; j++) {
                let dist = distance(points[j], vec2<f32>(f32(id.x),f32(id.y)));
                if (dist < min_dist) {
                    min_dist = dist;
                    min_index = j;
                }
            }

            let weight = 1 - ((pixel.x + pixel.y + pixel.z) / 3.0);
            let x = u32(255 * pixel.x);
            let y = u32(255 * pixel.y);
            let z = u32(255 * pixel.z);

            centroids[min_index].x += f32(id.x) * weight;
            centroids[min_index].y += f32(id.y) * weight;
            weights[min_index] += weight;
            counts[min_index]++;

            workgroupBarrier();
            
            if (i < 1000) {
                if (weights[i] > 0) {
                    centroids[i] = centroids[i] / weights[i];
                    avg_weights[i] = weights[i] / max(f32(counts[i]), 1);
                } else {
                    centroids[i] = vec2<f32>(points[i].x, points[i].y);
                }
                points[i] = centroids[i];
            }
            workgroupBarrier();
            // let v = points[i];
            let sw = avg_weights[i] * 120.0;
            // let sw = map(avgWeights[i], 0, maxWeight, 0, 12, true);
            // strokeWeight(sw);
            // point(v.x, v.y);
            if (min_dist < 2) {
                im_out[i] = 0xff000000;
            }
            else {
                im_out[i] = 0xff000000 | (z << 16) | (y << 8) | x;
            }

        }
        `,
    });

    const pipeline = device.createComputePipeline({
        label: 'doubling compute pipeline',
        layout: 'auto',
        compute: {
            module,
            entryPoint: 'centorid_computation',
        },
    });


    // create a buffer on the GPU to hold our computation
    // input and output
    const write_buffer = device.createBuffer({
        label: 'write buffer',
        size: 4 * width * height,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    async function render_pass() {
        frame_texture = device.importExternalTexture({
            source: camera
        });

        const bind_group = device.createBindGroup({
            label: 'bindGroup for work buffer',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: frame_texture },
                { binding: 1, resource: { buffer: write_buffer } },
                { binding: 2, resource: { buffer: points_buffer } },
                { binding: 3, resource: { buffer: centroids_buffer } },
                { binding: 4, resource: { buffer: weight_buffer } },
                { binding: 5, resource: { buffer: count_buffer } },
                { binding: 6, resource: { buffer: avg_weight_buffer } },
            ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind_group);
        pass.dispatchWorkgroups(width, height);
        pass.end();


        encoder.copyBufferToTexture(
            { buffer: write_buffer, bytesPerRow: 4 * width, rowsPerImage: height },
            { texture: context.getCurrentTexture() },
            { width, height, depthOrArrayLayers: 1 }
        )

        encoder.copyBufferToBuffer(centroids_buffer, 0, result_centroids_buffer, 0, centroids.byteLength);
        const commandBuffer = encoder.finish();

        device.queue.submit([commandBuffer]);

        // await result_centroids_buffer.mapAsync(GPUMapMode.READ);
        // const result_centroids = new Float32Array(result_centroids_buffer.getMappedRange());

        // console.log(Array.from(result_centroids));

        // result_centroids_buffer.unmap();

        camera.requestVideoFrameCallback(render_pass);
    }

    camera.requestVideoFrameCallback(render_pass);


}
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

    let points = [];
    for (let i = 0; i < NUM_POINTS; i++) {
        let x = parseInt(Math.random() * width);
        let y = parseInt(Math.random() * height);
        points.push([x, y]);
    }

    const module = device.createShaderModule({
        label: 'voronoi',
        code: /* wgsl */`
        @group(0) @binding(0) var in_texture: texture_external; // sRGB color space normalized
        @group(0) @binding(1) var<storage, read_write> dataout: array<u32>;
        // @group(0) @binding(1) var<storage, read> datain: array<f32>;
        
        @compute @workgroup_size(1) fn computeSomething(@builtin(global_invocation_id) id: vec3u) {
            let pixel = textureLoad(in_texture, id.xy);
            let i = id.y * 640 + id.x;
            let v = u32(255 * (pixel.x + pixel.y + pixel.z) / 3.0);
            let x = u32(255 * pixel.x);
            let y = u32(255 * pixel.y);
            let z = u32(255 * pixel.z);
            dataout[i] = 0xff000000 | (z << 16) | (y << 8) | x;
        }
        `,
    });

    const pipeline = device.createComputePipeline({
        label: 'doubling compute pipeline',
        layout: 'auto',
        compute: {
            module,
            entryPoint: 'computeSomething',
        },
    });


    // create a buffer on the GPU to hold our computation
    // input and output
    const points_buffer = device.createBuffer({
        label: 'read buffer',
        size: points.length * 4 * 2,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
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

        const commandBuffer = encoder.finish();

        device.queue.submit([commandBuffer]);

        camera.requestVideoFrameCallback(render_pass);
    }

    camera.requestVideoFrameCallback(render_pass);


}
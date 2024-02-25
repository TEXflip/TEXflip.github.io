let camera = document.getElementById("camera")
camera.addEventListener("load", main());

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
    canvas.width = width;
    canvas.height = height;

    const module = device.createShaderModule({
        label: 'voronoi',
        code: /* wgsl */`
        @group(0) @binding(0) var in_texture: texture_external; // sRGB color space normalized
        @group(0) @binding(1) var<storage, read_write> dataout: array<u32>;
        // @group(0) @binding(1) var<storage, read> datain: array<f32>;
        
        @compute @workgroup_size(1) fn computeSomething(@builtin(global_invocation_id) id: vec3u) {
            let pixel = textureLoad(in_texture, id.xy);
            let i = id.y * 320 + id.x;
            let v = (pixel.x + pixel.y + pixel.z) / 3.0;
            dataout[i] = u32(v * 255);
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
    device.create


    // create a buffer on the GPU to hold our computation
    // input and output
    // const readBuffer = device.createBuffer({
    //     label: 'read buffer',
    //     size: input.byteLength,
    //     usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    // });
    const writeBuffer = device.createBuffer({
        label: 'write buffer',
        size: 4 * width * height,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    const resultBuffer = device.createBuffer({
        label: 'result buffer',
        size: 4 * width * height,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    async function render_pass() {
        frame_texture = device.importExternalTexture({
            source: camera
        });

        const bindGroup = device.createBindGroup({
            label: 'bindGroup for work buffer',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: frame_texture },
                { binding: 1, resource: { buffer: writeBuffer } },
            ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(width, height);
        pass.end();

        // Encode a command to copy the results to a mappable buffer.
        encoder.copyBufferToBuffer(writeBuffer, 0, resultBuffer, 0, resultBuffer.size);
        const rend_texture = device.createTexture({
            size: { width: width, height: height, depthOrArrayLayers: 1 },
            format: "r32uint",
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })

        encoder.copyBufferToTexture({buffer: writeBuffer, bytesPerRow: 4 * width, rowsPerImage: height}, {texture: rend_texture}, {width, height, depthOrArrayLayers: 1 })

        const rend_pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 0, g: 1, b: 0, a: 1 },
                storeOp: "store",
            }]
        });
        rend_pass.end();

        // Finish encoding and submit the commands
        const commandBuffer = encoder.finish();

        device.queue.submit([commandBuffer]);

        // Read the results
        await resultBuffer.mapAsync(GPUMapMode.READ);
        const result = new Uint32Array(resultBuffer.getMappedRange());

        console.log('result', Array.from(result));

        // device.queue.writeBuffer(readBuffer, 0, result);

        resultBuffer.unmap();
    }

    camera.requestVideoFrameCallback(render_pass);
    // Copy our input data to that buffer
    // device.queue.copyExternalImageToTexture({source: camera}, { texture: texture} , [width, height, 3]);
    // device.queue.writeBuffer(readBuffer, 0, input);


}
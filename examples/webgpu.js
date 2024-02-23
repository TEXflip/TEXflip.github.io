
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
    return { device, context };
}

const { device, context } = await setup_webgpu();

const module = device.createShaderModule({
    label: 'voronoi',
    code: /* wgsl */`
    @group(0) @binding(0) var<storage, read> datain: array<f32>;
    @group(0) @binding(1) var<storage, read_write> dataout: array<f32>;
    
    @compute @workgroup_size(1) fn computeSomething(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        dataout[i] = datain[i] * 2.0;
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


let input = new Float32Array([1, 3, 5]);
// create a buffer on the GPU to hold our computation
// input and output
const readBuffer = device.createBuffer({
    label: 'read buffer',
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
// Copy our input data to that buffer
device.queue.writeBuffer(readBuffer, 0, input);

const writeBuffer = device.createBuffer({
    label: 'write buffer',
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
});

const resultBuffer = device.createBuffer({
    label: 'result buffer',
    size: input.byteLength,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
});

// Setup a bindGroup to tell the shader which
// buffer to use for the computation
const bindGroup = device.createBindGroup({
    label: 'bindGroup for work buffer',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
        { binding: 0, resource: { buffer: readBuffer } },
        { binding: 1, resource: { buffer: writeBuffer } },
    ],
});

async function compute() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(input.length);
    pass.end();

    // Encode a command to copy the results to a mappable buffer.
    encoder.copyBufferToBuffer(writeBuffer, 0, resultBuffer, 0, resultBuffer.size);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();

    device.queue.submit([commandBuffer]);

    // Read the results
    await resultBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(resultBuffer.getMappedRange());
    
    console.log('result', Array.from(result));
    
    device.queue.writeBuffer(readBuffer, 0, result);

    resultBuffer.unmap();
}

await compute();
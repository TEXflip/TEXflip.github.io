/*
    This is an example of a very basic particle system
    using transform feedback. 

    It's important to remember that not all particle
    systems *need* transform feedback. It's just a tool
    you can use when the number of particles grow very
    large. This animation could have been done entirely
    in JavaScript, but you would run out of CPU capcity
    and saturate your bandwidth on most hardware.
*/


const vertexShaderSource = `#version 300 es
#pragma vscode_glsllint_stage: vert

uniform float uTime;

layout(location=0) in vec2 aTarget;
layout(location=1) in vec2 aPosition;
layout(location=2) in vec2 aVelocity;

out vec2 vTarget;
out vec2 vPosition;
out vec2 vVelocity;

void main()
{
	vec2 p = aPosition + aVelocity;

    // this f*cking line is here to prevent the particles to disappearing when they are not moving
    // beacuse some browsers renders only lines of points between 2 frames. 
    // So technically speaking my particles are like electrons vibrating.
    p += vec2(sin(uTime), cos(uTime)) * 0.000001;
    vPosition = p;

    vec2 targetDirection = normalize(aTarget - aPosition) * 0.1;
    float speed = min(length(aVelocity), length(aTarget - aPosition));
	vVelocity = normalize(aVelocity + targetDirection) * speed;
    vTarget = aTarget;

	if (vPosition.y < -1.0) {
		vPosition.y = 1.0;
	}
	if (vPosition.y > 1.0) {
		vPosition.y = -1.0;
	}
	if (vPosition.x < -1.0) {
		vPosition.x = 1.0;
	}
	if (vPosition.x > 1.0) {
		vPosition.x = -1.0;
	}
    
    gl_Position = vec4(vPosition, 0.0, 1.0);
    gl_PointSize = 4.0;
}`;

const fragmentShaderSource = `#version 300 es
#pragma vscode_glsllint_stage: frag

precision mediump float;

out vec4 fragColor;

void main()
{
    fragColor = vec4(0., 0., 0., 1.);
}`;

const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2', {antialias: false});
const program = gl.createProgram();

const vertexShader = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vertexShader, vertexShaderSource);
gl.compileShader(vertexShader);
gl.attachShader(program, vertexShader);

const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fragmentShader, fragmentShaderSource);
gl.compileShader(fragmentShader);
gl.attachShader(program, fragmentShader);

// This line tells WebGL that these four output varyings should
// be recorded by transform feedback and that we're using a single
// buffer to record them.
gl.transformFeedbackVaryings(program, ['vTarget', 'vPosition', 'vVelocity'], gl.INTERLEAVED_ATTRIBS);

gl.linkProgram(program);

if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.log(gl.getShaderInfoLog(vertexShader));
    console.log(gl.getShaderInfoLog(fragmentShader));
    console.log(gl.getProgramInfoLog(program));
}

gl.useProgram(program);

// This is the number of primitives we will draw
const COUNT = 1000;

// Initial state of the input data. This "seeds" the
// particle system for its first draw.
let initialData = new Float32Array(COUNT * 6);
for (let i = 0; i < COUNT * 6; i += 6) {
    const px = Math.random() * 2 - 1;
    const py = Math.random() * 2 - 1;
    const tx = Math.random() * 2 - 1;
    const ty = Math.random() * 2 - 1;
    const vx = (Math.random() * 2 - 1) * 0.01;
    const vy = (Math.random() * 2 - 1) * 0.01;

    initialData.set([
        tx, ty,     // vTarget
        px, py,     // vPosition
        vx, vy,     // vVelocity
    ], i);

}
// console.log(initialData);

// Describe our first buffer for when it is used a vertex buffer
const buffer1 = gl.createBuffer();
const vao1 = gl.createVertexArray();
gl.bindVertexArray(vao1);
gl.bindBuffer(gl.ARRAY_BUFFER, buffer1);
gl.bufferData(gl.ARRAY_BUFFER, 6 * COUNT * 4, gl.DYNAMIC_COPY);
gl.bufferSubData(gl.ARRAY_BUFFER, 0, initialData);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.enableVertexAttribArray(2);

// Initial data is no longer needed, so we can clear it now.

// Buffer2 is identical but does not need initial data
const buffer2 = gl.createBuffer();
const vao2 = gl.createVertexArray();
gl.bindVertexArray(vao2);
gl.bindBuffer(gl.ARRAY_BUFFER, buffer2);
gl.bufferData(gl.ARRAY_BUFFER, 6 * COUNT * 4, gl.DYNAMIC_COPY);
gl.bufferSubData(gl.ARRAY_BUFFER, 0, initialData);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16);
gl.enableVertexAttribArray(0);
gl.enableVertexAttribArray(1);
gl.enableVertexAttribArray(2);
initialData = null;

// Clean up after yourself
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// This code should NOT be used, since we are using a single
// draw call to both UPDATE our particle system and DRAW it.
// gl.enable(gl.RASTERIZER_DISCARD);


// We have two VAOs and two buffers, but one of each is
// ever active at a time. These variables will make sure
// of that.
let vao = vao1;
let buffer = buffer1;
let time = 0;

const uTimeLocation = gl.getUniformLocation(program, 'uTime');

// When we call `gl.clear(gl.COLOR_BUFFER_BIT)` WebGL will
// use this color (100% black) as the background color.
gl.clearColor(1,1,1,1);

const draw = () => {
    // schedule the next draw call
    requestAnimationFrame(draw);
    time +=1;

    // It often helps to send a single (or multiple) random
    // numbers into the vertex shader as a uniform.
    gl.uniform1f(uTimeLocation, time);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Bind one buffer to ARRAY_BUFFER and the other to TFB
    gl.bindVertexArray(vao);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);

    // Perform transform feedback and the draw call
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, COUNT);
    gl.endTransformFeedback();

    // Clean up after ourselves to avoid errors.
    gl.bindVertexArray(null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    // If we HAD skipped the rasterizer, we would have turned it
    // back on here too.
    // gl.disable(gl.RASTERIZER_DISCARD);

    // Swap the VAOs and buffers
    if (vao === vao1) {
        vao = vao2;
        buffer = buffer1;
    } else {
        vao = vao1;
        buffer = buffer2;
    }
};
draw();
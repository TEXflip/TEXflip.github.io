var canvas = document.getElementById('canvas');
var gl = canvas.getContext('webgl2');
twgl.setDefaults({attribPrefix: "a_"});
numVerts = 1000;
const arrays = {
	position: [-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0],
};

let vertexShader = `
	#version 300 es

	out vec3 a_position;
	out vec3 a_velocity;

	void main() {
		a_position = a_position + a_velocity;
		a_velocity = vec3(0.1, 0.1, 0.);
	}
`;

let fragmentShader = `
	#version 300 es
	precision mediump float;
	out vec4 o;
	void main() {
		o = vec4(0);
	}
`;


// twgl setup with shaders
const feedbackProgramInfo = twgl.createProgramInfo(gl, [vertexShader, fragmentShader],
{ transformFeedbackVaryings: [
	"a_position",
	"a_velocity",
  ],
});

function generateMesh(tf, bufferInfo) {
    // Generate a mesh using transform feedback

    gl.enable(gl.RASTERIZER_DISCARD);

    gl.useProgram(feedbackProgramInfo.program);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.beginTransformFeedback(gl.POINTS);
    twgl.drawBufferInfo(gl, bufferInfo);
    gl.endTransformFeedback();
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    gl.disable(gl.RASTERIZER_DISCARD);
}

const bufferInfo = twgl.createBufferInfoFromArrays(gl, {
	position: numVerts * 3,
	velocity: numVerts * 3,
});

const tf = twgl.createTransformFeedback(gl, feedbackProgramInfo, bufferInfo);
generateMesh(tf, bufferInfo);

// render on framebugffer
const attachments = [
	{ format: twgl.RGBA, type: twgl.UNSIGNED_BYTE, min: twgl.LINEAR, wrap: twgl.CLAMP_TO_EDGE },
	// { format: twgl.DEPTH_STENCIL, },
  ];
const fbi = twgl.createFramebufferInfo(gl, attachments);

gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
gl.useProgram(programInfo.program);
twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
twgl.drawBufferInfo(gl, bufferInfo);

gl.bindFramebuffer(gl.FRAMEBUFFER, null);

let vertexShader2 = `
	attribute vec2 position; 
	uniform sampler2D u_texture;
	void main() {
		gl_Position = vec4(position, 0, 1);
	}
`;

let fragmentShader2 = `
	precision mediump float;
	uniform sampler2D u_texture;
	void main() {
	  vec4 c = texture2D(u_texture, gl_FragCoord.xy / vec2(256.0, 256.0));
	  gl_FragColor = vec4(c.r, c.g*0., c.b, 1.0);
	}
`;


// twgl setup with shaders
const programInfoRender = twgl.createProgramInfo(gl, [vertexShader2, fragmentShader2]);

bufferInfo = twgl.createBufferInfoFromArrays(gl, arrays);

const bufferInfoRender = twgl.createBufferInfoFromArrays(gl, arrays);

gl.useProgram(programInfoRender.program);
twgl.setBuffersAndAttributes(gl, programInfoRender, bufferInfo);
twgl.drawBufferInfo(gl, bufferInfo);


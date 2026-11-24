import { makeColorTexture, makeTerrain, updateGeometry } from './terrain.js';

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uViewProjection;
out vec3 vWorldPosition;
out vec3 vWorldNormal;
out vec2 vUV;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = mat3(uModel) * aNormal;
  vUV = aUV;
  gl_Position = uViewProjection * worldPosition;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTerrain;
uniform vec3 uLightDirection;
uniform vec3 uEye;
in vec3 vWorldPosition;
in vec3 vWorldNormal;
in vec2 vUV;
out vec4 outColor;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uLightDirection);
  vec3 V = normalize(uEye - vWorldPosition);
  vec3 R = reflect(-L, N);
  vec4 terrain = texture(uTerrain, vUV);
  vec3 baseColor = pow(terrain.rgb, vec3(2.2));
  float diffuse = max(dot(N, L), 0.0);
  float specular = diffuse > 0.0 ? pow(max(dot(R, V), 0.0), 45.0) : 0.0;
  vec3 lit = baseColor * (0.09 + 0.89 * diffuse)
           + vec3(0.78, 0.88, 1.0) * mix(0.012, 0.16, terrain.a) * specular;
  outColor = vec4(pow(clamp(lit, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

const RAD = Math.PI / 180;
const TILT = -23.44 * RAD;

function modelMatrix(angle) {
  // Column-major Rz(tilt) * Ry(spin): spin around the Earth's tilted y-axis.
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  return new Float32Array([
    ct * c, st * c, -s, 0,
    -st, ct, 0, 0,
    ct * s, st * s, c, 0,
    0, 0, 0, 1,
  ]);
}

function viewProjectionMatrix(aspect, cameraDistance) {
  // Perspective projection times a view matrix translating the scene by -cameraDistance.
  const f = 1 / Math.tan(17 * RAD);
  const near = 0.1;
  const far = 30;
  const a = (far + near) / (near - far);
  const b = 2 * far * near / (near - far);
  return new Float32Array([
    f / Math.max(1, aspect), 0, 0, 0,
    0, f * Math.min(1, aspect), 0, 0,
    0, 0, a, -1,
    0, 0, b - a * cameraDistance, cameraDistance,
  ]);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`셰이더 컴파일 오류: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`셰이더 링크 오류: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function createAttribute(gl, location, size, values, usage) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, usage);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  return buffer;
}

function createTexture(gl, elevation) {
  const { width, height, pixels } = makeColorTexture(elevation);
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
}

export function createRenderer(canvas, elevation, exaggeration) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('이 브라우저에서 WebGL 2를 시작할 수 없어요.');
  const program = createProgram(gl);
  const uniforms = Object.fromEntries(
    ['uModel', 'uViewProjection', 'uLightDirection', 'uEye', 'uTerrain'].map(
      name => [name, gl.getUniformLocation(program, name)],
    ),
  );
  const terrain = makeTerrain(elevation);
  const positions = new Float32Array(terrain.directions.length);
  const normals = new Float32Array(positions.length);
  updateGeometry(terrain, exaggeration, positions, normals);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const positionBuffer = createAttribute(gl, 0, 3, positions, gl.DYNAMIC_DRAW);
  const normalBuffer = createAttribute(gl, 1, 3, normals, gl.DYNAMIC_DRAW);
  createAttribute(gl, 2, 2, terrain.textureCoordinates, gl.STATIC_DRAW);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, terrain.indices, gl.STATIC_DRAW);
  createTexture(gl, elevation);

  gl.useProgram(program);
  gl.uniform1i(uniforms.uTerrain, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0.025, 0.043, 0.071, 1);

  function setExaggeration(value) {
    updateGeometry(terrain, value, positions, normals);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, normals);
  }

  function draw({ rotation, light, distance }) {
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(uniforms.uModel, false, modelMatrix((rotation - 50) * RAD));
    gl.uniformMatrix4fv(uniforms.uViewProjection, false, viewProjectionMatrix(width / height, distance));
    gl.uniform3f(uniforms.uEye, 0, 0, distance);
    const azimuth = light * RAD;
    const elevation = 14 * RAD;
    gl.uniform3f(uniforms.uLightDirection,
      Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
    gl.drawElements(gl.TRIANGLES, terrain.indices.length, gl.UNSIGNED_INT, 0);
  }

  return { draw, setExaggeration };
}

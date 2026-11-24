const WIDTH = 720;
const HEIGHT = 360;
const STEP = 0.5;
const FIRST_LON = 1 / 120;
const FIRST_LAT = -90 + 1 / 120;
const EARTH_RADIUS_METERS = 6_371_000;
const TO_RADIANS = Math.PI / 180;

// NOAA grid: south to north, eastward from 0.008333°E, little-endian meters.
export async function loadElevation(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`고도 파일을 불러올 수 없어요 (${response.status}).`);
  const bytes = new DataView(await response.arrayBuffer());
  if (bytes.byteLength !== WIDTH * HEIGHT * 2) throw new Error('고도 파일의 크기가 올바르지 않아요.');
  const meters = new Int16Array(WIDTH * HEIGHT);
  for (let i = 0; i < meters.length; i++) meters[i] = bytes.getInt16(i * 2, true);
  return meters;
}

function sampleElevation(meters, latitude, longitude) {
  const x = (((longitude - FIRST_LON) / STEP) % WIDTH + WIDTH) % WIDTH;
  const y = Math.max(0, Math.min(HEIGHT - 1, (latitude - FIRST_LAT) / STEP));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % WIDTH;
  const y1 = Math.min(y0 + 1, HEIGHT - 1);
  const south = meters[y0 * WIDTH + x0] * (1 - (x - x0)) + meters[y0 * WIDTH + x1] * (x - x0);
  const north = meters[y1 * WIDTH + x0] * (1 - (x - x0)) + meters[y1 * WIDTH + x1] * (x - x0);
  return south * (1 - (y - y0)) + north * (y - y0);
}

export function makeTerrain(meters) {
  const stride = WIDTH + 1;
  const count = stride * (HEIGHT + 1);
  const directions = new Float32Array(count * 3);
  const elevations = new Float32Array(count);
  const textureCoordinates = new Float32Array(count * 2);
  const indices = new Uint32Array(WIDTH * (HEIGHT - 1) * 6);
  let triangle = 0;

  for (let row = 0; row <= HEIGHT; row++) {
    const latitude = 90 - row * STEP;
    const phi = latitude * TO_RADIANS;
    const atPole = row === 0 || row === HEIGHT;
    const latitudeRadius = atPole ? 0 : Math.cos(phi);
    // Every longitude meets at the same position at each pole.
    const poleHeight = atPole ? sampleElevation(meters, latitude, 0) : 0;

    for (let col = 0; col <= WIDTH; col++) {
      const longitude = -180 + col * STEP;
      const lambda = (col === WIDTH ? -180 : longitude) * TO_RADIANS;
      const vertex = row * stride + col;
      directions[vertex * 3] = latitudeRadius * Math.sin(lambda);
      directions[vertex * 3 + 1] = Math.sin(phi);
      directions[vertex * 3 + 2] = latitudeRadius * Math.cos(lambda);
      elevations[vertex] = atPole ? poleHeight : sampleElevation(meters, latitude, longitude);
      // +0.5 converts a sample index to the center of its texel.
      textureCoordinates[vertex * 2] = ((longitude - FIRST_LON) / STEP + 0.5) / WIDTH;
      textureCoordinates[vertex * 2 + 1] = ((latitude - FIRST_LAT) / STEP + 0.5) / HEIGHT;

      if (row === HEIGHT || col === WIDTH) continue;
      const below = vertex + stride;
      if (row !== 0) {
        indices[triangle++] = vertex;
        indices[triangle++] = below;
        indices[triangle++] = vertex + 1;
      }
      if (row !== HEIGHT - 1) {
        indices[triangle++] = vertex + 1;
        indices[triangle++] = below;
        indices[triangle++] = below + 1;
      }
    }
  }
  return { directions, elevations, textureCoordinates, indices };
}

export function updateGeometry(terrain, exaggeration, positions, normals) {
  const { directions, elevations, indices } = terrain;
  for (let vertex = 0; vertex < elevations.length; vertex++) {
    const radius = 1 + exaggeration * Math.max(0, elevations[vertex]) / EARTH_RADIUS_METERS;
    const i = vertex * 3;
    positions[i] = radius * directions[i];
    positions[i + 1] = radius * directions[i + 1];
    positions[i + 2] = radius * directions[i + 2];
  }

  // Sum the cross products of the adjacent faces for area-weighted normals.
  normals.fill(0);
  for (let face = 0; face < indices.length; face += 3) {
    const a = indices[face] * 3;
    const b = indices[face + 1] * 3;
    const c = indices[face + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const x = aby * acz - abz * acy;
    const y = abz * acx - abx * acz;
    const z = abx * acy - aby * acx;
    normals[a] += x; normals[a + 1] += y; normals[a + 2] += z;
    normals[b] += x; normals[b + 1] += y; normals[b + 2] += z;
    normals[c] += x; normals[c + 1] += y; normals[c + 2] += z;
  }

  // The duplicated meridian vertices meet geometrically and share a normal.
  for (let row = 1; row < HEIGHT; row++) {
    const first = row * (WIDTH + 1) * 3;
    const last = first + WIDTH * 3;
    for (let axis = 0; axis < 3; axis++) {
      normals[first + axis] += normals[last + axis];
      normals[last + axis] = normals[first + axis];
    }
  }
  for (const row of [0, HEIGHT]) {
    const first = row * (WIDTH + 1) * 3;
    for (let col = 0; col <= WIDTH; col++) {
      const i = first + 3 * col;
      normals[i] = 0;
      normals[i + 1] = row === 0 ? 1 : -1;
      normals[i + 2] = 0;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    normals[i] /= length;
    normals[i + 1] /= length;
    normals[i + 2] /= length;
  }
}

const SEA_COLORS = [[-11000, 13, 34, 80], [-5000, 21, 56, 110], [-500, 26, 98, 151], [0, 41, 137, 175]];
const LAND_COLORS = [[0, 87, 129, 80], [250, 119, 143, 83], [1000, 170, 150, 97], [2800, 163, 124, 91], [5200, 211, 186, 157], [8000, 248, 242, 230]];

export function makeColorTexture(meters) {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < meters.length; i++) {
    const height = meters[i];
    const colors = height < 0 ? SEA_COLORS : LAND_COLORS;
    const upper = colors.findIndex((stop, index) => index > 0 && height <= stop[0]);
    const end = upper < 0 ? colors.length - 1 : upper;
    const low = colors[end - 1];
    const high = colors[end];
    const t = Math.max(0, Math.min(1, (height - low[0]) / (high[0] - low[0])));
    const latitude = FIRST_LAT + Math.floor(i / WIDTH) * STEP;
    const ice = height >= 0 ? Math.max(0, Math.min(1, (Math.abs(latitude) - 69) / 12)) : 0;
    for (let channel = 0; channel < 3; channel++) {
      const color = low[channel + 1] * (1 - t) + high[channel + 1] * t;
      pixels[i * 4 + channel] = Math.round(color * (1 - ice) + (225 + 9 * channel) * ice);
    }
    pixels[i * 4 + 3] = height < 0 ? 255 : 0; // Water mask for the specular term.
  }
  return { pixels, width: WIDTH, height: HEIGHT };
}

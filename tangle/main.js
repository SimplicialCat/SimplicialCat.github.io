import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe4f6);
scene.fog = new THREE.Fog(0xcfe4f6, 12, 28);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .05, 100);
camera.position.set(4.1, 2.9, 5.1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .08;
controls.maxPolarAngle = Math.PI * .52;
controls.minDistance = 1.2;
controls.maxDistance = 16;
controls.target.set(0, .55, 0);

scene.add(new THREE.HemisphereLight(0x9db4ff, 0x8fa3b8, 1.05));
const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.1);
keyLight.position.set(3.2, 6.4, 2.7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -6;
keyLight.shadow.camera.right = 6;
keyLight.shadow.camera.top = 6;
keyLight.shadow.camera.bottom = -6;
keyLight.shadow.camera.far = 18;
keyLight.shadow.bias = -.0004;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x7f9bff, .45);
fillLight.position.set(-4, 1.5, -3);
scene.add(fillLight);

const planeSize = 12;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(planeSize, planeSize, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0xdfe8f3, roughness: .82, metalness: .06 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(planeSize, 24, 0x71828f, 0xa9bcd0);
grid.material.transparent = true;
grid.material.opacity = .35;
scene.add(grid);

const GEOM_SEGMENTS = 20;
const RING_COSINES = Array.from({ length: GEOM_SEGMENTS }, (_, index) => Math.cos(index / GEOM_SEGMENTS * Math.PI * 2));
const RING_SINES = Array.from({ length: GEOM_SEGMENTS }, (_, index) => Math.sin(index / GEOM_SEGMENTS * Math.PI * 2));
const MAX_ROPES = 12;
const DEFAULT_COUNT = 110;
const DEFAULT_LENGTH = 8;
const MAX_DRAG_SPEED = 3;
const PHYSICS = { spring: 1.0, bend: 1.0, repulsion: 1.0, damping: 1.0, friction: 1.0 };
let nextRopeId = 1;

function layoutCenter(index) {
  const column = index % 3;
  const row = Math.floor(index / 3) % 3;
  return new THREE.Vector3((column - 1) * 2.2, .62, (row - 1) * 2.2);
}

function projectToTangentPlane(vector, tangent) {
  return vector.addScaledVector(tangent, -vector.dot(tangent));
}

function perpendicularSeed(tangent) {
  const seed = new THREE.Vector3(0, 1, 0);
  if (Math.abs(seed.dot(tangent)) > .9) seed.set(1, 0, 0);
  return projectToTangentPlane(seed, tangent).normalize();
}

function transportNormal(vector, fromTangent, toTangent) {
  const transported = vector.clone();
  const axis = new THREE.Vector3().crossVectors(fromTangent, toTangent);
  const sine = axis.length();
  const cosine = Math.max(-1, Math.min(1, fromTangent.dot(toTangent)));
  if (sine < 1e-10) {
    if (cosine < 0) transported.copy(perpendicularSeed(toTangent));
  } else {
    transported.applyAxisAngle(axis.divideScalar(sine), Math.atan2(sine, cosine));
  }
  return projectToTangentPlane(transported, toTangent).normalize();
}

function signedFrameAngle(current, target, tangent) {
  const from = projectToTangentPlane(current.clone(), tangent).normalize();
  const to = projectToTangentPlane(target.clone(), tangent).normalize();
  const cross = new THREE.Vector3().crossVectors(from, to);
  return Math.atan2(cross.dot(tangent), Math.max(-1, Math.min(1, from.dot(to))));
}

function frameClosureResidual(frames, tangents) {
  const expected = transportNormal(frames[tangents.length - 1], tangents[tangents.length - 1], tangents[0]);
  return signedFrameAngle(frames[0], expected, tangents[0]);
}

function randomRopeColor() {
  return new THREE.Color().setHSL(Math.random(), .08, .95);
}

class Rope {
  constructor({ count = DEFAULT_COUNT, radius = .09, closed = false, color = null, layoutIndex = 0 }) {
    count = Math.max(closed ? 8 : 4, Math.round(count));
    this.id = nextRopeId++;
    this.closed = closed;
    this.count = count;
    this.radius = radius;
    this.segmentRest = DEFAULT_LENGTH / (closed ? count : count - 1);
    this.restLength = this.segmentRest * (closed ? count : count - 1);
    this.pinned = closed ? [] : [false, false];
    this.center = layoutCenter(layoutIndex).clone();
    this.color = color ? color.clone() : randomRopeColor();
    this.geometry = new THREE.BufferGeometry();
    this.mesh = null;
    this.buildGeometry();
    this.material = new THREE.MeshPhysicalMaterial({
      color: this.color,
      roughness: .58,
      metalness: .02,
      clearcoat: .42,
      clearcoatRoughness: .28,
      sheen: .85,
      sheenRoughness: .32,
      sheenColor: this.color.clone().multiplyScalar(.24)
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.ropeIndex = -1;
    this.reset();
  }

  buildIndices() {
    const indices = [];
    const segmentCount = this.closed ? this.count : this.count - 1;
    for (let i = 0; i < segmentCount; i++) {
      const next = (i + 1) % this.count;
      for (let j = 0; j < GEOM_SEGMENTS; j++) {
        const ringNext = (j + 1) % GEOM_SEGMENTS;
        const a = i * GEOM_SEGMENTS + j;
        const b = i * GEOM_SEGMENTS + ringNext;
        const c = next * GEOM_SEGMENTS + j;
        const d = next * GEOM_SEGMENTS + ringNext;
        indices.push(a, c, b, b, c, d);
      }
    }
    return indices;
  }

  buildGeometry() {
    this.geometry?.dispose();
    this.geometry = new THREE.BufferGeometry();
    const vertexCount = this.count * GEOM_SEGMENTS;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    this.geometry.setIndex(this.buildIndices());
    this.renderFrames = Array.from({ length: this.count }, () => new THREE.Vector3());
    this.tangents = Array.from({ length: this.count }, () => new THREE.Vector3());
    if (this.mesh) this.mesh.geometry = this.geometry;
  }

  reset() {
    const positions = new Float32Array(this.count * 3);
    if (this.closed) {
      const loopRadius = this.restLength / (Math.PI * 2);
      for (let i = 0; i < this.count; i++) {
        const angle = i / this.count * Math.PI * 2;
        positions[i * 3] = this.center.x + Math.cos(angle) * loopRadius;
        positions[i * 3 + 1] = this.center.y;
        positions[i * 3 + 2] = this.center.z + Math.sin(angle) * loopRadius;
      }
    } else {
      const angle = (this.id * 1.1) % (Math.PI * 2);
      const direction = new THREE.Vector3(Math.cos(angle), .05, Math.sin(angle)).normalize();
      const start = this.center.clone().addScaledVector(direction, -this.restLength / 2);
      for (let i = 0; i < this.count; i++) {
        const point = start.clone().addScaledVector(direction, this.segmentRest * i);
        point.y += Math.sin(i / this.count * Math.PI * 2) * .07;
        point.y = Math.max(point.y, this.radius + .004);
        positions.set([point.x, point.y, point.z], i * 3);
      }
    }
    this.positions = positions;
    this.previous = positions.slice();
    this.updateGeometry();
  }

  setCenterline(positions, segmentRest = this.segmentRest) {
    this.count = positions.length / 3;
    this.segmentRest = segmentRest;
    this.restLength = segmentRest * (this.closed ? this.count : this.count - 1);
    this.positions = Float32Array.from(positions);
    this.previous = this.positions.slice();
    this.buildGeometry();
    this.updateGeometry();
  }

  point(index) {
    return new THREE.Vector3().fromArray(this.positions, index * 3);
  }

  setPoint(index, point) {
    point.toArray(this.positions, index * 3);
  }

  closeLoop() {
    if (this.closed || this.count < 8) return false;
    const joined = this.point(0).add(this.point(this.count - 1)).multiplyScalar(.5);
    const positions = new Float32Array((this.count - 1) * 3);
    positions.set(this.positions.subarray(0, (this.count - 1) * 3));
    positions[0] = joined.x;
    positions[1] = joined.y;
    positions[2] = joined.z;
    this.count--;
    this.closed = true;
    this.pinned = [];
    this.positions = positions;
    this.previous = positions.slice();
    this.buildGeometry();
    this.updateGeometry();
    return true;
  }

  insertAtSegment(segmentIndex, point) {
    const maxSegment = this.closed ? this.count - 1 : this.count - 2;
    if (segmentIndex < 0 || segmentIndex > maxSegment) return false;
    const oldPositions = this.positions;
    const positions = new Float32Array((this.count + 1) * 3);
    const insertAt = (segmentIndex + 1) * 3;
    positions.set(oldPositions.subarray(0, insertAt));
    positions[insertAt] = point.x;
    positions[insertAt + 1] = point.y;
    positions[insertAt + 2] = point.z;
    positions.set(oldPositions.subarray(insertAt), insertAt + 3);
    this.count++;
    this.positions = positions;
    this.previous = positions.slice();
    this.restLength = this.segmentRest * (this.closed ? this.count : this.count - 1);
    this.buildGeometry();
    this.updateGeometry();
    return true;
  }

  addAtEndpoint(side) {
    if (this.closed) return false;
    const oldPositions = this.positions;
    const positions = new Float32Array((this.count + 1) * 3);
    if (side === 0) {
      const direction = this.point(0).sub(this.point(1)).normalize().multiplyScalar(this.segmentRest);
      const point = this.point(0).clone().add(direction);
      point.y = Math.max(point.y, this.radius + .004);
      positions[0] = point.x;
      positions[1] = point.y;
      positions[2] = point.z;
      positions.set(oldPositions, 3);
    } else {
      const last = this.count - 1;
      const direction = this.point(last).sub(this.point(last - 1)).normalize().multiplyScalar(this.segmentRest);
      const point = this.point(last).clone().add(direction);
      point.y = Math.max(point.y, this.radius + .004);
      positions.set(oldPositions);
      positions.set([point.x, point.y, point.z], oldPositions.length);
    }
    this.count++;
    this.positions = positions;
    this.previous = positions.slice();
    this.restLength = this.segmentRest * (this.count - 1);
    this.buildGeometry();
    this.updateGeometry();
    return true;
  }

  updateGeometry() {
    const positions = this.positions;
    const position = this.geometry.attributes.position.array;
    const normal = this.geometry.attributes.normal.array;
    const frameNormal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const center = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const tangents = this.tangents;

    for (let i = 0; i < this.count; i++) {
      const previousIndex = this.closed ? (i - 1 + this.count) % this.count : Math.max(0, i - 1);
      const nextIndex = this.closed ? (i + 1) % this.count : Math.min(this.count - 1, i + 1);
      const previousIndex3 = previousIndex * 3;
      const nextIndex3 = nextIndex * 3;
      tangents[i].set(
        positions[nextIndex3] - positions[previousIndex3],
        positions[nextIndex3 + 1] - positions[previousIndex3 + 1],
        positions[nextIndex3 + 2] - positions[previousIndex3 + 2]
      );
      if (tangents[i].lengthSq() < 1e-12) tangents[i].set(0, 1, 0);
      tangents[i].normalize();
    }

    this.renderFrames[0].copy(perpendicularSeed(tangents[0]));
    for (let i = 1; i < this.count; i++) {
      this.renderFrames[i].copy(transportNormal(this.renderFrames[i - 1], tangents[i - 1], tangents[i]));
    }

    if (this.closed) {
      let residual = frameClosureResidual(this.renderFrames, tangents);
      for (let pass = 0; pass < 5 && Math.abs(residual) > 1e-5; pass++) {
        const perEdgeTwist = -residual / this.count;
        let transported = this.renderFrames[0].clone();
        for (let edge = 0; edge < this.count; edge++) {
          const next = (edge + 1) % this.count;
          transported = transportNormal(transported, tangents[edge], tangents[next]);
          transported.applyAxisAngle(tangents[next], perEdgeTwist);
          projectToTangentPlane(transported, tangents[next]).normalize();
          if (next !== 0) this.renderFrames[next].copy(transported);
        }
        residual = frameClosureResidual(this.renderFrames, tangents);
      }
    }

    for (let i = 0; i < this.count; i++) {
      frameNormal.copy(this.renderFrames[i]);
      projectToTangentPlane(frameNormal, tangents[i]).normalize();
      binormal.crossVectors(tangents[i], frameNormal).normalize();
      const centerIndex = i * 3;
      center.set(positions[centerIndex], positions[centerIndex + 1], positions[centerIndex + 2]);
      for (let j = 0; j < GEOM_SEGMENTS; j++) {
        radial.copy(frameNormal).multiplyScalar(RING_COSINES[j]).addScaledVector(binormal, RING_SINES[j]);
        const index = (i * GEOM_SEGMENTS + j) * 3;
        position[index] = center.x + radial.x * this.radius;
        position[index + 1] = center.y + radial.y * this.radius;
        position[index + 2] = center.z + radial.z * this.radius;
        normal[index] = radial.x;
        normal[index + 1] = radial.y;
        normal[index + 2] = radial.z;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

let ropes = [];
let activeRopeIndex = -1;
let activeTool = 'select';
let glueFirst = null;
let dragging = null;

function activeRope() {
  return ropes[activeRopeIndex] ?? null;
}

function setActiveRope(index) {
  activeRopeIndex = index >= 0 && index < ropes.length ? index : -1;
  ropes.forEach((rope, i) => {
    rope.material.emissive.set(i === activeRopeIndex ? 0x1b2438 : 0x000000);
    rope.material.emissiveIntensity = i === activeRopeIndex ? .75 : 0;
    rope.mesh.userData.ropeIndex = i;
  });
  updateMarkers();
  updateStatus();
}

function createRope(closed) {
  if (ropes.length >= MAX_ROPES) return;
  const rope = new Rope({
    count: DEFAULT_COUNT,
    radius: parseFloat(document.getElementById('radius').value),
    closed,
    layoutIndex: ropes.length
  });
  scene.add(rope.mesh);
  ropes.push(rope);
  setActiveRope(ropes.length - 1);
}

function deleteActiveRope() {
  if (!activeRope()) return;
  scene.remove(activeRope().mesh);
  activeRope().dispose();
  ropes.splice(activeRopeIndex, 1);
  dragging = null;
  setActiveRope(Math.min(activeRopeIndex, ropes.length - 1));
}

function resetAll() {
  clearRopes();
  createRope(false);
}

function clearRopes() {
  dragging = null;
  glueFirst = null;
  ropes.forEach(rope => {
    scene.remove(rope.mesh);
    rope.dispose();
  });
  ropes = [];
  setActiveRope(-1);
}

function roundedFileValue(value) {
  return Number(value.toFixed(6));
}

function exportTangle() {
  const payload = {
    format: 'tangle-scene',
    version: 1,
    settings: {
      radius: Number(radiusInput.value),
      gravity: Number(gravityInput.value)
    },
    activeRope: activeRopeIndex,
    ropes: ropes.map(rope => ({
      closed: rope.closed,
      color: `#${rope.color.getHexString()}`,
      segmentLength: roundedFileValue(rope.segmentRest),
      pinned: rope.closed ? [] : [...rope.pinned],
      points: Array.from({ length: rope.count }, (_, index) => {
        const point = rope.point(index);
        return [roundedFileValue(point.x), roundedFileValue(point.y), roundedFileValue(point.z)];
      })
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
  link.href = url;
  link.download = `tangle-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`已导出 ${ropes.length} 条绳索。`);
}

function parseTangleText(text) {
  const data = JSON.parse(text);
  if (!data || data.format !== 'tangle-scene' || data.version !== 1) {
    throw new Error('不是支持的 tangle 文件。');
  }
  if (!data.settings || typeof data.settings !== 'object') {
    throw new Error('文件缺少 settings。');
  }
  if (!Array.isArray(data.ropes)) {
    throw new Error('文件缺少 ropes。');
  }
  if (data.ropes.length > MAX_ROPES) {
    throw new Error(`文件包含 ${data.ropes.length} 条绳索，超过上限 ${MAX_ROPES}。`);
  }

  const radius = Number(data.settings.radius);
  const gravity = Number(data.settings.gravity);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error('文件中的半径无效。');
  }
  if (!Number.isFinite(gravity)) {
    throw new Error('文件中的重力无效。');
  }

  const importedRopes = data.ropes.map((ropeData, ropeIndex) => {
    if (!ropeData || typeof ropeData !== 'object') {
      throw new Error(`第 ${ropeIndex + 1} 条绳索无效。`);
    }
    if (typeof ropeData.closed !== 'boolean') {
      throw new Error(`第 ${ropeIndex + 1} 条绳索的 closed 无效。`);
    }
    if (typeof ropeData.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(ropeData.color)) {
      throw new Error(`第 ${ropeIndex + 1} 条绳索的颜色无效。`);
    }
    const segmentLength = Number(ropeData.segmentLength);
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) {
      throw new Error(`第 ${ropeIndex + 1} 条绳索的 segmentLength 无效。`);
    }
    if (!Array.isArray(ropeData.points)) {
      throw new Error(`第 ${ropeIndex + 1} 条绳索缺少 points。`);
    }
    const minimumPoints = ropeData.closed ? 8 : 4;
    if (ropeData.points.length < minimumPoints) {
      throw new Error(`第 ${ropeIndex + 1} 条绳索的点数不足。`);
    }
    const points = ropeData.points.map((point, pointIndex) => {
      if (!Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(Number(value)))) {
        throw new Error(`第 ${ropeIndex + 1} 条绳索的第 ${pointIndex + 1} 个点无效。`);
      }
      return [Number(point[0]), Number(point[1]), Number(point[2])];
    });
    const pinned = ropeData.closed
      ? []
      : (Array.isArray(ropeData.pinned) && ropeData.pinned.length === 2
        ? ropeData.pinned.map(Boolean)
        : [false, false]);

    return { closed: ropeData.closed, color: ropeData.color, segmentLength, pinned, points };
  });

  return {
    radius,
    gravity,
    activeRope: Number.isInteger(data.activeRope) ? data.activeRope : -1,
    ropes: importedRopes
  };
}

function importTangleText(text) {
  const data = parseTangleText(text);
  const newRopes = data.ropes.map((ropeData, index) => {
    const count = ropeData.points.length;
    const rope = new Rope({
      count,
      radius: data.radius,
      closed: ropeData.closed,
      color: new THREE.Color(ropeData.color),
      layoutIndex: index
    });
    const positions = new Float32Array(count * 3);
    ropeData.points.forEach((point, pointIndex) => {
      positions[pointIndex * 3] = point[0];
      positions[pointIndex * 3 + 1] = point[1];
      positions[pointIndex * 3 + 2] = point[2];
    });
    rope.pinned = ropeData.pinned;
    rope.setCenterline(positions, ropeData.segmentLength);
    return rope;
  });

  clearRopes();
  ropes = newRopes;
  ropes.forEach(rope => scene.add(rope.mesh));
  radiusInput.value = data.radius;
  gravityInput.value = data.gravity;
  radiusInput.dispatchEvent(new Event('input'));
  gravityInput.dispatchEvent(new Event('input'));
  setActiveRope(data.activeRope);
  setStatus(`已读取 ${ropes.length} 条绳索。`);
}

function makeRopeFromPositions(positions, segmentRest, radius, color, layoutIndex, pinned = [false, false]) {
  const count = positions.length / 3;
  const rope = new Rope({ count, radius, closed: false, color, layoutIndex });
  rope.pinned = pinned;
  rope.setCenterline(positions, segmentRest);
  return rope;
}

function replaceRope(index, newRopes) {
  const old = ropes[index];
  scene.remove(old.mesh);
  old.dispose();
  ropes.splice(index, 1, ...newRopes);
  newRopes.forEach(rope => scene.add(rope.mesh));
  setActiveRope(index);
}

function endpointThreshold(rope) {
  return rope.radius * 4 + rope.segmentRest;
}

function glueRopeEnds(ropeIndex, endpointIndex) {
  const rope = ropes[ropeIndex];
  if (!rope || rope.closed) return;
  if (rope.point(0).distanceTo(rope.point(rope.count - 1)) > endpointThreshold(rope)) {
    setStatus('两端距离太远；请先用选择 / 拖动工具把它们拉近。');
    return;
  }
  if (rope.closeLoop()) {
    setActiveRope(ropeIndex);
    setStatus('线绳两端已粘接成闭合圈。');
  }
}

function reverseVector3Array(array) {
  const reversed = array.slice();
  for (let i = 0, j = array.length - 3; i < j; i += 3, j -= 3) {
    for (let component = 0; component < 3; component++) {
      reversed[i + component] = array[j + component];
      reversed[j + component] = array[i + component];
    }
  }
  return reversed;
}

function orientedRopePositions(rope, endpointIndex, asEnd) {
  const positions = Float32Array.from(rope.positions);
  const isStart = endpointIndex === 0;
  if ((isStart && asEnd) || (!isStart && !asEnd)) return reverseVector3Array(positions);
  return positions;
}

function glueTwoRopes(first, second) {
  const ropeA = ropes[first.ropeIndex];
  const ropeB = ropes[second.ropeIndex];
  const joined = ropeA.point(first.endpointIndex).add(ropeB.point(second.endpointIndex)).multiplyScalar(.5);
  const positionsA = orientedRopePositions(ropeA, first.endpointIndex, true);
  const positionsB = orientedRopePositions(ropeB, second.endpointIndex, false);
  positionsA[positionsA.length - 3] = joined.x;
  positionsA[positionsA.length - 2] = joined.y;
  positionsA[positionsA.length - 1] = joined.z;
  const positions = new Float32Array((ropeA.count + ropeB.count - 1) * 3);
  positions.set(positionsA);
  positions.set(positionsB.subarray(3), positionsA.length);
  const edgeCountA = ropeA.count - 1;
  const edgeCountB = ropeB.count - 1;
  const segmentRest = (ropeA.segmentRest * edgeCountA + ropeB.segmentRest * edgeCountB) / (edgeCountA + edgeCountB);
  const radius = (ropeA.radius + ropeB.radius) / 2;
  const oppositeA = first.endpointIndex === 0 ? 1 : 0;
  const oppositeB = second.endpointIndex === 0 ? 1 : 0;
  const pinned = [ropeA.pinned[oppositeA], ropeB.pinned[oppositeB]];
  const insertIndex = Math.min(first.ropeIndex, second.ropeIndex);
  const newRope = makeRopeFromPositions(positions, segmentRest, radius, ropeA.color, insertIndex, pinned);
  newRope.id = ropeA.id;
  const highIndex = Math.max(first.ropeIndex, second.ropeIndex);
  const lowIndex = Math.min(first.ropeIndex, second.ropeIndex);
  scene.remove(ropes[highIndex].mesh);
  ropes[highIndex].dispose();
  ropes.splice(highIndex, 1);
  scene.remove(ropes[lowIndex].mesh);
  ropes[lowIndex].dispose();
  ropes.splice(lowIndex, 1);
  ropes.splice(lowIndex, 0, newRope);
  scene.add(newRope.mesh);
  dragging = null;
  glueFirst = null;
  setActiveRope(lowIndex);
  setStatus('两条线绳已粘接成一条更长的线绳。');
}

function cutRopeAt(ropeIndex, nodeIndex) {
  const rope = ropes[ropeIndex];
  if (!rope || rope.count < 6) return;
  if (!rope.closed && (nodeIndex === 0 || nodeIndex === rope.count - 1)) {
    setStatus('线绳端点不能剪开；请点击中间。');
    return;
  }
  if (rope.closed) {
    const positions = new Float32Array((rope.count + 1) * 3);
    for (let i = 0; i <= rope.count; i++) {
      const source = (nodeIndex + i) % rope.count;
      positions.set(rope.positions.subarray(source * 3, source * 3 + 3), i * 3);
    }
    const newRope = makeRopeFromPositions(positions, rope.segmentRest, rope.radius, rope.color, ropeIndex);
    newRope.id = rope.id;
    replaceRope(ropeIndex, [newRope]);
    setStatus('圈绳已剪开成一条线绳。');
    return;
  }

  const firstPositions = rope.positions.slice(0, (nodeIndex + 1) * 3);
  const secondPositions = rope.positions.slice(nodeIndex * 3);
  const first = makeRopeFromPositions(firstPositions, rope.segmentRest, rope.radius, rope.color, ropeIndex, [rope.pinned[0], false]);
  const second = makeRopeFromPositions(secondPositions, rope.segmentRest, rope.radius, rope.color, ropeIndex, [false, rope.pinned[1]]);
  second.id = nextRopeId++;
  replaceRope(ropeIndex, [first, second]);
  setStatus('线绳已剪开成两条线绳。');
}

const endpointMarkers = [];
function updateMarkers() {
  const desired = [];
  ropes.forEach((rope, ropeIndex) => {
    if (rope.closed) return;
    for (let endpointIndex = 0; endpointIndex < 2; endpointIndex++) {
      desired.push({ rope, ropeIndex, endpointIndex });
    }
  });
  while (endpointMarkers.length < desired.length) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(.065, 20, 14),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: .95 })
    );
    scene.add(marker);
    endpointMarkers.push(marker);
  }
  endpointMarkers.forEach((marker, index) => {
    const item = desired[index];
    marker.visible = Boolean(item);
    if (!item) return;
    marker.userData.ropeIndex = item.ropeIndex;
    marker.userData.endpointIndex = item.endpointIndex;
    marker.position.copy(item.rope.point(item.endpointIndex ? item.rope.count - 1 : 0));
    const pinned = item.rope.pinned[item.endpointIndex];
    marker.material.color.set(pinned ? 0xffb347 : item.rope.color);
    if (glueFirst && glueFirst.ropeIndex === item.ropeIndex && glueFirst.endpointIndex === item.endpointIndex) {
      marker.material.color.set(0xffffff);
    }
  });
}

function updateStatus(text) {
  const rope = activeRope();
  const toolNames = {
    select: '选择 / 拖动',
    glue: '粘连',
    cut: '剪开',
    lengthen: '加长',
    pin: '插地',
    unpin: '拔起'
  };
  const hints = {
    select: '点击绳体或端点后拖动。',
    glue: '依次点击两个端点：同绳成圈，异绳接长。',
    cut: '点击绳体中间节点。',
    lengthen: '点击端点延伸一段，或点击绳体中间插入一段。',
    pin: '点击一个端点，把它固定在地面上。',
    unpin: '点击一个已固定的端点。'
  };
  let info = `当前工具：<b>${toolNames[activeTool]}</b> · ${hints[activeTool]}`;
  if (rope) {
    const endpointState = rope.closed ? '闭合圈' : `A ${rope.pinned[0] ? '固定' : '自由'} / B ${rope.pinned[1] ? '固定' : '自由'}`;
    info += `<br>选中：<b>#${rope.id} ${rope.closed ? '圈绳' : '线绳'}</b> · ${rope.count} 节点 · ${endpointState}`;
  }
  if (glueFirst) info += '<br>已选第一个端点，请点击另一个端点。';
  document.getElementById('status').innerHTML = text ? `${info}<br><b>${text}</b>` : info;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragPoint = new THREE.Vector3();
const dragOffset = new THREE.Vector3();

function setPointer(event) {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function endpointHit() {
  const hits = raycaster.intersectObjects(endpointMarkers.filter(marker => marker.visible));
  return hits.length ? hits[0].object.userData : null;
}

function ropeHit() {
  const hits = raycaster.intersectObjects(ropes.map(rope => rope.mesh));
  return hits.length ? { ropeIndex: hits[0].object.userData.ropeIndex, point: hits[0].point } : null;
}

function nearestNodeIndex(rope, point) {
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rope.count; i++) {
    const distance = rope.point(i).distanceToSquared(point);
    if (distance < best) {
      best = distance;
      index = i;
    }
  }
  return index;
}

function nearestSegment(rope, point) {
  const segmentCount = rope.closed ? rope.count : rope.count - 1;
  let best = { index: 0, point: rope.point(0), distance: Number.POSITIVE_INFINITY };
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % rope.count;
    const a = rope.point(i);
    const b = rope.point(next);
    const segment = b.clone().sub(a);
    const lengthSquared = segment.lengthSq() || 1e-12;
    const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(segment) / lengthSquared));
    const projected = a.clone().addScaledVector(segment, t);
    const distance = projected.distanceToSquared(point);
    if (distance < best.distance) best = { index: i, point: projected, distance };
  }
  return best;
}

function beginDrag(rope, index, side = null, pointerEvent = null) {
  dragging = { rope, index, side, target: rope.point(index).clone() };
  controls.enabled = false;
  dragPlane.setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new THREE.Vector3()).negate(),
    rope.point(index)
  );
  if (pointerEvent) setPointer(pointerEvent);
  raycaster.ray.intersectPlane(dragPlane, dragPoint);
  dragOffset.subVectors(rope.point(index), dragPoint);
}

canvas.addEventListener('pointerdown', event => {
  setPointer(event);
  if (event.button !== 0) return;
  const endpoint = endpointHit();

  if (activeTool !== 'select' && !endpoint && !ropeHit()) {
    setTool('select');
    return;
  }

  if (activeTool === 'select') {
    if (endpoint) {
      const rope = ropes[endpoint.ropeIndex];
      if (rope.pinned[endpoint.endpointIndex]) {
        setActiveRope(endpoint.ropeIndex);
        setStatus('该端点已固定；请先用「拔起」工具。');
        controls.enabled = false;
        return;
      }
      const index = endpoint.endpointIndex ? rope.count - 1 : 0;
      setActiveRope(endpoint.ropeIndex);
      beginDrag(rope, index, endpoint.endpointIndex, event);
      return;
    }
    const hit = ropeHit();
    if (hit) {
      const rope = ropes[hit.ropeIndex];
      const index = nearestNodeIndex(rope, hit.point);
      const isEndpoint = !rope.closed && (index === 0 || index === rope.count - 1);
      if (isEndpoint && rope.pinned[index === 0 ? 0 : 1]) {
        setActiveRope(hit.ropeIndex);
        setStatus('该端点已固定；请先用「拔起」工具。');
        controls.enabled = false;
        return;
      }
      setActiveRope(hit.ropeIndex);
      beginDrag(rope, index, isEndpoint ? (index === 0 ? 0 : 1) : null, event);
      return;
    }
  }

  if (activeTool === 'glue') {
    if (!endpoint) {
      setStatus('粘连工具只能点击端点。');
      return;
    }
    if (!glueFirst) {
      glueFirst = { ropeIndex: endpoint.ropeIndex, endpointIndex: endpoint.endpointIndex };
      updateMarkers();
      updateStatus('已选择第一个端点。');
      return;
    }
    const sameEndpoint = glueFirst.ropeIndex === endpoint.ropeIndex && glueFirst.endpointIndex === endpoint.endpointIndex;
    if (sameEndpoint) {
      glueFirst = null;
      updateMarkers();
      updateStatus();
      return;
    }
    if (glueFirst.ropeIndex === endpoint.ropeIndex) {
      glueRopeEnds(endpoint.ropeIndex, endpoint.endpointIndex);
      updateMarkers();
      return;
    }
    glueTwoRopes(glueFirst, { ropeIndex: endpoint.ropeIndex, endpointIndex: endpoint.endpointIndex });
    updateMarkers();
    return;
  }

  if (activeTool === 'cut') {
    const hit = ropeHit();
    if (!hit) return;
    cutRopeAt(hit.ropeIndex, nearestNodeIndex(ropes[hit.ropeIndex], hit.point));
    updateMarkers();
    return;
  }

  if (activeTool === 'lengthen') {
    if (endpoint) {
      const rope = ropes[endpoint.ropeIndex];
      rope.addAtEndpoint(endpoint.endpointIndex);
      setActiveRope(endpoint.ropeIndex);
      updateMarkers();
      setStatus('已在端部增加一段。');
      return;
    }
    const hit = ropeHit();
    if (!hit) return;
    const rope = ropes[hit.ropeIndex];
    const segment = nearestSegment(rope, hit.point);
    rope.insertAtSegment(segment.index, segment.point);
    setActiveRope(hit.ropeIndex);
    updateMarkers();
    setStatus('已在指定位置插入一段。');
    return;
  }

  if (activeTool === 'pin' || activeTool === 'unpin') {
    if (!endpoint) {
      setStatus(`${activeTool === 'pin' ? '插地' : '拔起'}工具只能点击端点。`);
      return;
    }
    const rope = ropes[endpoint.ropeIndex];
    const pinned = activeTool === 'pin';
    rope.pinned[endpoint.endpointIndex] = pinned;
    if (pinned) {
      const index = endpoint.endpointIndex ? rope.count - 1 : 0;
      const point = rope.point(index);
      point.y = rope.radius + .001;
      rope.setPoint(index, point);
      rope.previous.set([point.x, point.y, point.z], index * 3);
    }
    setActiveRope(endpoint.ropeIndex);
    updateMarkers();
    updateStatus(pinned ? '端点已固定在地面。' : '端点已拔起。');
    return;
  }
});

canvas.addEventListener('pointermove', event => {
  if (!dragging) return;
  setPointer(event);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const target = dragPoint.clone().add(dragOffset);
  target.y = Math.max(target.y, dragging.rope.radius + .003);
  dragging.target.copy(target);
  updateMarkers();
});

canvas.addEventListener('pointerup', event => {
  if (dragging) canvas.releasePointerCapture(event.pointerId);
  dragging = null;
  controls.enabled = true;
  updateStatus();
});

document.querySelectorAll('.tool[data-tool]').forEach(button => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

function setTool(tool) {
  activeTool = tool;
  glueFirst = null;
  document.querySelectorAll('.tool[data-tool]').forEach(button => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  updateMarkers();
  updateStatus();
}

document.getElementById('add-line').onclick = () => createRope(false);
document.getElementById('add-loop').onclick = () => createRope(true);
document.getElementById('delete-rope').onclick = deleteActiveRope;
document.getElementById('export-tangle').onclick = exportTangle;
const importFileInput = document.getElementById('import-file');
document.getElementById('import-tangle').onclick = () => importFileInput.click();
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  try {
    importTangleText(await file.text());
  } catch (error) {
    console.error(error);
    setStatus(`读取失败：${error.message}`);
  } finally {
    importFileInput.value = '';
  }
});
document.getElementById('reset-all')?.addEventListener('click', resetAll);

const radiusInput = document.getElementById('radius');
const gravityRow = document.createElement('div');
gravityRow.className = 'row';
gravityRow.innerHTML = '<label>重力</label><input id=gravity type=range min=0 max=9.8 step=0.1 value=0><output id=gravity-out>0.0</output>';
radiusInput.closest('.row').after(gravityRow);
const gravityInput = document.getElementById('gravity');

function bindRange(id, format = value => value.toFixed(3), onChange = null) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-out`);
  const update = () => output.textContent = format(parseFloat(input.value));
  input.addEventListener('input', () => {
    update();
    onChange?.(parseFloat(input.value));
  });
  update();
  return input;
}

bindRange('radius', value => value.toFixed(3), value => {
  ropes.forEach(rope => {
    rope.radius = value;
    for (let i = 0; i < rope.count; i++) {
      const point = rope.point(i);
      point.y = Math.max(point.y, rope.radius + .004);
      rope.setPoint(i, point);
    }
    rope.updateGeometry();
  });
  updateMarkers();
});
bindRange('gravity', value => value.toFixed(1));

const settingsOverlay = document.getElementById('settings-overlay');
document.getElementById('open-settings').onclick = () => settingsOverlay.classList.remove('hidden');
document.getElementById('close-settings').onclick = () => settingsOverlay.classList.add('hidden');
settingsOverlay.addEventListener('click', event => {
  if (event.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});

const fixedStepSize = 1 / 300;
const solverIterations = 3;
const maxStepsPerFrame = 12;
let simulationAccumulator = 0;
const clock = new THREE.Clock();

function closestPointParameters(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const abX = bx - ax, abY = by - ay, abZ = bz - az;
  const cdX = dx - cx, cdY = dy - cy, cdZ = dz - cz;
  const acX = cx - ax, acY = cy - ay, acZ = cz - az;
  const abLenSq = abX * abX + abY * abY + abZ * abZ || 1e-12;
  const cdLenSq = cdX * cdX + cdY * cdY + cdZ * cdZ || 1e-12;
  const abDotCd = abX * cdX + abY * cdY + abZ * cdZ;
  const abDotAc = abX * acX + abY * acY + abZ * acZ;
  const cdDotAc = cdX * acX + cdY * acY + cdZ * acZ;
  const denominator = abLenSq * cdLenSq - abDotCd * abDotCd;
  let s = denominator > 1e-12
    ? (abDotAc * cdLenSq - cdDotAc * abDotCd) / denominator
    : abDotAc / abLenSq;
  s = Math.max(0, Math.min(1, s));
  let t = cdLenSq > 1e-12 ? (s * abDotCd - cdDotAc) / cdLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  if (denominator <= 1e-12) {
    s = Math.max(0, Math.min(1, abDotAc / abLenSq));
    t = 0;
  }
  return { s, t };
}

function nodeWeight(rope, index) {
  if (dragging && dragging.rope === rope && index === dragging.index) return 0;
  if (!rope.closed) {
    if (rope.pinned[0] && index === 0) return 0;
    if (rope.pinned[1] && index === rope.count - 1) return 0;
  }
  return 1;
}

function integrateRope(rope, stepDt) {
  const positions = rope.positions;
  const previous = rope.previous;
  const dampingFactor = Math.exp(-PHYSICS.damping * 8 * stepDt);
  const gravity = parseFloat(gravityInput.value);
  for (let i = 0; i < rope.count; i++) {
    const i3 = i * 3;
    const x = positions[i3];
    const y = positions[i3 + 1];
    const z = positions[i3 + 2];
    if (nodeWeight(rope, i) === 0) {
      let nextX = x;
      let nextY = y;
      let nextZ = z;
      if (dragging && dragging.rope === rope && i === dragging.index && dragging.target) {
        const dx = dragging.target.x - x;
        const dy = dragging.target.y - y;
        const dz = dragging.target.z - z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const maxStep = MAX_DRAG_SPEED * stepDt;
        if (distance > maxStep && distance > 1e-12) {
          const scale = maxStep / distance;
          nextX = x + dx * scale;
          nextY = y + dy * scale;
          nextZ = z + dz * scale;
        } else {
          nextX = dragging.target.x;
          nextY = dragging.target.y;
          nextZ = dragging.target.z;
        }
        nextY = Math.max(nextY, rope.radius + .003);
      }
      previous[i3] = x;
      previous[i3 + 1] = y;
      previous[i3 + 2] = z;
      positions[i3] = nextX;
      positions[i3 + 1] = nextY;
      positions[i3 + 2] = nextZ;
      continue;
    }
    const vx = (x - previous[i3]) / stepDt * dampingFactor;
    const vy = (y - previous[i3 + 1]) / stepDt * dampingFactor - gravity * stepDt;
    const vz = (z - previous[i3 + 2]) / stepDt * dampingFactor;
    previous[i3] = x;
    previous[i3 + 1] = y;
    previous[i3 + 2] = z;
    positions[i3] = x + vx * stepDt;
    positions[i3 + 1] = y + vy * stepDt;
    positions[i3 + 2] = z + vz * stepDt;
  }
}

function solveSpringConstraints(rope, stiffness) {
  const positions = rope.positions;
  const segmentCount = rope.closed ? rope.count : rope.count - 1;
  for (let i = 0; i < segmentCount; i++) {
    const next = (i + 1) % rope.count;
    const a = i * 3;
    const b = next * 3;
    const weightA = nodeWeight(rope, i);
    const weightB = nodeWeight(rope, next);
    const weightSum = weightA + weightB;
    if (!weightSum) continue;
    const dx = positions[b] - positions[a];
    const dy = positions[b + 1] - positions[a + 1];
    const dz = positions[b + 2] - positions[a + 2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8;
    const correction = (distance - rope.segmentRest) / distance * stiffness / weightSum;
    positions[a] += dx * correction * weightA;
    positions[a + 1] += dy * correction * weightA;
    positions[a + 2] += dz * correction * weightA;
    positions[b] -= dx * correction * weightB;
    positions[b + 1] -= dy * correction * weightB;
    positions[b + 2] -= dz * correction * weightB;
  }
}

function forEachBendJoint(rope, callback) {
  const jointCount = rope.closed ? rope.count : rope.count - 1;
  for (let item = 0; item < jointCount; item++) {
    const joint = rope.closed ? item : item + 1;
    const indexA = (joint - 1 + rope.count) % rope.count;
    const indexC = (joint + 1) % rope.count;
    callback(indexA, joint, indexC);
  }
}

function solveBendConstraints(rope, stiffness) {
  if (stiffness <= 0) return;
  const positions = rope.positions;
  const straightLength = rope.segmentRest * 2;
  forEachBendJoint(rope, (indexA, joint, indexC) => {
    const a = indexA * 3;
    const c = indexC * 3;
    const weightA = nodeWeight(rope, indexA);
    const weightC = nodeWeight(rope, indexC);
    const weightSum = weightA + weightC;
    if (!weightSum) return;
    const dx = positions[c] - positions[a];
    const dy = positions[c + 1] - positions[a + 1];
    const dz = positions[c + 2] - positions[a + 2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8;
    if (distance >= straightLength) return;
    const correction = (distance - straightLength) / distance * stiffness / weightSum;
    positions[a] += dx * correction * weightA;
    positions[a + 1] += dy * correction * weightA;
    positions[a + 2] += dz * correction * weightA;
    positions[c] -= dx * correction * weightC;
    positions[c + 1] -= dy * correction * weightC;
    positions[c + 2] -= dz * correction * weightC;
  });
}

function solveMinimumBendConstraints(rope) {
  const positions = rope.positions;
  const minBendRadius = Math.max(rope.radius * 1.25, rope.segmentRest * .75);
  const ratio = Math.min(1, rope.segmentRest / (2 * minBendRadius));
  const maxTurnAngle = 2 * Math.asin(ratio);
  const minChordLength = 2 * rope.segmentRest * Math.cos(maxTurnAngle / 2);
  forEachBendJoint(rope, (indexA, joint, indexC) => {
    const a = indexA * 3;
    const c = indexC * 3;
    const weightA = nodeWeight(rope, indexA);
    const weightC = nodeWeight(rope, indexC);
    const weightSum = weightA + weightC;
    if (!weightSum) return;
    const dx = positions[c] - positions[a];
    const dy = positions[c + 1] - positions[a + 1];
    const dz = positions[c + 2] - positions[a + 2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-8;
    if (distance >= minChordLength) return;
    const correction = (distance - minChordLength) / distance * .85 / weightSum;
    positions[a] += dx * correction * weightA;
    positions[a + 1] += dy * correction * weightA;
    positions[a + 2] += dz * correction * weightA;
    positions[c] -= dx * correction * weightC;
    positions[c + 1] -= dy * correction * weightC;
    positions[c + 2] -= dz * correction * weightC;
  });
}

function buildRepulsionPairs() {
  const segments = [];
  ropes.forEach(rope => {
    const segmentCount = rope.closed ? rope.count : rope.count - 1;
    const margin = rope.radius + .002;
    for (let i = 0; i < segmentCount; i++) {
      const j = (i + 1) % rope.count;
      const a = i * 3;
      const b = j * 3;
      segments.push({
        rope,
        index: i,
        x0: Math.min(rope.positions[a], rope.positions[b]) - margin,
        x1: Math.max(rope.positions[a], rope.positions[b]) + margin,
        y0: Math.min(rope.positions[a + 1], rope.positions[b + 1]) - margin,
        y1: Math.max(rope.positions[a + 1], rope.positions[b + 1]) + margin,
        z0: Math.min(rope.positions[a + 2], rope.positions[b + 2]) - margin,
        z1: Math.max(rope.positions[a + 2], rope.positions[b + 2]) + margin
      });
    }
  });
  segments.sort((left, right) => left.x0 - right.x0);

  const pairs = [];
  for (let first = 0; first < segments.length; first++) {
    const segmentA = segments[first];
    const ropeA = segmentA.rope;
    const i = segmentA.index;
    for (let second = first + 1; second < segments.length && segments[second].x0 <= segmentA.x1; second++) {
      const segmentB = segments[second];
      if (segmentB.y0 > segmentA.y1 || segmentA.y0 > segmentB.y1) continue;
      if (segmentB.z0 > segmentA.z1 || segmentA.z0 > segmentB.z1) continue;
      const ropeB = segmentB.rope;
      const k = segmentB.index;
      if (ropeA === ropeB) {
        let separation = Math.abs(i - k);
        if (ropeA.closed) separation = Math.min(separation, ropeA.count - separation);
        const skip = Math.max(1, Math.ceil((ropeA.radius * 2 + .004) / ropeA.segmentRest));
        if (separation <= skip) continue;
      }
      pairs.push({ a: segmentA, b: segmentB });
    }
  }
  return pairs;
}

function solveRepulsionConstraints(pairs, stiffness) {
  if (stiffness <= 0) return;
  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
    const segmentA = pairs[pairIndex].a;
    const segmentB = pairs[pairIndex].b;
    const ropeA = segmentA.rope;
    const ropeB = segmentB.rope;
    const i = segmentA.index;
    const j = (i + 1) % ropeA.count;
    const k = segmentB.index;
    const l = (k + 1) % ropeB.count;
    const a = i * 3;
    const b = j * 3;
    const c = k * 3;
    const d = l * 3;
    const positionsA = ropeA.positions;
    const positionsB = ropeB.positions;
    const { s, t } = closestPointParameters(
      positionsA[a], positionsA[a + 1], positionsA[a + 2],
      positionsA[b], positionsA[b + 1], positionsA[b + 2],
      positionsB[c], positionsB[c + 1], positionsB[c + 2],
      positionsB[d], positionsB[d + 1], positionsB[d + 2]
    );
    const contactAX = positionsA[a] + (positionsA[b] - positionsA[a]) * s;
    const contactAY = positionsA[a + 1] + (positionsA[b + 1] - positionsA[a + 1]) * s;
    const contactAZ = positionsA[a + 2] + (positionsA[b + 2] - positionsA[a + 2]) * s;
    const contactBX = positionsB[c] + (positionsB[d] - positionsB[c]) * t;
    const contactBY = positionsB[c + 1] + (positionsB[d + 1] - positionsB[c + 1]) * t;
    const contactBZ = positionsB[c + 2] + (positionsB[d + 2] - positionsB[c + 2]) * t;
    const dx = contactBX - contactAX;
    const dy = contactBY - contactAY;
    const dz = contactBZ - contactAZ;
    const minDistance = ropeA.radius + ropeB.radius + .004;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq >= minDistance * minDistance || distanceSq < 1e-14) continue;
    const distance = Math.sqrt(distanceSq);
    const overlap = Math.min(minDistance - distance, minDistance * .5);
    const scale = overlap / distance * stiffness * .5;
    const weightA0 = (1 - s) * nodeWeight(ropeA, i);
    const weightA1 = s * nodeWeight(ropeA, j);
    const weightB0 = (1 - t) * nodeWeight(ropeB, k);
    const weightB1 = t * nodeWeight(ropeB, l);
    positionsA[a] -= dx * scale * weightA0;
    positionsA[a + 1] -= dy * scale * weightA0;
    positionsA[a + 2] -= dz * scale * weightA0;
    positionsA[b] -= dx * scale * weightA1;
    positionsA[b + 1] -= dy * scale * weightA1;
    positionsA[b + 2] -= dz * scale * weightA1;
    positionsB[c] += dx * scale * weightB0;
    positionsB[c + 1] += dy * scale * weightB0;
    positionsB[c + 2] += dz * scale * weightB0;
    positionsB[d] += dx * scale * weightB1;
    positionsB[d + 1] += dy * scale * weightB1;
    positionsB[d + 2] += dz * scale * weightB1;
  }
}

function solveGroundConstraint(rope) {
  const positions = rope.positions;
  const previous = rope.previous;
  const floor = rope.radius + .001;
  const friction = 1 - PHYSICS.friction;
  for (let i = 0; i < rope.count; i++) {
    const i3 = i * 3;
    if (positions[i3 + 1] >= floor || nodeWeight(rope, i) === 0) continue;
    positions[i3 + 1] = floor;
    previous[i3 + 1] += (floor - previous[i3 + 1]) * friction;
  }
}

function simulateStep(stepDt) {
  const springStiffness = PHYSICS.spring;
  const bendStiffness = PHYSICS.bend;
  const repulsionStiffness = PHYSICS.repulsion;
  ropes.forEach(rope => integrateRope(rope, stepDt));
  const repulsionPairs = buildRepulsionPairs();
  for (let iteration = 0; iteration < solverIterations; iteration++) {
    ropes.forEach(rope => {
      solveSpringConstraints(rope, springStiffness);
      solveBendConstraints(rope, bendStiffness);
      solveMinimumBendConstraints(rope);
      solveGroundConstraint(rope);
    });
    solveRepulsionConstraints(repulsionPairs, repulsionStiffness);
  }
}

function simulate(dt) {
  simulationAccumulator += Math.min(dt, 1 / 20);
  let steps = 0;
  while (simulationAccumulator >= fixedStepSize && steps < maxStepsPerFrame) {
    simulateStep(fixedStepSize);
    simulationAccumulator -= fixedStepSize;
    steps++;
  }
  if (steps === maxStepsPerFrame) simulationAccumulator = 0;
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  simulate(dt);
  ropes.forEach(rope => rope.updateGeometry());
  updateMarkers();
  controls.update();
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

createRope(false);
setTool('select');
loop();

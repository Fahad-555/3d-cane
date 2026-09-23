import * as THREE from './three.module.js';
import { CAN, buildBodyGeometry } from './_m.mjs';
const g = buildBodyGeometry(CAN.radialSegments);
const pos = g.attributes.position, uv = g.attributes.uv;
// LatheGeometry: vertex = segIndex * points.length + j. So profile index j
// at the first angular segment is just vertex j.
const P = pos.count / (CAN.radialSegments + 1);
console.log('points/profile  ', P, '(want 84)   divisor', P - 1, '(want 83)');
const yAt = (j) => pos.getY(j);
const vAt = (j) => uv.getY(j);
const uAt = (j) => uv.getX(j);
const chk = (name, got, want, eps = 1e-6) =>
  console.log(name.padEnd(16), got.toFixed(6).padStart(10), ' want', String(want).padStart(10),
              Math.abs(got - want) < eps ? ' OK' : ' MISMATCH');
console.log('--- profile y at the band edges ---');
console.log('y[9]  =', yAt(9).toFixed(4), ' (bodyBot', CAN.bodyBot + ')');
console.log('y[10] =', yAt(10).toFixed(4), ' (first point of the straight run)');
console.log('y[69] =', yAt(69).toFixed(4), ' (bodyTop', CAN.bodyTop + ')');
console.log('y[70] =', yAt(70).toFixed(4), ' (neck starts)');
console.log('y[0]  =', yAt(0).toFixed(4), ' y[83] =', yAt(83).toFixed(4));
console.log('--- the contract ---');
chk('v[9]', vAt(9), CAN.bandVBot);
chk('v[69]', vAt(69), CAN.bandVTop);
console.log('--- monotonic? ---');
let mono = true;
for (let j = 1; j < P; j++) if (yAt(j) <= yAt(j - 1)) { mono = false; console.log('  flat/back at j =', j, yAt(j-1).toFixed(4), '->', yAt(j).toFixed(4)); }
console.log('y strictly increasing:', mono);
console.log('--- u wraps 0..1 ---');
console.log('u[0]', uAt(0).toFixed(4), ' u at last segment', uv.getX(P * CAN.radialSegments).toFixed(4));
const bb = new THREE.Box3().setFromBufferAttribute(pos);
console.log('bbox y', bb.min.y.toFixed(3), '..', bb.max.y.toFixed(3), ' h', (bb.max.y - bb.min.y).toFixed(3),
            ' w', (bb.max.x - bb.min.x).toFixed(3));

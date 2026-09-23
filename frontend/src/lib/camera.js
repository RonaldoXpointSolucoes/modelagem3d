import * as THREE from 'three';
import { viewerRef } from './viewerRef.js';
import { editor } from './editor.js';

/** Enquadra a câmera no modelo (tamanho real, sem reescalar — preserva as medidas do SketchUp). */
export function fitCamera(obj = editor.root) {
  const { camera, controls } = viewerRef;
  if (!obj || !camera) return;
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.1);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
  const dir = new THREE.Vector3(1, 0.7, 1.2).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(dist / 1000, 0.001);
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  if (controls) { controls.target.copy(center); controls.maxDistance = dist * 20; controls.minDistance = radius / 50; controls.update(); }
}


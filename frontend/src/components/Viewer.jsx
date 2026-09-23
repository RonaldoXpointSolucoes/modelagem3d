import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls, ContactShadows, useGLTF, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { viewerRef } from '../lib/viewerRef.js';


function Capture() {
  const { gl, scene, camera, controls } = useThree();
  useEffect(() => { Object.assign(viewerRef, { gl, scene, camera, controls }); }, [gl, scene, camera, controls]);
  return null;
}

/** Normaliza o modelo: maior dimensão = 2 m, apoiado no chão, centralizado. */
function useNormalized(scene) {
  return useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z, 1e-6);
    root.scale.setScalar(s);
    const b2 = new THREE.Box3().setFromObject(root);
    const c = b2.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -b2.min.y, -c.z);
    const g = new THREE.Group(); g.add(root);
    return g;
  }, [scene]);
}

function Model({ url }) {
  const { scene } = useGLTF(url);
  const obj = useNormalized(scene);
  const selected = useStore((s) => s.selected);
  const tool = useStore((s) => s.tool);
  const set = useStore((s) => s.set);
  const ref = useRef();
  return (
    <>
      <primitive ref={ref} object={obj} onClick={(e) => { e.stopPropagation(); set({ selected: true }); }} />
      {selected && ref.current && (
        <TransformControls object={ref.current} mode={tool} size={1.1} translationSnap={0.05} rotationSnap={Math.PI / 24} />
      )}
    </>
  );
}

function ActiveModel() {
  const activeId = useStore((s) => s.activeId);
  const project = useStore((s) => s.projects.find((p) => p.$id === s.activeId));
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setUrl(null); setErr(null);
    if (!activeId || project?.status !== 'pronto') return;
    let u, off = false;
    api.file(activeId, 'glb').then((b) => { if (off) return; u = URL.createObjectURL(b); setUrl(u + '#.glb'); }).catch((e) => setErr(e.message));
    return () => { off = true; if (u) URL.revokeObjectURL(u); };
  }, [activeId, project?.status]);
  if (err) return <Html center><div className="glass pill">Erro ao carregar: {err}</div></Html>;
  if (!url) return null;
  return <Model url={url} key={url} />;
}

export default function Viewer() {
  const set = useStore((s) => s.set);
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4, 3, 5], fov: 45, near: 0.05, far: 500 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onPointerMissed={() => set({ selected: false })}
      >
        <color attach="background" args={['#0b0d12']} />
        <fog attach="fog" args={['#0b0d12', 18, 60]} />
        <hemisphereLight args={['#dfe7ff', '#1a1d26', 0.7]} />
        <directionalLight position={[6, 10, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}>
          <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.1, 40]} />
        </directionalLight>
        <directionalLight position={[-5, 4, -6]} intensity={0.5} />
        <Grid
          infiniteGrid cellSize={0.25} sectionSize={1} fadeDistance={40} fadeStrength={1.5}
          cellColor="#2a3040" sectionColor="#3d4a6b" cellThickness={0.6} sectionThickness={1.1}
        />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={12} blur={2.2} far={4} />
        <Suspense fallback={<Html center><div className="glass pill">Carregando modelo…</div></Html>}>
          <ActiveModel />
        </Suspense>
        {/* 1 dedo gira, pinça = zoom, 2 dedos = pan */}
        <OrbitControls
          makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.495} minDistance={0.5} maxDistance={60}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        <GizmoHelper alignment="bottom-right" margin={[64, 150]}>
          <GizmoViewport axisColors={['#ff5a6a', '#34d399', '#6c8cff']} labelColor="#0b0d12" />
        </GizmoHelper>
        <Capture />
      </Canvas>
    </div>
  );
}

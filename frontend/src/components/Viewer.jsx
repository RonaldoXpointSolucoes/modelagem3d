import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls, ContactShadows, Html, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { viewerRef } from '../lib/viewerRef.js';
import { editor, loadGLB, unload, pick, select, enterGroup, beginTransform, endTransform } from '../lib/editor.js';
import { fitCamera } from '../lib/camera.js';

function Capture() {
  const { gl, scene, camera, controls } = useThree();
  useEffect(() => { Object.assign(viewerRef, { gl, scene, camera, controls }); }, [gl, scene, camera, controls]);
  return null;
}

/** Contorno da peça selecionada */
function SelectionBox() {
  const ref = useRef();
  const selected = useStore((s) => s.selected);
  useFrame(() => {
    const b = ref.current;
    if (!b) return;
    if (editor.selected) { b.setFromObject(editor.selected); b.visible = true; } else b.visible = false;
  });
  return <boxHelper ref={ref} args={[undefined, '#6c8cff']} visible={selected} />;
}

function Gizmo() {
  const selected = useStore((s) => s.selected);
  const selectedName = useStore((s) => s.selectedName);
  const tool = useStore((s) => s.tool);
  const [obj, setObj] = useState(null);
  useEffect(() => { setObj(selected ? editor.selected : null); }, [selected, selectedName]);
  if (!obj) return null;
  return (
    <TransformControls
      object={obj} mode={tool} size={0.9} space="local"
      onMouseDown={beginTransform} onMouseUp={endTransform}
    />
  );
}

function ActiveModel() {
  const activeId = useStore((s) => s.activeId);
  const project = useStore((s) => s.projects.find((p) => p.$id === s.activeId));
  const [root, setRoot] = useState(null);
  const [err, setErr] = useState(null);
  const lastTap = useRef(0);

  useEffect(() => {
    setRoot(null); setErr(null); unload();
    if (!activeId || project?.status !== 'pronto') return;
    let off = false;
    api.file(activeId, 'glb')
      .then((b) => b.arrayBuffer())
      .then(loadGLB)
      .then((r) => { if (!off) { setRoot(r); requestAnimationFrame(() => fitCamera(r)); } })
      .catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [activeId, project?.status]);

  if (err) return <Html center><div className="glass pill">Erro ao carregar: {err}</div></Html>;
  if (!root) return project?.status === 'pronto' ? <Html center><div className="glass pill">Carregando modelo…</div></Html> : null;

  const onClick = (e) => {
    e.stopPropagation();
    const now = performance.now();
    const dbl = now - lastTap.current < 320;
    lastTap.current = now;
    pick(e.object);
    if (dbl && enterGroup()) useStore.getState().showToast('Dentro do grupo — toque em ← para sair');
  };
  return <primitive object={root} onClick={onClick} />;
}

export default function Viewer() {
  return (
    <div className="canvas-wrap">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [4, 3, 5], fov: 45, near: 0.01, far: 2000 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onPointerMissed={(e) => { if (e.type === 'click') select(null); }}
      >
        <color attach="background" args={['#0b0d12']} />
        <hemisphereLight args={['#dfe7ff', '#1a1d26', 0.9]} />
        <directionalLight position={[6, 10, 4]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}>
          <orthographicCamera attach="shadow-camera" args={[-10, 10, 10, -10, 0.1, 60]} />
        </directionalLight>
        <directionalLight position={[-5, 4, -6]} intensity={0.6} />
        <Grid
          infiniteGrid cellSize={0.1} sectionSize={1} fadeDistance={60} fadeStrength={1.5}
          cellColor="#232a3a" sectionColor="#3d4a6b" cellThickness={0.5} sectionThickness={1.1}
        />
        <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={20} blur={2.2} far={6} />
        <Suspense fallback={null}>
          <ActiveModel />
        </Suspense>
        <SelectionBox />
        <Gizmo />
        {/* 1 dedo gira, pinça = zoom, 2 dedos = pan */}
        <OrbitControls
          makeDefault enableDamping dampingFactor={0.08}
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

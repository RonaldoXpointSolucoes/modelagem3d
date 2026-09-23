import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, TransformControls, ContactShadows, Html, GizmoHelper, GizmoViewport, AdaptiveDpr } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { viewerRef } from '../lib/viewerRef.js';
import { editor, loadGLB, unload, pick, select, enterGroup, beginTransform, endTransform, transformChanged } from '../lib/editor.js';
import { display, pickAt, selectionBox, hide } from '../lib/display.js';
import { fitCamera } from '../lib/camera.js';
import { useViewTick } from '../lib/viewTools.js';

function Capture() {
  const { gl, scene, camera, controls, invalidate } = useThree();
  useEffect(() => {
    Object.assign(viewerRef, { gl, scene, camera, controls, invalidate });
    display.invalidate = () => invalidate();
    gl.localClippingEnabled = true;
  }, [gl, scene, camera, controls, invalidate]);
  return null;
}

/** Contorno da peça selecionada (recalculado só quando a cena muda, não a cada quadro). */
function SelectionBox() {
  const ref = useRef();
  const box = useRef(new THREE.Box3());
  const tick = useViewTick((s) => s.tick);
  useEffect(() => {
    const b = ref.current;
    if (!b) return;
    const bb = selectionBox(box.current);
    if (bb && !bb.isEmpty()) { b.box.copy(bb); b.visible = true; } else b.visible = false;
  }, [tick]);
  return <box3Helper ref={ref} args={[new THREE.Box3(), '#6c8cff']} visible={false} />;
}

function Gizmo() {
  const selected = useStore((s) => s.selected);
  const selectedName = useStore((s) => s.selectedName);
  const tool = useStore((s) => s.tool);
  const exploded = useStore((s) => s.view.explode > 0);
  const [obj, setObj] = useState(null);
  useEffect(() => { setObj(selected && !exploded ? editor.selected : null); }, [selected, selectedName, exploded]);
  if (!obj) return null;
  return (
    <TransformControls
      object={obj} mode={tool} size={0.9} space="local"
      onMouseDown={beginTransform} onMouseUp={endTransform} onObjectChange={transformChanged}
    />
  );
}

/** Clique/toque rápido sem arrastar = selecionar (ou ocultar, no modo borracha). */
function PointerPicking() {
  const { gl, camera } = useThree();
  const lastTap = useRef(0);
  useEffect(() => {
    const el = gl.domElement;
    let down = null;
    const onDown = (e) => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e) => {
      if (!down || !e.isPrimary) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 400;
      down = null;
      if (moved > 6 || !quick || !editor.root) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const hit = pickAt(ndc, camera);
      const st = useStore.getState();
      if (!hit) { select(null); return; }
      if (st.view.eraser) {
        // oculta a peça do nível atual que contém o ponto tocado
        let o = hit; while (o && o.parent !== editor.level) o = o.parent;
        hide(o || hit);
        return;
      }
      const now = performance.now();
      const dbl = now - lastTap.current < 320;
      lastTap.current = now;
      pick(hit);
      if (dbl && enterGroup()) st.showToast('Dentro do grupo — toque em ← para sair');
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [gl, camera]);
  return null;
}

function ActiveModel() {
  const activeId = useStore((s) => s.activeId);
  const project = useStore((s) => s.projects.find((p) => p.$id === s.activeId));
  const [root, setRoot] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    setRoot(null); setErr(null); unload();
    if (!activeId || project?.status !== 'pronto') return;
    let off = false;
    setLoading('Baixando modelo…');
    api.file(activeId, 'glb', false, (mb) => !off && setLoading(`Baixando modelo… ${mb.toFixed(0)} MB`))
      .then((b) => b.arrayBuffer())
      .then((buf) => { if (!off) setLoading('Preparando peças…'); return new Promise((r) => setTimeout(() => r(buf), 30)); })
      .then(loadGLB)
      .then((r) => {
        if (off) return;
        setRoot(r); setLoading(null);
        requestAnimationFrame(() => { fitCamera(r); invalidate(); useStore.getState().bumpShadow(); });
      })
      .catch((e) => { if (!off) { setErr(e.message); setLoading(null); } });
    return () => { off = true; };
  }, [activeId, project?.status]);

  if (err) return <Html center><div className="glass pill">Erro ao carregar: {err}</div></Html>;
  if (!root) return loading ? <Html center><div className="glass pill">{loading}</div></Html> : null;
  return (
    <>
      <primitive object={root} />
      <primitive object={display.group} />
    </>
  );
}

function Shadows() {
  const k = useStore((s) => s.shadowKey);
  const b = display.bounds;
  if (!display.root || b.isEmpty()) return null;
  const size = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const scale = Math.max(size.x, size.z) * 1.6 + 0.5;
  // sombra de contato renderizada uma vez (e refeita quando o modelo muda), não a cada quadro
  return <ContactShadows key={k} frames={1} position={[c.x, b.min.y + 0.001, c.z]} opacity={0.45} scale={scale} blur={2.2} far={Math.max(size.y, 1)} resolution={1024} />;
}

export default function Viewer() {
  return (
    <div className="canvas-wrap">
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        performance={{ min: 0.5, debounce: 250 }}
        camera={{ position: [4, 3, 5], fov: 45, near: 0.01, far: 2000 }}
        gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      >
        <color attach="background" args={['#0b0d12']} />
        <hemisphereLight args={['#dfe7ff', '#1a1d26', 1.1]} />
        <directionalLight position={[6, 10, 4]} intensity={2} />
        <directionalLight position={[-5, 4, -6]} intensity={0.7} />
        <Grid
          infiniteGrid cellSize={0.1} sectionSize={1} fadeDistance={60} fadeStrength={1.5}
          cellColor="#232a3a" sectionColor="#3d4a6b" cellThickness={0.5} sectionThickness={1.1}
        />
        <Shadows />
        <Suspense fallback={null}>
          <ActiveModel />
        </Suspense>
        <SelectionBox />
        <Gizmo />
        <PointerPicking />
        {/* 1 dedo gira, pinça = zoom, 2 dedos = pan; durante o giro a resolução baixa um pouco (regress) */}
        <OrbitControls
          makeDefault enableDamping dampingFactor={0.12} regress
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        <AdaptiveDpr />
        <GizmoHelper alignment="bottom-right" margin={[64, 150]}>
          <GizmoViewport axisColors={['#ff5a6a', '#34d399', '#6c8cff']} labelColor="#0b0d12" />
        </GizmoHelper>
        <Capture />
      </Canvas>
    </div>
  );
}

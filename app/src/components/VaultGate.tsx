'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Vault gate: payments fly through a copper ring; every fourth is an attacker
// payment that is stopped, flashes the ring red and falls away.
type Payment = { x: number; y: number; z: number; bad: boolean; phase: 'fly' | 'denied'; vy: number; spin: number; mesh: THREE.Mesh };

const CENTRE: [number, number, number] = [1.4, 0.3, 0];

export default function VaultGate({ offset = CENTRE }: { offset?: [number, number, number] }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0806');
    scene.fog = new THREE.Fog('#0a0806', 7, 16);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(-3.2, 1.4, 6.2);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight('#ffffff', 0.4));
    const key = new THREE.PointLight('#ffcf9f', 30); key.position.set(0, 2, 3); scene.add(key);
    const rim = new THREE.PointLight('#d9773f', 14); rim.position.set(3, -1, -2); scene.add(rim);

    const world = new THREE.Group(); world.position.set(...offset); scene.add(world);
    const gate = new THREE.Group(); gate.rotation.y = Math.PI / 2; world.add(gate);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#d9773f', metalness: 0.9, roughness: 0.25, emissive: '#5a2a0c', emissiveIntensity: 0.8 });
    gate.add(new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.09, 24, 120), ringMat));
    gate.add(new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.015, 8, 120), new THREE.MeshBasicMaterial({ color: '#5a4030' })));

    const good = new THREE.MeshStandardMaterial({ color: '#d9773f', metalness: 0.8, roughness: 0.3, emissive: '#3a1a08' });
    const bad = new THREE.MeshStandardMaterial({ color: '#8a2a20', metalness: 0.6, roughness: 0.4, emissive: '#2a0505' });
    const disc = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 40);
    const payments: Payment[] = Array.from({ length: 14 }, (_, i) => {
      const mesh = new THREE.Mesh(disc, i % 4 === 3 ? bad : good);
      mesh.rotation.z = Math.PI / 2;
      world.add(mesh);
      return { x: -9 - i * 1.6, y: Math.sin(i * 1.7) * 0.9, z: Math.cos(i * 2.3) * 0.6, bad: i % 4 === 3, phase: 'fly', vy: 0, spin: 0, mesh };
    });

    const red = new THREE.Color('#ff2a1a'), base = new THREE.Color('#5a2a0c');
    const clock = new THREE.Clock();
    let flash = 0, visible = false;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(el);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.position.z = width < 700 ? 9 : 6.2;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize); resize();

    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      for (const p of payments) {
        const m = p.mesh;
        if (p.phase === 'fly') {
          p.x += 2.2 * dt;
          const pull = THREE.MathUtils.clamp((p.x + 4) / 4, 0, 1);
          m.position.set(p.x, THREE.MathUtils.lerp(p.y, 0, pull), THREE.MathUtils.lerp(p.z, 0, pull));
          if (p.bad && p.x > -0.45) { p.phase = 'denied'; p.vy = 1.5; flash = 1; }
        } else {
          p.x -= 1.2 * dt; p.vy -= 6 * dt; p.spin += 8 * dt;
          m.position.x = p.x; m.position.y += p.vy * dt; m.rotation.x = p.spin;
          if (m.position.y < -4) { p.phase = 'fly'; p.x = -12; p.spin = 0; m.rotation.x = 0; }
        }
        if (p.x > 9) p.x = -12;
      }
      ringMat.emissive.lerpColors(base, red, flash);
      ringMat.emissiveIntensity = 0.8 + flash * 2.5;
      flash = Math.max(0, flash - dt * 2.2);
      gate.position.y = Math.sin(clock.elapsedTime * 1.2) * 0.08;
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      io.disconnect();
      window.removeEventListener('resize', resize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [offset]);

  return <div id="gate-canvas" ref={host} />;
}

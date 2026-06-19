"use client";
/**
 * app/page.tsx — Velo402 Landing Page (Botanical Liquid Glass)
 *
 * Full-screen marketing landing page with:
 * - WebGL botanical shader background
 * - Three.js animated glass icosahedron
 * - Scroll-reveal sections
 * - Mouse parallax glass cards
 * - No sidebar (standalone layout)
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import "./landing.css";

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);

  // ── WebGL Botanical Shader ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function syncSize() {
      if (!canvas) return;
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(syncSize).observe(canvas);
    }
    syncSize();

    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return;

    const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

    const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
varying vec2 v_texCoord;

void main() {
    vec2 uv = v_texCoord;
    vec2 p = uv - 0.5;
    p.x *= u_resolution.x / u_resolution.y;
    
    float d = length(p);
    
    float v1 = sin(p.x * 2.0 + u_time * 0.5);
    float v2 = sin(p.y * 3.0 - u_time * 0.3);
    float v3 = sin(d * 10.0 - u_time * 1.0);
    
    float noise = v1 * v2 * v3;
    
    vec3 forest  = vec3(0.02, 0.17, 0.14);
    vec3 emerald = vec3(0.17, 0.35, 0.15);
    vec3 cream   = vec3(0.98, 0.98, 0.95);
    
    vec3 color = mix(forest, emerald, 0.5 + 0.5 * sin(u_time * 0.2 + d * 4.0));
    color = mix(color, cream, smoothstep(0.4, 1.2, noise + d));
    color *= 1.0 - smoothstep(0.4, 0.8, d);
    
    gl_FragColor = vec4(color, 1.0);
}`;

    function createShader(type: number, src: string) {
      const s = gl!.createShader(type)!;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");

    let animId: number;
    function render(t: number) {
      if (typeof ResizeObserver === "undefined") syncSize();
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      if (uTime) gl!.uniform1f(uTime, t * 0.001);
      if (uRes) gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      animId = requestAnimationFrame(render);
    }
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // ── Scroll reveal ────────────────────────────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("active");
          }
        });
      },
      { threshold: 0.1 },
    );
    document.querySelectorAll(".scroll-reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // ── Mouse parallax on glass cards ────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const cards = document.querySelectorAll<HTMLElement>(".glass-card-3d");
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      cards.forEach((card) => {
        card.style.transform = `perspective(1000px) rotateX(${y * 8}deg) rotateY(${-x * 8}deg) translateY(${y * -6}px)`;
      });
    };
    const handleMouseLeave = () => {
      const cards = document.querySelectorAll<HTMLElement>(".glass-card-3d");
      cards.forEach((card) => {
        card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)";
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <div className="landing-root">
      {/* ── Shader background ── */}
      <div className="shader-layer">
        <canvas ref={canvasRef} className="shader-canvas" />
      </div>

      {/* ── Top Nav ── */}
      <nav className="landing-nav">
        <div className="landing-nav-left">
          <span className="landing-brand">Velo402</span>
          <div className="landing-nav-links">
            <Link href="/dashboard" className="landing-nav-link active">Mission Control</Link>
            <Link href="/provision" className="landing-nav-link">Provision</Link>
            <Link href="/marketplace" className="landing-nav-link">Knowledge</Link>
            <Link href="/trading" className="landing-nav-link">Trading Desk</Link>
            <Link href="/guardian" className="landing-nav-link">Guardian</Link>
          </div>
        </div>
        <div className="landing-nav-right">
          <button className="landing-btn-ghost">Connect Wallet</button>
          <Link href="/kill-switch" className="landing-btn-kill">Kill Switch</Link>
        </div>
      </nav>

      {/* ── Main content ── */}
      <main className="landing-main">

        {/* ── Hero ── */}
        <section className="hero-section">
          <div className="hero-content">
            <h1 className="hero-title text-glow">
              The Agentic Standard for <br />
              <span style={{ color: "var(--primary)" }}>Autonomous Finance</span>
            </h1>
            <p className="hero-subtitle">
              Precision engineering meets natural stability. Velo402 orchestrates
              institutional liquidity through a botanical-inspired neural framework on Sui.
            </p>
            <div className="hero-cta">
              <Link href="/dashboard" className="btn-launch">
                Launch Application
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>rocket_launch</span>
              </Link>
              <a
                href="https://github.com/velo402"
                target="_blank"
                rel="noreferrer"
                className="btn-docs"
              >
                Read Docs
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>description</span>
              </a>
            </div>
          </div>

          {/* Three.js orb */}
          <div className="hero-orb-wrapper">
            <div className="hero-orb-bg" />
            <ThreeOrb />
            <div className="hero-orb-fade" />
          </div>
        </section>

        {/* ── Sovereign Intelligence ── */}
        <section className="section-sovereign">
          <div className="section-header">
            <div className="section-header-left">
              <h2 className="section-title">Sovereign Intelligence</h2>
              <p className="section-subtitle">
                Our autonomous agents navigate the complexities of decentralized markets
                with the efficiency of a high-speed trading desk and the resilience of a
                natural ecosystem.
              </p>
            </div>
            <div className="live-badge">
              <div className="pulse-dot-landing" />
              <span>Live Network Processing</span>
            </div>
          </div>

          <div className="feature-grid">
            {[
              {
                icon: "neurology",
                title: "Autonomous Provisioning",
                desc: "Dynamic liquidity reallocation based on volatility curves and cross-protocol yields. Agents optimize capital efficiency in real-time.",
                delay: 0,
              },
              {
                icon: "monitoring",
                title: "Knowledge Synthesis",
                desc: "On-chain data analysis fused with external market signals to predict protocol health and institutional liquidity flows.",
                delay: 150,
              },
              {
                icon: "hub",
                title: "Trading Desk Core",
                desc: "Execution engine designed for low-latency atomic swaps and complex arbitrage loops across the Sui ecosystem.",
                delay: 300,
              },
            ].map((feat) => (
              <div
                key={feat.title}
                className="feature-card glass-card-3d scroll-reveal"
                style={{ transitionDelay: `${feat.delay}ms` }}
              >
                <div className="feature-icon-wrap">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: "28px", color: "var(--primary)", fontVariationSettings: "'FILL' 1" }}
                  >
                    {feat.icon}
                  </span>
                </div>
                <h3 className="feature-title">{feat.title}</h3>
                <p className="feature-desc">{feat.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Ecosystem protocols ── */}
        <section className="protocols-section">
          <div className="protocols-inner">
            <span className="protocols-label">Integrated Ecosystem Protocols</span>
            <div className="protocols-row">
              {[
                { icon: "waves", name: "CETUS" },
                { icon: "sailing", name: "SCALLOP" },
                { icon: "book_5", name: "DEEPBOOK" },
                { icon: "blur_on", name: "WALRUS" },
                { icon: "lock", name: "SEAL" },
              ].map((p) => (
                <div key={p.name} className="protocol-item">
                  <div className="protocol-icon">
                    <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
                      {p.icon}
                    </span>
                  </div>
                  <span className="protocol-name">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Institutional Security ── */}
        <section className="security-section">
          <div className="security-grid">
            <div className="scroll-reveal">
              <h2 className="section-title">Institutional Security</h2>
              <p className="section-subtitle" style={{ marginBottom: "2rem" }}>
                Velo402 implements a multi-layered security mesh. The Guardian service
                monitors protocol invariants 24/7, while the hardware-level Kill Switch
                ensures immediate capital safety.
              </p>

              <div className="security-cards">
                <div className="security-card glass-card-3d">
                  <span className="material-symbols-outlined" style={{ fontSize: "32px", color: "var(--secondary)" }}>
                    shield_lock
                  </span>
                  <div>
                    <h4 className="security-card-title">Guardian Protocol</h4>
                    <p className="security-card-desc">
                      AI-monitored circuit breakers that trigger defensive posture shifts
                      during abnormal market conditions.
                    </p>
                  </div>
                </div>
                <div className="security-card glass-card-3d" style={{ borderColor: "rgba(255,180,171,0.15)" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "32px", color: "var(--error)" }}>
                    emergency_home
                  </span>
                  <div>
                    <h4 className="security-card-title">Omni Kill Switch</h4>
                    <p className="security-card-desc">
                      A non-custodial emergency egress mechanism allowing users to withdraw
                      all assets to cold storage in one transaction.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="security-visual scroll-reveal" style={{ transitionDelay: "200ms" }}>
              <div className="security-visual-glow" />
              <div className="security-visual-card glass-card-3d">
                <div className="security-visual-overlay" />
                {/* Synthetic visual instead of external image */}
                <div className="security-visual-content">
                  <div className="security-hex-ring">
                    {[...Array(6)].map((_, i) => (
                      <div
                        key={i}
                        className="security-hex"
                        style={{ animationDelay: `${i * 0.3}s` }}
                      />
                    ))}
                    <div className="security-hex-core">
                      <span className="material-symbols-outlined" style={{ fontSize: "40px", color: "var(--primary)", fontVariationSettings: "'FILL' 1" }}>
                        verified_user
                      </span>
                    </div>
                  </div>
                  <div className="security-visual-label">
                    <span className="protocols-label" style={{ marginBottom: "0.25rem", display: "block" }}>
                      Safety Architecture
                    </span>
                    <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--on-surface)" }}>
                      Velo Hardware Enclave
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="cta-section">
          <div className="cta-card glass-card-3d scroll-reveal">
            <h2 className="cta-title">
              Secure Your Autonomous <br />Financial Future.
            </h2>
            <div className="cta-buttons">
              <Link href="/dashboard" className="btn-launch" style={{ fontSize: "1.1rem", padding: "1rem 2.5rem" }}>
                Start Onboarding
              </Link>
              <button className="btn-docs" style={{ fontSize: "1.1rem", padding: "1rem 2.5rem" }}>
                Partner Inquiry
              </button>
            </div>
            <p className="cta-footnote">No Trust. Just Mathematics.</p>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-left">
          <span className="landing-footer-brand">Velo402</span>
          <span className="landing-footer-copy">
            © 2026 Velo402 · Sui Overflow Hackathon · Agentic Web Track
          </span>
        </div>
        <div className="landing-footer-links">
          {["Legal", "Privacy", "API Docs", "Status"].map((l) => (
            <a key={l} href="#" className="landing-footer-link">
              {l}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}

// ── Three.js Orb Component ────────────────────────────────────────────────────
function ThreeOrb() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Dynamically load Three.js
    const script = document.createElement("script");
    script.src = "https://ajax.googleapis.com/ajax/libs/threejs/r125/three.min.js";
    script.onload = () => {
      const THREE = (window as any).THREE;
      if (!THREE) return;

      const width = container.clientWidth || 500;
      const height = container.clientHeight || 500;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      camera.position.z = 5;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      // Outer glass shell
      const geometry = new THREE.IcosahedronGeometry(2, 4);
      const material = new THREE.MeshPhysicalMaterial({
        color: 0x88d4ab,
        metalness: 0.1,
        roughness: 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: 0.7,
        wireframe: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Inner core
      const coreGeom = new THREE.IcosahedronGeometry(1.2, 2);
      const coreMat = new THREE.MeshPhongMaterial({
        color: 0x2d5a27,
        shininess: 100,
        emissive: 0x062d24,
        flatShading: true,
      });
      const core = new THREE.Mesh(coreGeom, coreMat);
      scene.add(core);

      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const spotLight = new THREE.SpotLight(0xfcfaf2, 1);
      spotLight.position.set(10, 10, 10);
      scene.add(spotLight);

      let animId: number;
      function animate() {
        animId = requestAnimationFrame(animate);
        mesh.rotation.y += 0.005;
        mesh.rotation.x += 0.003;
        core.rotation.y -= 0.008;
        const scale = 1 + Math.sin(Date.now() * 0.001) * 0.05;
        mesh.scale.set(scale, scale, scale);
        renderer.render(scene, camera);
      }
      animate();

      const handleResize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener("resize", handleResize);

      return () => {
        cancelAnimationFrame(animId);
        window.removeEventListener("resize", handleResize);
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    };
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) document.head.removeChild(script);
    };
  }, []);

  return <div ref={containerRef} className="three-orb-container" />;
}

import { useEffect, useRef } from 'react';

export default function TerrainContourBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.animations === 'off') return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import('three').then((THREE) => {
      if (disposed || !containerRef.current) return;

      const host = containerRef.current;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(host.clientWidth, host.clientHeight);
      host.appendChild(renderer.domElement);

      const vertexShader = `
        varying vec2 vUv;
        varying float vElevation;

        vec2 hash(vec2 p) {
          p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
          return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
        }

        float noise(in vec2 p) {
          const float K1 = 0.366025404;
          const float K2 = 0.211324865;
          vec2 i = floor(p + (p.x + p.y) * K1);
          vec2 a = p - i + (i.x + i.y) * K2;
          float m = step(a.y, a.x);
          vec2 o = vec2(m, 1.0 - m);
          vec2 b = a - o + K2;
          vec2 c = a - 1.0 + 2.0 * K2;
          vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
          vec3 n = h * h * h * h * vec3(
            dot(a, hash(i + 0.0)),
            dot(b, hash(i + o)),
            dot(c, hash(i + 1.0))
          );
          return dot(n, vec3(70.0));
        }

        float fbm(vec2 p) {
          float f = 0.0;
          float w = 0.5;
          for (int i = 0; i < 4; i++) {
            f += w * noise(p);
            p *= 1.8;
            w *= 0.45;
          }
          return f;
        }

        uniform float uAmplitude;

        void main() {
          vUv = uv;
          float elevation = fbm(uv * 2.2) * uAmplitude;
          vElevation = elevation;
          vec3 newPos = position;
          newPos.z += elevation;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
        }
      `;

      const fragmentShader = `
        varying vec2 vUv;
        varying float vElevation;

        uniform float uDensity;
        uniform float uLineIntensity;
        uniform float uOpacity;
        uniform vec3 uBaseColor;
        uniform vec3 uLineColor;

        void main() {
          float phase = vElevation * uDensity;
          float f = abs(fract(phase) - 0.5);
          float line = smoothstep(0.42, 0.5, f);
          vec3 finalColor = mix(uBaseColor, uLineColor, line * uLineIntensity);
          float relief = smoothstep(-3.8, 3.8, vElevation);
          finalColor *= mix(0.84, 1.06, relief);
          float dist = distance(vUv, vec2(0.5));
          float vignette = smoothstep(0.72, 0.12, dist);
          gl_FragColor = vec4(finalColor, vignette * uOpacity);
        }
      `;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uDensity: { value: 8.5 },
          uAmplitude: { value: 10.5 },
          uLineIntensity: { value: 0.58 },
          uOpacity: { value: 0.45 },
          uBaseColor: { value: new THREE.Color('#f4f6f8') },
          uLineColor: { value: new THREE.Color('#a9b3bd') },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const geometry = new THREE.PlaneGeometry(92, 92, 110, 110);
      const terrain = new THREE.Mesh(geometry, material);
      terrain.rotation.x = -Math.PI / 2.55;
      terrain.position.set(0, -9.5, -5);
      scene.add(terrain);

      camera.position.set(0, 7.4, 17.5);
      camera.lookAt(0, -6.5, -3);

      let animationId = 0;
      let lastFrame = -Infinity;
      let mouseX = 0;
      let mouseY = 0;

      const onMouseMove = (event: MouseEvent) => {
        mouseX = event.clientX / Math.max(host.clientWidth, 1) - 0.5;
        mouseY = event.clientY / Math.max(host.clientHeight, 1) - 0.5;
      };

      const onResize = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };

      const animate = (frame: number) => {
        animationId = requestAnimationFrame(animate);
        if (frame - lastFrame < 1000 / 30 - 1) return;
        lastFrame = frame;
        const time = Date.now() * 0.00012;
        terrain.rotation.z = time * 0.2;
        terrain.rotation.x = -Math.PI / 2.55 + Math.sin(time * 0.5) * 0.035;
        terrain.rotation.y = Math.cos(time * 0.45) * 0.035;
        terrain.position.x = Math.sin(time * 0.6) * 1.2;
        terrain.position.z = -5 + Math.cos(time * 0.48) * 1.2;

        camera.position.x += (mouseX * 1.6 - camera.position.x) * 0.025;
        camera.position.y += (-mouseY * 1.2 + 7.4 - camera.position.y) * 0.025;
        camera.lookAt(0, -6.5, -3);
        renderer.render(scene, camera);
      };

      window.addEventListener('resize', onResize);
      const syncVisibility = () => {
        cancelAnimationFrame(animationId);
        if (!document.hidden) animationId = requestAnimationFrame(animate);
      };
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('visibilitychange', syncVisibility);
      syncVisibility();

      cleanup = () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('visibilitychange', syncVisibility);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }).catch(() => {
      // The surrounding CSS remains visible when WebGL is unavailable.
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true" />;
}

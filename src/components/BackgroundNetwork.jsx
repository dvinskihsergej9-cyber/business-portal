import { useEffect, useRef } from "react";

export default function BackgroundNetwork() {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const devicePixelRatio = window.devicePixelRatio || 1;

    function buildParticles() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const count = Math.min(190, Math.max(90, Math.floor((w * h) / 11000)));

      const cols = Math.max(1, Math.ceil(Math.sqrt((count * w) / h)));
      const rows = Math.max(1, Math.ceil(count / cols));
      const spacingX = w / cols;
      const spacingY = h / rows;
      const jitterX = spacingX * 0.34;
      const jitterY = spacingY * 0.34;
      const particles = [];

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (particles.length >= count) break;
          particles.push({
            x:
              col * spacingX +
              spacingX / 2 +
              (Math.random() * 2 - 1) * jitterX,
            y:
              row * spacingY +
              spacingY / 2 +
              (Math.random() * 2 - 1) * jitterY,
            vx: (Math.random() - 0.5) * 0.42,
            vy: (Math.random() - 0.5) * 0.42,
            radius: 1.7 + Math.random() * 1.5,
          });
        }
      }

      particlesRef.current = particles;
    }

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";

      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      buildParticles();
    }

    resize();
    window.addEventListener("resize", resize);

    function tick() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const particles = particlesRef.current;

      ctx.clearRect(0, 0, w, h);

      const maxDist = 215;

      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = 1 - dist / maxDist;
            ctx.strokeStyle = `rgba(59, 130, 246, ${alpha * 0.82})`;
            ctx.lineWidth = 1.05;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(37, 99, 235, 0.95)";
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      animationRef.current = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-network" />;
}

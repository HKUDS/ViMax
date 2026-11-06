"use client";

// ── Starfield Particle Backdrop (canvas, GSAP-ticker driven) ────────
// A particle field in three depth bands: soft-glow particles pre-rendered
// as sprite canvases (one drawImage per particle, no per-frame gradients),
// drifting slowly with depth-scaled speed, twinkling on independent
// phases, and parallaxing against the pointer. Rare shooting stars cross
// the upper field. Single static frame under prefers-reduced-motion.
// Pure decoration: aria-hidden, pointer-events-none.

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface Particle {
  x: number;
  y: number;
  depth: number; // 0.2 far .. 1 near
  radius: number; // sprite draw radius in px
  phase: number;
  twinkleSpeed: number;
  warm: boolean;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
}

const DRIFT_PX_PER_SEC = 3.5;
const PARALLAX_MAX = 18;
const SPRITE_SIZE = 48;

function makeGlowSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const sctx = sprite.getContext("2d")!;
  const half = SPRITE_SIZE / 2;
  const gradient = sctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.25, color);
  gradient.addColorStop(1, "transparent");
  sctx.globalAlpha = 1;
  sctx.fillStyle = gradient;
  sctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return sprite;
}

export function StarfieldBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Glow sprites: bright core + soft falloff, cool and warm variants.
    const sprites = {
      cool: makeGlowSprite("rgba(214, 222, 240, 1)"),
      warm: makeGlowSprite("rgba(240, 196, 130, 1)"),
    };

    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let nextMeteorAt = 4;
    let elapsed = 0;
    const meteors: Meteor[] = [];
    const parallax = { x: 0, y: 0 };
    const parallaxXTo = gsap.quickTo(parallax, "x", { duration: 1, ease: "power2.out" });
    const parallaxYTo = gsap.quickTo(parallax, "y", { duration: 1, ease: "power2.out" });

    const isDark = () =>
      (document.documentElement.getAttribute("data-theme") ?? "dark") !== "light";

    const seed = () => {
      const count = Math.round((width * height) / 7500);
      particles = Array.from({ length: count }, () => {
        const depth = gsap.utils.random(0.2, 1);
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          depth,
          radius: (0.7 + depth * 1.6) * (Math.random() < 0.05 ? 1.6 : 1),
          phase: Math.random() * Math.PI * 2,
          twinkleSpeed: gsap.utils.random(0.3, 1.4),
          warm: Math.random() < 0.2,
        };
      });
    };

    const spawnMeteor = () => {
      const fromLeft = Math.random() < 0.5;
      const speed = gsap.utils.random(500, 800);
      const angle = (fromLeft ? gsap.utils.random(20, 38) : gsap.utils.random(142, 160)) * (Math.PI / 180);
      meteors.push({
        x: fromLeft ? gsap.utils.random(-40, width * 0.35) : gsap.utils.random(width * 0.65, width + 40),
        y: gsap.utils.random(-30, height * 0.3),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.9,
        maxLife: 0.9,
      });
    };

    const draw = (dt: number) => {
      const dark = isDark();
      const baseAlpha = dark ? 1 : 0.4;
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        const twinkle = reduce ? 0.85 : 0.55 + 0.45 * Math.sin(elapsed * p.twinkleSpeed + p.phase);
        const size = p.radius * (0.9 + 0.1 * twinkle) * (4 + p.depth * 4);
        ctx.globalAlpha = (0.1 + p.depth * 0.38) * twinkle * baseAlpha;
        const px = p.x + parallax.x * p.depth * PARALLAX_MAX;
        const py = p.y + parallax.y * p.depth * PARALLAX_MAX;
        ctx.drawImage(
          p.warm ? sprites.warm : sprites.cool,
          px - size / 2,
          py - size / 2,
          size,
          size,
        );
      }

      // Shooting stars: bright head with a fading trail.
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.life -= dt;
        if (m.life <= 0) {
          meteors.splice(i, 1);
          continue;
        }
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const fade = Math.min(m.life / m.maxLife, 1);
        const tail = 90;
        const trail = ctx.createLinearGradient(
          m.x,
          m.y,
          m.x - (m.vx / 700) * tail,
          m.y - (m.vy / 700) * tail,
        );
        const headColor = dark ? "255, 244, 224" : "150, 130, 100";
        trail.addColorStop(0, `rgba(${headColor}, ${0.85 * fade * baseAlpha})`);
        trail.addColorStop(1, `rgba(${headColor}, 0)`);
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - (m.vx / 700) * tail, m.y - (m.vy / 700) * tail);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduce) {
        elapsed = 1;
        draw(0);
      }
    };

    let last = 0;
    const tick = (time: number, deltaMS: number) => {
      const dt = Math.min(deltaMS, 64) / 1000;
      elapsed += dt;
      for (const p of particles) {
        p.x -= DRIFT_PX_PER_SEC * p.depth * dt;
        if (p.x < -8) {
          p.x = width + 8;
          p.y = Math.random() * height;
        }
      }
      nextMeteorAt -= dt;
      if (nextMeteorAt <= 0) {
        spawnMeteor();
        nextMeteorAt = gsap.utils.random(6, 14);
      }
      draw(dt);
      last = time;
    };

    const onPointerMove = (event: PointerEvent) => {
      parallaxXTo(event.clientX / window.innerWidth - 0.5);
      parallaxYTo(event.clientY / window.innerHeight - 0.5);
    };

    resize();
    window.addEventListener("resize", resize);

    if (reduce) {
      draw(0);
      return () => window.removeEventListener("resize", resize);
    }

    gsap.ticker.add(tick);
    window.addEventListener("pointermove", onPointerMove);
    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      gsap.killTweensOf(parallax);
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}

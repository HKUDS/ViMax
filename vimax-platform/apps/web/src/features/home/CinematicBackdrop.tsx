// ── Cinematic Backdrop ─────────────────────────────────────────────
// 电影感光影背景：地平线辉光 + 变形镜头光束（紫/青）+ 极光色团 +
// 胶片颗粒 + 边缘暗角。所有颜色经 color-mix 挂在主题 token 上，
// 深/浅主题自动适配，无位图资产。纯装饰：aria-hidden + pointer-events-none。
// 动效仅 transform/opacity，prefers-reduced-motion 下静止。

export function CinematicBackdrop({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {/* 地平线辉光：从画面底部升起的舞台光 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 55% at 50% 115%, color-mix(in oklab, var(--color-accent) 24%, transparent), transparent 65%)",
        }}
      />

      {/* 变形镜头光束：两道交叉的水平光带，缓慢漂移 */}
      <div
        className="fx-beam"
        style={{
          position: "absolute",
          top: "16%",
          left: "-12%",
          width: "124%",
          height: "200px",
          transform: "rotate(-7deg)",
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-accent) 32%, transparent) 32%, color-mix(in oklab, var(--color-accent) 46%, transparent) 50%, color-mix(in oklab, var(--color-accent) 32%, transparent) 68%, transparent 100%)",
          filter: "blur(42px)",
          animation: "fxBeamDrift 26s ease-in-out infinite alternate",
        }}
      />
      <div
        className="fx-beam"
        style={{
          position: "absolute",
          top: "34%",
          left: "-8%",
          width: "116%",
          height: "130px",
          transform: "rotate(4deg)",
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-secondary) 34%, transparent) 38%, color-mix(in oklab, var(--color-secondary) 48%, transparent) 55%, transparent 100%)",
          filter: "blur(34px)",
          animation: "fxBeamDrift 32s ease-in-out infinite alternate-reverse",
        }}
      />

      {/* 极光色团：紫/珊瑚两团低饱和氛围光 */}
      <div
        className="fx-aurora"
        style={{
          position: "absolute",
          top: "-22%",
          left: "55%",
          width: "560px",
          height: "560px",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--color-tertiary) 18%, transparent), transparent 68%)",
          filter: "blur(56px)",
          animation: "fxAuroraDrift 38s ease-in-out infinite alternate",
        }}
      />

      {/* 胶片颗粒：静态 turbulence 纹理 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.05,
          mixBlendMode: "overlay",
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      {/* 边缘暗角：把视线收拢到中央创作区 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 70% at 50% 42%, transparent 60%, color-mix(in oklab, var(--color-canvas) 38%, transparent) 100%)",
        }}
      />
    </div>
  );
}

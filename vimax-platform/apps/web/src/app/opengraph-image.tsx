import { ImageResponse } from "next/og";

// 品牌分享卡片：深空底 + 变形镜头光束 + ViMax 字标。
// 文本仅用 Latin 字符（next/og 默认内嵌字体不含 CJK）。

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ViMax Studio · AI Video Workbench";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f131d",
          position: "relative",
        }}
      >
        {/* 变形光束 */}
        <div
          style={{
            position: "absolute",
            top: 150,
            left: -60,
            width: 1320,
            height: 200,
            background:
              "linear-gradient(90deg, transparent 0%, rgba(160,120,255,0.35) 45%, rgba(53,198,232,0.30) 60%, transparent 100%)",
            filter: "blur(48px)",
            transform: "rotate(-6deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 330,
            left: 80,
            width: 1040,
            height: 110,
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,182,144,0.20) 50%, transparent 100%)",
            filter: "blur(40px)",
            transform: "rotate(3deg)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
          }}
        >
          <div
            style={{
              width: 76,
              height: 76,
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #a078ff 0%, #35c6e8 100%)",
              color: "#ffffff",
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            V
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, fontWeight: 800, color: "#dfe2f1", letterSpacing: -3 }}>
              ViMax Studio
            </div>
            <div style={{ fontSize: 30, color: "#958ea0", marginTop: 10 }}>
              AI video workbench · from idea to video
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}

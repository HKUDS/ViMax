// ── Prompt word banks (联想词 + 限制词) ────────────────────────────
// 所有提示词入口（首页 / 生图工坊 / 视频工坊 / 画布）的词条单一来源，
// 页面只消费，禁止各页拷贝词库。
//
// 底层云 API（Seedream/Seedance/Veo）均无独立负面词参数，限制词统一
// 以 `Avoid: ...` 文本折叠进 prompt（见 composeImagePrompt/composeVideoPrompt），
// 不支持 SD 权重语法；字节系模型对负面词响应有限，词条保持自然语言。

// ── 限制词（负面提示词）────────────────────────────────────────────

export type NegativeWordGroupId = "quality" | "watermark" | "anatomy" | "temporal";

export interface NegativeWord {
  id: string;
  /** 中文标签（UI 展示）。 */
  label: string;
  /** 折叠进 prompt 的英文片段。 */
  en: string;
}

export interface NegativeWordGroup {
  id: NegativeWordGroupId;
  label: string;
  /** 视频专属分组（时序伪影），仅视频入口展示。 */
  videoOnly?: boolean;
  words: readonly NegativeWord[];
}

export const NEGATIVE_WORD_GROUPS: readonly NegativeWordGroup[] = [
  {
    id: "quality",
    label: "画质",
    words: [
      { id: "low-quality", label: "低质量", en: "low quality" },
      { id: "blurry", label: "模糊", en: "blurry" },
      { id: "low-res", label: "低分辨率", en: "low res" },
      { id: "jpeg-artifacts", label: "压缩伪影", en: "jpeg artifacts" },
    ],
  },
  {
    id: "watermark",
    label: "水印文字",
    words: [
      { id: "watermark", label: "水印", en: "watermark" },
      { id: "text", label: "文字", en: "text" },
      { id: "logo", label: "标志", en: "logo" },
      { id: "signature", label: "签名", en: "signature" },
    ],
  },
  {
    id: "anatomy",
    label: "人体结构",
    words: [
      { id: "bad-hands", label: "手部畸形", en: "bad hands" },
      { id: "extra-fingers", label: "多余手指", en: "extra fingers" },
      { id: "deformed-anatomy", label: "结构变形", en: "deformed anatomy" },
      { id: "distorted-face", label: "面部扭曲", en: "distorted face" },
    ],
  },
  {
    id: "temporal",
    label: "视频时序",
    videoOnly: true,
    words: [
      { id: "warping", label: "变形扭曲", en: "warping" },
      { id: "morphing", label: "形态渐变", en: "morphing" },
      { id: "flickering", label: "闪烁", en: "flickering" },
      { id: "jittery", label: "抖动", en: "jittery motion" },
      { id: "inconsistent-character", label: "角色不一致", en: "inconsistent character" },
    ],
  },
];

/** 自动管线建节点时注入的温和默认负面词（画质 + 水印组）。 */
export const DEFAULT_NEGATIVE_PROMPT = "low quality, blurry, watermark, text";

// ── 联想词（提示词延伸）────────────────────────────────────────────

export type ThesaurusDimensionId = "style" | "light" | "camera" | "mood" | "quality" | "detail";

export interface ThesaurusDimension {
  id: ThesaurusDimensionId;
  label: string;
  words: readonly { id: string; label: string; en: string }[];
}

/** 维度化联想词库：点击词条把英文片段追加到 prompt。 */
export const PROMPT_THESAURUS: readonly ThesaurusDimension[] = [
  {
    id: "style",
    label: "风格",
    words: [
      { id: "cinematic", label: "电影质感", en: "cinematic film look, dramatic color grading" },
      { id: "photorealistic", label: "超写实", en: "photorealistic, ultra detailed" },
      { id: "anime", label: "日漫", en: "japanese anime style, cel shading" },
      { id: "3d-render", label: "3D 渲染", en: "polished 3D render, global illumination" },
      { id: "watercolor", label: "水彩", en: "watercolor illustration, soft brush strokes" },
      { id: "film-noir", label: "黑白胶片", en: "black-and-white film noir, high contrast" },
    ],
  },
  {
    id: "light",
    label: "光线",
    words: [
      { id: "golden-hour", label: "黄金时刻", en: "golden hour sunlight" },
      { id: "blue-hour", label: "蓝调时刻", en: "blue hour twilight" },
      { id: "rim-light", label: "轮廓逆光", en: "rim lighting, backlit silhouette" },
      { id: "soft-diffuse", label: "柔和漫射", en: "soft diffused lighting" },
      { id: "neon", label: "霓虹", en: "neon glow, colorful reflections" },
      { id: "volumetric", label: "体积光", en: "volumetric light rays" },
    ],
  },
  {
    id: "camera",
    label: "镜头",
    words: [
      { id: "wide-shot", label: "远景", en: "wide establishing shot" },
      { id: "close-up", label: "特写", en: "extreme close-up" },
      { id: "aerial", label: "航拍", en: "aerial drone shot" },
      { id: "macro", label: "微距", en: "macro photography" },
      { id: "fisheye", label: "鱼眼", en: "fisheye lens distortion" },
      { id: "shallow-dof", label: "浅景深", en: "shallow depth of field, bokeh" },
    ],
  },
  {
    id: "mood",
    label: "氛围",
    words: [
      { id: "serene", label: "宁静", en: "serene, tranquil atmosphere" },
      { id: "epic", label: "史诗", en: "epic, monumental scale" },
      { id: "melancholy", label: "忧郁", en: "melancholic mood" },
      { id: "mysterious", label: "神秘", en: "mysterious, enigmatic" },
      { id: "joyful", label: "明快", en: "joyful, vibrant energy" },
      { id: "tense", label: "紧张", en: "tense, suspenseful" },
    ],
  },
  {
    id: "quality",
    label: "画质",
    words: [
      { id: "8k", label: "8K 超清", en: "8k, ultra high definition" },
      { id: "sharp-focus", label: "锐利对焦", en: "razor sharp focus" },
      { id: "film-grain", label: "胶片颗粒", en: "35mm film grain" },
      { id: "hdr", label: "HDR", en: "HDR, high dynamic range" },
    ],
  },
  {
    id: "detail",
    label: "细节",
    words: [
      { id: "texture", label: "材质纹理", en: "intricate material textures" },
      { id: "skin-detail", label: "皮肤细节", en: "detailed skin texture" },
      { id: "fabric", label: "织物", en: "detailed fabric weave" },
      { id: "particles", label: "粒子", en: "floating particles, dust motes" },
    ],
  },
];

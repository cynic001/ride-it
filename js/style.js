/**
 * style.js
 * 그래픽 스타일 프리셋 — 'standard'(기존 PBR+HDRI) / 'toon'(A: 단계형 음영+외곽선+노을빛) / 'pastel'(B: 단계형 음영+파스텔)
 * - 단계형 음영(cel): PBR 재질 플러그인으로 조명 세기를 3단으로 양자화 — 셰이더 코드만 추가라 드로우콜 증가 없음
 * - 외곽선: 화면 공간 깊이 경계 검출 포스트프로세스(두께가 모델 스케일과 무관하게 일정). 깊이 패스가 추가돼
 *   low 프리셋에서는 끔(SE2 프레임 우선)
 * - 하늘: standard는 HDRI 스카이박스, 카툰 계열은 그라데이션 돔(노을/파스텔)
 */

const STYLES = {
  standard: {},
  // 밝은 낮(기본값): 선명한 하늘색 그라데이션 + 옅은 하늘색 안개(멀리가 어두워지지 않게) + 푸른빛 그림자. 지면·안개·하늘 지평선은 스테이지 palette로 살짝 달라짐
  day: {
    outline: true,
    sky: ['#0f74ff', '#2a8dff', '#4ea9ff', '#86c9ff', '#bfe6ff'],
    fog: [0.72, 0.88, 1.0], fogDensity: 0.0008,
    sun: { dir: [-0.5, -0.78, 0.38], color: [1.0, 0.98, 0.93], intensity: 2.5 },
    envIntensity: 0.95,
    ground: [1.15, 1.25, 1.05],
    bands: [0.8, 0.98, 1.1],
    shadow: [0.8, 0.9, 1.14], // 그림자 단계에 곱하는 색 — 검정이 아닌 푸른빛
    tint: [1.04, 1.02, 1.0],
    image: { exposure: 1.3, contrast: 1.04, saturation: 22 },
    clouds: true,
  },
  toon: {
    outline: true,
    sky: ['#27306f', '#6b4a9a', '#d8628a', '#ff9a5c', '#ffcf7a'], // 위 → 지평선
    fog: [1.0, 0.78, 0.6], fogDensity: 0.0014,
    sun: { dir: [-0.75, -0.32, 0.58], color: [1.0, 0.72, 0.48], intensity: 2.6 },
    envIntensity: 0.55,
    ground: [1.0, 0.86, 0.52],
    bands: [0.58, 0.95, 1.12], // 음영 3단(그림자/중간/밝음) 밝기
    tint: [1.06, 0.95, 0.86],
    image: { exposure: 1.12, contrast: 1.12, saturation: 8 },
  },
  pastel: {
    outline: false,
    sky: ['#5f9dff', '#8fb2ff', '#c8b4f5', '#ffc6d4', '#ffe9cc'],
    fog: [0.98, 0.9, 0.9], fogDensity: 0.0012,
    sun: { dir: [-0.5, -0.72, 0.42], color: [1.0, 0.93, 0.86], intensity: 2.1 },
    envIntensity: 0.95,
    ground: [1.0, 1.0, 0.86],
    bands: [0.74, 0.95, 1.08],
    tint: [1.06, 1.0, 0.97],
    image: { exposure: 1.12, contrast: 1.0, saturation: -10 },
  },
};

/** PBR 재질 플러그인: 최종 색을 "알베도 × 조명 단계"로 치환 — 조명 세기(최종/알베도 휘도 비)를 3단으로 끊음 */
class ToonPlugin extends BABYLON.MaterialPluginBase {
  constructor(material) {
    super(material, 'Toon', 200, { TOON: false });
    this._isEnabled = false;
    this.bands = new BABYLON.Vector3(0.55, 0.9, 1.08);
    this.tint = new BABYLON.Color3(1, 1, 1);
    this.shadow = new BABYLON.Color3(1, 1, 1);
  }
  get isEnabled() { return this._isEnabled; }
  set isEnabled(v) {
    if (this._isEnabled === v) return;
    this._isEnabled = v;
    this.markAllDefinesAsDirty();
    this._enable(v);
  }
  prepareDefines(defines) { defines.TOON = this._isEnabled; }
  getClassName() { return 'ToonPlugin'; }
  getUniforms() {
    return {
      ubo: [{ name: 'toonBands', size: 3, type: 'vec3' }, { name: 'toonTint', size: 3, type: 'vec3' }, { name: 'toonShadow', size: 3, type: 'vec3' }],
      fragment: '#ifdef TOON\nuniform vec3 toonBands;\nuniform vec3 toonTint;\nuniform vec3 toonShadow;\n#endif',
    };
  }
  bindForSubMesh(ubo) {
    if (!this._isEnabled) return;
    ubo.updateFloat3('toonBands', this.bands.x, this.bands.y, this.bands.z);
    ubo.updateColor3('toonTint', this.tint);
    ubo.updateColor3('toonShadow', this.shadow);
  }
  getCustomCode(shaderType) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
#ifdef TOON
  vec3 toonAlb = max(surfaceAlbedo.rgb, vec3(0.002));
  float toonLa = dot(toonAlb, vec3(0.2126, 0.7152, 0.0722));
  float toonShade = dot(finalColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / toonLa;
  float toonQ = toonShade < 0.42 ? toonBands.x : (toonShade < 0.85 ? toonBands.y : toonBands.z);
  finalColor.rgb = toonAlb * toonQ * toonTint * (toonShade < 0.42 ? toonShadow : vec3(1.0));
#endif
`,
    };
  }
}
BABYLON.RegisterMaterialPlugin('Toon', m => (m instanceof BABYLON.PBRMaterial ? new ToonPlugin(m) : null));

// 깊이 경계 외곽선 — 이웃 4픽셀 깊이의 상대 라플라시안이 크면 선. 하늘(깊이 1) 내부는 제외
BABYLON.Effect.ShadersStore.toonOutlineFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec2 texel;
uniform vec3 lineColor;
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  float d = texture2D(depthSampler, vUV).r;
  float dl = texture2D(depthSampler, vUV - vec2(texel.x, 0.0)).r;
  float dr = texture2D(depthSampler, vUV + vec2(texel.x, 0.0)).r;
  float du = texture2D(depthSampler, vUV + vec2(0.0, texel.y)).r;
  float dd = texture2D(depthSampler, vUV - vec2(0.0, texel.y)).r;
  float e = abs(dl + dr + du + dd - 4.0 * d) / max(min(min(dl, dr), min(min(du, dd), d)), 0.0005);
  float edge = smoothstep(0.12, 0.4, e) * (1.0 - smoothstep(0.93, 0.99, d)) ;
  gl_FragColor = vec4(mix(c.rgb, lineColor, edge * 0.85), c.a);
}`;

// 부스트 방사형 블러: 카트 화면 위치(center)에서 바깥쪽으로 늘어지는 줌 블러. 중심부는 선명하게(거리 비례 마스크).
// CA 정의 시(high) 가장자리 색수차 — R/B를 반대 방향으로 약간 벌림
BABYLON.Effect.ShadersStore.radialBoostFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 center;
uniform float strength;
void main(void) {
  vec2 dir = vUV - center;
  float d = length(dir);
  float amt = strength * smoothstep(0.08, 0.55, d);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float k = 1.0 - amt * (float(i) / float(SAMPLES - 1));
    acc += texture2D(textureSampler, center + dir * k).rgb;
  }
  vec3 col = acc / float(SAMPLES);
#ifdef CA
  float ca = amt * 0.06;
  col.r = mix(col.r, texture2D(textureSampler, center + dir * (1.0 + ca)).r, 0.6);
  col.b = mix(col.b, texture2D(textureSampler, center + dir * (1.0 - ca)).b, 0.6);
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

/** '#rrggbb' 색을 0~1 RGB 배열 쪽으로 t만큼 섞음 */
function mixHex(hex, rgb, t) {
  const c = [1, 3, 5].map((i, k) => parseInt(hex.slice(i, i + 2), 16) / 255 * (1 - t) + Math.min(1, rgb[k]) * t);
  return '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

const StyleManager = {
  current: localStorage.getItem('rc_style') || 'day', // 저장된 선택(예: 카툰 노을)이 있으면 그대로 존중
  _skyDome: null,
  _outline: null,

  set(name) {
    if (!STYLES[name]) return;
    this.current = name;
    try { localStorage.setItem('rc_style', name); } catch (e) { /* 저장 실패 무시 */ }
    if (window.Game && Game.scene) this.apply(Game);
  },

  /** 씬/재질/하늘/후처리에 현재 스타일 반영 — 스테이지 로드 후·품질 변경 후에도 다시 호출 */
  apply(game) {
    const scene = game.scene;
    const st = STYLES[this.current];
    const toon = this.current !== 'standard';

    scene.materials.forEach(m => {
      const p = m.pluginManager && m.pluginManager.getPlugin('Toon');
      if (!p) return;
      const on = toon && m.name !== 'skyBox';
      p.isEnabled = on;
      if (on) { p.bands.set(...st.bands); p.tint.set(...st.tint); p.shadow.set(...(st.shadow || [1, 1, 1])); }
    });

    if (game._skybox) game._skybox.setEnabled(!toon);
    const pal = game.track && game.track.stageData.palette;
    const day = this.current === 'day' && pal; // 밝은 낮 + 스테이지 테마 색
    this._setSkyDome(scene, toon ? (day ? st.sky.map((c, i) => (i >= 3 ? mixHex(c, pal.haze, 0.4) : c)) : st.sky) : null);
    this._setClouds(scene, !!st.clouds, QualityManager.current);

    const sun = game.sun;
    if (toon) {
      sun.direction = new BABYLON.Vector3(...st.sun.dir).normalize();
      sun.diffuse = new BABYLON.Color3(...st.sun.color);
      sun.intensity = st.sun.intensity;
      scene.environmentIntensity = st.envIntensity;
      const fog = day ? st.fog.map((c, i) => c * 0.6 + pal.haze[i] * 0.4) : st.fog;
      scene.fogColor = new BABYLON.Color3(...fog);
      scene.fogDensity = st.fogDensity;
      scene.clearColor = new BABYLON.Color4(...fog, 1);
      if (game._ground) game._ground.material.albedoColor = new BABYLON.Color3(...(day ? pal.grass : st.ground));
    } else {
      sun.direction = new BABYLON.Vector3(-0.55, -0.68, 0.48).normalize();
      sun.diffuse = new BABYLON.Color3(1, 1, 1);
      sun.intensity = 2.2;
      scene.environmentIntensity = 0.9;
      scene.fogColor = new BABYLON.Color3(0.74, 0.85, 0.96);
      scene.fogDensity = 0.0017;
      scene.clearColor = new BABYLON.Color4(0.72, 0.84, 0.95, 1);
      if (game._ground) game._ground.material.albedoColor = new BABYLON.Color3(1, 1, 1);
    }

    // 색보정 — 파이프라인 이미지 처리(medium/high) 또는 씬 기본 이미지 처리(low)
    const ip = game._pipeline && game._pipeline.imageProcessingEnabled ? game._pipeline.imageProcessing : scene.imageProcessingConfiguration;
    const img = toon ? st.image : { exposure: 1.15, contrast: 1.1, saturation: 0 };
    ip.exposure = img.exposure;
    ip.contrast = img.contrast;
    ip.colorCurvesEnabled = img.saturation !== 0;
    if (ip.colorCurvesEnabled) {
      const cc = new BABYLON.ColorCurves();
      cc.globalSaturation = img.saturation;
      ip.colorCurves = cc;
    }

    this._setOutline(game, toon && st.outline && QualityManager.current !== 'low');
  },

  /** 카툰 구름: 구 5~6개를 합친 뭉게구름 n개를 하늘에 고정(카메라 기준 infiniteDistance, 천천히 회전) — 아래쪽은 푸르스름하게 정점 색으로 음영.
   * 전부 한 메시로 병합해 드로우콜 1회, low는 4개 */
  _setClouds(scene, on, quality) {
    const n = on ? ({ low: 4, medium: 7, high: 10 }[quality] || 7) : 0;
    if (this._cloudN === n && (!n || (this._clouds && !this._clouds.isDisposed()))) return;
    if (this._clouds) { this._clouds.dispose(); this._clouds = null; }
    this._cloudN = n;
    if (!n) return;
    const parts = [];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < n; i++) {
      const ang = (i + rnd() * 0.6) / n * Math.PI * 2, dist = 650 + rnd() * 120, y = 60 + rnd() * 170;
      const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist, size = 55 + rnd() * 55;
      for (let k = 0; k < 6; k++) {
        const s = BABYLON.MeshBuilder.CreateSphere('cloudPart', { diameter: size * (0.55 + rnd() * 0.5), segments: 6 }, scene);
        s.position.set(cx + (k - 2.5) * size * 0.42, y + (k % 2 ? 1 : 0) * size * 0.18 + (k === 2 || k === 3 ? size * 0.2 : 0), cz + (rnd() - 0.5) * size * 0.4);
        s.bakeCurrentTransformIntoVertices();
        const pos = s.getVerticesData(BABYLON.VertexBuffer.PositionKind), cols = [];
        for (let v = 1; v < pos.length; v += 3) { const lo = Math.max(0, Math.min(1, (pos[v] - (y - size * 0.3)) / (size * 0.8))); cols.push(0.9 + 0.1 * lo, 0.95 + 0.05 * lo, 1, 1); }
        s.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
        parts.push(s);
      }
    }
    const cloud = BABYLON.Mesh.MergeMeshes(parts, true, true);
    cloud.name = 'styleClouds';
    if (!scene._cloudMat) {
      const m = new BABYLON.StandardMaterial('cloudMat', scene);
      m.disableLighting = true; m.emissiveColor = new BABYLON.Color3(1, 1, 1); m.backFaceCulling = false;
      scene._cloudMat = m;
    }
    cloud.material = scene._cloudMat;
    cloud.infiniteDistance = true; cloud.applyFog = false; cloud.isPickable = false; cloud.alwaysSelectAsActiveMesh = true;
    this._clouds = cloud;
  },

  _setSkyDome(scene, stops) {
    if (!stops) { if (this._skyDome) this._skyDome.setEnabled(false); return; }
    if (!this._skyDome) {
      const dome = BABYLON.MeshBuilder.CreateSphere('styleSky', { diameter: 1800, segments: 16 }, scene);
      const mat = new BABYLON.StandardMaterial('styleSkyMat', scene);
      mat.backFaceCulling = false;
      mat.disableLighting = true;
      mat.diffuseColor = BABYLON.Color3.Black();
      mat.specularColor = BABYLON.Color3.Black();
      dome.material = mat;
      dome.infiniteDistance = true;
      dome.applyFog = false;
      dome.isPickable = false;
      this._skyDome = dome;
    }
    const tex = new BABYLON.DynamicTexture('styleSkyTex', { width: 4, height: 512 }, scene, false);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    // 구 UV의 v: 0(위)→0.5(지평선)→1(아래). 지평선 아래는 마지막 색 유지
    // 게임 카메라는 대부분 지평선 위 0~25°만 보므로 색 변화를 지평선(v=0.5) 쪽에 몰아 배치. 구 UV의 위/아래 방향과
    // 무관하도록 지평선 기준 대칭(아래 반구는 지면에 가려 안 보임)
    const STOP_V = [0, 0.3, 0.41, 0.47, 0.5];
    stops.forEach((c, i) => { g.addColorStop(STOP_V[i], c); g.addColorStop(1 - STOP_V[i], c); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
    tex.update();
    const mat = this._skyDome.material;
    if (mat.emissiveTexture) mat.emissiveTexture.dispose();
    mat.emissiveTexture = tex;
    this._skyDome.setEnabled(true);
  },

  _setOutline(game, on) {
    if (this._outline) {
      this._outline.dispose();
      this._outline = null;
    }
    if (this._depthCam) {
      game.scene.disableDepthRenderer(this._depthCam);
      this._depthCam = null;
    }
    if (!on || !game.camera) return;
    const cam = game.camera.camera;
    const depth = game.scene.enableDepthRenderer(cam, false);
    this._depthCam = cam;
    const pp = new BABYLON.PostProcess('toonOutline', 'toonOutline', ['texel', 'lineColor'], ['depthSampler'], 1.0, cam);
    pp.onApply = effect => {
      effect.setTexture('depthSampler', depth.getDepthMap());
      effect.setFloat2('texel', 1 / pp.width, 1 / pp.height);
      effect.setColor3('lineColor', new BABYLON.Color3(0.12, 0.09, 0.2));
    };
    this._outline = pp;
  },
};

window.STYLES = STYLES;
window.StyleManager = StyleManager;

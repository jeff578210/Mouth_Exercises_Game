/*
 * TongueDirectionDetector — 舌頭方向偵測 (ES Module 版)
 * 取代 Teachable Machine,用我們訓練好的 U-Net 分割模型。
 *
 * 使用:
 *   import * as tf from 'https://esm.sh/@tensorflow/tfjs@4';
 *   import { TongueDirectionDetector } from './tongue_direction.js';
 *   const det = await new TongueDirectionDetector({ tf, modelPath: './web_model/model.json' }).load();
 *   const r = det.detect(videoElement, faceLandmarks);  // r.direction: '上'|'下'|'左'|'右'|null
 */
const ROI_SIZE = 128;
const ROI_PAD  = 1.6;

// FACEMESH_LIPS 唇部 landmark 索引(40 點)
const LIP_INDICES = [
  0,  13, 14, 17, 37, 39, 40, 61, 78, 80,
  81, 82, 84, 87, 88, 91, 95, 146,178,181,
  185,191,267,269,270,291,308,310,311,312,
  314,317,318,321,324,375,402,405,409,415,
];
const INNER_TOP = 13, INNER_BOTTOM = 14, LIP_LEFT = 78, LIP_RIGHT = 308;

export class TongueDirectionDetector {
  constructor(opts) {
    opts = opts || {};
    this.tf = opts.tf;
    if (!this.tf) throw new Error('TongueDirectionDetector: constructor 需提供 tf 參考');
    this.modelPath  = opts.modelPath  || 'web_model/model.json';
    this.openThresh = opts.openThresh != null ? opts.openThresh : 0.06;
    this.probThresh = opts.probThresh != null ? opts.probThresh : 0.5;
    this.inferEvery = opts.inferEvery != null ? opts.inferEvery : 2;

    this.seg = null;
    this._cachedSeg = null;
    this._framesSince = 0;

    this.roiCanvas = document.createElement('canvas');
    this.roiCanvas.width = ROI_SIZE;
    this.roiCanvas.height = ROI_SIZE;
    this.roiCtx = this.roiCanvas.getContext('2d', { willReadFrequently: true });
  }

  async load() {
    this.seg = await this.tf.loadLayersModel(this.modelPath);
    // 暖機
    this.tf.tidy(() => this.seg.predict(this.tf.zeros([1, ROI_SIZE, ROI_SIZE, 3])));
    return this;
  }

  /**
   * 每幀呼叫;若無臉/閉嘴會回傳 direction: null。
   * @param {HTMLVideoElement|HTMLCanvasElement|HTMLImageElement|ImageBitmap} image
   * @param {Array<{x:number, y:number}>} landmarks  — MediaPipe Face Mesh / FaceLandmarker 的 468 點
   * @returns {{direction: '上'|'下'|'左'|'右'|null, mouthOpen: boolean, openRatio: number}}
   */
  detect(image, landmarks) {
    if (!landmarks || landmarks.length < 468 || !image) {
      this._cachedSeg = null; this._framesSince = 0;
      return { direction: null, mouthOpen: false, openRatio: 0 };
    }

    // (1) 嘴巴開合
    const dyL = Math.abs(landmarks[INNER_TOP].y - landmarks[INNER_BOTTOM].y);
    const dxL = Math.abs(landmarks[LIP_LEFT].x - landmarks[LIP_RIGHT].x);
    const openRatio = dxL > 0 ? dyL / dxL : 0;
    const mouthOpen = openRatio > this.openThresh;
    if (!mouthOpen) {
      this._cachedSeg = null; this._framesSince = 0;
      return { direction: null, mouthOpen: false, openRatio };
    }
    if (!this.seg) return { direction: null, mouthOpen: true, openRatio };

    const w = image.videoWidth  || image.width  || image.naturalWidth;
    const h = image.videoHeight || image.height || image.naturalHeight;
    if (!w || !h) return { direction: null, mouthOpen: true, openRatio };

    // (2) 唇部 bbox
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < LIP_INDICES.length; i++) {
      const p = landmarks[LIP_INDICES[i]];
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const lipCx = (minX + maxX) * 0.5 * w;
    const lipCy = (minY + maxY) * 0.5 * h;
    const lipW  = (maxX - minX) * w;
    const lipH  = (maxY - minY) * h;
    const halfW = Math.max(1, lipW * 0.5);
    const halfH = Math.max(1, lipH * 0.5);

    // (3) 正方形 ROI(訓練/推論共用同一規格)
    const s  = Math.min(Math.max(lipW, lipH) * ROI_PAD, w, h);
    const x0 = Math.max(0, Math.min(w - s, lipCx - s * 0.5));
    const y0 = Math.max(0, Math.min(h - s, lipCy - s * 0.5));
    this.roiCtx.drawImage(image, x0, y0, s, s, 0, 0, ROI_SIZE, ROI_SIZE);

    // (4) 模型推論(跳幀快取省算力)
    if (!this._cachedSeg || this._framesSince >= this.inferEvery - 1) {
      this._cachedSeg = this.tf.tidy(() => {
        const x = this.tf.browser.fromPixels(this.roiCanvas).toFloat().div(255).expandDims(0);
        return this.seg.predict(x).squeeze().dataSync();
      });
      this._framesSince = 0;
    } else {
      this._framesSince++;
    }
    const seg = this._cachedSeg;

    // (5) Landmark 投票
    let up = 0, down = 0, left = 0, right = 0;
    for (let i = 0; i < LIP_INDICES.length; i++) {
      const idx = LIP_INDICES[i];
      const sx = landmarks[idx].x * w;
      const sy = landmarks[idx].y * h;
      const u = Math.round((sx - x0) / s * ROI_SIZE);
      const v = Math.round((sy - y0) / s * ROI_SIZE);
      if (u < 0 || u >= ROI_SIZE || v < 0 || v >= ROI_SIZE) continue;
      if (seg[v * ROI_SIZE + u] <= this.probThresh) continue;
      const nx = (sx - lipCx) / halfW;
      const ny = (sy - lipCy) / halfH;
      if (Math.abs(nx) > Math.abs(ny)) { if (nx > 0) left++; else right++; }
      else                              { if (ny > 0) down++; else up++; }
    }
    const arr = [['上', up], ['下', down], ['左', left], ['右', right]];
    arr.sort((a, b) => b[1] - a[1]);
    if (arr[0][1] >= 2 && arr[0][1] > arr[1][1]) {
      return { direction: arr[0][0], mouthOpen: true, openRatio };
    }

    // (6) 質心退路
    let tsx = 0, tsy = 0, tn = 0;
    for (let v = 0; v < ROI_SIZE; v++) {
      const row = v * ROI_SIZE;
      for (let u = 0; u < ROI_SIZE; u++) {
        if (seg[row + u] > this.probThresh) { tsx += u; tsy += v; tn++; }
      }
    }
    if (tn === 0) return { direction: null, mouthOpen: true, openRatio };
    const tCxSrc = x0 + (tsx / tn) / ROI_SIZE * s;
    const tCySrc = y0 + (tsy / tn) / ROI_SIZE * s;
    const nx = (tCxSrc - lipCx) / halfW;
    const ny = (tCySrc - lipCy) / halfH;
    let dir;
    if (Math.abs(nx) > Math.abs(ny)) dir = nx > 0 ? '左' : '右';
    else                              dir = ny >= 0 ? '下' : '上';
    return { direction: dir, mouthOpen: true, openRatio };
  }

  dispose() {
    if (this.seg) this.seg.dispose();
    this.seg = null;
    this._cachedSeg = null;
  }
}

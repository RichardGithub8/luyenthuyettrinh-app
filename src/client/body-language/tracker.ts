/**
 * Theo dõi ngôn ngữ cơ thể TRÊN TRÌNH DUYỆT bằng MediaPipe (không gửi video lên server để phân tích).
 * Dùng trong trang quay video:
 *   const t = new BodyLanguageTracker(); await t.init(); t.start(videoEl);
 *   ... khi dừng quay: const metrics = t.stop(); → POST /api/sessions/:id/body-metrics (trước upload-complete)
 * Chỉ số được tính mỗi ~200 ms, tổng hợp thành BodyMetrics (khớp BodyMetricsSchema ở server).
 */
import { FilesetResolver, FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const SAMPLE_MS = 200;
// Ngưỡng: nhìn vào camera khi đầu quay ngang < 15° và cúi/ngẩng < 12°.
const YAW_MAX = 15, PITCH_MAX = 12, HAND_MOVE = 0.04, HIP_SHIFT = 0.05, SMILE = 0.4;

export interface BodyMetrics {
  version: 1; durationSec: number; samples: number; eyeContactRatio: number; handsVisibleRatio: number;
  gestureRatePerMin: number; postureShiftsPerMin: number; avgShoulderTiltDeg: number; smileRatio: number;
  timeline: { t: number; eye: 0 | 1; gesture: 0 | 1 }[];
}

export class BodyLanguageTracker {
  private face?: FaceLandmarker; private pose?: PoseLandmarker; private timer?: number; private t0 = 0;
  private n = 0; private eye = 0; private hands = 0; private smile = 0; private tiltSum = 0; private tiltN = 0;
  private gestureOnsets = 0; private shifts = 0; private inGesture = false;
  private lastWrists?: [number, number, number, number]; private lastHipX?: number;
  private timeline: BodyMetrics['timeline'] = [];

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    [this.face, this.pose] = await Promise.all([
      FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true }),
      PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 }),
    ]);
  }

  start(video: HTMLVideoElement) {
    if (!this.face || !this.pose) throw new Error('Gọi init() trước start()');
    this.t0 = performance.now();
    this.timer = window.setInterval(() => this.sample(video), SAMPLE_MS);
  }

  private sample(video: HTMLVideoElement) {
    if (video.readyState < 2 || document.hidden) return;
    const now = performance.now(), t = (now - this.t0) / 1000;
    this.n++;
    let eye: 0 | 1 = 0, gesture: 0 | 1 = 0;
    const f = this.face!.detectForVideo(video, now);
    const m = f.facialTransformationMatrixes?.[0]?.data;
    if (m) {
      // Ma trận 4x4 (column-major): ước lượng góc quay đầu.
      const yaw = Math.atan2(m[8]!, m[10]!) * 180 / Math.PI, pitch = Math.asin(Math.max(-1, Math.min(1, -m[9]!))) * 180 / Math.PI;
      if (Math.abs(yaw) < YAW_MAX && Math.abs(pitch) < PITCH_MAX) { this.eye++; eye = 1; }
    }
    const bs = f.faceBlendshapes?.[0]?.categories;
    if (bs) {
      const s = (bs.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0) + (bs.find((c) => c.categoryName === 'mouthSmileRight')?.score ?? 0);
      if (s / 2 > SMILE) this.smile++;
    }
    const p = this.pose!.detectForVideo(video, now).landmarks?.[0];
    if (p) {
      const [ls, rs, lw, rw, lh, rh] = [p[11], p[12], p[15], p[16], p[23], p[24]];
      if (ls && rs) { const deg = Math.abs(Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180 / Math.PI); this.tiltSum += deg > 90 ? 180 - deg : deg; this.tiltN++; }
      if (lw && rw && (lw.visibility ?? 0) > 0.5 && (rw.visibility ?? 0) > 0.5) {
        this.hands++;
        const cur: [number, number, number, number] = [lw.x, lw.y, rw.x, rw.y];
        const moved = this.lastWrists ? Math.max(Math.hypot(cur[0] - this.lastWrists[0], cur[1] - this.lastWrists[1]), Math.hypot(cur[2] - this.lastWrists[2], cur[3] - this.lastWrists[3])) : 0;
        if (moved > HAND_MOVE) { gesture = 1; if (!this.inGesture) this.gestureOnsets++; this.inGesture = true; } else this.inGesture = false;
        this.lastWrists = cur;
      }
      if (lh && rh) { const x = (lh.x + rh.x) / 2; if (this.lastHipX !== undefined && Math.abs(x - this.lastHipX) > HIP_SHIFT) this.shifts++; this.lastHipX = x; }
    }
    if (this.timeline.length < 600 && this.n % 5 === 0) this.timeline.push({ t: Math.round(t * 10) / 10, eye, gesture });
  }

  stop(): BodyMetrics {
    window.clearInterval(this.timer);
    const dur = Math.max(1, (performance.now() - this.t0) / 1000), min = dur / 60, n = Math.max(1, this.n), r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      version: 1, durationSec: Math.round(dur), samples: n,
      eyeContactRatio: r(this.eye / n), handsVisibleRatio: r(this.hands / n), smileRatio: r(this.smile / n),
      gestureRatePerMin: Math.round(this.gestureOnsets / min * 10) / 10, postureShiftsPerMin: Math.round(this.shifts / min * 10) / 10,
      avgShoulderTiltDeg: this.tiltN ? Math.round(this.tiltSum / this.tiltN * 10) / 10 : 0, timeline: this.timeline,
    };
  }

  dispose() { window.clearInterval(this.timer); this.face?.close(); this.pose?.close(); }
}

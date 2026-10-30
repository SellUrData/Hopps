import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

let instance: Promise<PoseLandmarker> | null = null;
let lastTs = 0;

export function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!instance) {
    instance = (async () => {
      const base = import.meta.env.BASE_URL;
      const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
      const create = (delegate: 'GPU' | 'CPU') =>
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: `${base}models/pose_landmarker_lite.task`, delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await create('GPU');
      } catch {
        return await create('CPU');
      }
    })();
    instance.catch(() => {
      instance = null;
    });
  }
  return instance;
}

/** MediaPipe requires strictly increasing timestamps across all calls. */
export function detectPose(landmarker: PoseLandmarker, source: HTMLVideoElement) {
  const ts = Math.max(lastTs + 1, performance.now());
  lastTs = ts;
  return landmarker.detectForVideo(source, ts);
}

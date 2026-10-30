// Copies MediaPipe wasm runtime into public/ and downloads the pose model so the app works offline.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/mediapipe');
const modelDir = join(root, 'public/models');
const modelPath = join(modelDir, 'pose_landmarker_lite.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

mkdirSync(wasmDst, { recursive: true });
for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(wasmDst, f));

if (!existsSync(modelPath)) {
  mkdirSync(modelDir, { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('Downloaded pose model');
}

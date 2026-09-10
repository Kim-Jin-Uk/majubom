/**
 * R2 왕복 검증 — 리사이즈 → PUT → 공개 URL GET → 삭제.  실제 앱 코드(src/lib/storage/*)를 그대로 쓴다.
 *
 *   npm run r2:verify
 *
 * 확인하는 것:
 *   1) 자격증명·엔드포인트·버킷명이 맞다
 *   2) sharp 가 이 환경에서 돈다 (Cloud Run 이미지에 네이티브 바이너리가 들어갔는지)
 *   3) variants 가 전부 올라간다
 *   4) r2.dev 공개 URL 로 읽힌다 (Public Development URL 이 켜져 있다) — 크기·형식까지 확인
 *   5) 사업장 용량 집계(접두사 스캔)가 방금 올린 만큼을 센다
 *   6) 삭제 권한이 있다
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { buildImageBase, putVariant, deleteObject, publicUrl, usedBytes } = await import("../../src/lib/storage/r2.js");
const { processImage } = await import("../../src/lib/storage/image.js");
const { variantKey } = await import("../../src/lib/storage/variants.js");

const BIZ = "11111111-2222-4333-8444-555555555555";

let failed = false;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { console.error(`  ✗ ${m}`); failed = true; };

console.log("R2 왕복 검증");

// 검증용 원본 — 표준 폭 몇 개가 나오도록 충분히 크게 만든다
const sharp = (await import("sharp")).default;
const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#2f6f4f" } }).jpeg().toBuffer();

const processed = await processImage(source, "product");
ok(`sharp    ${processed.sourceWidth}×${processed.sourceHeight} → ${processed.variants.map((v) => v.width).join(", ")} (${processed.totalBytes} bytes)`);

const base = buildImageBase("product", BIZ);
const keys = processed.variants.map((v) => variantKey(base, v.width));
try {
  await Promise.all(processed.variants.map((v, i) => putVariant(keys[i], v.body)));
  ok(`PUT      ${keys.length}장  ${base}`);
} catch (e) {
  bad(`PUT 실패: ${(e as Error).message}`);
}

const largest = keys[keys.length - 1];
const get = await fetch(publicUrl(largest));
if (get.ok && get.headers.get("content-type") === "image/webp") ok(`공개 URL  ${get.status} ${get.headers.get("content-type")} ${get.headers.get("content-length")} bytes`);
else bad(`공개 URL ${get.status} ${get.headers.get("content-type")} — 버킷 Settings 의 Public Development URL 확인`);

const used = await usedBytes(BIZ);
if (used >= processed.totalBytes) ok(`용량 집계  ${used} bytes (검증용 사업장 접두사 전체)`);
else bad(`용량 집계가 방금 올린 ${processed.totalBytes} bytes 보다 작다 (${used}) — 접두사 규약 확인`);

try {
  await Promise.all(keys.map(deleteObject));
  ok(`삭제      ${keys.length}장`);
} catch (e) {
  bad(`삭제 실패: ${(e as Error).message}`);
}

console.log(failed ? "\n실패한 항목이 있다." : "\n전부 통과.");
process.exit(failed ? 1 : 0);

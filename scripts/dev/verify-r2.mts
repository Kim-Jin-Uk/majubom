/**
 * R2 왕복 검증 — presign → PUT → 공개 URL GET → 삭제.  실제 앱 코드(src/lib/storage/r2.ts)를 그대로 쓴다.
 *
 *   npm run r2:verify
 *
 * 확인하는 것:
 *   1) 자격증명·엔드포인트·버킷명이 맞다
 *   2) presigned PUT 이 통한다 (서명에 content-type·content-length 가 묶여 있다)
 *   3) 서명과 다른 content-type 으로 올리면 거부된다
 *   4) r2.dev 공개 URL 로 읽힌다 (Public Development URL 이 켜져 있다)
 *   5) 삭제 권한이 있다
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

const { presignUpload, deleteObject } = await import("../../src/lib/storage/r2.js");

/** 1×1 투명 PNG */
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

let failed = false;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => { console.error(`  ✗ ${m}`); failed = true; };

console.log("R2 왕복 검증");

const { key, url, publicUrl } = await presignUpload({
  kind: "product",
  businessId: "11111111-2222-4333-8444-555555555555",
  mime: "image/png",
  bytes: png.byteLength,
});
ok(`presign  ${key}`);

const headers = { "content-type": "image/png", "content-length": String(png.byteLength) };
const put = await fetch(url, { method: "PUT", headers, body: png });
if (put.ok) ok(`PUT      ${put.status}`);
else bad(`PUT ${put.status} — ${(await put.text()).slice(0, 200)}`);

const wrong = await fetch(url, {
  method: "PUT",
  headers: { ...headers, "content-type": "text/html" },
  body: png,
});
if (wrong.status === 403) ok("서명과 다른 content-type 거부 (403)");
else bad(`content-type 위반이 ${wrong.status} 로 통과했다 — signableHeaders 확인`);

const get = await fetch(publicUrl);
if (get.ok && get.headers.get("content-type")?.startsWith("image/")) {
  ok(`공개 URL  ${get.status} ${get.headers.get("content-type")}`);
} else {
  bad(`공개 URL ${get.status} — 버킷 Settings 의 Public Development URL 확인`);
}

try {
  await deleteObject(key);
  ok("삭제");
} catch (e) {
  bad(`삭제 실패: ${(e as Error).message}`);
}

console.log(failed ? "\n실패한 항목이 있다." : "\n전부 통과.");
process.exit(failed ? 1 : 0);

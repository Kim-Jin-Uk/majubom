#!/usr/bin/env node
/**
 * R2 버킷 CORS 정책 적용/확인.  브라우저가 presigned URL 로 직접 PUT 하므로 필요하다.
 *
 *   node scripts/dev/r2-cors.mjs          # 현재 정책 조회
 *   node scripts/dev/r2-cors.mjs --apply  # infra/r2-cors.json 적용
 *
 * App Hosting 도메인이 정해지면 infra/r2-cors.json 의 AllowedOrigins 에 추가하고 다시 --apply.
 * 권한이 부족하면(토큰이 Object Read & Write 만) 403 이 나온다 → Cloudflare 콘솔에서 붙여넣기.
 */
import { readFileSync } from "node:fs";
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from "@aws-sdk/client-s3";
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`✗ 환경변수 없음: ${missing.join(", ")}  (.env.local 확인)`);
  process.exit(1);
}

const Bucket = process.env.R2_BUCKET;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const rules = JSON.parse(readFileSync(new URL("../../infra/r2-cors.json", import.meta.url), "utf8"));

try {
  if (process.argv.includes("--apply")) {
    await s3.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
    console.log(`✓ CORS 적용 — ${Bucket}`);
  }
  const cur = await s3.send(new GetBucketCorsCommand({ Bucket }));
  console.log(JSON.stringify(cur.CORSRules, null, 2));
} catch (e) {
  const code = e?.$metadata?.httpStatusCode;
  if (code === 403) {
    console.error("✗ 403 — 토큰에 버킷 설정 권한이 없다. Cloudflare 콘솔 → 버킷 → Settings → CORS policy 에 infra/r2-cors.json 내용을 붙여넣을 것");
  } else if (e?.name === "NoSuchCORSConfiguration") {
    console.log("(CORS 정책 없음 — --apply 로 적용)");
  } else {
    console.error(`✗ ${e?.name ?? "Error"}: ${e?.message ?? e}`);
  }
  process.exit(code === 403 ? 2 : 1);
}

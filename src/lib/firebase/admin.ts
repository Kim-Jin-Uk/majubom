import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { serverEnv } from "@/lib/env";

/**
 * Firebase Admin — 커스텀 토큰 발급·리프레시 토큰 폐기 전용 (FR-AUTH-030 "Firebase 커스텀 토큰 발급").
 * 자격증명: FIREBASE_ADMIN_* 셋이 있으면 서비스 계정, 없으면 ADC (App Hosting 의 런타임 서비스 계정).
 * 로컬에서 셋 다 없고 ADC 도 없으면 첫 호출에서 실패한다 — 채팅(FEATURE_CHAT) 을 켠 환경에서만 필요하다.
 */
let app: App | undefined;

export function firebaseAdmin(): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) return (app = existing);
  const env = serverEnv();
  if (env.FIREBASE_ADMIN_PROJECT_ID && env.FIREBASE_ADMIN_CLIENT_EMAIL && env.FIREBASE_ADMIN_PRIVATE_KEY) {
    app = initializeApp({
      credential: cert({
        projectId: env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // Secret Manager · .env 에는 줄바꿈이 \n 으로 들어온다
        privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
      projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    });
  } else {
    app = initializeApp({ credential: applicationDefault(), projectId: env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
  }
  return app;
}

export type ChatClaims = { businessId?: string; canHandleChat: boolean; admin: boolean };

export async function mintChatToken(uid: string, claims: ChatClaims): Promise<string> {
  return getAuth(firebaseAdmin()).createCustomToken(uid, claims);
}

/** 권한 회수 시 호출 — 이미 발급된 ID 토큰은 최대 1시간 남지만, 갱신은 /api/auth/firebase-token 이 거부한다 */
export async function revokeFirebaseAccess(uid: string): Promise<void> {
  await getAuth(firebaseAdmin()).revokeRefreshTokens(uid);
}

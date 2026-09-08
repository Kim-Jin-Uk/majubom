import { z } from "zod";
import "@/lib/zod-locale";
import { HttpError } from "@/features/auth/errors";

/** JSON 본문을 zod 로 검증한다. 실패 → 400 INVALID_BODY + issues (클라이언트가 필드별 문구로 바꾼다) */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, "INVALID_BODY", { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  return parsed.data;
}

/** 경로 파라미터 id — UUID 가 아니면 존재하지 않는 것과 같다(404). 22P02 로 500 을 내지 않기 위해 */
export function uuidParam(raw: string | undefined): string {
  const r = z.uuid().safeParse(raw);
  if (!r.success) throw new HttpError(404, "NOT_FOUND");
  return r.data;
}

/** 절대 URL 만들기 (메일 링크·리다이렉트). AUTH_URL 기준 */
export function absoluteUrl(path: string, base = process.env.AUTH_URL ?? "http://localhost:3000"): string {
  return new URL(path, base).toString();
}

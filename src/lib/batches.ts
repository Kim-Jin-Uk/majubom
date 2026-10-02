/**
 * 바깥 왕복(메일 발송)을 **겹쳐서** 처리한다. 배치가 500건을 하나씩 기다리면 그만큼 길어지고,
 * 한 틱에 여러 작업이 들어 있으면 뒤따르는 작업까지 밀린다 (`README.md` 배치 설계).
 *
 * 한 번에 다 던지지는 않는다 — Resend 쪽 속도 제한에 걸린다.
 */
export const MAIL_CONCURRENCY = 8;

export async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

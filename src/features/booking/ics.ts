/**
 * 예약 한 건을 캘린더 파일(.ics)로 (FR-BOOK-090 "캘린더 담기", #89).
 *
 * **순수 함수다** — DB 도 시계도 모른다. 손님의 캘린더에 들어가는 값이라 조용히 틀리면 안 되는데,
 * 틀렸다는 걸 알려 주는 것도 없다(캘린더 앱은 파싱에 실패하면 그냥 안 열린다). 그래서 테스트로 묶는다.
 *
 * 시각은 **UTC 순간**(`…Z`)으로 적는다. 벽시계로 적고 타임존을 따로 실으면 VTIMEZONE 블록을 만들어야 하고,
 * 그걸 빠뜨린 파일은 앱마다 다르게 읽는다 — 손님 달력에 한 시간 어긋난 일정이 들어간다.
 */
export type IcsEvent = {
  uid: string;
  /** epoch ms */
  start: number;
  end: number;
  stamp: number;
  summary: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
};

/** `2026-09-20T01:00:00.000Z` → `20260920T010000Z` */
export function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** `\` `;` `,` 와 줄바꿈은 값 구분자와 겹친다 — 이스케이프하지 않으면 그 뒤가 통째로 다른 속성이 된다 */
export function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/**
 * RFC 5545 의 75옥텟 접기. **문자가 아니라 바이트로 세되, 글자 가운데를 자르지 않는다** —
 * 한글은 UTF-8 3바이트라 문자 수로 접으면 한 줄이 규격의 두 배가 되고, 바이트로만 접으면
 * 글자가 반 토막 나 깨진 제목이 캘린더에 들어간다.
 */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    // 이어지는 줄은 앞에 공백 한 칸이 붙으므로 그만큼 여유를 둔다
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.map((s, i) => (i === 0 ? s : ` ${s}`)).join("\r\n");
}

export function buildIcs(e: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//majubom//reservation//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsTime(e.stamp)}`,
    `DTSTART:${icsTime(e.start)}`,
    `DTEND:${icsTime(e.end)}`,
    `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    ...(e.url ? [`URL:${icsEscape(e.url)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // 줄 끝은 CRLF 다. LF 만 쓰면 받아 주는 앱도 있지만 규격은 CRLF 이고, 엄격한 쪽에서 통째로 실패한다
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

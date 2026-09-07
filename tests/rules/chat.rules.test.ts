/**
 * Firestore 보안 규칙 테스트 — 02_기능명세서 FR-CHAT-020 "실시간 계층 인가".
 *
 * 에뮬레이터 안에서만 돈다:
 *   npx firebase emulators:exec --only firestore --project demo-majubom "npm run test:rules"
 *   (= npm run test:rules:emu)
 *
 * 프로젝트 ID 는 반드시 `demo-` 프리픽스 (08 §6.4) — 실 자격증명 없이 돌고, 실수로도 프로덕션을 건드리지 않는다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "demo-majubom";

// ── 픽스처 ─────────────────────────────────────────────────────────────
const BIZ_A = "biz_A";
const BIZ_B = "biz_B";
const CUSTOMER_1 = "cust_1"; // ROOM_1 의 고객
const CUSTOMER_2 = "cust_2"; // ROOM_2 의 고객 (ROOM_1 에는 타인)
const STAFF_A = "staff_A"; // BIZ_A 스태프, canHandleChat=true
const STAFF_A_NOCHAT = "staff_A_nochat"; // BIZ_A 스태프, canHandleChat=false
const STAFF_B = "staff_B"; // BIZ_B 스태프, canHandleChat=true
const ADMIN = "admin_1";

const ROOM_1 = "room_1"; // BIZ_A × CUSTOMER_1, reportStatus 없음
const ROOM_2 = "room_2"; // BIZ_B × CUSTOMER_2, reportStatus 없음
const ROOM_REPORTED = "room_reported"; // BIZ_A × CUSTOMER_1, reportStatus=PENDING
const ROOM_RESOLVED = "room_resolved"; // BIZ_A × CUSTOMER_1, reportStatus=RESOLVED

let testEnv: RulesTestEnvironment;

const asCustomer1 = () => testEnv.authenticatedContext(CUSTOMER_1).firestore();
const asCustomer2 = () => testEnv.authenticatedContext(CUSTOMER_2).firestore();
const asStaffA = () =>
  testEnv.authenticatedContext(STAFF_A, { businessId: BIZ_A, canHandleChat: true }).firestore();
const asStaffANoChat = () =>
  testEnv.authenticatedContext(STAFF_A_NOCHAT, { businessId: BIZ_A, canHandleChat: false }).firestore();
const asStaffB = () =>
  testEnv.authenticatedContext(STAFF_B, { businessId: BIZ_B, canHandleChat: true }).firestore();
const asAdmin = () => testEnv.authenticatedContext(ADMIN, { admin: true }).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

function msgPayload(senderType: string, overrides: Record<string, unknown> = {}) {
  return {
    senderType,
    content: "안녕하세요",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "chatRooms", ROOM_1), {
      businessId: BIZ_A,
      customerId: CUSTOMER_1,
      customerUnread: 0,
      bizUnread: 0,
    });
    await setDoc(doc(db, "chatRooms", ROOM_2), {
      businessId: BIZ_B,
      customerId: CUSTOMER_2,
      customerUnread: 0,
      bizUnread: 0,
    });
    await setDoc(doc(db, "chatRooms", ROOM_REPORTED), {
      businessId: BIZ_A,
      customerId: CUSTOMER_1,
      reportStatus: "PENDING",
    });
    await setDoc(doc(db, "chatRooms", ROOM_RESOLVED), {
      businessId: BIZ_A,
      customerId: CUSTOMER_1,
      reportStatus: "RESOLVED",
    });
    await setDoc(doc(db, "chatRooms", ROOM_1, "messages", "m1"), {
      senderType: "CUSTOMER",
      content: "첫 메시지",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await setDoc(doc(db, "chatRooms", ROOM_1, "messages", "m2"), {
      senderType: "SYSTEM",
      content: "",
      type: "RESERVATION_CARD",
      payload: { reservationId: "r1" },
      createdAt: new Date("2026-01-01T00:01:00Z"),
    });
    await setDoc(doc(db, "chatRooms", ROOM_2, "messages", "m1"), {
      senderType: "CUSTOMER",
      content: "다른 방 메시지",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
  });
}

beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  const [hostname, port] = host.split(":");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: hostname,
      port: Number(port ?? 8080),
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

// ── (1) 고객 ────────────────────────────────────────────────────────────
describe("고객 (isCustomer)", () => {
  it("본인 방 문서를 읽을 수 있다", async () => {
    await assertSucceeds(getDoc(doc(asCustomer1(), "chatRooms", ROOM_1)));
  });

  it("본인 방의 메시지 목록을 createdAt 순으로 읽을 수 있다", async () => {
    const snap = await assertSucceeds(
      getDocs(query(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), orderBy("createdAt"))),
    );
    expect(snap.docs.map((d) => d.id)).toEqual(["m1", "m2"]);
  });

  it("본인 방에 CUSTOMER 메시지를 보낼 수 있다", async () => {
    await assertSucceeds(
      addDoc(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), msgPayload("CUSTOMER")),
    );
  });

  it("타인 방 문서는 읽을 수 없다", async () => {
    await assertFails(getDoc(doc(asCustomer2(), "chatRooms", ROOM_1)));
  });

  it("타인 방 메시지는 읽을 수 없다", async () => {
    await assertFails(getDocs(collection(asCustomer2(), "chatRooms", ROOM_1, "messages")));
    await assertFails(getDoc(doc(asCustomer2(), "chatRooms", ROOM_1, "messages", "m1")));
  });

  it("타인 방에 메시지를 보낼 수 없다", async () => {
    await assertFails(
      addDoc(collection(asCustomer2(), "chatRooms", ROOM_1, "messages"), msgPayload("CUSTOMER")),
    );
  });

  it("비로그인은 어떤 방도 읽을 수 없다", async () => {
    await assertFails(getDoc(doc(asAnon(), "chatRooms", ROOM_1)));
    await assertFails(getDocs(collection(asAnon(), "chatRooms", ROOM_1, "messages")));
  });
});

// ── (2) 사업장 스태프 ──────────────────────────────────────────────────
describe("사업장 스태프 (isStaff)", () => {
  it("businessId 일치 + canHandleChat=true 면 방·메시지 read 가능", async () => {
    await assertSucceeds(getDoc(doc(asStaffA(), "chatRooms", ROOM_1)));
    await assertSucceeds(getDocs(collection(asStaffA(), "chatRooms", ROOM_1, "messages")));
  });

  it("businessId 일치 + canHandleChat=true 면 BIZ 메시지 create 가능", async () => {
    await assertSucceeds(
      addDoc(collection(asStaffA(), "chatRooms", ROOM_1, "messages"), msgPayload("BIZ")),
    );
  });

  it("canHandleChat=false 면 businessId 가 일치해도 read 불가", async () => {
    await assertFails(getDoc(doc(asStaffANoChat(), "chatRooms", ROOM_1)));
    await assertFails(getDocs(collection(asStaffANoChat(), "chatRooms", ROOM_1, "messages")));
  });

  it("canHandleChat=false 면 create 불가", async () => {
    await assertFails(
      addDoc(collection(asStaffANoChat(), "chatRooms", ROOM_1, "messages"), msgPayload("BIZ")),
    );
  });

  it("다른 사업장 스태프는 canHandleChat=true 라도 read/create 불가", async () => {
    await assertFails(getDoc(doc(asStaffB(), "chatRooms", ROOM_1)));
    await assertFails(getDocs(collection(asStaffB(), "chatRooms", ROOM_1, "messages")));
    await assertFails(
      addDoc(collection(asStaffB(), "chatRooms", ROOM_1, "messages"), msgPayload("BIZ")),
    );
  });
});

// ── (3) 관리자 ─────────────────────────────────────────────────────────
describe("관리자 (isReviewer)", () => {
  it("reportStatus == 'PENDING' 인 방은 방·메시지 read 가능", async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), "chatRooms", ROOM_REPORTED)));
    await assertSucceeds(getDocs(collection(asAdmin(), "chatRooms", ROOM_REPORTED, "messages")));
  });

  it("reportStatus 필드가 없는 방은 read 불가 (필드 부재 = 거부, 에러 아님)", async () => {
    await assertFails(getDoc(doc(asAdmin(), "chatRooms", ROOM_1)));
    await assertFails(getDocs(collection(asAdmin(), "chatRooms", ROOM_1, "messages")));
  });

  it("reportStatus 가 PENDING 이 아닌(종결) 방은 read 불가", async () => {
    await assertFails(getDoc(doc(asAdmin(), "chatRooms", ROOM_RESOLVED)));
  });

  it("관리자는 신고 방이라도 메시지를 쓸 수 없다 (열람 전용)", async () => {
    await assertFails(
      addDoc(collection(asAdmin(), "chatRooms", ROOM_REPORTED, "messages"), msgPayload("BIZ")),
    );
  });

  it("admin 클레임이 없는 사용자는 PENDING 방이라도 열 수 없다", async () => {
    await assertFails(getDoc(doc(asCustomer2(), "chatRooms", ROOM_REPORTED)));
  });
});

// ── (4)(5) 메시지 create 유효성 ────────────────────────────────────────
describe("메시지 create 유효성", () => {
  it("senderType 'SYSTEM' 은 클라이언트가 만들 수 없다 (서버 전용)", async () => {
    await assertFails(
      addDoc(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), msgPayload("SYSTEM")),
    );
    await assertFails(
      addDoc(collection(asStaffA(), "chatRooms", ROOM_1, "messages"), msgPayload("SYSTEM")),
    );
  });

  it("senderType 이 없거나 알 수 없는 값이면 거부", async () => {
    await assertFails(
      addDoc(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), {
        content: "x",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      addDoc(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), msgPayload("ADMIN")),
    );
  });

  it("content 1000자는 허용, 1001자는 거부", async () => {
    await assertSucceeds(
      addDoc(
        collection(asCustomer1(), "chatRooms", ROOM_1, "messages"),
        msgPayload("CUSTOMER", { content: "a".repeat(1000) }),
      ),
    );
    await assertFails(
      addDoc(
        collection(asCustomer1(), "chatRooms", ROOM_1, "messages"),
        msgPayload("CUSTOMER", { content: "a".repeat(1001) }),
      ),
    );
  });

  it("content 가 문자열이 아니거나 없으면 거부", async () => {
    await assertFails(
      addDoc(
        collection(asCustomer1(), "chatRooms", ROOM_1, "messages"),
        msgPayload("CUSTOMER", { content: 123 }),
      ),
    );
    await assertFails(
      addDoc(collection(asCustomer1(), "chatRooms", ROOM_1, "messages"), {
        senderType: "CUSTOMER",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("메시지 update / delete 는 본인 메시지라도 클라이언트에서 불가", async () => {
    await assertFails(
      updateDoc(doc(asCustomer1(), "chatRooms", ROOM_1, "messages", "m1"), { content: "수정" }),
    );
    await assertFails(deleteDoc(doc(asCustomer1(), "chatRooms", ROOM_1, "messages", "m1")));
    await assertFails(
      updateDoc(doc(asStaffA(), "chatRooms", ROOM_1, "messages", "m1"), { deletedAt: serverTimestamp() }),
    );
  });
});

// ── (6) 방 문서 쓰기 ───────────────────────────────────────────────────
describe("방 문서 쓰기 (서버 Admin SDK 전용)", () => {
  it("고객이 자기 자신을 customerId 로 넣어 방을 만들 수 없다", async () => {
    await assertFails(
      setDoc(doc(asCustomer1(), "chatRooms", "room_new"), {
        businessId: BIZ_A,
        customerId: CUSTOMER_1,
      }),
    );
  });

  it("스태프가 방을 만들 수 없다", async () => {
    await assertFails(
      setDoc(doc(asStaffA(), "chatRooms", "room_new"), {
        businessId: BIZ_A,
        customerId: CUSTOMER_1,
      }),
    );
  });

  it("관리자도 방을 만들거나 reportStatus 를 바꿀 수 없다 (스스로 열람권 생성 차단)", async () => {
    await assertFails(
      setDoc(doc(asAdmin(), "chatRooms", "room_new"), { businessId: BIZ_A, customerId: CUSTOMER_1 }),
    );
    await assertFails(updateDoc(doc(asAdmin(), "chatRooms", ROOM_1), { reportStatus: "PENDING" }));
  });

  it("고객·스태프는 본인 방이라도 update / delete 불가", async () => {
    await assertFails(updateDoc(doc(asCustomer1(), "chatRooms", ROOM_1), { customerUnread: 0 }));
    await assertFails(updateDoc(doc(asStaffA(), "chatRooms", ROOM_1), { bizUnread: 0 }));
    await assertFails(deleteDoc(doc(asCustomer1(), "chatRooms", ROOM_1)));
  });

  it("chatRooms 밖의 임의 경로는 읽고 쓸 수 없다", async () => {
    await assertFails(getDoc(doc(asAdmin(), "users", "u1")));
    await assertFails(setDoc(doc(asCustomer1(), "users", CUSTOMER_1), { x: 1 }));
  });
});

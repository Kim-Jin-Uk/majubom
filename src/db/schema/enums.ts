import { pgEnum } from "drizzle-orm/pg-core";

/**
 * 02_기능명세서 §2.2 의 enum 전부. 값 추가는 "값 추가 전용 마이그레이션 1개 → 다음 마이그레이션에서 사용"
 * 2단계로만 한다 (08 §5.2 정정 3). 같은 파일에서 추가하고 쓰면 PG 가 거부한다.
 */

// ── User ─────────────────────────────────────────────────────────────
export const userProviderEnum = pgEnum("user_provider", ["LOCAL", "KAKAO", "GOOGLE"]);
export const globalRoleEnum = pgEnum("global_role", ["ADMIN", "USER"]);
export const userStatusEnum = pgEnum("user_status", ["ACTIVE", "SUSPENDED", "WITHDRAWN"]);

/** auth_tokens.kind — 단일사용 토큰 용도 (FR-AUTH-010/020/040 · 고객 이메일 검증) */
export const authTokenKindEnum = pgEnum("auth_token_kind", ["EMAIL_OTP", "EMAIL_VERIFY", "INVITE", "PASSWORD_RESET"]);

// ── BusinessMember ───────────────────────────────────────────────────
export const memberRoleEnum = pgEnum("member_role", ["OWNER", "MANAGER"]);
export const memberStatusEnum = pgEnum("member_status", ["INVITED", "ACTIVE", "INACTIVE"]);

// ── Business ─────────────────────────────────────────────────────────
export const businessStatusEnum = pgEnum("business_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "BLOCKED",
]);
export const businessPlanEnum = pgEnum("business_plan", ["FREE", "BASIC"]);

// ── Resource / Product ───────────────────────────────────────────────
export const resourceTypeEnum = pgEnum("resource_type", ["STAFF", "SPACE", "SHARED"]);
export const startModeEnum = pgEnum("start_mode", ["FREE", "FIXED"]);
export const resourceSelectModeEnum = pgEnum("resource_select_mode", [
  "REQUIRED",
  "OPTIONAL",
  "AUTO",
  "NONE",
]);
export const productStatusEnum = pgEnum("product_status", ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]);

// ── 근무 ─────────────────────────────────────────────────────────────
export const holidayTypeEnum = pgEnum("holiday_type", ["ONCE", "WEEKLY", "MONTHLY_DAY", "YEARLY"]);
export const workExceptionKindEnum = pgEnum("work_exception_kind", ["OFF", "MODIFIED", "BLOCK", "EXTRA"]);
/** 근무 예외 상태 — 사장님이 직접 둔 예외는 APPROVED, 매니저의 휴가 신청은 PENDING → APPROVED/REJECTED */
export const workExceptionStatusEnum = pgEnum("work_exception_status", ["PENDING", "APPROVED", "REJECTED"]);
export const swapTypeEnum = pgEnum("swap_type", ["GIVE", "EXCHANGE"]);
export const shiftSwapStatusEnum = pgEnum("shift_swap_status", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "APPROVED",
  "DENIED",
  "CANCELED",
  "EXPIRED",
]);

// ── Reservation ──────────────────────────────────────────────────────
export const reservationStatusEnum = pgEnum("reservation_status", [
  "REQUESTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELED_BY_USER",
  "CANCELED_BY_BIZ",
  "NO_SHOW",
  "REJECTED",
  "EXPIRED",
]);
export const noShowSourceEnum = pgEnum("no_show_source", ["MANUAL", "AUTO"]);
export const createdViaEnum = pgEnum("created_via", ["WEB", "CHAT", "WALK_IN"]);

// ── Review ───────────────────────────────────────────────────────────
export const reviewStatusEnum = pgEnum("review_status", ["PUBLISHED", "HIDDEN", "REPORTED"]);

// ── 알림 ─────────────────────────────────────────────────────────────
export const pushPlatformEnum = pgEnum("push_platform", ["IOS", "ANDROID", "DESKTOP"]);
export const eventGroupEnum = pgEnum("event_group", ["RESERVATION", "CHAT", "SCHEDULE", "MARKETING"]);
/**
 * FR-NOTI-010 이벤트 표. 명세는 이벤트 "이름"만 주고 코드 문자열은 정하지 않아
 * 표의 행 순서대로 여기서 코드를 확정한다 (수신자·채널 매핑은 코드 쪽 상수 테이블이 맡는다).
 */
export const notificationEventTypeEnum = pgEnum("notification_event_type", [
  "BUSINESS_APPLIED", // 사업자 가입 신청 → ADMIN
  "BUSINESS_APPROVED", // 가입 승인
  "BUSINESS_REJECTED", // 가입 반려
  "MEMBER_INVITED", // 매니저 초대
  "RESERVATION_REQUESTED", // 예약 접수
  "RESERVATION_CONFIRMED", // 예약 확정
  "RESERVATION_REJECTED", // 예약 거절
  "RESERVATION_CANCELED_BY_USER", // 예약 취소(고객)
  "RESERVATION_CANCELED_BY_BIZ", // 예약 취소(매장)
  "RESERVATION_REMINDER", // 방문 리마인드 (24h 전)
  "DAILY_RESERVATION_SUMMARY", // 당일 예약 요약 09:00
  "REQUEST_PENDING", // 승인 미처리 2h
  "SHIFT_REQUESTED", // 교대 요청
  "SHIFT_RESPONDED", // 교대 응답
  "SHIFT_APPROVED", // 교대 승인
  "USAGE_LIMIT_80", // 사용량 한도 80%
  "RESERVATION_EXPIRED", // 승인 대기 만료
  "CHAT_NEW_MESSAGE", // 새 채팅 메시지
  "CHAT_NEW_ROOM", // 신규 상담 개시
  "CHAT_UNANSWERED", // 채팅 미응답 15분
  "REPORT_RECEIVED", // 신고 접수 → ADMIN
  "REPORT_RESOLVED", // 신고 처리 결과 → 신고자
]);

// ── 운영 ─────────────────────────────────────────────────────────────
/** FR-ADM-040 action 목록. 그룹 순서 그대로. */
export const auditActionEnum = pgEnum("audit_action", [
  // 사업장
  "BUSINESS_APPROVE",
  "BUSINESS_REJECT",
  "BUSINESS_SUSPEND",
  "BUSINESS_BLOCK",
  "BUSINESS_RESTORE",
  "BUSINESS_UPDATE",
  "PLAN_LIMIT_UPDATE",
  // 구성원
  "MEMBER_CREATE",
  "MEMBER_DEACTIVATE",
  "MEMBER_REACTIVATE",
  "MEMBER_PERMISSION_UPDATE",
  // 상품·정책
  "PRODUCT_DELETE",
  "POLICY_UPDATE",
  // 근무
  "SCHEDULE_UPDATE",
  "SHIFT_APPROVE",
  "SHIFT_DENY",
  "HOLIDAY_BULK_CANCEL",
  "LEAVE_APPROVE", // 매니저 휴가 신청 승인
  "LEAVE_DENY", // 매니저 휴가 신청 반려
  // 예약
  "RESERVATION_STATUS_CHANGE",
  "RESERVATION_REASSIGN",
  "RESERVATION_CREATE_WALKIN",
  // 홈페이지
  "SITE_PUBLISH",
  "SITE_REVERT",
  // 신고·운영
  "REPORT_VIEW",
  "REPORT_ACTION",
  "CHAT_BLOCK",
  "USER_SUSPEND",
  // 인증
  "LOGIN_FAIL",
  "PASSWORD_CHANGE",
]);
export const reportTargetTypeEnum = pgEnum("report_target_type", ["CHAT_ROOM", "CHAT_MESSAGE", "REVIEW"]);
export const reportStatusEnum = pgEnum("report_status", ["PENDING", "RESOLVED", "DISMISSED"]);

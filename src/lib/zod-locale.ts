import { z } from "zod";

/**
 * zod 기본 메시지를 한국어로. 스키마에 직접 쓴 메시지가 우선하고, 안 쓴 곳(max·enum·url 등)의 영어 기본 문구가 화면에 새는 걸 막는다.
 * 서버(readJson)가 파싱하는 모듈에서 한 번 import 하면 전역 설정이다.
 */
z.config(z.locales.ko());

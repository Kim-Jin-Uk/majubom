"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui";

/** signOut → Auth.js 가 events.signOut 으로 리프레시 행을 폐기하고 두 쿠키를 지운다 */
export function LogoutButton({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <Button type="button" size={size} onClick={() => signOut({ redirectTo: "/" })}>
      로그아웃
    </Button>
  );
}

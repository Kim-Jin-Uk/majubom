"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui";

export function SocialButtons({ providers, next }: { providers: Array<"kakao" | "google">; next: string }) {
  if (providers.length === 0) return null;
  return (
    <div className="form">
      {providers.includes("kakao") && (
        <Button type="button" variant="kakao" block onClick={() => signIn("kakao", { redirectTo: next })}>
          카카오로 계속하기
        </Button>
      )}
      {providers.includes("google") && (
        <Button type="button" block onClick={() => signIn("google", { redirectTo: next })}>
          Google로 계속하기
        </Button>
      )}
    </div>
  );
}

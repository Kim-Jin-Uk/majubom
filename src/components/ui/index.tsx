import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * 최소 UI 키트 (이슈 #11 "공통 UI 컴포넌트" 의 첫 조각). 스타일은 globals.css 의 .card/.field/.input/.btn/.alert.
 * 색은 토큰만 쓴다. 인증 화면이 필요로 하는 것만 두고, 나중 화면이 필요할 때 늘린다.
 */

export function AuthShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="auth-shell">
      <Link href="/" aria-label="마주,봄 홈">
        <Logo size={30} />
      </Link>
      <div className={wide ? "card card--wide" : "card"}>{children}</div>
      <ThemeToggle size={34} />
    </main>
  );
}

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: string; error?: string | null; htmlFor: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <span className="err" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={["input", className].filter(Boolean).join(" ")} />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "default" | "danger" | "kakao"; block?: boolean; size?: "md" | "sm"; loading?: boolean };

export function Button({ variant = "default", block, size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const cls = ["btn", variant !== "default" && `btn--${variant}`, block && "btn--block", size === "sm" && "btn--sm", className].filter(Boolean).join(" ");
  return (
    <button {...rest} className={cls} disabled={disabled || loading} aria-busy={loading || undefined}>
      {children}
      {loading && <span aria-hidden="true">…</span>}
    </button>
  );
}

export function Alert({ kind = "info", children }: { kind?: "error" | "ok" | "warn" | "info"; children: ReactNode }) {
  return (
    <div className={`alert alert--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return <div className="divider">{children}</div>;
}

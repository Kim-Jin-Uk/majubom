import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 24,
        textAlign: "center",
      }}
    >
      <Logo size={40} />
      <p style={{ margin: 0, color: "var(--text-2)" }}>마주,봄 — 준비 중입니다</p>
      <ThemeToggle />
    </main>
  );
}

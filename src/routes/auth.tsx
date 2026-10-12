import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/app-shell";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — نظام هادي للتداول" },
      { name: "description", content: "سجّل دخولك إلى نظام هادي الشخصي للتداول." },
      { property: "og:title", content: "تسجيل الدخول — نظام هادي للتداول" },
      { property: "og:description", content: "سجّل دخولك إلى نظام هادي الشخصي للتداول." },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

/** Falling white petals — deterministic values so nothing jumps between renders. */
const PETALS = Array.from({ length: 26 }, (_, i) => {
  const r = (n: number) => { const v = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  return {
    x: `${Math.round(r(1) * 100)}%`,
    size: `${Math.round(10 + r(2) * 12)}px`,
    dur: `${(9 + r(3) * 9).toFixed(1)}s`,
    delay: `${(-r(4) * 18).toFixed(1)}s`,
    sway: `${Math.round((r(5) - 0.5) * 140)}px`,
    spin: `${Math.round(240 + r(6) * 480)}deg`,
  };
});

function Petals() {
  return (
    <div className="petals" aria-hidden="true">
      {PETALS.map((p, i) => (
        <span key={i} className="petal" style={{ "--x": p.x, "--size": p.size, "--dur": p.dur, "--delay": p.delay, "--sway": p.sway, "--spin": p.spin } as React.CSSProperties} />
      ))}
    </div>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    setEmail(localStorage.getItem("hadi-last-email") ?? "");
    setRemember(localStorage.getItem("hadi-ephemeral") !== "1");
  }, []);
  function keep() {
    if (remember) { localStorage.setItem("hadi-last-email", email); localStorage.removeItem("hadi-ephemeral"); }
    else { localStorage.removeItem("hadi-last-email"); localStorage.setItem("hadi-ephemeral", "1"); sessionStorage.setItem("hadi-session-only", "1"); }
  }
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        keep();
        navigate({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        if (data.session) { keep(); navigate({ to: "/dashboard" }); }
        else toast.success("تم إنشاء الحساب، سجّل دخولك الحين.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg.includes("Invalid login") ? "البريد أو كلمة المرور غير صحيحة." : msg.includes("already registered") ? "الإيميل مسجّل من قبل، سجّل دخولك." : msg.includes("Password should") ? "الباسورد لازم 6 حروف أو أكثر." : msg.includes("confirm") ? "يرجى تأكيد بريدك الإلكتروني أولاً." : "تعذر إتمام العملية، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Petals />
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="mb-6 text-center">
          <p className="text-lg font-bold leading-relaxed sm:text-xl">تهانينا سيد هادي</p>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">أفضل نظام تداول في العالم</p>
        </div>
        <form onSubmit={submit} className="panel glow-primary space-y-5 p-8">
          <div>
            <h1 className="text-2xl font-bold">{mode === "in" ? "مرحباً هادي" : "إنشاء حسابك"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">تداول بثقة. التزم بخطتك.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input id="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input id="password" type="password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            تذكرني على هذا الجهاز
          </label>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "جارٍ التنفيذ…" : mode === "in" ? "تسجيل الدخول" : "إنشاء الحساب"}
          </Button>
          <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
            {mode === "in" ? "ما عندك حساب؟ أنشئ حساب" : "عندك حساب؟ سجّل الدخول"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs tracking-[0.2em] text-muted-foreground">انضباط. استراتيجية. حرية.</p>
      </div>
    </div>
  );
}

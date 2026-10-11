import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard` },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/dashboard" });
        else toast.success("تم إنشاء الحساب. افتح بريدك لتأكيد الحساب ثم سجّل الدخول.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg.includes("Invalid login") ? "البريد أو كلمة المرور غير صحيحة." : msg.includes("confirm") ? "يرجى تأكيد بريدك الإلكتروني أولاً." : "تعذر إتمام العملية، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
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

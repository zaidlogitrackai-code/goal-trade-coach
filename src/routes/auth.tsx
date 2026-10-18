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

/**
 * Sign-in only: this is one trader's personal app, so the public sign-up toggle is gone.
 * Sign-ups also have to be turned off in the backend's auth settings (Lovable manages them),
 * otherwise the API still accepts a new account.
 */
function AuthPage() {
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
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      keep();
      navigate({ to: "/dashboard" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg.includes("Invalid login") ? "البريد أو كلمة المرور غير صحيحة." : msg.includes("confirm") ? "يرجى تأكيد بريدك الإلكتروني أولاً." : "تعذر إتمام العملية، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="panel glow-primary space-y-5 p-8">
          <div>
            <h1 className="text-2xl font-bold">مرحباً هادي</h1>
            <p className="mt-1 text-sm text-muted-foreground">تداول بثقة. التزم بخطتك.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" enterKeyHint="go" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
            تذكرني على هذا الجهاز
          </label>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "جارٍ الدخول…" : "تسجيل الدخول"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">انضباط. استراتيجية. حرية.</p>
      </div>
    </div>
  );
}

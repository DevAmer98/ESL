"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { Btn, Field, Spinner } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/auth/login", { email, password });
      // Straight to the requested page, or the only store they have, or the picker.
      if (next) router.replace(next);
      else if (res.stores.length === 1) router.replace(`/stores/${res.stores[0].id}`);
      else router.replace("/stores");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form onSubmit={submit} style={{ width: "min(380px, 92vw)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center",
            background: "linear-gradient(140deg,var(--accent),var(--blue))",
            color: "#04211D", fontWeight: 900, fontSize: 17,
          }}>❄</div>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: 1, fontSize: 15, color: "var(--ink)" }}>
              FROSTLINE
            </div>
            <div style={{ fontSize: 10, color: "var(--faint)", letterSpacing: 1.5 }}>
              ESL CONSOLE
            </div>
          </div>
        </div>

        <div className="card">
          <Field label="Email" type="email" value={email} autoComplete="username"
            autoFocus required onChange={(e) => setEmail(e.target.value)} />
          <Field label="Password" type="password" value={password}
            autoComplete="current-password" required
            onChange={(e) => setPassword(e.target.value)} />

          {error && (
            <div style={{
              color: "var(--bad)", fontSize: 12.5, marginBottom: 12,
              padding: "8px 10px", background: "rgba(242,121,92,.08)",
              border: "1px solid #3A2420", borderRadius: 8,
            }}>{error}</div>
          )}

          <Btn kind="primary" type="submit" disabled={busy}
            style={{ width: "100%", justifyContent: "center" }}>
            {busy ? <Spinner /> : null} Sign in
          </Btn>
        </div>
      </form>
    </div>
  );
}

// useSearchParams() opts the subtree out of prerendering, so it needs its own
// boundary — without it the whole /login route fails to build.
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="center-screen"><Spinner /></div>}>
      <LoginForm />
    </Suspense>
  );
}

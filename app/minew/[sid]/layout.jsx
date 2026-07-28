"use client";
// Per-store console shell — the left sidebar for a Minew store. Everything under
// /minew/[sid] renders inside it, mirroring the Minew store console layout.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client/api";

const NAV = [
  { seg: "", label: "Store Overview", icon: "▦" },
  { seg: "data", label: "Store Data", icon: "◫" },
  { seg: "templates", label: "Templates", icon: "❏" },
  { seg: "gateways", label: "Gateways", icon: "◈" },
  { seg: "devices", label: "Devices", icon: "▤" },
  { seg: "settings", label: "Store Settings", icon: "⚙" },
  { seg: "statistics", label: "Statistical Analysis", icon: "◨" },
];

export default function MinewStoreLayout({ children, params }) {
  const { sid } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    api.get("/auth/me").then((r) => setUser(r.user)).catch(() => {});
    api.get("/minew/stores")
      .then((r) => setStoreName(r.stores.find((x) => x.id === sid)?.name ?? ""))
      .catch(() => {});
  }, [sid]);

  const base = `/minew/${sid}`;
  const current = pathname.replace(base, "").replace(/^\//, "").split("/")[0];

  async function signOut() {
    await api.post("/auth/logout").catch(() => {});
    router.replace("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div style={{ padding: "4px 8px 16px", display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center",
            background: "linear-gradient(140deg,var(--accent),var(--blue))",
            color: "#04211D", fontWeight: 900, fontSize: 14,
          }}>❄</div>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: 1, fontSize: 14 }}>FROSTLINE</div>
            <div style={{ fontSize: 9.5, color: "var(--faint)", letterSpacing: 1.5 }}>ESL CONSOLE</div>
          </div>
        </div>

        <Link href="/minew" style={{ color: "inherit", textDecoration: "none" }}>
          <div className="faint" style={{ fontSize: 11.5, padding: "0 10px 4px", cursor: "pointer" }}>
            ← All stores
          </div>
        </Link>
        <div style={{ fontSize: 12.5, padding: "0 10px 12px", color: "var(--dim)" }}>
          {storeName || "…"}
        </div>

        <nav>
          {NAV.map((n) => (
            <Link key={n.seg || "overview"} href={n.seg ? `${base}/${n.seg}` : base}
              style={{ color: "inherit", textDecoration: "none" }}>
              <div className={`nav-item${current === n.seg ? " active" : ""}`}>
                <span className="nav-icon">{n.icon}</span>{n.label}
              </div>
            </Link>
          ))}
        </nav>

        <div style={{
          marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--line-soft)",
          fontSize: 11.5, color: "var(--faint)", lineHeight: 1.7,
        }}>
          <div style={{ color: "var(--dim)" }}>{user?.name}</div>
          <div onClick={signOut} style={{ cursor: "pointer", marginTop: 6, color: "var(--dim)" }}>
            Sign out →
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

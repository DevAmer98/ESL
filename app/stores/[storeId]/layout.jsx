"use client";
// The console shell: sidebar navigation, store switcher, account menu.
// Everything under /stores/[storeId] renders inside it.
import { use } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider, useSession } from "@/components/Session";
import { ToastProvider } from "@/components/ui";
import { api } from "@/lib/client/api";

const NAV = [
  { seg: "", label: "Overview", icon: "▦" },
  { seg: "data", label: "Store Data", icon: "◫" },
  { seg: "templates", label: "Templates", icon: "❏" },
  { seg: "gateways", label: "Gateways", icon: "◈" },
  { seg: "devices", label: "Devices", icon: "▤" },
  { seg: "settings", label: "Store Settings", icon: "⚙" },
  { seg: "statistics", label: "Statistical Analysis", icon: "◨" },
];

function Sidebar({ storeId }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, stores, store, role } = useSession();

  const base = `/stores/${storeId}`;
  const current = pathname.replace(base, "").replace(/^\//, "").split("/")[0];

  async function signOut() {
    await api.post("/auth/logout").catch(() => {});
    router.replace("/login");
  }

  return (
    <aside className="sidebar">
      <div style={{ padding: "4px 8px 16px", display: "flex", alignItems: "center", gap: 9 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center",
          background: "linear-gradient(140deg,var(--accent),var(--blue))",
          color: "#04211D", fontWeight: 900, fontSize: 14,
        }}>❄</div>
        <div>
          <div style={{ fontWeight: 800, letterSpacing: 1, fontSize: 14 }}>FROSTLINE</div>
          <div style={{ fontSize: 9.5, color: "var(--faint)", letterSpacing: 1.5 }}>
            ESL CONSOLE
          </div>
        </div>
      </div>

      {/* Store switcher — only worth showing when there is a choice to make. */}
      {stores.length > 1 ? (
        <select className="select" style={{ marginBottom: 12, fontSize: 12.5 }}
          value={storeId}
          onChange={(e) => router.push(`/stores/${e.target.value}`)}>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        <div className="faint" style={{ fontSize: 11.5, padding: "0 10px 12px" }}>
          {store?.name ?? "…"}
        </div>
      )}

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
        <div>{role?.toLowerCase()}</div>
        <div onClick={signOut}
          style={{ cursor: "pointer", marginTop: 6, color: "var(--dim)" }}>
          Sign out →
        </div>
      </div>
    </aside>
  );
}

export default function StoreLayout({ children, params }) {
  const { storeId } = use(params);
  return (
    <SessionProvider storeId={storeId}>
      <ToastProvider>
        <div className="shell">
          <Sidebar storeId={storeId} />
          <main className="main">{children}</main>
        </div>
      </ToastProvider>
    </SessionProvider>
  );
}

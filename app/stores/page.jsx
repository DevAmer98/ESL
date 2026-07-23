"use client";
// Store picker — shown when a user belongs to more than one store.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Card, Chip, Spinner } from "@/components/ui";

export default function StorePicker() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, stores: [] });

  useEffect(() => {
    api.get("/auth/me")
      .then((res) => {
        // One store is not a choice — skip the screen entirely.
        if (res.stores.length === 1) router.replace(`/stores/${res.stores[0].id}`);
        else setState({ loading: false, stores: res.stores });
      })
      .catch(() => setState({ loading: false, stores: [] }));
  }, [router]);

  if (state.loading) return <div className="center-screen"><Spinner /></div>;

  return (
    <div className="page" style={{ maxWidth: 760, margin: "0 auto", paddingTop: 60 }}>
      <div className="page-head">
        <div>
          <h1>Choose a store</h1>
          <div className="sub">You have access to {state.stores.length} stores</div>
        </div>
      </div>

      {state.stores.length === 0 && (
        <Card><div className="empty">
          No stores are assigned to your account. Ask an administrator for access.
        </div></Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))" }}>
        {state.stores.map((s) => (
          <Card key={s.id} style={{ cursor: "pointer" }}
            onClick={() => router.push(`/stores/${s.id}`)}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{s.name}</div>
            <Chip>{s.role.toLowerCase()}</Chip>
          </Card>
        ))}
      </div>
    </div>
  );
}

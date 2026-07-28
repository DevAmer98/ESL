"use client";
// Minew store manager — lists every store on the Minew backend and lets an
// admin create one. Data is live from /api/minew/stores (which proxies Minew's
// esl/store/list + esl/store/add); nothing is stored locally.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Btn, Card, Chip, Spinner, Modal, Field, useToast } from "@/components/ui";

export default function MinewStores() {
  const router = useRouter();
  const [state, setState] = useState({ loading: true, stores: [], error: null });
  const [adding, setAdding] = useState(false);

  async function load() {
    setState((s) => ({ ...s, loading: true }));
    try {
      const res = await api.get("/minew/stores");
      setState({ loading: false, stores: res.stores, error: null });
    } catch (err) {
      setState({ loading: false, stores: [], error: err.message });
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="page" style={{ maxWidth: 1000, margin: "0 auto", paddingTop: 40 }}>
      <div className="page-head">
        <div>
          <h1>Stores</h1>
          <div className="sub">Live from your Minew backend</div>
        </div>
        <div className="inline" style={{ gap: 8 }}>
          <Btn onClick={load} disabled={state.loading}>
            {state.loading ? <Spinner /> : "↻"} Reload
          </Btn>
          <Btn kind="primary" onClick={() => setAdding(true)}>+ Add store</Btn>
        </div>
      </div>

      {state.error && (
        <Card><div className="empty" style={{ color: "var(--bad)" }}>{state.error}</div></Card>
      )}

      {state.loading ? (
        <div className="center-screen"><Spinner /></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
          {state.stores.map((s) => (
            <Card key={s.id} style={{ cursor: "pointer" }}
              onClick={() => router.push(`/minew/${s.id}`)}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{s.name}</div>
              <div className="hint">#{s.number} · {s.address}</div>
              <div style={{ marginTop: 8 }}>
                <Chip tone={s.active ? "ok" : ""}>{s.active ? "active" : "closed"}</Chip>
              </div>
            </Card>
          ))}
          {!state.stores.length && !state.error && (
            <Card><div className="empty">No stores yet. Add one to get started.</div></Card>
          )}
        </div>
      )}

      {adding && <AddStoreModal onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}

function AddStoreModal({ onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ number: "", name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      await api.post("/minew/stores", form);
      toast.ok("Store created");
      onSaved();
      onClose();
    } catch (err) {
      toast.bad(err.message);
      setBusy(false);
    }
  }

  const ready = form.number && form.name && form.address;
  return (
    <Modal title="New store" onClose={onClose} footer={
      <>
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !ready}>
          {busy ? <Spinner /> : null} Create
        </Btn>
      </>
    }>
      <Field label="Store number *" value={form.number} onChange={set("number")}
        placeholder="1002" hint="Digits only, unique across the account." />
      <Field label="Name *" value={form.name} onChange={set("name")} placeholder="SVS Riyadh" />
      <Field label="Address *" value={form.address} onChange={set("address")}
        placeholder="Riyadh, Saudi Arabia" />
    </Modal>
  );
}

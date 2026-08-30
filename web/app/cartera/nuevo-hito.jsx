"use client";
import { useState } from "react";

export default function NuevoHito({ proyectos, actorId }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ project_code: "", amount_cop: "", expected_date: "",
    contract_date: "", deliverables: "" });
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  async function crear() {
    if (!actorId) { setMsj("Elige arriba quién registra."); return; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/hitos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "crear", actor_id: Number(actorId), ...f,
        amount_cop: Number(f.amount_cop) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  if (!abierto) {
    return <button className="btn" onClick={() => setAbierto(true)}>Registrar hito de ingreso</button>;
  }
  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select style={{ ...sel, minWidth: 260 }} value={f.project_code}
        onChange={(e) => set("project_code", e.target.value)}>
        <option value="">— Proyecto —</option>
        {proyectos.map((p) => <option key={p.code} value={p.code}>{p.display_code}</option>)}
      </select>
      <input className="mini" type="number" min="1" placeholder="Monto COP" style={{ width: 150 }}
        value={f.amount_cop} onChange={(e) => set("amount_cop", e.target.value)} />
      <input className="mini" type="date" title="Fecha esperada de cobro"
        value={f.expected_date} onChange={(e) => set("expected_date", e.target.value)} />
      <input className="mini" style={{ flex: "1 1 220px" }} placeholder="Entregables del hito"
        value={f.deliverables} onChange={(e) => set("deliverables", e.target.value)} />
      <button className="btn" disabled={ocupado || !f.project_code || !f.amount_cop || !f.expected_date}
        onClick={crear}>Crear hito</button>
      <button className="btn sec" onClick={() => setAbierto(false)}>Cerrar</button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 12 }}>{msj}</span>}
    </div>
  );
}

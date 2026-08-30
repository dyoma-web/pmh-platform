"use client";
import { useState } from "react";

export default function Asignador({ usuarios, proyectos, semanas }) {
  const [f, setF] = useState({ actor: "", user_id: "", project_code: "", week: semanas[0], pct: "" });
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  async function asignar() {
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/potenciacion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "asignar", actor_id: Number(f.actor),
        user_id: Number(f.user_id), project_code: f.project_code,
        week: f.week, dedication_pct: Number(f.pct) }),
    });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (r.ok) {
      if (j.sobrecarga) setMsj(`Guardado — ojo: esa semana queda al ${j.total_semana} %.`);
      else window.location.reload();
    } else setMsj(j.error || "Error inesperado.");
  }

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };

  return (
    <section className="plancha">
      <h2>Asignar dedicación <span className="mid">0 % BORRA LA ASIGNACIÓN</span></h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select style={sel} value={f.actor} onChange={(e) => set("actor", e.target.value)}>
          <option value="">— Quién registra —</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select style={sel} value={f.user_id} onChange={(e) => set("user_id", e.target.value)}>
          <option value="">— Persona —</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select style={{ ...sel, minWidth: 240 }} value={f.project_code}
          onChange={(e) => set("project_code", e.target.value)}>
          <option value="">— Proyecto —</option>
          {proyectos.map((p) => <option key={p.code} value={p.code}>{p.display_code}</option>)}
        </select>
        <select style={sel} value={f.week} onChange={(e) => set("week", e.target.value)}>
          {semanas.map((s) => <option key={s} value={s}>semana del {s}</option>)}
        </select>
        <input className="mini" type="number" min="0" max="100" placeholder="%"
          style={{ width: 80 }} value={f.pct} onChange={(e) => set("pct", e.target.value)} />
        <button className="btn" disabled={ocupado || !f.actor || !f.user_id || !f.project_code || f.pct === ""}
          onClick={asignar}>Asignar</button>
        {msj && <span style={{ fontSize: 12, color: msj.startsWith("Guardado") ? "var(--alerta)" : "var(--critico)" }}>{msj}</span>}
      </div>
    </section>
  );
}

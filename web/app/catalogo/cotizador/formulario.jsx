"use client";
import { useMemo, useState } from "react";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const filaLinea = () => ({ ihpsc_code: "", description: "", unit: "", qty: "", unit_price: "", ref: null });

export default function FormularioCotizacion({ usuarios, clientes, items }) {
  const [actor, setActor] = useState("");
  const [title, setTitle] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [lineas, setLineas] = useState([filaLinea()]);
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const total = useMemo(() => lineas.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0), [lineas]);
  const costoRef = useMemo(() => lineas.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.ref) || 0), 0), [lineas]);
  const margen = total > 0 && costoRef > 0 ? (1 - costoRef / total) * 100 : null;

  const setL = (i, patch) => setLineas(lineas.map((x, ix) => (ix === i ? { ...x, ...patch } : x)));

  async function crear() {
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/potenciacion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "cotizacion_crear", actor_id: Number(actor),
        title, client_id: clienteId ? Number(clienteId) : undefined,
        lineas: lineas.filter((l) => l.description && l.qty) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };

  return (
    <section className="plancha">
      <h2>Nueva cotización{" "}
        <span className="mid" style={{ color: margen == null ? undefined : margen < 30 ? "var(--critico)" : "var(--correcto)" }}>
          $ {nf.format(total)} COP{margen != null ? ` · MARGEN ESPERADO ${nf.format(Math.round(margen))} %` : ""}
        </span></h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select style={sel} value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">— Quién cotiza —</option>
          {usuarios.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <input className="mini" style={{ flex: "1 1 260px", height: 40 }} placeholder="Título de la propuesta"
          value={title} onChange={(e) => setTitle(e.target.value)} />
        <select style={sel} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">— Cliente (opcional) —</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {lineas.map((l, i) => {
        const lineaMargen = Number(l.unit_price) > 0 && Number(l.ref) > 0
          ? (1 - Number(l.ref) / Number(l.unit_price)) * 100 : null;
        return (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
            <select style={{ ...sel, height: 32, minWidth: 250, fontSize: 12 }} value={l.ihpsc_code}
              onChange={(e) => {
                const it = items.find((x) => x.code === e.target.value);
                setL(i, { ihpsc_code: e.target.value,
                  description: l.description || it?.name || "",
                  unit: l.unit || it?.unit || "",
                  ref: it?.ref_cost ?? null,
                  unit_price: l.unit_price || (it?.ref_cost ? Math.round(it.ref_cost * 1.4) : "") });
              }}>
              <option value="">— Ítem IHPSC —</option>
              {items.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} · {x.name?.slice(0, 34)}{x.ref_cost ? ` · ref $${nf.format(x.ref_cost)}` : ""}
                </option>
              ))}
            </select>
            <input className="mini" style={{ flex: "1 1 160px" }} placeholder="Descripción"
              value={l.description} onChange={(e) => setL(i, { description: e.target.value })} />
            <input className="mini" style={{ width: 80 }} placeholder="Cant." type="number"
              value={l.qty} onChange={(e) => setL(i, { qty: e.target.value })} />
            <input className="mini" style={{ width: 130 }} placeholder="Precio unit." type="number"
              value={l.unit_price} onChange={(e) => setL(i, { unit_price: e.target.value })} />
            <span className="notaf" style={{ minWidth: 120 }}>
              {l.ref ? `costo ref $ ${nf.format(l.ref)}` : "sin costo ref."}
              {lineaMargen != null ? ` · ${nf.format(Math.round(lineaMargen))} %` : ""}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn sec" onClick={() => setLineas([...lineas, filaLinea()])}>Agregar línea</button>
        <button className="btn" disabled={ocupado || !actor || !title.trim() || total <= 0} onClick={crear}>
          Crear cotización
        </button>
        {msj && <span style={{ color: "var(--critico)", fontSize: 13 }}>{msj}</span>}
      </div>
    </section>
  );
}

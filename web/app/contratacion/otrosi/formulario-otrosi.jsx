"use client";
import { useMemo, useState } from "react";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export default function FormularioOtrosi({ actorId, contratos, pagosPend }) {
  const [contrato, setContrato] = useState("");
  const [efecto, setEfecto] = useState("monto");
  const [detalle, setDetalle] = useState("");
  const [nuevoMonto, setNuevoMonto] = useState("");
  const [pagoId, setPagoId] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState("");
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const k = useMemo(() => contratos.find((c) => c.code === contrato), [contrato, contratos]);
  const pagosDelContrato = useMemo(
    () => pagosPend.filter((p) => p.contract_code === contrato), [contrato, pagosPend]);

  async function enviar() {
    if (!actorId) { setMsj("Elige arriba quién solicita."); return; }
    setOcupado(true); setMsj(null);
    const changes = efecto === "monto" ? { nuevo_monto: Number(nuevoMonto) }
      : efecto === "fechas" ? { pago_id: Number(pagoId), nueva_fecha: nuevaFecha }
      : efecto === "plazo" ? { nueva_fecha_fin: nuevaFecha } : {};
    const r = await fetch("/api/otrosi", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "solicitar", actor_id: Number(actorId),
        contract_code: contrato, effect: efecto, detail: detalle, changes }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  const sel = { height: 40, border: "1px solid var(--filete)", borderRadius: 8, padding: "0 10px",
    font: "13px var(--fx-archivo)", background: "var(--plancha)", color: "var(--tinta-1)" };

  return (
    <section className="plancha">
      <h2>Solicitar otrosí</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...sel, minWidth: 300 }} value={contrato} onChange={(e) => setContrato(e.target.value)}>
          <option value="">— Contrato activo —</option>
          {contratos.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.contratista} · $ {nf.format(c.amount)}
            </option>
          ))}
        </select>
        <select style={sel} value={efecto} onChange={(e) => setEfecto(e.target.value)}>
          <option value="monto">Cambia el monto</option>
          <option value="fechas">Mueve un pago</option>
          <option value="plazo">Prorroga el plazo (fecha de fin)</option>
          <option value="alcance">Cambia el alcance</option>
          <option value="anulacion">Anula el contrato</option>
        </select>
        {efecto === "monto" && (
          <input className="mini" type="number" min="1" placeholder={`Nuevo monto${k ? ` (actual $ ${nf.format(k.amount)})` : ""}`}
            style={{ width: 220 }} value={nuevoMonto} onChange={(e) => setNuevoMonto(e.target.value)} />
        )}
        {efecto === "plazo" && (
          <input className="mini" type="date" style={{ width: 160 }}
            title={k?.end_date ? `Fin actual ${String(k.end_date).slice(0, 10)}` : ""}
            value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} />
        )}
        {efecto === "fechas" && (
          <>
            <select style={{ ...sel, minWidth: 220 }} value={pagoId} onChange={(e) => setPagoId(e.target.value)}>
              <option value="">— Pago a mover —</option>
              {pagosDelContrato.map((p) => (
                <option key={p.id} value={p.id}>
                  {new Date(p.due_date).toISOString().slice(0, 10)} · $ {nf.format(p.amount)}
                </option>
              ))}
            </select>
            <input className="mini" type="date" style={{ width: 160 }}
              value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} />
          </>
        )}
      </div>
      <input className="mini" style={{ width: "100%", marginTop: 10 }}
        placeholder="Detalle obligatorio: qué cambia y por qué (es lo que lee quien resuelve)"
        value={detalle} onChange={(e) => setDetalle(e.target.value)} />
      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn" disabled={ocupado || !contrato || !detalle.trim()} onClick={enviar}>
          Solicitar otrosí
        </button>
        {msj && <span style={{ color: "var(--critico)", fontSize: 13 }}>{msj}</span>}
      </div>
    </section>
  );
}

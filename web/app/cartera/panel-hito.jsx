"use client";
import { useState } from "react";
import { Subidor } from "../contratacion/firmas/acciones-pago";

const nf = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

// Acciones sobre un hito: facturar, acreditar (abonos), reprogramar forecast,
// registrar gestión de cobro. Un panel por modo; nada de botones grises.
export default function PanelHito({ hito, actorId }) {
  const [modo, setModo] = useState(null);
  const [msj, setMsj] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({
    invoice_date: "", invoice_number: "", invoice_url: "",
    monto: hito.saldo ?? hito.amount_cop, fecha: "", soporte_url: "",
    forecast_date: "", delay_category: "externo", nota: "",
  });
  const set = (k, v) => setF({ ...f, [k]: v });

  async function enviar(accion, payload) {
    if (!actorId) { setMsj("Elige arriba quién actúa."); return; }
    setOcupado(true); setMsj(null);
    const r = await fetch("/api/hitos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, hito_id: hito.id, actor_id: Number(actorId), ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) window.location.reload();
    else { setMsj(j.error || "Error inesperado."); setOcupado(false); }
  }

  const chip = (id, label) => (
    <button className="btn sec" style={{ padding: "4px 10px", fontSize: 11.5 }}
      onClick={() => { setModo(modo === id ? null : id); setMsj(null); }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {hito.state === "scheduled" && chip("facturar", "Facturar")}
        {["invoiced", "partial"].includes(hito.state) && chip("acreditar", "Acreditar abono")}
        {chip("gestion", "Registrar gestión")}
        {chip("reprogramar", "Reprogramar")}
      </div>

      {modo === "facturar" && (
        <div className="panelmini">
          <input className="mini" type="date" value={f.invoice_date}
            onChange={(e) => set("invoice_date", e.target.value)} title="Fecha de factura" />
          <input className="mini" placeholder="N.º de factura" value={f.invoice_number}
            onChange={(e) => set("invoice_number", e.target.value)} style={{ width: 130 }} />
          <Subidor etiqueta="factura" valor={f.invoice_url}
            onUrl={(v) => set("invoice_url", v)} origen="factura_cliente" />
          <button className="btn" disabled={ocupado}
            onClick={() => enviar("facturar", { invoice_date: f.invoice_date || undefined,
              invoice_number: f.invoice_number || undefined, invoice_url: f.invoice_url || undefined })}>
            Marcar facturado
          </button>
        </div>
      )}

      {modo === "acreditar" && (
        <div className="panelmini">
          <input className="mini" type="number" min="1" value={f.monto}
            onChange={(e) => set("monto", e.target.value)}
            title={`Saldo: $ ${nf.format(hito.saldo ?? hito.amount_cop)}`} style={{ width: 150 }} />
          <input className="mini" type="date" value={f.fecha}
            onChange={(e) => set("fecha", e.target.value)} title="Fecha del abono" />
          <Subidor etiqueta="soporte" valor={f.soporte_url}
            onUrl={(v) => set("soporte_url", v)} origen="soporte_abono" />
          <button className="btn" disabled={ocupado}
            onClick={() => enviar("acreditar", { monto_cop: Number(f.monto),
              fecha: f.fecha || undefined, soporte_url: f.soporte_url || undefined })}>
            Registrar abono
          </button>
        </div>
      )}

      {modo === "gestion" && (
        <div className="panelmini">
          <input className="mini" style={{ width: 300 }} value={f.nota}
            placeholder="Qué se hizo y qué quedó acordado"
            onChange={(e) => set("nota", e.target.value)} />
          <button className="btn" disabled={ocupado || !f.nota.trim()}
            onClick={() => enviar("gestion", { nota: f.nota })}>Registrar gestión de cobro</button>
        </div>
      )}

      {modo === "reprogramar" && (
        <div className="panelmini">
          <input className="mini" type="date" value={f.forecast_date}
            onChange={(e) => set("forecast_date", e.target.value)} title="Nueva fecha probable" />
          <select className="mini" style={{ width: 110 }} value={f.delay_category}
            onChange={(e) => set("delay_category", e.target.value)}>
            <option value="externo">Externo</option><option value="interno">Interno</option>
            <option value="mixto">Mixto</option><option value="otro">Otro</option>
          </select>
          <input className="mini" style={{ width: 220 }} value={f.nota}
            placeholder="Motivo (obligatorio)" onChange={(e) => set("nota", e.target.value)} />
          <button className="btn" disabled={ocupado}
            onClick={() => enviar("reprogramar", { forecast_date: f.forecast_date,
              delay_category: f.delay_category, nota: f.nota })}>
            Mover forecast
          </button>
        </div>
      )}
      {msj && <div style={{ color: "var(--critico)", fontSize: 12, maxWidth: 340, textAlign: "right" }}>{msj}</div>}
    </div>
  );
}

"use client";
import { useState } from "react";

// Sube al almacén propio (/api/archivos: dedup por hash, URL firmada) o acepta un enlace.
function Subidor({ etiqueta, valor, onUrl, origen }) {
  const [subiendo, setSubiendo] = useState(false);
  async function archivo(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSubiendo(true);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("origen", origen);
    const r = await fetch("/api/archivos", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setSubiendo(false);
    if (r.ok) onUrl(j.url);
    else alert(j.error || "No se pudo subir el archivo.");
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input value={valor} onChange={(e) => onUrl(e.target.value)}
        placeholder={`URL ${etiqueta}`} className="mini" style={{ width: 160 }} />
      <label className="btn sec" style={{ padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
        {subiendo ? "subiendo…" : "subir"}
        <input type="file" hidden onChange={archivo} disabled={subiendo} />
      </label>
    </span>
  );
}

// Formulario de firma por pago. El actor se elige arriba (pre-OIDC) y llega por prop.
export default function AccionesPago({ pago, actorId, modo }) {
  const [msj, setMsj] = useState(null);
  const [invoice, setInvoice] = useState(pago.invoice_url || "");
  const [legal, setLegal] = useState(pago.legal_support_url || "");
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar(accion) {
    if (!actorId) {
      setMsj("Elige primero quién firma (arriba).");
      return;
    }
    setOcupado(true);
    setMsj(null);
    const r = await fetch("/api/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion, pago_id: pago.id, actor_id: Number(actorId),
        invoice_url: invoice || undefined, legal_url: legal || undefined,
        motivo: motivo || undefined,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      window.location.reload();
    } else {
      setMsj(j.error || "Error inesperado.");
      setOcupado(false);
    }
  }

  const falta = !invoice || !legal;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
      {modo === "validar" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Subidor etiqueta="cuenta de cobro" valor={invoice} onUrl={setInvoice} origen="cuenta_cobro" />
          <Subidor etiqueta="soporte seg. social" valor={legal} onUrl={setLegal} origen="soporte_legal" />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {modo === "autorizar" && (
          <button className="btn" disabled={ocupado} onClick={() => enviar("autorizar")}>
            Autorizar pago
          </button>
        )}
        {modo === "validar" && (falta ? (
          <span className="sev alerta">bloqueado · faltan documentos</span>
        ) : (
          <button className="btn" disabled={ocupado} onClick={() => enviar("validar")}>
            Validar y pagar
          </button>
        ))}
        {modo === "validar" && (
          <>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="motivo…" className="mini" style={{ width: 110 }} />
            <button className="btn sec" disabled={ocupado} onClick={() => enviar("devolver")}>
              Devolver
            </button>
          </>
        )}
      </div>
      {msj && <div style={{ color: "var(--critico)", fontSize: 12, maxWidth: 300, textAlign: "right" }}>{msj}</div>}
    </div>
  );
}

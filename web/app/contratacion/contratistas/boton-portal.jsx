"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function BotonPortal({ contratistaId }) {
  const actorId = useSearchParams().get("actor") || "";
  const [url, setUrl] = useState(null);
  const [msj, setMsj] = useState(null);
  async function generar() {
    if (!actorId) { setMsj("Elige arriba quién genera."); return; }
    const r = await fetch("/api/potenciacion", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "portal_contratista", contratista_id: contratistaId,
        actor_id: Number(actorId) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const abs = window.location.origin + j.url;
      setUrl(abs);
      try { await navigator.clipboard.writeText(abs); } catch {}
    } else setMsj(j.error || "Error.");
  }
  if (url) return <span className="sev correcto" style={{ fontSize: 10 }}>enlace copiado ✓</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button className="btn sec" style={{ padding: "4px 10px", fontSize: 11 }} onClick={generar}>
        Enlace de portal
      </button>
      {msj && <span style={{ color: "var(--critico)", fontSize: 10 }}>{msj}</span>}
    </span>
  );
}

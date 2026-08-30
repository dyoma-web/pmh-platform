"use client";
export default function BotonImprimir() {
  return (
    <button className="btn" onClick={() => window.print()}>
      Generar PDF del comité
    </button>
  );
}

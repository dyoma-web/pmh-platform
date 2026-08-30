"use client";
import { useSearchParams } from "next/navigation";
import PanelHito from "./panel-hito";
import NuevoHito from "./nuevo-hito";

// Puente cliente: toma el actor de la URL (?actor=) y lo inyecta a los paneles.
export default function ActorBridge({ render, hito, proyectos }) {
  const actorId = useSearchParams().get("actor") || "";
  if (render === "panel") return <PanelHito hito={hito} actorId={actorId} />;
  return <NuevoHito proyectos={proyectos} actorId={actorId} />;
}

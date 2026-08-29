import { q } from "../../lib/db";
import { cop, n0 } from "../../lib/fmt";

export const dynamic = "force-dynamic";

const REGLA = {
  hito_vencido: { t: "Hito de cobro vencido", sev: "critico" },
  pago_contratista_vencido: { t: "Pago a contratista vencido", sev: "critico" },
  pago_sin_soporte_legal: { t: "Pago sin soporte legal", sev: "alerta" },
  proyecto_activo_cierre_vencido: { t: "Prorrogar o cerrar proyecto", sev: "alerta" },
  infra_on_vencida: { t: "Infraestructura encendida y vencida", sev: "pendiente" },
};

export default async function MiDia() {
  const tareas = await q(`
    select * from metrics.v0_semaforos
    order by case regla
      when 'hito_vencido' then 1
      when 'pago_contratista_vencido' then 2
      when 'pago_sin_soporte_legal' then 3
      when 'proyecto_activo_cierre_vencido' then 4
      else 5 end,
      dias desc nulls last, monto_cop desc nulls last`);

  const grupos = {};
  for (const t of tareas) (grupos[t.regla] ??= []).push(t);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Mi día</h1>
          <div className="sub">
            {n0(tareas.length)} asuntos abiertos en todo el sistema · en F1 esta vista aún no filtra
            por persona
          </div>
        </div>
        <div className="meta">Orden: severidad · antigüedad</div>
      </div>

      <div className="contenido">
        {tareas.length === 0 && (
          <section className="plancha">
            <div className="vacio">
              <div className="t">Todo al día. No hay semáforos abiertos.</div>
            </div>
          </section>
        )}

        {Object.entries(grupos).map(([regla, items]) => (
          <section className="plancha" key={regla}>
            <h2>
              {REGLA[regla]?.t ?? regla}{" "}
              <span className="mid">
                {n0(items.length)} · {cop(items.reduce((s, x) => s + Number(x.monto_cop || 0), 0))}
              </span>
            </h2>
            <div>
              {items.slice(0, 15).map((t, i) => (
                <div className={"tarea " + (REGLA[regla]?.sev ?? "pendiente")} key={i}>
                  <div className="dias">
                    <div className="n">{t.dias ?? "—"}</div>
                    <div className="u">DÍAS</div>
                  </div>
                  <div className="cuerpo">
                    <div className="t">{t.detalle}</div>
                    <div className="code">
                      {t.project_code} · ref {t.referencia}
                    </div>
                    <div className="d">Responsable: {t.dueno}</div>
                  </div>
                  <div className="lado">
                    <div className="monto">{t.monto_cop ? cop(t.monto_cop) : ""}</div>
                    <div className={"sev " + (REGLA[regla]?.sev ?? "pendiente")}>
                      {REGLA[regla]?.sev === "critico" ? "crítico" : REGLA[regla]?.sev === "alerta" ? "alerta" : "seguimiento"}
                    </div>
                  </div>
                </div>
              ))}
              {items.length > 15 && (
                <p className="notaf" style={{ marginTop: 12 }}>
                  + {n0(items.length - 15)} más de esta regla · exportables desde metrics.v0_semaforos
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

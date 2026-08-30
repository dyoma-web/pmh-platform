import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, fecha } from "../../lib/fmt";
import Historia from "../historia";

export const dynamic = "force-dynamic";

const PALABRA = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"];
const TIPO7 = {
  hito_cobro: "Hito de cobro",
  pago_contratista: "Pago a contratista",
  fin_infraestructura: "Fin de infraestructura",
};

// Cada regla termina en un verbo y en el lugar donde hoy se resuelve.
const ACCION = {
  hito_vencido: { verbo: "Registrar gestión de cobro", href: () => `/cartera` },
  pago_contratista_vencido: { verbo: "Validar pago", href: () => "/contratacion/firmas" },
  pago_bloqueado_documentos: { verbo: "Completar documentos", href: () => "/contratacion/firmas" },
  pago_sin_soporte_legal: { verbo: "Solicitar soporte", href: () => "/contratacion/firmas" },
  proyecto_activo_cierre_vencido: {
    verbo: "Prorrogar o cerrar",
    href: (t) => `/proyectos/${encodeURIComponent(t.project_code)}`,
  },
  contrato_por_vencer: {
    verbo: "Prorrogar o liquidar",
    href: (t) => `/proyectos/${encodeURIComponent(t.project_code)}`,
  },
  infra_on_vencida: { verbo: "Renovar o apagar", href: () => "/infraestructura" },
};
const RESUMEN = {
  hito_vencido: "Hitos de cobro vencidos",
  pago_contratista_vencido: "Pagos a contratistas vencidos",
  pago_bloqueado_documentos: "Pagos bloqueados por documentos",
  pago_sin_soporte_legal: "Pagos legados sin soporte legal — riesgo laboral acumulado",
  proyecto_activo_cierre_vencido: "Proyectos activos con cierre vencido — prórroga o cierre, no hay tercera opción",
  contrato_por_vencer: "Contratos que vencen en 30 días",
  infra_on_vencida: "Infraestructura encendida y vencida",
};

function responsable(dueno) {
  const m = String(dueno).match(/(?::|\+)\s*(.+)$/);
  return (m ? m[1] : dueno).trim();
}

export default async function MiDia({ searchParams }) {
  const sp = await searchParams;
  const quien = (sp?.quien || "").trim();

  const todos = await q(`
    select * from metrics.v2_semaforos
    order by case severidad when 'critico' then 1 when 'alerta' then 2 else 3 end,
      monto_cop desc nulls last, dias desc nulls last`);
  const proximos = await q("select * from metrics.v2_proximos_7d");
  const movimientos = await q(`
    select actor, entity, entity_id, action, at::date f
    from audit.event_log
    where action not like 'prueba%' order by at desc limit 7`);

  const personas = [...new Set(todos.map((t) => responsable(t.dueno)))]
    .filter((p) => p && p !== "Administración" && p !== "Infraestructura")
    .sort();

  const filtrados = quien ? todos.filter((t) => responsable(t.dueno) === quien) : todos;

  // Cola curada: lo urgente con plata primero; el resto se resume en una línea por regla.
  const hero = filtrados
    .filter((t) => ["hito_vencido", "pago_contratista_vencido"].includes(t.regla))
    .slice(0, 8);
  const resumen = Object.entries(
    filtrados.reduce((acc, t) => {
      if (hero.includes(t)) return acc;
      (acc[t.regla] ??= { n: 0, monto: 0 }).n += 1;
      acc[t.regla].monto += Number(t.monto_cop || 0);
      return acc;
    }, {})
  );

  const nHero = hero.length;
  const titulo = quien
    ? nHero === 0
      ? `Todo al día, ${quien.split(" ")[0]}`
      : `${PALABRA[nHero] ?? nHero} ${nHero === 1 ? "cosa te toca" : "cosas te toca"} cerrar hoy`
    : `${PALABRA[Math.min(nHero, 10)] ?? nHero} cobros mandan el día de hoy`;
  const totalVencido = hero.reduce((s, t) => s + Number(t.monto_cop || 0), 0);
  const lede = quien
    ? `Viendo los asuntos a nombre de ${quien}. ${n0(filtrados.length)} abiertos en total; aquí están los que mueven plata.`
    : `Los ${n0(nHero)} asuntos de arriba concentran ${mcop(totalVencido)} M COP. El resto del sistema (${n0(
        filtrados.length - nHero
      )} pendientes) está resumido abajo, una línea por regla — nada se esconde.`;

  return (
    <>
      <Historia
        num="00"
        seccion="Mi día"
        titulo={titulo}
        lede={lede}
        lado={
          <span className="notaf">
            ORDEN: SEVERIDAD · MONTO
          </span>
        }
      />

      <div className="contenido">
        <section className="plancha">
          <div className="vercomo" style={{ marginBottom: 4 }}>
            <span className="notaf" style={{ marginRight: 6 }}>VER COMO</span>
            <Link href="/mi-dia" className={!quien ? "on" : ""}>Todo el sistema</Link>
            {personas.map((p) => (
              <Link key={p} href={`/mi-dia?quien=${encodeURIComponent(p)}`} className={quien === p ? "on" : ""}>
                {p}
              </Link>
            ))}
          </div>
        </section>

        <section className="plancha">
          <h2>Cola de acciones <span className="mid">{n0(nHero)} · {cop(totalVencido)}</span></h2>
          {hero.length === 0 ? (
            <div className="vacio">
              <div className="t">No hay cobros ni pagos vencidos {quien ? `a nombre de ${quien}` : ""}.</div>
              <div className="d">
                {resumen.length > 0
                  ? "Quedan asuntos de seguimiento en el resumen de abajo."
                  : "Nada pendiente. El sistema no tiene más que decirte por hoy."}
              </div>
            </div>
          ) : (
            hero.map((t, i) => {
              const sev = t.severidad;
              const acc = ACCION[t.regla];
              return (
                <div className={"tarea " + sev} key={i}>
                  <div className="dias">
                    <div className="n">{t.dias ?? "—"}</div>
                    <div className="u">DÍAS</div>
                  </div>
                  <div className="cuerpo">
                    <div className="t">{t.detalle}</div>
                    <div className="code">
                      <Link href={`/proyectos/${encodeURIComponent(t.project_code)}`}>{t.project_code}</Link>
                      {"  "}· {cop(t.monto_cop)}
                    </div>
                    <div className="d">Responsable: {responsable(t.dueno)}</div>
                  </div>
                  <div className="lado" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <span className={"sev " + sev}>{sev === "critico" ? "crítico" : "alerta"}</span>
                    <Link className="accionbtn" href={acc.href(t)}>{acc.verbo}</Link>
                  </div>
                </div>
              );
            })
          )}
        </section>

        {resumen.length > 0 && (
          <section className="plancha">
            <h2>El resto, una línea por regla <span className="mid">NADA SE ESCONDE</span></h2>
            <div className="instr">
              {resumen.map(([regla, r]) => (
                <div className="fila" key={regla}>
                  <span className="lab">
                    {RESUMEN[regla] ?? regla}
                  </span>
                  <span className="mono">{r.monto ? mcop(r.monto) + " M" : "—"}</span>
                  <span className="val">{n0(r.n)}</span>
                  <Link className="mono" href={ACCION[regla]?.href({ project_code: "" }) ?? "#"}>ver →</Link>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="g2">
          <section className="plancha">
            <h2>Vence en los próximos 7 días <span className="mid">{n0(proximos.length)}</span></h2>
            {proximos.length === 0 ? (
              <div className="vacio"><div className="t">Nada vence en los próximos 7 días.</div></div>
            ) : (
              <div className="instr">
                {proximos.map((p, i) => (
                  <div className="fila" key={i}>
                    <span className="lab">
                      {TIPO7[p.tipo] ?? p.tipo} · {p.contraparte}
                      <span className="mono" style={{ marginLeft: 8 }}>{p.project_code}</span>
                    </span>
                    <span className="mono">{fecha(p.fecha)}</span>
                    <span className="val">{p.monto_cop ? cop(p.monto_cop) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Últimos movimientos <span className="mid">AUDIT.EVENT_LOG · APPEND-ONLY</span></h2>
            <div className="feed">
              {movimientos.map((m, i) => (
                <div className={"mov " + (m.action.includes("acreditar") || m.action.includes("validar") ? "correcto"
                  : m.action.includes("crear") || m.action.includes("aprobar") ? "info" : "pendiente")} key={i}>
                  <div className="t">{m.actor} · {m.action.replace(".", " → ")}</div>
                  <div className="m">{fecha(m.f).toUpperCase()} · {m.entity} {m.entity_id}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

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
  hito_vencido: { verbo: "Registrar gestión de cobro", href: (t) => `/cartera` },
  pago_contratista_vencido: { verbo: "Validar pago", href: () => "/contratacion" },
  pago_sin_soporte_legal: { verbo: "Solicitar soporte", href: () => "/contratacion" },
  proyecto_activo_cierre_vencido: {
    verbo: "Prorrogar o cerrar",
    href: (t) => `/proyectos/${encodeURIComponent(t.project_code)}`,
  },
  infra_on_vencida: { verbo: "Renovar o apagar", href: () => "/infraestructura" },
};
const TITULO = {
  hito_vencido: (t) => `Hito vencido hace ${t.dias} días`,
  pago_contratista_vencido: (t) => `Pago a contratista vencido hace ${t.dias} días`,
  pago_sin_soporte_legal: () => "Pago hecho sin soporte legal",
  proyecto_activo_cierre_vencido: (t) => `Proyecto activo con cierre vencido hace ${t.dias} días`,
  infra_on_vencida: (t) => `Infraestructura encendida, vencida hace ${t.dias} días`,
};
const SEV = {
  hito_vencido: "critico",
  pago_contratista_vencido: "critico",
  pago_sin_soporte_legal: "alerta",
  proyecto_activo_cierre_vencido: "alerta",
  infra_on_vencida: "pendiente",
};

function responsable(dueno) {
  const m = String(dueno).match(/(?::|\+)\s*(.+)$/);
  return (m ? m[1] : dueno).trim();
}

export default async function MiDia({ searchParams }) {
  const sp = await searchParams;
  const quien = (sp?.quien || "").trim();

  const todos = await q(`
    select * from metrics.v0_semaforos
    order by case regla when 'hito_vencido' then 1 when 'pago_contratista_vencido' then 2
      when 'proyecto_activo_cierre_vencido' then 3 when 'pago_sin_soporte_legal' then 4
      else 5 end, monto_cop desc nulls last, dias desc nulls last`);
  const proximos = await q("select * from metrics.v0_proximos_7d");
  const movimientos = await q(`
    (select 'cobro' tipo, 'Se acreditó ' || to_char(expected_cop,'FM999G999G999G999') || ' COP de ' || project_code detalle,
            credited_date::date f, project_code ref
       from staging.income where status='Credited' and credited_date is not null
         and credited_date >= '2022-01-01' order by credited_date desc limit 4)
    union all
    (select 'pago', 'Pago validado por ' || to_char(payment_amount,'FM999G999G999G999') || ' COP · ' || contract_code,
            payment_date::date, contract_code
       from staging.contract_payments where adm_validation='Paid' and payment_date::date <= current_date
       order by payment_date desc limit 3)
    order by f desc limit 7`);

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
              const sev = SEV[t.regla];
              const acc = ACCION[t.regla];
              return (
                <div className={"tarea " + sev} key={i}>
                  <div className="dias">
                    <div className="n">{t.dias ?? "—"}</div>
                    <div className="u">DÍAS</div>
                  </div>
                  <div className="cuerpo">
                    <div className="t">{TITULO[t.regla](t)}</div>
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
                    {TITULO[regla] ? TITULO[regla]({ dias: "—" }).replace(" hace — días", "s") : regla}
                    {regla === "pago_sin_soporte_legal" && " — riesgo laboral acumulado, no urgencia de caja"}
                    {regla === "proyecto_activo_cierre_vencido" && " — cada uno exige prórroga o cierre, no hay tercera opción"}
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
            <h2>Últimos movimientos <span className="mid">DEL DATO REAL · NO HAY EVENT LOG AÚN</span></h2>
            <div className="feed">
              {movimientos.map((m, i) => (
                <div className={"mov " + (m.tipo === "cobro" ? "correcto" : "info")} key={i}>
                  <div className="t">{m.detalle}</div>
                  <div className="m">{fecha(m.f).toUpperCase()} · {m.ref}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, fecha } from "../../lib/fmt";
import Historia from "../historia";

export const dynamic = "force-dynamic";

export default async function Contratacion() {
  const [k] = await q(`
    select
      count(*) filter (where payment_status='Pending') por_autorizar_n,
      sum(payment_amount) filter (where payment_status='Pending') por_autorizar_cop,
      count(*) filter (where payment_status='Authorized' and adm_validation<>'Paid') por_validar_n,
      sum(payment_amount) filter (where payment_status='Authorized' and adm_validation<>'Paid') por_validar_cop,
      count(*) filter (where adm_validation<>'Paid' and (contractor_invoice is null or contractor_legal is null)) bloqueados_n,
      count(*) filter (where adm_validation='Paid' and contractor_legal is null) pagados_sin_soporte_n,
      round(100.0 * count(*) filter (where adm_validation='Paid' and contractor_legal is not null)
        / nullif(count(*) filter (where adm_validation='Paid'),0), 1) cumplimiento_pct
    from staging.contract_payments`);

  const porAutorizar = await q(`
    select cp.contract_code, cp.payment_date::date f, cp.payment_amount, c.project_code,
           c.contractor_name, c.contract_overseer,
           (cp.contractor_invoice is null or cp.contractor_legal is null) bloqueado,
           (current_date - cp.payment_date::date) dias
    from staging.contract_payments cp join staging.contracts c using (contract_code)
    where cp.payment_status='Pending'
    order by cp.payment_date limit 20`);

  const porValidar = await q(`
    select cp.contract_code, cp.payment_date::date f, cp.payment_amount, c.project_code,
           c.contractor_name,
           (cp.contractor_invoice is null or cp.contractor_legal is null) bloqueado,
           (current_date - cp.payment_date::date) dias
    from staging.contract_payments cp join staging.contracts c using (contract_code)
    where cp.payment_status='Authorized' and cp.adm_validation<>'Paid'
    order by cp.payment_date limit 20`);

  const solicitudes = await q(`
    select status, category, count(*) n, sum(s.total) monto
    from staging.hiring_requests r
    left join (select request_id, sum(price_total) total
               from staging.request_services group by 1) s on s.request_id = r.request_id
    group by 1, 2 order by 1, 2`);

  const descuadre = await q(`
    select c.contract_code, c.project_code, c.contract_amount, sum(cp.payment_amount) suma_pagos,
           c.contract_annotations
    from staging.contracts c join staging.contract_payments cp using (contract_code)
    group by 1,2,3,5
    having abs(sum(cp.payment_amount) - c.contract_amount) > 1
    order by abs(sum(cp.payment_amount) - c.contract_amount) desc`);

  const Cola = ({ titulo, quien, filas, accion }) => (
    <section className="plancha">
      <h2>{titulo} <span className="mid">{quien} · {n0(filas.length)}</span></h2>
      {filas.length === 0 ? (
        <div className="vacio"><div className="t">No hay pagos en esta bandeja.</div></div>
      ) : (
        <div>
          {filas.map((p, i) => (
            <div className={"tarea " + (p.dias > 0 ? "critico" : p.bloqueado ? "alerta" : "pendiente")} key={i}>
              <div className="dias">
                <div className="n">{p.dias > 0 ? p.dias : "·"}</div>
                <div className="u">{p.dias > 0 ? "DÍAS VENC." : "EN FECHA"}</div>
              </div>
              <div className="cuerpo">
                <div className="t">{cop(p.payment_amount)} · {p.contractor_name}</div>
                <div className="code">
                  {p.contract_code} · <Link href={`/proyectos/${encodeURIComponent(p.project_code)}`}>{p.project_code}</Link>
                </div>
                <div className="d">
                  Vence {fecha(p.f)}
                  {p.bloqueado ? " · falta cuenta de cobro o soporte legal" : " · documentos completos"}
                </div>
              </div>
              <div className="lado">
                <span className={"sev " + (p.bloqueado ? "alerta" : "correcto")}>
                  {p.bloqueado ? "bloqueado" : accion}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <Historia
        num="04"
        seccion="Contratación · pagos a terceros"
        titulo={
          Number(k.bloqueados_n) > 0
            ? `${n0(k.bloqueados_n)} pagos no se pueden pagar: falta papel, no plata`
            : `${n0(Number(k.por_autorizar_n) + Number(k.por_validar_n))} pagos esperan firma`
        }
        lede={`En cola hay ${n0(k.por_autorizar_n)} pagos esperando la primera firma (gestoras) y ${n0(
          k.por_validar_n
        )} la segunda (administración). Los bloqueados no tienen botón de pagar — tienen la acción que los desbloquea: pedir la cuenta de cobro o el soporte de seguridad social. Y quedan ${n0(
          k.pagados_sin_soporte_n
        )} pagos históricos hechos sin soporte: riesgo laboral acumulado que baja solo cuando alguien lo persigue.`}
        lado={
          <>
            <span className="notaf">M8 · CUMPLIMIENTO {k.cumplimiento_pct ?? "—"} %</span>
            <Link className="btn" href="/contratacion/firmas">Cola de firmas</Link>
            <Link className="btn sec" href="/contratacion/solicitudes">Solicitudes</Link>
            <Link className="btn sec" href="/contratacion/otrosi">Otrosí</Link>
            <Link className="btn sec" href="/contratacion/contratistas">Contratistas</Link>
          </>
        }
      />

      <div className="contenido">
        <section className="plancha">
          <div className="kpis">
            <div className="kpi">
              <div className="et">Por autorizar · 1.ª firma</div>
              <div className="v">{n0(k.por_autorizar_n)}</div>
              <div className="ctx">{mcop(k.por_autorizar_cop)} M COP · gestoras</div>
            </div>
            <div className="kpi">
              <div className="et">Por validar · 2.ª firma</div>
              <div className="v">{n0(k.por_validar_n)}</div>
              <div className="ctx">{mcop(k.por_validar_cop)} M COP · administración</div>
            </div>
            <div className="kpi">
              <div className="et">Bloqueados</div>
              <div className={"v " + (Number(k.bloqueados_n) > 0 ? "alerta" : "correcto")}>{n0(k.bloqueados_n)}</div>
              <div className="ctx">sin cuenta de cobro o soporte legal</div>
            </div>
            <div className="kpi">
              <div className="et">Pagados sin soporte</div>
              <div className={"v " + (Number(k.pagados_sin_soporte_n) > 0 ? "critico" : "correcto")}>
                {n0(k.pagados_sin_soporte_n)}
              </div>
              <div className="ctx">stock histórico por regularizar · M8</div>
            </div>
          </div>
        </section>

        <div className="g2">
          <Cola titulo="Por autorizar" quien="GESTORA · 1.ª FIRMA" filas={porAutorizar} accion="listo para autorizar" />
          <Cola titulo="Por validar" quien="ADMINISTRACIÓN · 2.ª FIRMA" filas={porValidar} accion="listo para validar" />
        </div>

        <div className="g2">
          <section className="plancha">
            <h2>Solicitudes de contratación <span className="mid">HIRING · 2026</span></h2>
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>Estado</th><th>Tipo</th><th className="n">N.º</th><th className="n">Valor COP</th></tr>
                </thead>
                <tbody>
                  {solicitudes.map((s, i) => (
                    <tr key={i}>
                      <td className={"estado " + (s.status === "Requested" ? "info" : s.status === "Processed" ? "correcto" : "pendiente")}>
                        {s.status === "Processed" ? "Procesada" : s.status === "Requested" ? "En trámite" : "Cancelada"}
                      </td>
                      <td className="code">{s.category}</td>
                      <td className="n">{n0(s.n)}</td>
                      <td className="n">{s.monto ? cop(s.monto) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="plancha">
            <h2>Contratos cuyo cronograma no cuadra <span className="mid">Σ PAGOS ≠ MONTO</span></h2>
            {descuadre.length === 0 ? (
              <div className="vacio"><div className="t">Todos los contratos cuadran con su cronograma.</div></div>
            ) : (
              <div className="twrap">
                <table className="maestra">
                  <thead>
                    <tr><th>Contrato</th><th>Proyecto</th><th className="n">Monto</th><th className="n">Σ pagos</th><th>Nota</th></tr>
                  </thead>
                  <tbody>
                    {descuadre.map((d) => (
                      <tr key={d.contract_code}>
                        <td className="estado alerta code">{d.contract_code}</td>
                        <td className="code">
                          <Link href={`/proyectos/${encodeURIComponent(d.project_code)}`}>{d.project_code}</Link>
                        </td>
                        <td className="n">{cop(d.contract_amount)}</td>
                        <td className="n">{cop(d.suma_pagos)}</td>
                        <td style={{ fontSize: 12, whiteSpace: "normal" }}>{d.contract_annotations ?? "sin otrosí registrado"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="notaf" style={{ marginTop: 10 }}>
              decisión F0: con otrosí manda Σ pagos · sin otrosí manda el monto
            </p>
          </section>
        </div>
      </div>
    </>
  );
}

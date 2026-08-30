import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha, fechaHora } from "../../lib/fmt";
import Historia from "../historia";
import SelectorActor from "../contratacion/firmas/selector-actor";
import { BotonSellar, BotonConciliar } from "./acciones";

export const dynamic = "force-dynamic";

export default async function Finanzas() {
  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);

  const meses = await q(`
    select date_trunc('month', e.event_date)::date mes,
           count(*) eventos,
           sum(e.amount_cop) filter (where e.direction='out') gasto,
           sum(e.amount_cop) filter (where e.direction='in') ingreso,
           p.sealed_at, p.sealed_by
    from ledger.money_event e
    left join ledger.period p on p.month = date_trunc('month', e.event_date)::date
    group by 1, p.sealed_at, p.sealed_by
    order by 1 desc limit 14`);

  const sugerencias = await q(`
    select g.id gl_id, g.event_date gl_fecha, g.amount_cop monto, g.note gl_tercero,
           p.id pago_id, p.event_date pago_fecha, ct.display_name contratista,
           pr.code project_code,
           (case when g.project_id = p.project_id then 0.4 else 0 end
            + case when abs(g.event_date - p.event_date) <= 45 then 0.4
                   when abs(g.event_date - p.event_date) <= 90 then 0.2 else 0 end
            + 0.2) confianza
    from ledger.money_event g
    join ledger.money_event p
      on p.kind = 'contractor_payment'
     and abs(p.amount_cop - g.amount_cop) <= 1
     and abs(g.event_date - p.event_date) <= 120
    left join procurement.contractor ct on ct.id = p.contractor_id
    left join core.project pr on pr.id = g.project_id
    where g.kind = 'gl_accrual'
      and not exists (select 1 from ledger.reconciliation r where r.gl_event_id = g.id)
      and not exists (select 1 from ledger.reconciliation r where r.op_event_id = p.id)
    order by confianza desc, g.amount_cop desc limit 12`);

  const [recon] = await q(`
    select count(*) parejas,
           (select count(*) from ledger.money_event where kind='gl_accrual') gl_total
    from ledger.reconciliation`);

  const sinDistribuir = await q("select * from metrics.v1_prorrateo_sin_distribuir limit 10");
  const reglas = await q(`
    select r.resource_key, p.code project_code, r.weight, r.valid_from, r.valid_to
    from infra.allocation_rule r join core.project p on p.id = r.project_id
    order by r.resource_key, r.weight desc`);

  const monedas = await q(`
    select currency, count(*) n, sum(amount) monto_original, sum(amount_cop) monto_cop
    from ledger.money_event group by currency order by n desc`);

  const abiertos = meses.filter((m) => !m.sealed_at).length;

  return (
    <>
      <Historia
        num="07"
        seccion="Finanzas · Ledger"
        titulo={`${n0(abiertos)} meses abiertos esperan su sello`}
        lede={`El libro único registra ${n0(monedas.reduce((s, m) => s + Number(m.n), 0))} eventos. Un mes sellado es inmutable — el motor rechaza cualquier cambio dentro de él; los ajustes van como eventos nuevos. La conciliación empareja lo contable con los pagos reales, y el prorrateo del gasto compartido es una regla con pesos, no una captura de pantalla.`}
        lado={<span className="notaf">M9 · SELLO POR TRIGGER · {n0(recon.parejas)} PAREJAS CONCILIADAS</span>}
      />
      <div className="contenido">
        <section className="plancha"><SelectorActor usuarios={usuarios} /></section>

        <section className="plancha">
          <h2>Cierres mensuales <span className="mid">IMPORTA CON tools/importar_cierre.py · SELLA AQUÍ</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr><th>Mes</th><th className="n">Eventos</th><th className="n">Gasto COP</th>
                  <th className="n">Ingreso COP</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {meses.map((m) => {
                  const mesStr = new Date(m.mes).toISOString().slice(0, 7);
                  return (
                    <tr key={mesStr}>
                      <td className={"estado code " + (m.sealed_at ? "correcto" : "alerta")}>{mesStr}</td>
                      <td className="n">{n0(m.eventos)}</td>
                      <td className="n">{m.gasto ? cop(m.gasto) : "—"}</td>
                      <td className="n">{m.ingreso ? cop(m.ingreso) : "—"}</td>
                      <td>
                        <span className={"sev " + (m.sealed_at ? "correcto" : "alerta")}>
                          {m.sealed_at ? `sellado por ${m.sealed_by}` : "abierto"}
                        </span>
                      </td>
                      <td>{!m.sealed_at && <BotonSellar mes={mesStr} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="plancha">
          <h2>Conciliación contabilidad ↔ pagos <span className="mid">
            {n0(recon.parejas)} DE {n0(recon.gl_total)} ASIENTOS EMPAREJADOS · SUGERENCIAS POR MONTO+PROYECTO+FECHA</span></h2>
          {sugerencias.length === 0 ? (
            <div className="vacio">
              <div className="t">No hay parejas nuevas que sugerir.</div>
              <div className="d">Aparecen cuando un asiento contable y un pago validado comparten monto y ventana de fechas.</div>
            </div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>Asiento contable</th><th className="n">Fecha GL</th>
                    <th className="n">Monto</th><th>Pago a</th><th className="n">Fecha pago</th>
                    <th>Proyecto</th><th className="n">Conf.</th><th></th></tr>
                </thead>
                <tbody>
                  {sugerencias.map((s) => (
                    <tr key={`${s.gl_id}-${s.pago_id}`}>
                      <td className={"estado " + (Number(s.confianza) >= 0.8 ? "correcto" : "info")}
                        style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.gl_tercero ?? "asiento " + s.gl_id}
                      </td>
                      <td className="n">{fecha(s.gl_fecha)}</td>
                      <td className="n" style={{ fontWeight: 600 }}>{cop(s.monto)}</td>
                      <td>{s.contratista ?? "—"}</td>
                      <td className="n">{fecha(s.pago_fecha)}</td>
                      <td className="code">{s.project_code ?? "—"}</td>
                      <td className="n">{n1(Number(s.confianza) * 100)} %</td>
                      <td><BotonConciliar glId={s.gl_id} pagoId={s.pago_id} confianza={s.confianza} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Prorrateo · sin distribuir <span className="mid">M9 · CADA FILA PIDE UNA REGLA</span></h2>
            <div className="instr">
              {sinDistribuir.map((s) => (
                <div className="fila" key={s.resource_code ?? "sin-codigo"}>
                  <span className="lab code" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>
                    {s.resource_code ?? "(sin código de recurso)"}
                  </span>
                  <span className="mono">{n0(s.eventos)} pagos</span>
                  <span className="val">{s.monto_cop ? cop(s.monto_cop) : "—"}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--tinta-2)", margin: "10px 0 0" }}>
              Las reglas se definen por API (<span className="code">regla_prorrateo</span>): pesos por
              proyecto con vigencia. Lo no cubierto por pesos queda como overhead visible, nunca desaparece.
            </p>
          </section>

          <section className="plancha">
            <h2>Reglas vigentes <span className="mid">{n0(reglas.length)}</span></h2>
            {reglas.length === 0 ? (
              <div className="vacio">
                <div className="t">Aún no hay reglas de prorrateo.</div>
                <div className="d">La primera candidata: la Granja InnovaHub (Google Cloud), hoy repartida con capturas de pantalla.</div>
              </div>
            ) : (
              <div className="instr">
                {reglas.map((r, i) => (
                  <div className="fila" key={i}>
                    <span className="lab code" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>
                      {r.resource_key} → {r.project_code}
                    </span>
                    <span className="mono">desde {fecha(r.valid_from)}{r.valid_to ? ` hasta ${fecha(r.valid_to)}` : ""}</span>
                    <span className="val">{n1(Number(r.weight) * 100)} %</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="plancha">
          <h2>El libro por moneda <span className="mid">LOS ORIGINALES NUNCA SE SUMAN ENTRE SÍ</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr><th>Moneda</th><th className="n">Eventos</th>
                  <th className="n">Monto original</th><th className="n">Equivalente COP</th></tr>
              </thead>
              <tbody>
                {monedas.map((m) => (
                  <tr key={m.currency}>
                    <td className="estado pendiente code">{m.currency}</td>
                    <td className="n">{n0(m.n)}</td>
                    <td className="n">{m.currency} {n0(m.monto_original)}</td>
                    <td className="n">{m.monto_cop ? cop(m.monto_cop) : "sin TRM (Q02)"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

import Link from "next/link";
import { q } from "../../lib/db";
import { cop, n0, fecha } from "../../lib/fmt";

export const dynamic = "force-dynamic";

export default async function Infraestructura() {
  const items = await q(`
    select project_code, concept, provider, link, status,
           end_date::date fin, monthly_budget, currency,
           (status='ON' and end_date::date < current_date) vencida
    from staging.infra_items
    order by (status='ON' and end_date::date < current_date) desc, end_date`);
  const subs = await q(`
    select b.code, b.provider, b.service, b.details, b.end_date::date fin,
           b.full_budget, b.currency,
           p.pagos_n, p.ultimo_pago
    from staging.subs_budget b
    left join (select code, count(*) pagos_n, max(date)::date ultimo_pago
               from staging.subs_payments group by 1) p using (code)
    order by b.full_budget desc nulls last`);
  const vencidas = items.filter((i) => i.vencida).length;

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Infraestructura</h1>
          <div className="sub">
            {n0(items.length)} ítems por proyecto · {n0(subs.length)} suscripciones corporativas
          </div>
        </div>
        <div className="meta">
          M9 · {n0(vencidas)} encendidos con fin vencido
        </div>
      </div>

      <div className="contenido">
        <section className="plancha">
          <h2>Ítems por proyecto <span className="mid">ESTADO REAL · VENCIDOS PRIMERO</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Proyecto</th><th>Concepto</th><th>Proveedor</th>
                  <th>Recurso</th><th>Estado</th><th className="n">Fin</th>
                  <th className="n">Mensual</th><th>Mon.</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, ix) => (
                  <tr key={ix}>
                    <td className={"estado code " + (i.vencida ? "alerta" : i.status === "ON" ? "correcto" : "pendiente")}>
                      <Link href={`/proyectos/${encodeURIComponent(i.project_code)}`}>{i.project_code}</Link>
                    </td>
                    <td>{i.concept}</td>
                    <td>{i.provider}</td>
                    <td className="code" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{i.link}</td>
                    <td>
                      <span className={"sev " + (i.vencida ? "alerta" : i.status === "ON" ? "correcto" : "pendiente")}>
                        {i.status}{i.vencida ? " · vencida" : ""}
                      </span>
                    </td>
                    <td className="n">{fecha(i.fin)}</td>
                    <td className="n">{i.monthly_budget ? cop(i.monthly_budget) : "—"}</td>
                    <td className="code">{i.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="notaf" style={{ marginTop: 10 }}>
            «ON · vencida» = sigue pagándose sin renovar el registro, o se apagó y nadie lo marcó — cada caso es una tarea en Mi día
          </p>
        </section>

        <section className="plancha">
          <h2>Suscripciones corporativas <span className="mid">PRESUPUESTO ANUAL · PAGOS CON SOPORTE</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Servicio</th><th>Proveedor</th><th>Plan</th>
                  <th className="n">Presupuesto anual</th><th>Mon.</th>
                  <th className="n">Fin vigencia</th><th className="n">Pagos reg.</th>
                  <th className="n">Último pago</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s, ix) => {
                  const vencida = s.fin && new Date(s.fin) < new Date();
                  return (
                    <tr key={ix}>
                      <td className={"estado " + (vencida ? "alerta" : "pendiente")}>{s.service}</td>
                      <td>{s.provider}</td>
                      <td style={{ fontSize: 12 }}>{s.details}</td>
                      <td className="n">{s.full_budget ? cop(s.full_budget) : "—"}</td>
                      <td className="code">{s.currency}</td>
                      <td className="n">{fecha(s.fin)}</td>
                      <td className="n">{s.pagos_n ? n0(s.pagos_n) : "·"}</td>
                      <td className="n">{s.ultimo_pago ? fecha(s.ultimo_pago) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="notaf" style={{ marginTop: 10 }}>
            los montos pagados viven en monedas mezcladas (USD/COP/EUR) — se normalizan a COP con el ledger en F6
          </p>
        </section>
      </div>
    </>
  );
}

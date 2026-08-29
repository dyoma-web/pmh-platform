import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../../lib/fmt";

export const dynamic = "force-dynamic";

const ES = { Active: "Activo", Completed: "Completado", Paused: "Pausado", Cancelled: "Cancelado" };
const ESTADO_HITO = { Scheduled: "Programado", Invoiced: "Facturado", Credited: "Acreditado", Paid: "Acreditado" };

export default async function Ficha({ params }) {
  const { code } = await params;
  const pc = decodeURIComponent(code);

  const [p] = await q("select * from metrics.v0_portafolio where project_code = $1", [pc]);
  if (!p) {
    return (
      <div className="contenido">
        <section className="plancha">
          <div className="vacio">
            <div className="t">El proyecto {pc} no existe en el maestro.</div>
            <div className="d"><Link href="/proyectos">Volver al portafolio</Link></div>
          </div>
        </section>
      </div>
    );
  }

  const hitos = await q(
    `select id, expected_date::date f_esp, invoice_date::date f_fac,
            credited_date::date f_acr, expected_cop, status, deliverables
     from staging.income where project_code = $1 order by expected_date`, [pc]);
  const contratos = await q(
    `select c.contract_code, c.contract_account, c.contractor_name, c.contract_amount,
            c.contract_start::date ini, c.contract_end::date fin, c.contract_annotations,
            coalesce(pg.pagado,0) pagado, coalesce(pg.pendiente,0) pendiente
     from staging.contracts c
     left join (select contract_code,
                  sum(payment_amount) filter (where adm_validation='Paid') pagado,
                  sum(payment_amount) filter (where adm_validation<>'Paid') pendiente
                from staging.contract_payments group by 1) pg using (contract_code)
     where c.project_code = $1 order by c.contract_amount desc`, [pc]);
  const costos = await q(
    `select coalesce(r.categoria, c.account_name) categoria, sum(c.amount) monto, count(*) n
     from staging.v_costs_norm c
     left join ref.cuenta_categoria r on r.cuenta = c.account::int::text
     where c.project_code_canon = $1 group by 1 order by 2 desc`, [pc]);
  const infra = await q(
    `select concept, provider, link, status, end_date::date fin, monthly_budget, currency
     from staging.infra_items where project_code = $1 order by status desc, end_date`, [pc]);
  const presupuesto = await q(
    `select code, details, quantity, unitary_price, total_price, budget80
     from staging.budget_lines where project_code = $1 order by total_price desc`, [pc]);

  const acreditado = hitos.filter((h) => ["Credited", "Paid"].includes(h.status))
    .reduce((s, h) => s + Number(h.expected_cop || 0), 0);
  const causado = Number(p.causado_cop || 0);
  const comprometidoPend = contratos.reduce((s, c) => s + Number(c.pendiente || 0), 0);
  const margen = p.costeo_cop
    ? ((Number(p.costeo_cop) - causado - comprometidoPend) / Number(p.costeo_cop)) * 100
    : null;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="notaf" style={{ marginBottom: 4 }}>
            <Link href="/proyectos">PORTAFOLIO</Link> / <span>{pc}</span>
          </div>
          <h1 style={{ fontFamily: "var(--fx-mono)", fontSize: 19 }}>{pc}</h1>
          <div className="sub">
            {p.cliente} · {p.pais} · {p.linea} · Gestora {p.gestora}
            {p.cierre ? ` · Cierre ${fecha(p.cierre)}` : ""}
          </div>
        </div>
        <div className="meta">
          <span className={"sev " + p.semaforo}>{ES[p.estado] ?? p.estado}</span>
          {p.vencidos_n > 0 && (
            <span className="sev critico" style={{ marginLeft: 12 }}>
              {n0(p.vencidos_n)} hitos vencidos · {mcop(p.vencidos_cop)} M
            </span>
          )}
        </div>
      </div>

      <div className="contenido">
        {/* Cabecera de cuatro cifras */}
        <section className="plancha">
          <div className="kpis">
            <div className="kpi">
              <div className="et">Costeo</div>
              <div className="v">{p.costeo_cop ? cop(p.costeo_cop) : "—"}</div>
              <div className="ctx">COP · valor de operación</div>
            </div>
            <div className="kpi">
              <div className="et">Acreditado</div>
              <div className="v correcto">{cop(acreditado)}</div>
              <div className="ctx">{hitos.filter((h) => ["Credited","Paid"].includes(h.status)).length} hitos cobrados</div>
            </div>
            <div className="kpi">
              <div className="et">Causado + comprometido</div>
              <div className="v">{cop(causado + comprometidoPend)}</div>
              <div className="ctx">causado {mcop(causado)} M · por pagar {mcop(comprometidoPend)} M</div>
            </div>
            <div className="kpi">
              <div className="et">Margen proyectado</div>
              <div className={"v " + (margen != null && margen < 0 ? "critico" : margen != null && margen < 15 ? "alerta" : "")}>
                {margen == null ? "—" : n1(margen)}<small>%</small>
              </div>
              <div className="ctx">sobre costeo · M2 aprox.</div>
            </div>
          </div>
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Hitos de ingreso <span className="mid">{n0(hitos.length)} · COP</span></h2>
            {hitos.length === 0 ? (
              <div className="vacio">
                <div className="t">Este proyecto no tiene hitos de ingreso registrados.</div>
                <div className="d">Sin hitos no hay cartera que vigilar ni caja que proyectar.</div>
              </div>
            ) : (
              <div className="twrap">
                <table className="maestra">
                  <thead>
                    <tr>
                      <th>Estado</th><th className="n">Esperado</th>
                      <th className="n">Acreditado</th><th className="n">Monto COP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hitos.map((h) => {
                      const vencido = ["Scheduled","Invoiced"].includes(h.status) &&
                        h.f_esp && new Date(h.f_esp) < new Date();
                      const sev = ["Credited","Paid"].includes(h.status) ? "correcto"
                        : vencido ? "critico" : h.status === "Invoiced" ? "alerta" : "pendiente";
                      return (
                        <tr key={h.id}>
                          <td className={"estado " + sev}>
                            <span className={"sev " + sev}>
                              {ESTADO_HITO[h.status] ?? h.status}{vencido ? " · vencido" : ""}
                            </span>
                          </td>
                          <td className="n">{fecha(h.f_esp)}</td>
                          <td className="n">{h.f_acr ? fecha(h.f_acr) : "—"}</td>
                          <td className="n" style={{ fontWeight: 600 }}>{cop(h.expected_cop)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Costos por categoría <span className="mid">CONTABILIDAD 2024→ · COP</span></h2>
            {costos.length === 0 ? (
              <div className="vacio">
                <div className="t">Sin costos contables imputados.</div>
                <div className="d">La contabilidad por proyecto empieza en enero de 2024.</div>
              </div>
            ) : (
              <div className="instr">
                {costos.map((c) => (
                  <div className="fila" key={c.categoria}>
                    <span className="lab">{c.categoria}</span>
                    <span className="mono">{n0(c.n)} asientos</span>
                    <span className="val">{cop(c.monto)}</span>
                  </div>
                ))}
                <div className="fila total">
                  <span className="lab">TOTAL CAUSADO</span>
                  <span className="val">{cop(causado)}</span>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="plancha">
          <h2>Contratación de terceros <span className="mid">{n0(contratos.length)} CONTRATOS · COP</span></h2>
          {contratos.length === 0 ? (
            <div className="vacio">
              <div className="t">Este proyecto no tiene contratos con terceros.</div>
            </div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr>
                    <th>Contrato</th><th>Categoría</th><th>Contratista</th>
                    <th className="n">Monto</th><th className="n">Pagado</th>
                    <th className="n">Pendiente</th><th className="n">Vigencia</th>
                  </tr>
                </thead>
                <tbody>
                  {contratos.map((c) => {
                    const cuadra = Math.abs(Number(c.pagado) + Number(c.pendiente) - Number(c.contract_amount)) <= 1;
                    return (
                      <tr key={c.contract_code}>
                        <td className={"estado code " + (cuadra ? "pendiente" : "alerta")}>{c.contract_code}</td>
                        <td>{c.contract_account}</td>
                        <td>{c.contractor_name}</td>
                        <td className="n">{cop(c.contract_amount)}</td>
                        <td className="n">{cop(c.pagado)}</td>
                        <td className="n">{Number(c.pendiente) ? cop(c.pendiente) : "—"}</td>
                        <td className="n">{fecha(c.ini)} → {fecha(c.fin)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Presupuesto por ítem <span className="mid">{n0(presupuesto.length)} LÍNEAS</span></h2>
            {presupuesto.length === 0 ? (
              <div className="vacio">
                <div className="t">Este proyecto no tiene presupuesto por ítem.</div>
                <div className="d">
                  En F5 el presupuesto será obligatorio para activar un proyecto. Hoy solo 2 de 144
                  lo tienen.
                </div>
              </div>
            ) : (
              <div className="twrap">
                <table className="maestra">
                  <thead>
                    <tr>
                      <th>Ítem</th><th>Detalle</th><th className="n">Cant.</th>
                      <th className="n">Total COP</th><th className="n">80 %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presupuesto.map((b, i) => (
                      <tr key={i}>
                        <td className="estado pendiente code">{b.code}</td>
                        <td>{b.details}</td>
                        <td className="n">{n0(b.quantity)}</td>
                        <td className="n">{cop(b.total_price)}</td>
                        <td className="n">{cop(b.budget80)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Infraestructura <span className="mid">{n0(infra.length)} ÍTEMS</span></h2>
            {infra.length === 0 ? (
              <div className="vacio">
                <div className="t">Sin infraestructura asociada.</div>
              </div>
            ) : (
              <div className="instr">
                {infra.map((i, ix) => {
                  const vencida = i.status === "ON" && i.fin && new Date(i.fin) < new Date();
                  return (
                    <div className="fila" key={ix}>
                      <span className="lab">
                        {i.concept} · {i.provider}
                        <span className="mono" style={{ marginLeft: 8 }}>{i.link}</span>
                      </span>
                      <span className={"sev " + (vencida ? "alerta" : i.status === "ON" ? "correcto" : "pendiente")}>
                        {i.status}{vencida ? " · vencida" : ""}
                      </span>
                      <span className="mono">fin {fecha(i.fin)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, mcop, n0, n1, fecha, fechaHora } from "../../../lib/fmt";
import { slug } from "../../../lib/slug";
import Historia from "../../historia";
import SelectorActor from "../../contratacion/firmas/selector-actor";
import ActorBridge from "../../cartera/actor-bridge";
import Entregables from "./entregables";
import DocumentosProyecto from "./documentos-proyecto";
import LineaVida, { CARRILES_PROYECTO, SQL_EVENTOS } from "../../linea-vida";

export const dynamic = "force-dynamic";

const ES = { active: "Activo", completed: "Completado", paused: "Pausado",
  cancelled: "Cancelado", draft: "Borrador" };
const EH = { scheduled: ["Programado", "pendiente"], invoiced: ["Facturado", "alerta"],
  partial: ["Abonado parcial", "info"], credited: ["Pagado", "correcto"],
  written_off: ["Castigado", "pendiente"] };

export default async function Ficha({ params }) {
  const { code } = await params;
  const pc = decodeURIComponent(code);

  const [p] = await q(
    `select p.*, cl.name cliente, ges.full_name gestora, pmg.full_name partner,
            fc.concept fc_concept, fc.folder_url fc_url,
            pa.amount, pa.currency, pa.fx_rate, pa.fx_kind, pa.amount_cop costeo_cop
     from core.project p
     left join core.client cl on cl.id = p.client_id
     left join core.app_user ges on ges.id = p.pm_id
     left join core.app_user pmg on pmg.id = p.partner_manager_id
     left join core.framework_contract fc on fc.code = p.framework_contract_code
     left join lateral (select * from core.project_amount where project_id = p.id
                        order by version desc limit 1) pa on true
     left join core.project_alias a on a.project_id = p.id
     where p.code = $1 or a.alias = $1 limit 1`, [pc]);

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

  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const hitos = await q(
    `select m.*, r.recibido_cop, r.saldo_cop,
            (m.state in ('scheduled','invoiced','partial') and m.expected_date < current_date) vencido
     from revenue.milestone m
     join revenue.v_milestone_recibido r on r.milestone_id = m.id
     where m.project_id = $1 order by m.expected_date`, [p.id]);
  const contratos = await q(
    `select c.code, c.state, c.account_category, c.amount, c.amount_note, c.hiring_request_code,
            c.start_date, c.end_date, ct.display_name contratista,
            coalesce(pg.pagado,0) pagado, coalesce(pg.pendiente,0) pendiente
     from procurement.contract c
     join procurement.contractor ct on ct.id = c.contractor_id
     left join (select contract_code,
                  sum(amount) filter (where adm_validated_at is not null) pagado,
                  sum(amount) filter (where adm_validated_at is null and cancelled_at is null) pendiente
                from procurement.contract_payment group by 1) pg on pg.contract_code = c.code
     where c.project_id = $1 order by c.amount desc`, [p.id]);
  const costos = await q(
    `select ga.mgmt_category categoria, sum(e.amount_cop) monto, count(*) n
     from ledger.money_event e join ledger.gl_account ga on ga.code = e.gl_account
     where e.project_id = $1 and e.kind = 'gl_accrual'
     group by 1 order by 2 desc`, [p.id]);
  const presupuesto = await q(
    `select l.*, v.version, v.state estado_version
     from budget.line l join budget.version v on v.id = l.version_id
     where v.project_id = $1 and v.state = 'approved' order by l.total desc`, [p.id]);
  const infra = await q(
    `select concept, provider, resource, status, end_date,
            (status='on' and end_date < current_date) vencida
     from infra.item where project_id = $1 order by vencida desc, end_date`, [p.id]);
  const entregables = await q(
    `select d.id, d.description, d.due_date, d.planned_value_cop, d.progress_pct,
            to_char(d.due_date,'DD Mon') due, u.full_name responsable
     from core.deliverable d left join core.app_user u on u.id = d.responsible_id
     where d.project_id = $1 order by d.due_date`, [p.id]);
  const [ev] = await q(
    "select * from metrics.v2_valor_ganado where project_id = $1", [p.id]);
  const [eventos, [brecha], fantasmas] = await Promise.all([
    q(`${SQL_EVENTOS} where project_id = $1 order by orden`, [p.id]),
    q("select * from metrics.v2_brecha_financiacion where project_id = $1", [p.id]),
    q(`select a.changes->>'fecha_fin_anterior' fecha, 'Fin anterior ' || a.contract_code || ' · otrosí #' || a.id titulo
         from procurement.contract_amendment a join procurement.contract k on k.code = a.contract_code
        where a.state='approved' and a.effect='plazo' and k.project_id = $1`, [p.id]),
  ]);
  const evVenc = eventos.filter((e) => e.estado === "vencido");

  const hitoIds = hitos.map((h) => String(h.id));
  const contratoCodes = contratos.map((c) => c.code);
  const bitacora = await q(
    `select actor, entity, entity_id, action, at from audit.event_log
     where (entity = 'milestone' and entity_id = any($1))
        or (entity in ('contract','contract_amendment','hiring_request') and entity_id = any($2))
     order by at desc limit 10`, [hitoIds, contratoCodes]);

  const acreditado = hitos.reduce((s, h) => s + Number(h.recibido_cop || 0), 0);
  const causado = costos.reduce((s, c) => s + Number(c.monto), 0);
  const comprometido = contratos.reduce((s, c) => s + Number(c.pendiente || 0), 0);
  const costeo = Number(p.costeo_cop || 0);
  const margen = costeo ? ((costeo - causado - comprometido) / costeo) * 100 : null;
  const vencidos = hitos.filter((h) => h.vencido);
  const saldoVencido = vencidos.reduce((s, h) => s + Number(h.saldo_cop), 0);

  return (
    <>
      <div className="historia">
        <div className="eyebrow2">
          <span className="tick" aria-hidden="true" />
          <span><Link href="/proyectos">03 · PORTAFOLIO</Link> / FICHA</span>
        </div>
        <div className="fila-titulo">
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            {p.cliente && (
              <img src={`/img/clientes/${slug(p.cliente)}.png`} alt={p.cliente}
                width={52} height={52}
                style={{ borderRadius: 10, objectFit: "cover", background: "var(--plancha)", border: "1px solid var(--filete)" }} />
            )}
            <div>
              <h1 style={{ fontFamily: "var(--fx-mono)", fontSize: 21, maxWidth: "none" }}>{p.display_code}</h1>
              <div className="lede" style={{ margin: "4px 0 0", fontSize: 14 }}>
                {p.cliente ?? "—"} ·{" "}
                {p.country && (
                  <img src={`/img/banderas/${slug(p.country)}.png`} alt="" width={16} height={11}
                    style={{ verticalAlign: "-1px", borderRadius: 2 }} />
                )}{" "}{p.country} · {p.service_line} · Gestora {p.gestora ?? "—"} ·
                Partner {p.partner ?? "—"}{p.closing_date ? ` · Cierre ${fecha(p.closing_date)}` : ""}
              </div>
            </div>
          </div>
          <div className="lado" style={{ flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span className={"sev " + (vencidos.length ? "critico" : p.status === "active" ? "correcto" : "pendiente")}>
              {ES[p.status] ?? p.status}{p.kind !== "project" ? ` · ${p.kind}` : ""}
            </span>
            {vencidos.length > 0 && (
              <span className="sev critico">{n0(vencidos.length)} hitos vencidos · {mcop(saldoVencido)} M</span>
            )}
            {p.contract_url && <a href={p.contract_url} target="_blank" className="notaf">CARPETA DEL CONTRATO ↗</a>}
          </div>
        </div>
      </div>

      <div className="contenido">
        <section className="plancha">
          <div className="kpis">
            <div className="kpi">
              <div className="et">Costeo</div>
              <div className="v">{costeo ? cop(costeo) : "—"}</div>
              <div className="ctx">
                {p.currency !== "COP" && p.amount
                  ? `${p.currency} ${n0(p.amount)} · TRM ${n1(p.fx_rate)} (${p.fx_kind})`
                  : "COP · valor de operación"}
              </div>
            </div>
            <div className="kpi">
              <div className="et">Acreditado</div>
              <div className="v correcto">{cop(acreditado)}</div>
              <div className="ctx">{hitos.filter((h) => h.state === "credited").length} hitos saldados de {hitos.length}</div>
            </div>
            <div className="kpi">
              <div className="et">Causado + comprometido</div>
              <div className="v">{cop(causado + comprometido)}</div>
              <div className="ctx">causado {mcop(causado)} M · por pagar {mcop(comprometido)} M</div>
            </div>
            <div className="kpi">
              <div className="et">Margen proyectado</div>
              <div className={"v " + (margen != null && margen < 0 ? "critico" : margen != null && margen < 15 ? "alerta" : "")}>
                {margen == null ? "—" : n1(margen)}<small>%</small>
              </div>
              <div className="ctx">sobre costeo · M2 aprox. · fuente: ledger</div>
            </div>
          </div>
        </section>

        <section className="plancha">
          <SelectorActor usuarios={usuarios} />
        </section>

        <section className="plancha">
          <h2>Línea de vida del proyecto{" "}
            <span className="mid">
              {Number(brecha?.brecha_cop) > 0
                ? `FINANCIANDO ${mcop(brecha.brecha_cop)} M: PAGADO A TERCEROS ANTES DE COBRAR`
                : evVenc.length ? `${n0(evVenc.length)} EVENTOS VENCIDOS` : "INGRESOS ARRIBA · EGRESOS ABAJO"}
            </span>
          </h2>
          <p style={{ fontSize: 13, color: "var(--tinta-2)", marginTop: 0 }}>
            {Number(brecha?.brecha_cop) > 0
              ? `InnovaHub ha pagado ${cop(brecha.pagado_terceros_cop)} a terceros y ha cobrado ${cop(brecha.cobrado_cliente_cop)} del cliente: la diferencia la financia la empresa.`
              : `Cobrado ${cop(brecha?.cobrado_cliente_cop ?? 0)} del cliente frente a ${cop(brecha?.pagado_terceros_cop ?? 0)} pagados a terceros.`}
            {" "}Cada evento muestra lo previsto (hueco) y lo ocurrido (sólido); el segmento entre ambos es la desviación.
          </p>
          <LineaVida eventos={eventos} carriles={CARRILES_PROYECTO} fantasmas={fantasmas}
            titulo={`Línea de vida ${p.display_code}`} />
          <DocumentosProyecto projectCode={p.code} contractUrl={p.contract_url} docsFecha={p.docs_uploaded_at ? fecha(p.docs_uploaded_at) : null} />
        </section>

        <section className="plancha">
          <h2>Hitos de ingreso <span className="mid">{n0(hitos.length)} · CAPTURA ACTIVA</span></h2>
          {hitos.length === 0 ? (
            <div className="vacio">
              <div className="t">Este proyecto no tiene hitos de ingreso.</div>
              <div className="d">Regístralos desde <Link href="/cartera">Cartera</Link>: sin hitos no hay caja que proyectar.</div>
            </div>
          ) : (
            hitos.map((h) => {
              const [lbl, sev] = EH[h.state] ?? [h.state, "pendiente"];
              const s = h.vencido ? (h.state === "invoiced" ? "critico" : "alerta") : sev;
              return (
                <div className={"tarea " + s} key={h.id}>
                  <div className="dias">
                    <div className="n">{h.vencido ? Math.floor((Date.now() - new Date(h.expected_date)) / 86400000) : "·"}</div>
                    <div className="u">{h.vencido ? "DÍAS VENC." : "EN FECHA"}</div>
                  </div>
                  <div className="cuerpo">
                    <div className="t">
                      {cop(h.saldo_cop)} <span style={{ fontWeight: 400, color: "var(--tinta-2)" }}>saldo</span>
                      {Number(h.recibido_cop) > 0 && (
                        <span style={{ fontWeight: 400, fontSize: 12, color: "var(--correcto)" }}> · abonado {cop(h.recibido_cop)}</span>
                      )}
                    </div>
                    <div className="code">
                      esperado {fecha(h.expected_date)}
                      {h.forecast_date ? ` · forecast ${fecha(h.forecast_date)}` : ""}
                      {h.invoice_number ? ` · fact. ${h.invoice_number}` : ""}
                      {h.credited_date ? ` · pagado ${fecha(h.credited_date)}${h.credited_date_approx ? " (aprox.)" : ""}` : ""}
                    </div>
                    <div className="d">
                      <span className={"sev " + sev}>{lbl}</span>
                      {h.deliverables ? ` · ${String(h.deliverables).slice(0, 110)}` : ""}
                    </div>
                  </div>
                  {h.state !== "credited" && h.state !== "written_off" ? (
                    <ActorBridge render="panel" hito={{
                      id: h.id, state: h.state, amount_cop: Number(h.amount_cop), saldo: Number(h.saldo_cop),
                    }} />
                  ) : <span className="notaf">SALDADO</span>}
                </div>
              );
            })
          )}
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Costos por categoría <span className="mid">LEDGER · GL 2024→</span></h2>
            {costos.length === 0 ? (
              <div className="vacio"><div className="t">Sin costos contables imputados.</div>
                <div className="d">La contabilidad por proyecto empieza en enero de 2024.</div></div>
            ) : (
              <div className="instr">
                {costos.map((c) => (
                  <div className="fila" key={c.categoria}>
                    <span className="lab">{c.categoria}</span>
                    <span className="mono">{n0(c.n)} eventos</span>
                    <span className="val">{cop(c.monto)}</span>
                  </div>
                ))}
                <div className="fila total"><span className="lab">TOTAL CAUSADO</span><span className="val">{cop(causado)}</span></div>
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Presupuesto por ítem <span className="mid">{n0(presupuesto.length)} LÍNEAS APROBADAS</span></h2>
            {presupuesto.length === 0 ? (
              <div className="vacio">
                <div className="t">Este proyecto no tiene presupuesto por ítem.</div>
                <div className="d">Desde F5, sin presupuesto aprobado un proyecto no puede activarse.</div>
              </div>
            ) : (
              <div className="instr">
                {presupuesto.map((b) => (
                  <div className="fila" key={b.id}>
                    <span className="lab">{b.description ?? b.legacy_code}
                      <span className="mono" style={{ marginLeft: 8 }}>{b.legacy_code}</span></span>
                    <span className="mono">80 % = {cop(b.budget80)}</span>
                    <span className="val">{cop(b.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="plancha">
          <h2>
            Entregables y valor ganado{" "}
            <span className="mid">
              {ev?.cpi != null
                ? `CPI ${n1(ev.cpi)} · SPI ${n1(ev.spi ?? 0)} · ${n0(ev.completados)}/${n0(ev.entregables)} COMPLETADOS`
                : "AVANCE FÍSICO → CPI/SPI"}
            </span>
          </h2>
          {ev?.cpi != null && (
            <p style={{ fontSize: 13, color: "var(--tinta-2)", marginTop: 0 }}>
              {Number(ev.cpi) < 1
                ? `Cada peso gastado está produciendo $ ${n1(Number(ev.cpi))} de valor: el proyecto consume más de lo que avanza.`
                : `El gasto rinde: $ ${n1(Number(ev.cpi))} de valor por peso gastado.`}
              {ev.spi != null && Number(ev.spi) < 1 ? ` Y va al ${n0(Number(ev.spi) * 100)} % del ritmo planeado.` : ""}
            </p>
          )}
          <Entregables projectCode={p.code} entregables={entregables} usuarios={usuarios} />
        </section>

        <section className="plancha">
          <h2>Contratación de terceros <span className="mid">{n0(contratos.length)} CONTRATOS</span></h2>
          {contratos.length === 0 ? (
            <div className="vacio"><div className="t">Sin contratos con terceros.</div></div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>Contrato</th><th>Origen</th><th>Categoría</th><th>Contratista</th>
                    <th>Estado</th><th className="n">Monto</th><th className="n">Pagado</th>
                    <th className="n">Pendiente</th></tr>
                </thead>
                <tbody>
                  {contratos.map((c) => (
                    <tr key={c.code}>
                      <td className={"estado code " + (c.state === "annulled" ? "pendiente" : c.state === "active" ? "correcto" : "info")}>
                        {c.code}
                      </td>
                      <td className="code">{c.hiring_request_code ?? "legado"}</td>
                      <td>{c.account_category ?? "—"}</td>
                      <td>{c.contratista}</td>
                      <td><span className={"sev " + (c.state === "annulled" ? "critico" : c.state === "active" ? "correcto" : "pendiente")}>
                        {c.state === "annulled" ? "anulado" : c.state === "active" ? "activo" : "terminado"}</span></td>
                      <td className="n" title={c.amount_note ?? ""}>{cop(c.amount)}{c.amount_note ? " *" : ""}</td>
                      <td className="n">{cop(c.pagado)}</td>
                      <td className="n">{Number(c.pendiente) ? cop(c.pendiente) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Infraestructura <span className="mid">{n0(infra.length)} ÍTEMS</span></h2>
            {infra.length === 0 ? (
              <div className="vacio"><div className="t">Sin infraestructura asociada.</div></div>
            ) : (
              <div className="instr">
                {infra.map((i, ix) => (
                  <div className="fila" key={ix}>
                    <span className="lab">{i.concept} · {i.provider}
                      <span className="mono" style={{ marginLeft: 8 }}>{i.resource}</span></span>
                    <span className={"sev " + (i.vencida ? "alerta" : i.status === "on" ? "correcto" : "pendiente")}>
                      {i.status}{i.vencida ? " · vencida" : ""}</span>
                    <span className="mono">fin {fecha(i.end_date)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Bitácora <span className="mid">AUDIT.EVENT_LOG · APPEND-ONLY</span></h2>
            {bitacora.length === 0 ? (
              <div className="vacio"><div className="t">Sin eventos de captura todavía.</div>
                <div className="d">Aquí aparece cada firma, abono, gestión y otrosí de este proyecto.</div></div>
            ) : (
              <div className="feed">
                {bitacora.map((b, i) => (
                  <div className={"mov " + (b.action.includes("acreditar") || b.action.includes("validar") ? "correcto"
                    : b.action.includes("gestion") || b.action.includes("reprogramar") ? "info" : "pendiente")} key={i}>
                    <div className="t">{b.actor} · {b.action.replace(".", " → ")}</div>
                    <div className="m">{fechaHora(b.at).toUpperCase()} · {b.entity} {b.entity_id}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

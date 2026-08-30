import Link from "next/link";
import { q } from "../../../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../../../lib/fmt";
import Historia from "../../../historia";
import SelectorActor from "../../firmas/selector-actor";
import PanelContacto from "../panel-contacto";
import BotonPortal from "../boton-portal";
import Acciones360 from "./acciones-360";
import AccionesContrato from "./acciones-contrato";
import LineaVida, { CARRILES_CONTRATO, SQL_EVENTOS } from "../../../linea-vida";

export const dynamic = "force-dynamic";

const ER = { en_vinculacion: ["En vinculación", "info"], activo: ["Activo", "correcto"],
  inactivo: ["Inactivo", "pendiente"], no_elegible: ["No elegible", "critico"] };
const TD = { rut: "RUT", cert_bancaria: "Cert. bancaria", autorizacion_1581: "Autorización Ley 1581",
  seguridad_social: "Seguridad social", certificacion: "Certificación" };

export default async function Ficha360({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const actorId = sp?.actor || "";

  const [c] = await q("select * from metrics.v2_contratista_360 where id = $1", [id]);
  if (!c) {
    return (
      <div className="contenido"><section className="plancha"><div className="vacio">
        <div className="t">El contratista no existe.</div>
        <div className="d"><Link href="/contratacion/contratistas">Volver al directorio</Link></div>
      </div></section></div>
    );
  }

  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const contratos = await q(
    `select k.code, k.state, k.amount, k.start_date, k.end_date, k.account_category,
            p.code project_code, p.display_code, u.full_name gestora,
            (r.contract_code is not null) evaluado,
            r.q_calidad, r.q_fechas, r.q_comunicacion, r.q_autonomia, r.rondas_ajustes,
            r.desviacion_dias, r.hecho
     from procurement.contract k
     join core.project p on p.id = k.project_id
     left join core.app_user u on u.id = k.overseer_id
     left join procurement.contractor_review r on r.contract_code = k.code
     where k.contractor_id = $1 order by k.start_date desc nulls last`, [id]);
  const tarifas = await q(
    `select s.ihpsc_group, count(*) lineas, round(avg(s.unit_price)) precio_prom,
            cmp.vs_promedio_pct
     from procurement.request_service s
     join procurement.hiring_request hr on hr.code = s.request_code
     left join metrics.v2_comparador cmp
       on cmp.ihpsc_group = s.ihpsc_group and cmp.contractor_id = $1
     where hr.contractor_id = $1 and s.ihpsc_group is not null
     group by s.ihpsc_group, cmp.vs_promedio_pct order by count(*) desc`, [id]);
  const docs = await q(
    `select tipo, periodo, vigente_hasta, url, subido_por, creado_en,
            (vigente_hasta is not null and vigente_hasta < current_date) vencido
     from procurement.contractor_document where contractor_id = $1
     order by creado_en desc limit 15`, [id]);
  const notas = await q(
    `select n.nota, n.creado_en, u.full_name autor
     from procurement.contractor_note n join core.app_user u on u.id = n.autor_id
     where n.contractor_id = $1 order by n.id desc limit 8`, [id]);
  const pagosPend = await q(
    `select cp.due_date, cp.amount, k.code contrato
     from procurement.contract_payment cp
     join procurement.contract k on k.code = cp.contract_code
     where k.contractor_id = $1 and cp.adm_validated_at is null and cp.cancelled_at is null
     order by cp.due_date limit 8`, [id]);

  // Línea de vida por contrato (0018): eventos, entregas y fantasmas de prórroga
  const codes = contratos.map((k) => k.code);
  const [eventos, entregables, fantasmas, firmas] = await Promise.all([
    q(`${SQL_EVENTOS} where contract_code = any($1) order by orden`, [codes]),
    q(`select id, contract_code, description, rounds_agreed, rounds_used, delivered_at, approved_at,
              to_char(due_date,'DD Mon') due, to_char(first_delivered_at,'DD Mon') first_delivered,
              to_char(approved_at,'DD Mon') approved,
              (first_delivered_at is null and due_date < current_date) vencido
         from procurement.contract_deliverable where contract_code = any($1) order by due_date`, [codes]),
    q(`select contract_code, changes->>'fecha_fin_anterior' fecha, 'Fin anterior · otrosí #' || id titulo
         from procurement.contract_amendment
        where state='approved' and effect='plazo' and contract_code = any($1)`, [codes]),
    q(`select code, signed_internal_at is not null interna, signed_contractor_at is not null contratista,
              base_amount, amount from procurement.contract where code = any($1)`, [codes]),
  ]);
  const porContrato = (arr) => arr.reduce((m, r) => ((m[r.contract_code] ??= []).push(r), m), {});
  const evK = porContrato(eventos), enK = porContrato(entregables), faK = porContrato(fantasmas);
  const fiK = Object.fromEntries(firmas.map((f) => [f.code, f]));

  const [lbl, sev] = ER[c.relation_state];
  const sinEvaluar = contratos.filter((k) => k.state === "finished" && !k.evaluado);

  return (
    <>
      <div className="historia">
        <div className="eyebrow2"><span className="tick" aria-hidden="true" />
          <span><Link href="/contratacion/contratistas">05 · CONTRATISTAS</Link> / EXPEDIENTE 360</span></div>
        <div className="fila-titulo">
          <div>
            <h1>{c.display_name}</h1>
            <p className="lede" style={{ margin: "6px 0 0" }}>
              {c.kind === "juridica" ? "Empresa" : "Persona natural"} · {c.profile ?? "sin perfil"} ·
              trabaja con {(c.gestoras_actuales ?? []).join(", ") || "nadie actualmente"}
              {(c.gestoras_historicas ?? []).length
                ? ` · ha trabajado con ${(c.gestoras_historicas ?? []).join(", ")}` : ""}
            </p>
          </div>
          <div className="lado" style={{ flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span className={"sev " + sev}>{lbl}</span>
            {c.eval_promedio != null && (
              <span className={"sev " + (Number(c.eval_promedio) >= 4 ? "correcto" : "alerta")}>
                evaluación {n1(c.eval_promedio)} / 5 · {n0(c.evaluaciones)} contratos
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="contenido">
        <section className="plancha">
          <div className="kpis">
            <div className="kpi"><div className="et">Percibido histórico</div>
              <div className="v correcto">{cop(c.percibido_cop)}</div>
              <div className="ctx">{n1(c.concentracion_pct)} % del gasto en terceros</div></div>
            <div className="kpi"><div className="et">Pendiente por pagar</div>
              <div className="v">{c.pendiente_cop > 0 ? cop(c.pendiente_cop) : "—"}</div>
              <div className="ctx">{n0(pagosPend.length)} pagos programados</div></div>
            <div className="kpi"><div className="et">Contratos</div>
              <div className="v">{n0(c.contratos_activos)}<small>/ {n0(c.contratos_total)}</small></div>
              <div className="ctx">activos / históricos</div></div>
            <div className="kpi"><div className="et">Le pagamos en</div>
              <div className={"v " + (Number(c.dso_pago_dias) > 15 ? "alerta" : "")}>
                {c.dso_pago_dias ?? "—"}<small>días</small></div>
              <div className="ctx">promedio vs fecha programada</div></div>
            <div className="kpi"><div className="et">Rondas de ajustes</div>
              <div className="v">{c.rondas_prom ?? "—"}</div>
              <div className="ctx">promedio por contrato{c.desviacion_prom != null ? ` · entrega ${c.desviacion_prom > 0 ? "+" : ""}${n1(c.desviacion_prom)} d` : ""}</div></div>
          </div>
        </section>

        <section className="plancha" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <SelectorActor usuarios={usuarios} />
          <PanelContacto contratistaId={Number(id)} actorId={actorId} />
          <BotonPortal contratistaId={Number(id)} />
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Cómo cobra frente a sus pares <span className="mid">COMPARADOR · SOLO INTERNO</span></h2>
            {tarifas.length === 0 ? (
              <div className="vacio"><div className="t">Sin líneas de servicio mapeadas a productos.</div>
                <div className="d">El comparador se alimenta de las solicitudes con ítem IHPSC.</div></div>
            ) : (
              <div className="instr">
                {tarifas.map((t) => (
                  <div className="fila" key={t.ihpsc_group}>
                    <span className="lab">{t.ihpsc_group}
                      <span className="mono" style={{ marginLeft: 8 }}>{n0(t.lineas)} líneas</span></span>
                    <span className="val">{cop(t.precio_prom)}</span>
                    {t.vs_promedio_pct != null && (
                      <span className={"sev " + (Number(t.vs_promedio_pct) > 10 ? "alerta" : Number(t.vs_promedio_pct) < -10 ? "correcto" : "pendiente")}>
                        {Number(t.vs_promedio_pct) > 0 ? "+" : ""}{n1(t.vs_promedio_pct)} % vs promedio
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Expediente documental <span className="mid">
              {Number(c.docs_vencidos) > 0 ? `${n0(c.docs_vencidos)} VENCIDOS` : "VIGENCIAS, NO EXISTENCIAS"}</span></h2>
            {docs.length === 0 ? (
              <div className="vacio"><div className="t">Expediente vacío.</div>
                <div className="d">RUT, certificación bancaria, autorización Ley 1581 y seguridad social mensual viven aquí con su vigencia.</div></div>
            ) : (
              <div className="instr">
                {docs.map((d, i) => (
                  <div className="fila" key={i}>
                    <span className="lab"><a href={d.url} target="_blank">{TD[d.tipo]}</a>
                      {d.periodo && <span className="mono" style={{ marginLeft: 6 }}>{fecha(d.periodo).slice(2)}</span>}</span>
                    <span className="mono">por {d.subido_por}</span>
                    <span className={"sev " + (d.vencido ? "alerta" : "correcto")}>
                      {d.vencido ? `venció ${fecha(d.vigente_hasta)}` : d.vigente_hasta ? `vigente hasta ${fecha(d.vigente_hasta)}` : "sin vencimiento"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Acciones360 contratistaId={Number(id)} modo="documento" />
          </section>
        </div>

        <section className="plancha">
          <h2>Historial de contratación y evaluaciones{" "}
            <span className="mid">{sinEvaluar.length > 0 ? `${n0(sinEvaluar.length)} SIN EVALUAR` : "AL DÍA"} · SOLO INTERNO</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr><th>Contrato</th><th>Proyecto</th><th>Gestora</th><th>Categoría</th>
                  <th className="n">Monto</th><th className="n">Vigencia</th>
                  <th className="n">Eval.</th><th className="n">Rondas</th><th className="n">Entrega</th><th></th></tr>
              </thead>
              <tbody>
                {contratos.map((k) => {
                  const prom = k.evaluado
                    ? (k.q_calidad + k.q_fechas + k.q_comunicacion + k.q_autonomia) / 4 : null;
                  return (
                    <tr key={k.code}>
                      <td className={"estado code " + (k.state === "active" ? "correcto" : k.state === "annulled" ? "pendiente" : "info")}>{k.code}</td>
                      <td className="code"><Link href={`/proyectos/${encodeURIComponent(k.project_code)}`}>{k.display_code}</Link></td>
                      <td>{k.gestora ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>{k.account_category ?? "—"}</td>
                      <td className="n">{cop(k.amount)}</td>
                      <td className="n">{fecha(k.start_date)} → {fecha(k.end_date)}</td>
                      <td className="n" title={k.hecho ?? ""}>
                        {prom != null
                          ? <span className={"sev " + (prom >= 4 ? "correcto" : prom >= 3 ? "alerta" : "critico")}>{n1(prom)}</span>
                          : "·"}
                      </td>
                      <td className="n">{k.rondas_ajustes ?? "·"}</td>
                      <td className="n">{k.desviacion_dias != null ? `${k.desviacion_dias > 0 ? "+" : ""}${k.desviacion_dias} d` : "·"}</td>
                      <td>
                        {k.state === "finished" && !k.evaluado && (
                          <Acciones360 contratistaId={Number(id)} modo="review" contrato={k.code} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="plancha">
          <h2>Línea de vida por contrato{" "}
            <span className="mid">PREVISTO ▽ · OCURRIDO ▼ · {n0(contratos.length)} CONTRATOS</span></h2>
          {contratos.length === 0 ? (
            <div className="vacio"><div className="t">Sin contratos: no hay línea que dibujar.</div></div>
          ) : contratos.map((k) => {
            const fi = fiK[k.code] || {};
            const sobre = Number(fi.amount || 0) - Number(fi.base_amount || 0);
            return (
              <details className="contrato-lv" key={k.code} open={k.state === "active"}>
                <summary>
                  <span className="code" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>{k.code}</span>
                  <span>{k.display_code}</span>
                  <span className={"sev " + (k.state === "active" ? "correcto" : k.state === "annulled" ? "pendiente" : "info")}>
                    {k.state === "active" ? "activo" : k.state === "annulled" ? "anulado" : "terminado"}</span>
                  <span className="mono" style={{ fontFamily: "var(--fx-mono)", fontSize: 11, color: "var(--tinta-3)" }}>
                    {fecha(k.start_date)} → {fecha(k.end_date)} · {cop(k.amount)}
                    {sobre > 0 ? ` · sobrecosto ${cop(sobre)} (${n1((100 * sobre) / Number(fi.base_amount))} %)` : ""}
                    {(enK[k.code] || []).length ? ` · ${(enK[k.code] || []).length} entregas planeadas` : ""}
                  </span>
                </summary>
                <div style={{ paddingTop: 10 }}>
                  <LineaVida eventos={evK[k.code] || []} carriles={CARRILES_CONTRATO}
                    fantasmas={faK[k.code] || []} titulo={`Línea de vida ${k.code}`} />
                  <AccionesContrato contrato={k.code} activo={k.state === "active"}
                    firmas={{ interna: fi.interna, contratista: fi.contratista }}
                    entregables={enK[k.code] || []} />
                </div>
              </details>
            );
          })}
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Pagos pendientes <span className="mid">{n0(pagosPend.length)}</span></h2>
            {pagosPend.length === 0 ? (
              <div className="vacio"><div className="t">Nada pendiente por pagarle.</div></div>
            ) : (
              <div className="instr">
                {pagosPend.map((p, i) => (
                  <div className="fila" key={i}>
                    <span className="lab code" style={{ fontFamily: "var(--fx-mono)", fontSize: 12 }}>{p.contrato}</span>
                    <span className="mono">{fecha(p.due_date)}</span>
                    <span className="val">{cop(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="plancha">
            <h2>Bitácora de la relación <span className="mid">APPEND-ONLY · SOLO INTERNO</span></h2>
            {notas.length === 0 ? (
              <div className="vacio"><div className="t">Sin notas todavía.</div></div>
            ) : (
              <div className="feed">
                {notas.map((nx, i) => (
                  <div className="mov pendiente" key={i}>
                    <div className="t">{nx.nota}</div>
                    <div className="m">{fecha(nx.creado_en).toUpperCase()} · {nx.autor}</div>
                  </div>
                ))}
              </div>
            )}
            <Acciones360 contratistaId={Number(id)} modo="nota" estadoActual={c.relation_state} />
          </section>
        </div>
      </div>
    </>
  );
}

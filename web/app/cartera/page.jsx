import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0, n1, fecha } from "../../lib/fmt";
import Historia from "../historia";
import SelectorActor from "../contratacion/firmas/selector-actor";
import PanelHito from "./panel-hito";
import NuevoHito from "./nuevo-hito";

export const dynamic = "force-dynamic";

// F4 · Cartera sobre el núcleo transaccional, con captura: facturar, abonar,
// reprogramar forecast y registrar gestión de cobro. El aging sigue anclado a la
// fecha esperada: reprogramar no lo maquilla.

const EST = {
  scheduled: ["Programado", "pendiente"],
  invoiced: ["Facturado", "alerta"],
  partial: ["Abonado parcial", "info"],
};

export default async function Cartera() {
  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const proyectos = await q(`
    select code, display_code from core.project
    where kind in ('project','phase') and status in ('active','paused','draft') order by code`);

  const vencidos = await q(`
    select m.id, m.state, m.amount_cop, m.expected_date, m.forecast_date, m.invoice_date,
           m.invoice_number, m.delay_category,
           r.recibido_cop, r.saldo_cop,
           p.code project_code, cl.name cliente, pm.full_name partner_manager,
           (current_date - m.expected_date) dias,
           ga.n gestiones, ga.ultima
    from revenue.milestone m
    join core.project p on p.id = m.project_id
    left join core.client cl on cl.id = p.client_id
    left join core.app_user pm on pm.id = p.partner_manager_id
    join revenue.v_milestone_recibido r on r.milestone_id = m.id
    left join (select milestone_id, count(*) n, max(at)::date ultima
               from revenue.collection_action group by 1) ga on ga.milestone_id = m.id
    where m.state in ('scheduled','invoiced','partial') and m.expected_date < current_date
    order by r.saldo_cop desc`);

  const proximos = await q(`
    select m.id, m.state, m.amount_cop, m.expected_date,
           r.recibido_cop, r.saldo_cop,
           p.code project_code, cl.name cliente, pm.full_name partner_manager,
           0 as dias
    from revenue.milestone m
    join core.project p on p.id = m.project_id
    left join core.client cl on cl.id = p.client_id
    left join core.app_user pm on pm.id = p.partner_manager_id
    join revenue.v_milestone_recibido r on r.milestone_id = m.id
    where m.state in ('scheduled','invoiced','partial') and m.expected_date >= current_date
    order by m.expected_date limit 12`);

  const totVencido = vencidos.reduce((s, v) => s + Number(v.saldo_cop), 0);
  const [top] = vencidos.length
    ? [vencidos.reduce((acc, v) => {
        acc[v.cliente] = (acc[v.cliente] || 0) + Number(v.saldo_cop);
        return acc;
      }, {})].map((m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0])
    : [null];

  return (
    <>
      <Historia
        num="04"
        seccion="Cartera y cobro"
        titulo={top ? `A ${top[0]} hay que cobrarle primero` : "No hay cartera vencida"}
        lede={
          top
            ? `${top[0]} concentra ${mcop(top[1])} M de los ${mcop(totVencido)} M vencidos. Desde aquí se factura, se registran los abonos (parciales incluidos), se reprograma el forecast con su motivo y cada gestión de cobro queda escrita con autor — el aging sigue contando desde la fecha esperada: moverse de fecha no borra la mora.`
            : "Todos los hitos con fecha cumplida están saldados."
        }
        lado={<span className="notaf">M5 · M6 · CAPTURA F4 · FUENTE: NÚCLEO TRANSACCIONAL</span>}
      />
      <div className="contenido">
        <section className="plancha" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <SelectorActor usuarios={usuarios} />
        </section>

        <section className="plancha">
          <h2>Nuevo hito <span className="mid">TODO CONTRATO NUEVO REGISTRA AQUÍ SUS COBROS</span></h2>
          <NuevoHitoActor proyectos={proyectos} />
        </section>

        <section className="plancha">
          <h2>Hitos vencidos por saldo <span className="mid">{n0(vencidos.length)} · $ {mcop(totVencido)} M COP</span></h2>
          {vencidos.length === 0 ? (
            <div className="vacio"><div className="t">Nada vencido.</div></div>
          ) : (
            vencidos.map((v) => <FilaHito key={v.id} v={v} vencido />)
          )}
        </section>

        <section className="plancha">
          <h2>Próximos hitos <span className="mid">{n0(proximos.length)} SIGUIENTES</span></h2>
          {proximos.map((v) => <FilaHito key={v.id} v={v} />)}
        </section>
      </div>
    </>
  );
}

// wrappers de servidor: leen el actor de la URL en el cliente vía props ligeras
import ActorBridge from "./actor-bridge";
function NuevoHitoActor({ proyectos }) {
  return <ActorBridge render="nuevo" proyectos={proyectos} />;
}
function FilaHito({ v, vencido = false }) {
  const [lbl, sev] = EST[v.state] ?? [v.state, "pendiente"];
  const s = vencido && v.dias > 60 ? "critico" : vencido ? "alerta" : sev;
  return (
    <div className={"tarea " + s}>
      <div className="dias">
        <div className="n">{vencido ? v.dias : "·"}</div>
        <div className="u">{vencido ? "DÍAS VENC." : "EN FECHA"}</div>
      </div>
      <div className="cuerpo">
        <div className="t">
          {cop(v.saldo_cop)} <span style={{ fontWeight: 400, color: "var(--tinta-2)" }}>saldo</span>
          {Number(v.recibido_cop) > 0 && (
            <span style={{ fontWeight: 400, fontSize: 12, color: "var(--correcto)" }}>
              {" "}· abonado {cop(v.recibido_cop)}
            </span>
          )}
          {"  "}· {v.cliente ?? "—"}
        </div>
        <div className="code">
          <Link href={`/proyectos/${encodeURIComponent(v.project_code)}`}>{v.project_code}</Link>
          {" "}· esperado {fecha(v.expected_date)}
          {v.forecast_date ? ` · forecast ${fecha(v.forecast_date)}` : ""}
          {v.invoice_number ? ` · fact. ${v.invoice_number}` : ""}
        </div>
        <div className="d">
          <span className={"sev " + sev}>{lbl}</span>
          {" "}· responsable {v.partner_manager ?? "—"}
          {v.gestiones ? ` · ${v.gestiones} gestiones (última ${fecha(v.ultima)})` : " · sin gestiones registradas"}
        </div>
      </div>
      <ActorBridge render="panel" hito={{
        id: v.id, state: v.state, amount_cop: Number(v.amount_cop), saldo: Number(v.saldo_cop),
      }} />
    </div>
  );
}

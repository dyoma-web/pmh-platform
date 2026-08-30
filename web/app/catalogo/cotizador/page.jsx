import { q } from "../../../lib/db";
import { cop, n0, n1, fecha } from "../../../lib/fmt";
import Historia from "../../historia";
import FormularioCotizacion from "./formulario";
import EstadoCotizacion from "./estado";

export const dynamic = "force-dynamic";

const EQ = { draft: ["Borrador", "pendiente"], sent: ["Enviada", "info"],
  won: ["Ganada", "correcto"], lost: ["Perdida", "alerta"] };

export default async function Cotizador() {
  const usuarios = await q(`
    select id, full_name from core.app_user where active and email is not null order by full_name`);
  const clientes = await q("select id, name from core.client order by name");
  const items = await q(`
    select code, name, unit, ref_cost, ref_source from catalog.ihpsc_item
    where state='activo' and os_applicable order by ref_cost desc nulls last, code`);
  const conCosto = items.filter((i) => i.ref_cost != null).length;
  const cotizaciones = await q(`
    select qz.code, qz.title, qz.state, qz.created_at, cl.name cliente, u.full_name autora,
           sum(l.total) total, sum(l.qty * coalesce(l.ref_cost, 0)) costo_ref,
           count(*) lineas
    from catalog.quote qz
    left join core.client cl on cl.id = qz.client_id
    join core.app_user u on u.id = qz.created_by
    join catalog.quote_line l on l.quote_id = qz.id
    group by qz.id, qz.code, qz.title, qz.state, qz.created_at, cl.name, u.full_name
    order by qz.code desc limit 20`);

  return (
    <>
      <Historia
        num="05"
        seccion="Catálogo · Cotizador"
        titulo="El precio deja de ser «lo que nos pareció»"
        lede={`Cada línea sale del catálogo IHPSC con su costo de referencia (${n0(conCosto)} ítems ya lo tienen, de precios reales pagados) y el margen esperado se calcula en vivo. Al ganar una cotización, sus líneas son el borrador natural del presupuesto del proyecto en el wizard de alta.`}
        lado={<span className="notaf">COSTO REF = MEDIANA DE LO REALMENTE PAGADO</span>}
      />
      <div className="contenido">
        <FormularioCotizacion usuarios={usuarios} clientes={clientes} items={items} />

        <section className="plancha">
          <h2>Cotizaciones <span className="mid">{n0(cotizaciones.length)} RECIENTES</span></h2>
          {cotizaciones.length === 0 ? (
            <div className="vacio"><div className="t">Aún no hay cotizaciones.</div>
              <div className="d">La primera que crees estrena el correlativo Q_{new Date().getFullYear()}_001.</div></div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>Código</th><th>Título</th><th>Cliente</th><th>Autora</th>
                    <th className="n">Valor COP</th><th className="n">Margen esp.</th>
                    <th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {cotizaciones.map((c) => {
                    const [lbl, sev] = EQ[c.state];
                    const margen = Number(c.total) && Number(c.costo_ref)
                      ? (1 - Number(c.costo_ref) / Number(c.total)) * 100 : null;
                    return (
                      <tr key={c.code}>
                        <td className={"estado code " + sev}>{c.code}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{c.title}</td>
                        <td>{c.cliente ?? "—"}</td>
                        <td>{c.autora}</td>
                        <td className="n" style={{ fontWeight: 600 }}>{cop(c.total)}</td>
                        <td className="n">{margen == null ? "sin ref." : n1(margen) + " %"}</td>
                        <td><span className={"sev " + sev}>{lbl}</span></td>
                        <td><EstadoCotizacion code={c.code} estado={c.state} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

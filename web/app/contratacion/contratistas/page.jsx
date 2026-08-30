import { q } from "../../../lib/db";
import { n0, cop } from "../../../lib/fmt";
import Historia from "../../historia";
import SelectorActor from "../firmas/selector-actor";
import PanelContacto from "./panel-contacto";

export const dynamic = "force-dynamic";

// Directorio SIN datos personales en el listado: el contacto se abre por acción
// explícita, queda registrado en la auditoría, y solo administración lo edita.

export default async function Contratistas({ searchParams }) {
  const sp = await searchParams;
  const actorId = sp?.actor || "";
  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const filas = await q(`
    select c.id, c.display_name, c.profile, c.id_type, c.company_name,
           coalesce(k.n, 0) contratos, coalesce(k.monto, 0) monto,
           coalesce(hr.n, 0) solicitudes,
           (cc.data_authorization_doc_id is not null) autorizacion
    from procurement.contractor c
    left join (select contractor_id, count(*) n, sum(amount) monto
               from procurement.contract group by 1) k on k.contractor_id = c.id
    left join (select contractor_id, count(*) n
               from procurement.hiring_request group by 1) hr on hr.contractor_id = c.id
    left join pii.contractor_contact cc on cc.contractor_id = c.id
    order by monto desc nulls last, c.display_name`);
  const sinAut = filas.filter((f) => !f.autorizacion).length;

  return (
    <>
      <Historia
        num="04"
        seccion="Contratación · Contratistas"
        titulo={`${n0(filas.length)} contratistas, cero datos personales a la vista`}
        lede={`El listado no muestra documentos, teléfonos ni correos: se abren por acción explícita y cada consulta queda en la auditoría (Ley 1581 de 2012). ${n0(sinAut)} contratistas aún no tienen registrada su autorización de tratamiento de datos — en el flujo nuevo será requisito para emitir contrato.`}
        lado={<span className="notaf">{n0(sinAut)} SIN AUTORIZACIÓN LEY 1581</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <SelectorActor usuarios={usuarios} />
        </section>
        <section className="plancha">
          <h2>Directorio <span className="mid">ORDENADO POR MONTO CONTRATADO</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Contratista</th><th>Perfil</th><th>Tipo doc.</th>
                  <th className="n">Contratos</th><th className="n">Monto COP</th>
                  <th className="n">Solicitudes</th><th>Ley 1581</th><th>Contacto</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td className={"estado " + (f.autorizacion ? "correcto" : "alerta")}>
                      {f.display_name}{f.company_name ? " · " + f.company_name : ""}
                    </td>
                    <td>{f.profile ?? "—"}</td>
                    <td className="code">{f.id_type ?? "—"}</td>
                    <td className="n">{n0(f.contratos)}</td>
                    <td className="n">{f.monto > 0 ? cop(f.monto) : "—"}</td>
                    <td className="n">{n0(f.solicitudes)}</td>
                    <td>
                      <span className={"sev " + (f.autorizacion ? "correcto" : "alerta")}>
                        {f.autorizacion ? "registrada" : "pendiente"}
                      </span>
                    </td>
                    <td><PanelContacto contratistaId={f.id} actorId={actorId} /></td>
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

import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, n0, fecha } from "../../../lib/fmt";
import Historia from "../../historia";
import SelectorActor from "../firmas/selector-actor";
import AccionesSolicitud from "./acciones-solicitud";

export const dynamic = "force-dynamic";

const EST = { requested: ["En trámite", "info"], processed: ["Procesada", "correcto"], cancelled: ["Cancelada", "pendiente"] };

export default async function Solicitudes({ searchParams }) {
  const sp = await searchParams;
  const actorId = sp?.actor || "";
  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const filas = await q(`
    select hr.code, hr.state, hr.category, hr.start_date, hr.annotations,
           p.code project_code, ct.display_name contratista, u.full_name gestora,
           s.total, s.n_serv, c.code contrato
    from procurement.hiring_request hr
    join core.project p on p.id = hr.project_id
    join procurement.contractor ct on ct.id = hr.contractor_id
    left join core.app_user u on u.id = hr.requested_by
    left join (select request_code, sum(total) total, count(*) n_serv
               from procurement.request_service group by 1) s on s.request_code = hr.code
    left join procurement.contract c on c.hiring_request_code = hr.code
    order by hr.code desc`);
  const enTramite = filas.filter((f) => f.state === "requested");
  const conLlave = filas.filter((f) => f.contrato).length;

  return (
    <>
      <Historia
        num="05"
        seccion="Contratación · Solicitudes"
        titulo={
          enTramite.length > 0
            ? `${n0(enTramite.length)} solicitudes esperan proceso`
            : "Ninguna solicitud en trámite"
        }
        lede={`De aquí nace todo contrato: la gestora pide, administración procesa, y el contrato queda amarrado a su solicitud por llave — la cadena que en AppSheet se cortaba. ${n0(conLlave)} contratos ya nacieron con llave en el sistema nuevo; los ${n0(filas.length - conLlave)} del legado quedaron sin ella y así se quedan: la regla aplica hacia adelante.`}
        lado={<Link className="btn" href={`/contratacion/solicitudes/nueva${actorId ? `?actor=${actorId}` : ""}`}>Crear solicitud</Link>}
      />
      <div className="contenido">
        <section className="plancha">
          <SelectorActor usuarios={usuarios} base="/contratacion/solicitudes" />
        </section>
        <section className="plancha">
          <h2>Solicitudes <span className="mid">{n0(filas.length)} · M12</span></h2>
          <div className="twrap">
            <table className="maestra">
              <thead>
                <tr>
                  <th>Código</th><th>Estado</th><th>Proyecto</th><th>Contratista</th>
                  <th>Gestora</th><th className="n">Servicios</th><th className="n">Valor COP</th>
                  <th>Contrato</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, 40).map((f) => {
                  const [lbl, sev] = EST[f.state] ?? [f.state, "pendiente"];
                  return (
                    <tr key={f.code}>
                      <td className={"estado code " + sev}>{f.code}</td>
                      <td><span className={"sev " + sev}>{lbl}</span></td>
                      <td className="code">
                        <Link href={`/proyectos/${encodeURIComponent(f.project_code)}`}>{f.project_code}</Link>
                      </td>
                      <td>{f.contratista}</td>
                      <td>{f.gestora ?? "—"}</td>
                      <td className="n">{n0(f.n_serv ?? 0)}</td>
                      <td className="n" style={{ fontWeight: 600 }}>{f.total ? cop(f.total) : "—"}</td>
                      <td className="code">{f.contrato ?? (f.state === "processed" ? "legado sin llave" : "—")}</td>
                      <td>
                        {f.state === "requested" && <AccionesSolicitud code={f.code} actorId={actorId} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

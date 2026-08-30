import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, n0, fecha, fechaHora } from "../../../lib/fmt";
import Historia from "../../historia";
import SelectorActor from "../firmas/selector-actor";
import FormularioOtrosi from "./formulario-otrosi";
import ResolverOtrosi from "./resolver-otrosi";

export const dynamic = "force-dynamic";

const EFECTO = { monto: "Monto", fechas: "Fechas", plazo: "Plazo", alcance: "Alcance", anulacion: "Anulación" };
const EST = { requested: ["En trámite", "info"], approved: ["Aprobado", "correcto"], rejected: ["Rechazado", "pendiente"] };

export default async function Otrosi({ searchParams }) {
  const sp = await searchParams;
  const actorId = sp?.actor || "";
  const usuarios = await q(`
    select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);
  const contratos = await q(`
    select c.code, c.amount, to_char(c.end_date,'YYYY-MM-DD') end_date, ct.display_name contratista, p.code project_code
    from procurement.contract c
    join procurement.contractor ct on ct.id = c.contractor_id
    join core.project p on p.id = c.project_id
    where c.state = 'active' order by c.code desc`);
  const pagosPend = await q(`
    select id, contract_code, due_date, amount from procurement.contract_payment
    where adm_validated_at is null and cancelled_at is null order by due_date`);
  const lista = await q(`
    select am.*, u1.full_name solicitante, u2.full_name resolutor
    from procurement.contract_amendment am
    join core.app_user u1 on u1.id = am.requested_by
    left join core.app_user u2 on u2.id = am.resolved_by
    order by am.id desc limit 30`);
  const enTramite = lista.filter((l) => l.state === "requested").length;

  return (
    <>
      <Historia
        num="05"
        seccion="Contratación · Otrosí"
        titulo={enTramite > 0 ? `${n0(enTramite)} otrosíes esperan resolución` : "El contrato original nunca se edita"}
        lede="Todo cambio a un contrato es un otrosí con su propio flujo: la gestora lo pide con detalle, administración lo resuelve (nunca la misma persona), y al aprobarse el sistema aplica el cambio dejando la traza — el monto anterior queda escrito, los pagos anulados se marcan, nada se borra."
        lado={<span className="notaf">SEPARACIÓN DE FUNCIONES POR CHECK</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <SelectorActor usuarios={usuarios} />
        </section>

        <FormularioOtrosi actorId={actorId} contratos={contratos} pagosPend={pagosPend} />

        <section className="plancha">
          <h2>Otrosíes <span className="mid">{n0(lista.length)} RECIENTES</span></h2>
          {lista.length === 0 ? (
            <div className="vacio"><div className="t">Aún no hay otrosíes en el sistema nuevo.</div>
              <div className="d">Los 41 «MODIFICADO POR OTROSÍ» del legado viven como anotación en sus contratos.</div></div>
          ) : (
            <div className="twrap">
              <table className="maestra">
                <thead>
                  <tr><th>#</th><th>Contrato</th><th>Efecto</th><th>Detalle</th>
                    <th>Solicitó</th><th>Estado</th><th>Resolvió</th><th></th></tr>
                </thead>
                <tbody>
                  {lista.map((a) => {
                    const [lbl, sev] = EST[a.state];
                    return (
                      <tr key={a.id}>
                        <td className={"estado code " + sev}>{a.id}</td>
                        <td className="code">{a.contract_code}</td>
                        <td>{EFECTO[a.effect]}</td>
                        <td style={{ whiteSpace: "normal", maxWidth: 320, fontSize: 13 }}>{a.detail}</td>
                        <td>{a.solicitante}</td>
                        <td><span className={"sev " + sev}>{lbl}</span></td>
                        <td>{a.resolutor ?? "—"}</td>
                        <td>{a.state === "requested" && <ResolverOtrosi id={a.id} actorId={actorId} />}</td>
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

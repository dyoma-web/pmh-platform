import Link from "next/link";
import { q } from "../../../lib/db";
import { cop, n0, fecha } from "../../../lib/fmt";
import Historia from "../../historia";
import SelectorActor from "./selector-actor";
import AccionesPago from "./acciones-pago";

export const dynamic = "force-dynamic";

// F3 · Primera pantalla de CAPTURA: la cola de doble firma sobre el núcleo
// transaccional. Escribe de verdad: firmas, devoluciones y el evento del ledger.

export default async function Firmas({ searchParams }) {
  const sp = await searchParams;
  const actorId = sp?.actor || "";

  const usuarios = await q(`
    select id, full_name, app_role, ih_role,
           (app_role = 'admin' or ih_role = 'Administrative Project Manager') puede_validar
    from core.app_user where active and email is not null order by full_name`);

  const cola = await q(`
    select cp.id, cp.due_date, cp.amount, cp.authorized_at, cp.invoice_url,
           cp.legal_support_url, cp.returned_reason, cp.contract_code,
           au.full_name as autorizado_por,
           p.code as project_code, ct.display_name as contratista,
           (current_date - cp.due_date) as dias
    from procurement.contract_payment cp
    join procurement.contract c on c.code = cp.contract_code
    join core.project p on p.id = c.project_id
    join procurement.contractor ct on ct.id = c.contractor_id
    left join core.app_user au on au.id = cp.authorized_by
    where cp.adm_validated_at is null
    order by cp.due_date limit 60`);

  const porAutorizar = cola.filter((c) => !c.authorized_at);
  const porValidar = cola.filter((c) => c.authorized_at);
  const bloqueados = porValidar.filter((c) => !c.invoice_url || !c.legal_support_url).length;

  const actor = usuarios.find((u) => String(u.id) === String(actorId));

  const Fila = ({ p, modo }) => (
    <div className={"tarea " + (p.dias > 0 ? "critico" : "pendiente")}>
      <div className="dias">
        <div className="n">{p.dias > 0 ? p.dias : "·"}</div>
        <div className="u">{p.dias > 0 ? "DÍAS VENC." : "EN FECHA"}</div>
      </div>
      <div className="cuerpo">
        <div className="t">{cop(p.amount)} · {p.contratista}</div>
        <div className="code">
          {p.contract_code} · <Link href={`/proyectos/${encodeURIComponent(p.project_code)}`}>{p.project_code}</Link>
          {" "}· vence {fecha(p.due_date)}
        </div>
        <div className="d">
          {modo === "validar"
            ? `Autorizado por ${p.autorizado_por ?? "firma migrada"} el ${fecha(p.authorized_at)}`
            : p.returned_reason
              ? `Devuelto: ${p.returned_reason}`
              : "Esperando primera firma"}
        </div>
      </div>
      <AccionesPago pago={p} actorId={actorId} modo={modo} />
    </div>
  );

  return (
    <>
      <Historia
        num="05"
        seccion="Contratación · Firmas"
        titulo={
          actor
            ? actor.puede_validar
              ? `${n0(porValidar.length)} pagos esperan tu segunda firma`
              : `${n0(porAutorizar.length)} pagos esperan primera firma`
            : "Elige quién firma para empezar"
        }
        lede={
          actor
            ? `Firmando como ${actor.full_name}. Las reglas las impone la base: quien autoriza no valida, y sin cuenta de cobro y soporte legal el botón de pagar no existe — existe la acción que desbloquea. Cada firma queda en el event log y cada pago validado escribe su evento en el ledger.`
            : `Esta es la primera pantalla de captura del sistema nuevo: escribe de verdad sobre el núcleo transaccional. Mientras llega el ingreso con Google (OIDC), la firma se elige aquí y la app completa vive tras autenticación.`
        }
        lado={<span className="notaf">{n0(bloqueados)} BLOQUEADOS POR DOCUMENTOS</span>}
      />
      <div className="contenido">
        <section className="plancha">
          <SelectorActor usuarios={usuarios} />
        </section>

        <div className="g2">
          <section className="plancha">
            <h2>Por autorizar · 1.ª firma <span className="mid">GESTORA · {n0(porAutorizar.length)}</span></h2>
            {porAutorizar.length === 0 ? (
              <div className="vacio"><div className="t">No hay pagos esperando primera firma.</div></div>
            ) : porAutorizar.slice(0, 12).map((p) => <Fila key={p.id} p={p} modo="autorizar" />)}
            {porAutorizar.length > 12 && (
              <p className="notaf" style={{ marginTop: 10 }}>+ {n0(porAutorizar.length - 12)} más, por fecha</p>
            )}
          </section>

          <section className="plancha">
            <h2>Por validar · 2.ª firma <span className="mid">ADMINISTRACIÓN · {n0(porValidar.length)}</span></h2>
            {porValidar.length === 0 ? (
              <div className="vacio"><div className="t">No hay pagos esperando segunda firma.</div></div>
            ) : porValidar.slice(0, 12).map((p) => <Fila key={p.id} p={p} modo="validar" />)}
          </section>
        </div>

        <section className="plancha">
          <h2>Cómo funciona esta cola <span className="mid">REGLAS DEL MOTOR, NO DE LA INTERFAZ</span></h2>
          <div className="instr">
            <div className="fila"><span className="lab">Quien autoriza no puede validar el mismo pago (CHECK <span className="mono">firmas_distintas</span>)</span><span className="sev correcto">separación de funciones</span></div>
            <div className="fila"><span className="lab">No existe pago validado sin cuenta de cobro y soporte de seguridad social</span><span className="sev correcto">regla M8</span></div>
            <div className="fila"><span className="lab">Validar escribe el evento en <span className="mono">ledger.money_event</span> y la firma en <span className="mono">audit.event_log</span></span><span className="sev correcto">trazabilidad</span></div>
            <div className="fila"><span className="lab">La segunda firma exige rol de administración</span><span className="sev correcto">permiso por operación</span></div>
          </div>
        </section>
      </div>
    </>
  );
}

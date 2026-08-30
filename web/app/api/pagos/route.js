import { NextResponse } from "next/server";
import { pool } from "../../../lib/db";

// F3 · API de doble firma de pagos a terceros.
// Reglas del motor + reglas de operación (checklist §5 y §8):
//  - autorizar (1.ª firma): cualquier usuaria activa
//  - validar (2.ª firma): solo administración, distinta de quien autorizó,
//    y solo con cuenta de cobro + soporte legal presentes
//  - devolver: retira la 1.ª firma con motivo obligatorio
// Actor: pre-OIDC se identifica por actor_id (la app está tras Basic Auth);
// con OIDC (bloqueado por credenciales de Google) el actor saldrá de la sesión.

const err = (status, mensaje) => NextResponse.json({ error: mensaje }, { status });

export async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b?.accion || !b?.pago_id || !b?.actor_id) {
    return err(400, "Faltan datos: accion, pago_id y actor_id son obligatorios.");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: [actor] } = await client.query(
      "select id, full_name, app_role, ih_role, active from core.app_user where id = $1",
      [b.actor_id]);
    if (!actor?.active) {
      await client.query("rollback");
      return err(403, "El actor no existe o está inactivo.");
    }
    const { rows: [p] } = await client.query(
      `select cp.*, c.project_id, c.contractor_id, c.code as contrato
       from procurement.contract_payment cp
       join procurement.contract c on c.code = cp.contract_code
       where cp.id = $1 for update`, [b.pago_id]);
    if (!p) {
      await client.query("rollback");
      return err(404, "El pago no existe.");
    }
    if (p.adm_validated_at) {
      await client.query("rollback");
      return err(409, "Este pago ya fue validado y pagado; los eventos no se editan, se ajustan con uno nuevo.");
    }

    const audit = (action, after) => client.query(
      `insert into audit.event_log (actor, entity, entity_id, action, after)
       values ($1, 'contract_payment', $2, $3, $4)`,
      [actor.full_name, String(p.id), action, JSON.stringify(after)]);

    if (b.accion === "autorizar") {
      if (p.authorized_at) {
        await client.query("rollback");
        return err(409, `Ya autorizado por otra firma el ${p.authorized_at.toISOString().slice(0, 10)}.`);
      }
      await client.query(
        `update procurement.contract_payment
         set authorized_at = current_date, authorized_by = $1, dates_approx = false,
             returned_reason = null, updated_at = now(), updated_by = $1
         where id = $2`, [actor.id, p.id]);
      await audit("pago.autorizar", { contrato: p.contrato, monto: p.amount });
    } else if (b.accion === "validar") {
      const esAdmin = actor.app_role === "admin" || actor.ih_role === "Administrative Project Manager";
      if (!esAdmin) {
        await client.query("rollback");
        return err(403, "La segunda firma es de administración. Tu firma es la de autorización.");
      }
      if (!p.authorized_at) {
        await client.query("rollback");
        return err(422, "Falta la primera firma: la gestora debe autorizar antes de validar.");
      }
      if (p.authorized_by && p.authorized_by === actor.id) {
        await client.query("rollback");
        return err(403, "Separación de funciones: quien autoriza no puede validar el mismo pago.");
      }
      const invoice = b.invoice_url || p.invoice_url;
      const legal = b.legal_url || p.legal_support_url;
      if (!invoice || !legal) {
        await client.query("rollback");
        return err(422, "No se puede pagar sin cuenta de cobro y soporte de seguridad social. " +
          "Adjunta los enlaces que faltan o solicítalos al contratista.");
      }
      await client.query(
        `update procurement.contract_payment
         set adm_validated_at = current_date, validated_by = $1, dates_approx = false,
             invoice_url = $2, legal_support_url = $3, legacy_exception = false,
             submitted_at = coalesce(submitted_at, current_date),
             updated_at = now(), updated_by = $1
         where id = $4`, [actor.id, invoice, legal, p.id]);
      await client.query(
        `insert into ledger.money_event
           (direction, kind, project_id, event_date, amount, currency, fx_rate,
            contractor_id, contract_payment_id, source_table, document_url, note)
         values ('out','contractor_payment',$1,current_date,$2,'COP',1,$3,$4,
                 'api/pagos',$5,$6)`,
        [p.project_id, p.amount, p.contractor_id, p.id, invoice,
         `Validado por ${actor.full_name}`]);
      await audit("pago.validar", { contrato: p.contrato, monto: p.amount, soporte: legal });
    } else if (b.accion === "devolver") {
      if (!b.motivo?.trim()) {
        await client.query("rollback");
        return err(422, "Devolver exige un motivo: el contratista y la gestora deben saber qué corregir.");
      }
      await client.query(
        `update procurement.contract_payment
         set authorized_at = null, authorized_by = null, returned_reason = $1,
             updated_at = now(), updated_by = $2
         where id = $3`, [b.motivo.trim(), actor.id, p.id]);
      await audit("pago.devolver", { contrato: p.contrato, motivo: b.motivo.trim() });
    } else {
      await client.query("rollback");
      return err(400, `Acción desconocida: ${b.accion}`);
    }

    await client.query("commit");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    return err(500, "La base de datos rechazó la operación: " + e.message);
  } finally {
    client.release();
  }
}

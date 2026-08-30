import { q } from "../../../../lib/db";
import Historia from "../../../historia";
import FormularioSolicitud from "./formulario";

export const dynamic = "force-dynamic";

export default async function Nueva({ searchParams }) {
  const sp = await searchParams;
  const usuarios = await q(`
    select id, full_name from core.app_user where active and email is not null order by full_name`);
  const proyectos = await q(`
    select code, display_code, status from core.project
    where kind in ('project','phase') and status in ('active','paused','draft')
    order by code`);
  const contratistas = await q(`
    select id, display_name, profile, id_type from procurement.contractor order by display_name`);

  return (
    <>
      <Historia
        num="05"
        seccion="Contratación · Nueva solicitud"
        titulo="Pide el contratista con el detalle que firma el contrato"
        lede="Los servicios que describas aquí son los entregables del contrato, y el plan de pagos debe sumar exactamente lo mismo que los servicios — el sistema no deja crear una solicitud descuadrada. Al procesarse, el contrato nace amarrado a esta solicitud por llave."
      />
      <div className="contenido">
        <FormularioSolicitud
          usuarios={usuarios}
          proyectos={proyectos}
          contratistas={contratistas}
          actorInicial={sp?.actor || ""}
        />
      </div>
    </>
  );
}

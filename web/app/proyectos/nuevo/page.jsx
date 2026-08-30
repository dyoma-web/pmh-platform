import { q } from "../../../lib/db";
import { trmHoy } from "../../../lib/trm";
import Historia from "../../historia";
import Wizard from "./wizard";

export const dynamic = "force-dynamic";

export default async function Nuevo() {
  const [usuarios, clientes, paises, lineas, orgs, frameworks, items, params, prefijos] =
    await Promise.all([
      q(`select id, full_name, (app_role='admin' or ih_role='Administrative Project Manager') admin
         from core.app_user where active and email is not null order by full_name`),
      q("select id, name from core.client order by name"),
      q("select name from core.country order by name"),
      q("select code from core.service_line order by code"),
      q("select name from core.org_entity order by name"),
      q("select code, concept from core.framework_contract order by code"),
      q(`select code, name, unit, ref_cost from catalog.ihpsc_item
         where state='activo' and os_applicable order by code`),
      q(`select clave, valor from ref.parametro where clave like 'costeo_%'`),
      q(`select distinct split_part(code,'_',1) p from core.project
         where kind='project' order by 1`),
    ]);
  const trm = await trmHoy();
  const defaults = Object.fromEntries(
    params.map((p) => [p.clave.replace("costeo_", ""), Number(p.valor)]));

  return (
    <>
      <Historia
        num="02"
        seccion="Proyectos · Alta"
        titulo="Sin presupuesto no hay proyecto activo"
        lede="Cinco pasos con validación bloqueante: el costeo se calcula (no se digita), el presupuesto por ítem debe cubrir el 100 % de la implementación y los hitos deben sumar el valor del contrato. Queda en borrador; administración aprueba el presupuesto y activa. Es la regla que evita repetir el «2 de 144»."
      />
      <div className="contenido">
        <Wizard usuarios={usuarios} clientes={clientes} paises={paises} lineas={lineas}
          orgs={orgs} frameworks={frameworks} items={items} trm={trm} defaults={defaults}
          prefijos={prefijos.map((x) => x.p)} />
      </div>
    </>
  );
}

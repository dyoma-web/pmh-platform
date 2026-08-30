import Link from "next/link";
import { q } from "../../lib/db";
import { cop, mcop, n0 } from "../../lib/fmt";
import Historia from "../historia";
import { MESES, MES3, DIAS, hoyLocal, addDays, lunes, inicioMes, finMes, addMeses, esFinde,
  gridMes, diasHabiles, fechaCorta, fechaLarga, diaSemana } from "../../lib/cal";

export const dynamic = "force-dynamic";

// Agenda: el calendario de compromisos. Al calendario solo va lo que alguien
// debe hacer (pendiente / vencido); lo cumplido aparece en gris como memoria del
// día. Misma vista de eventos que las líneas de vida (metrics.v2_eventos).

const FAM = { acto: "Actos", dinero: "Dinero", entrega: "Entregas", novedad: "Novedades" };
const SIMB = { acto: ["◇", "◆"], dinero: ["▽", "▼"], entrega: ["○", "●"], novedad: ["◈", "◈"] };
const VISTAS = [["dia", "Día"], ["semana", "Semana"], ["mes", "Mes"], ["anio", "Año"]];

const simb = (e) => SIMB[e.familia]?.[e.estado === "cumplido" ? 1 : 0] ?? "·";
const corto = (s, n = 44) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default async function Agenda({ searchParams }) {
  const sp = await searchParams;
  const vista = VISTAS.some(([v]) => v === sp?.vista) ? sp.vista : "semana";
  const hoy = hoyLocal();
  const f = /^\d{4}-\d{2}-\d{2}$/.test(sp?.fecha || "") ? sp.fecha : hoy;
  const fl = {
    familia: sp?.familia || "", proyecto: sp?.proyecto || "", contratista: sp?.contratista || "",
    gestora: sp?.gestora || "", pais: sp?.pais || "", cliente: sp?.cliente || "",
  };

  let ini, fin;
  if (vista === "dia") { ini = f; fin = f; }
  else if (vista === "semana") { ini = lunes(f); fin = addDays(ini, 6); }
  else if (vista === "mes") { ini = inicioMes(f); fin = finMes(f); }
  else { ini = f.slice(0, 4) + "-01-01"; fin = f.slice(0, 4) + "-12-31"; }

  const [eventos, opciones] = await Promise.all([
    q(`select ambito, familia, tipo, contract_code, project_code, display_code, contractor_id,
              contratista, gestora, cliente, pais, titulo, accion, estado, dueno, ref, monto_cop, orden,
              to_char(fecha_plan,'YYYY-MM-DD') fp, to_char(fecha_real,'YYYY-MM-DD') fr,
              case when estado in ('pendiente','vencido') then to_char(fecha_plan,'YYYY-MM-DD')
                   else to_char(fecha_real,'YYYY-MM-DD') end dia
         from metrics.v2_eventos
        where tipo <> 'vigencia'
          and ((estado = 'pendiente' and fecha_plan between $1 and $2)
               or (estado = 'cumplido' and fecha_real between $1 and $2)
               or estado = 'vencido')
          and ($3 = '' or familia = $3) and ($4 = '' or project_code = $4)
          and ($5 = '' or contractor_id::text = $5) and ($6 = '' or gestora = $6)
          and ($7 = '' or pais = $7) and ($8 = '' or cliente = $8)
        order by dia, orden, monto_cop desc nulls last`,
      [ini, fin, fl.familia, fl.proyecto, fl.contratista, fl.gestora, fl.pais, fl.cliente]),
    q(`select
         (select json_agg(x order by x.display_code) from (select distinct project_code code, display_code from metrics.v2_agenda) x) proyectos,
         (select json_agg(x order by x.contratista) from (select distinct contractor_id id, contratista from metrics.v2_agenda where contractor_id is not null) x) contratistas,
         (select json_agg(distinct gestora order by gestora) from metrics.v2_agenda where gestora is not null) gestoras,
         (select json_agg(distinct pais order by pais) from metrics.v2_agenda where pais is not null) paises,
         (select json_agg(distinct cliente order by cliente) from metrics.v2_agenda where cliente is not null) clientes`),
  ]);
  const op = opciones[0] || {};

  const enRango = (e) => e.dia >= ini && e.dia <= fin;
  const vencidos = eventos.filter((e) => e.estado === "vencido");
  const arrastrados = vencidos.filter((e) => e.dia < ini);
  const compromisos = eventos.filter((e) => e.estado !== "cumplido" && enRango(e));
  const cumplidos = eventos.filter((e) => e.estado === "cumplido" && enRango(e));
  const dinero = compromisos.filter((e) => e.familia === "dinero").reduce((s, e) => s + Number(e.monto_cop || 0), 0);
  const porDia = {};
  for (const e of eventos) if (enRango(e)) (porDia[e.dia] ??= []).push(e);

  // Enlaces que conservan filtros
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    const all = { vista, fecha: f, ...fl, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/agenda?${p.toString()}`;
  };
  const paso = vista === "dia" ? (n) => addDays(f, n) : vista === "semana" ? (n) => addDays(f, 7 * n)
    : vista === "mes" ? (n) => addMeses(f, n) : (n) => `${+f.slice(0, 4) + n}-01-01`;

  // Tesis
  const periodo = vista === "dia" ? (f === hoy ? "Hoy" : `El ${diaSemana(f)} ${fechaCorta(f)}`)
    : vista === "semana" ? (ini === lunes(hoy) ? "Esta semana" : `La semana del ${fechaCorta(ini)}`)
    : vista === "mes" ? `${MESES[+f.slice(5, 7) - 1][0].toUpperCase()}${MESES[+f.slice(5, 7) - 1].slice(1)} ${f.slice(0, 4)}`
    : f.slice(0, 4);
  const nC = compromisos.length;
  const titulo = nC === 0
    ? `${periodo}: nada programado${arrastrados.length ? `, pero ${n0(arrastrados.length)} vencidos esperan` : ""}`
    : `${periodo}: ${n0(nC)} ${nC === 1 ? "compromiso" : "compromisos"}${dinero ? ` que mueven ${mcop(dinero)} M` : ""}`;
  const lede = [
    vencidos.length ? `${n0(vencidos.length)} ya están vencidos (${mcop(vencidos.reduce((s, e) => s + Number(e.monto_cop || 0), 0))} M) y se arrastran hasta que alguien los cierre.` : "Nada vencido: el sistema está al día.",
    "Pagos, cobros y facturas avisan tres días hábiles antes; firmas, entregas y cierres, el día.",
    cumplidos.length ? `En gris, ${n0(cumplidos.length)} cosas que ya ocurrieron en el periodo.` : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <Historia num="01" seccion="Agenda" titulo={titulo} lede={lede}
        lado={<span className="notaf">SOLO COMPROMISOS · LO OCURRIDO VIVE EN LA LÍNEA DE VIDA</span>} />

      <div className="contenido">
        <section className="plancha" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="cal-tool">
            <div className="vercomo">
              {VISTAS.map(([v, l]) => (
                <Link key={v} href={qs({ vista: v })} className={vista === v ? "on" : ""}>{l}</Link>
              ))}
            </div>
            <div className="vercomo cal-nav">
              <Link href={qs({ fecha: paso(-1) })} aria-label="Anterior">‹</Link>
              <Link href={qs({ fecha: hoy })} className={f === hoy ? "on" : ""}>Hoy</Link>
              <Link href={qs({ fecha: paso(1) })} aria-label="Siguiente">›</Link>
              <span className="notaf" style={{ marginLeft: 6 }}>
                {vista === "dia" ? fechaLarga(f) : vista === "anio" ? f.slice(0, 4) : `${fechaCorta(ini)} → ${fechaCorta(fin)} ${fin.slice(0, 4)}`}
              </span>
            </div>
            <div className="vercomo" style={{ marginLeft: "auto" }}>
              <Link href={qs({ familia: "" })} className={!fl.familia ? "on" : ""}>Todo</Link>
              {Object.entries(FAM).map(([k, l]) => (
                <Link key={k} href={qs({ familia: k })} className={fl.familia === k ? "on" : ""}>{SIMB[k][0]} {l}</Link>
              ))}
            </div>
          </div>
          <form method="get" action="/agenda" className="cal-tool" style={{ gap: 8 }}>
            <input type="hidden" name="vista" value={vista} />
            <input type="hidden" name="fecha" value={f} />
            {fl.familia && <input type="hidden" name="familia" value={fl.familia} />}
            <select className="mini" name="proyecto" defaultValue={fl.proyecto}>
              <option value="">— Proyecto —</option>
              {(op.proyectos || []).map((p) => <option key={p.code} value={p.code}>{p.display_code}</option>)}
            </select>
            <select className="mini" name="contratista" defaultValue={fl.contratista}>
              <option value="">— Contratista —</option>
              {(op.contratistas || []).map((c) => <option key={c.id} value={c.id}>{c.contratista}</option>)}
            </select>
            <select className="mini" name="gestora" defaultValue={fl.gestora} style={{ width: 160 }}>
              <option value="">— Gestora —</option>
              {(op.gestoras || []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="mini" name="pais" defaultValue={fl.pais} style={{ width: 130 }}>
              <option value="">— País —</option>
              {(op.paises || []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="mini" name="cliente" defaultValue={fl.cliente} style={{ width: 150 }}>
              <option value="">— Cliente —</option>
              {(op.clientes || []).map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button className="btn sec" style={{ padding: "6px 14px", fontSize: 12 }}>Filtrar</button>
            {(fl.proyecto || fl.contratista || fl.gestora || fl.pais || fl.cliente) && (
              <Link href={qs({ proyecto: "", contratista: "", gestora: "", pais: "", cliente: "" })} className="notaf">LIMPIAR</Link>
            )}
          </form>
        </section>

        {vista === "dia" && <Dia f={f} hoy={hoy} eventos={eventos} vencidos={vencidos} qs={qs} />}
        {vista === "semana" && <Semana ini={ini} hoy={hoy} porDia={porDia} arrastrados={arrastrados} qs={qs} />}
        {vista === "mes" && <Mes f={f} hoy={hoy} porDia={porDia} arrastrados={arrastrados} qs={qs} />}
        {vista === "anio" && <Anio f={f} hoy={hoy} porDia={porDia} qs={qs} />}
      </div>
    </>
  );
}

function Item({ e, largo }) {
  const t = e.accion && e.estado !== "cumplido" ? `${e.accion}: ${e.titulo}` : e.titulo;
  return (
    <Link href={e.ref || "#"} className={"cal-it " + e.estado} title={`${t} · ${e.dueno}${e.monto_cop ? " · " + cop(e.monto_cop) : ""}`}>
      {simb(e)} {largo ? t : corto(t)}
      {e.monto_cop != null && Number(e.monto_cop) > 0 && <span className="m">{mcop(e.monto_cop)} M</span>}
    </Link>
  );
}

function Celda({ d, hoy, items = [], arrastrados = [], otro, max = 4, qs, largo }) {
  const esHoy = d === hoy;
  const vis = items.slice(0, max);
  return (
    <div className={"cal-cel" + (esHoy ? " hoy" : "") + (otro ? " otro" : "") + (esFinde(d) ? " finde" : "")}>
      <div className="d">
        <Link href={qs({ vista: "dia", fecha: d })} style={{ color: "inherit" }}>{+d.slice(8, 10)}{d.slice(8, 10) === "01" ? " " + MES3[+d.slice(5, 7) - 1] : ""}</Link>
        {items.length > 0 && <span>{items.length}</span>}
      </div>
      {esHoy && arrastrados.length > 0 && (
        <Link href={qs({ vista: "dia", fecha: d })} className="cal-it vencido" style={{ fontWeight: 600 }}>
          ▲ {n0(arrastrados.length)} vencidos arrastrados
        </Link>
      )}
      {vis.map((e, i) => <Item key={i} e={e} largo={largo} />)}
      {items.length > max && (
        <Link href={qs({ vista: "dia", fecha: d })} className="cal-mas">+ {items.length - max} MÁS</Link>
      )}
    </div>
  );
}

function Semana({ ini, hoy, porDia, arrastrados, qs }) {
  const dias = Array.from({ length: 7 }, (_, i) => addDays(ini, i));
  return (
    <section className="plancha" style={{ padding: 16 }}>
      <div className="cal-grid cal-semana">
        {dias.map((d, i) => <div className="cal-head" key={d}>{DIAS[i]} {fechaCorta(d)}</div>)}
        {dias.map((d) => (
          <Celda key={d} d={d} hoy={hoy} items={porDia[d] || []} arrastrados={arrastrados} max={40} qs={qs} largo />
        ))}
      </div>
    </section>
  );
}

function Mes({ f, hoy, porDia, arrastrados, qs }) {
  const semanas = gridMes(f);
  const mes = f.slice(0, 7);
  return (
    <section className="plancha" style={{ padding: 16 }}>
      <div className="cal-grid">
        {DIAS.map((d) => <div className="cal-head" key={d}>{d}</div>)}
        {semanas.flat().map((d) => (
          <Celda key={d} d={d} hoy={hoy} items={porDia[d] || []} arrastrados={arrastrados}
            otro={d.slice(0, 7) !== mes} qs={qs} />
        ))}
      </div>
    </section>
  );
}

function Anio({ f, hoy, porDia, qs }) {
  const y = f.slice(0, 4);
  return (
    <section className="plancha">
      <h2>Doce meses <span className="mid">INTENSIDAD = COMPROMISOS POR DÍA · ROJO = VENCIDO</span></h2>
      <div className="cal-anio">
        {Array.from({ length: 12 }, (_, m) => {
          const ms = `${y}-${String(m + 1).padStart(2, "0")}-01`;
          const semanas = gridMes(ms);
          const dias = semanas.flat().filter((d) => d.slice(0, 7) === ms.slice(0, 7));
          const items = dias.flatMap((d) => porDia[d] || []);
          const pend = items.filter((e) => e.estado !== "cumplido");
          const din = pend.filter((e) => e.familia === "dinero").reduce((s, e) => s + Number(e.monto_cop || 0), 0);
          const nVenc = pend.filter((e) => e.estado === "vencido").length;
          const offset = (new Date(Date.UTC(+y, m, 1)).getUTCDay() + 6) % 7;
          return (
            <Link key={m} href={qs({ vista: "mes", fecha: ms })} className="cal-mini">
              <div className="t"><span>{MESES[m]}</span><span>{pend.length ? n0(pend.length) : "·"}</span></div>
              <div className="g">
                {Array.from({ length: offset }, (_, i) => <span className="c vacio" key={"v" + i} />)}
                {dias.map((d) => {
                  const it = (porDia[d] || []).filter((e) => e.estado !== "cumplido");
                  const h = it.length === 0 ? "" : it.length === 1 ? " h1" : it.length <= 3 ? " h2" : it.length <= 6 ? " h3" : " h4";
                  return <span key={d} className={"c" + h + (it.some((e) => e.estado === "vencido") ? " v" : "") + (d === hoy ? " hoy" : "")}
                    title={`${fechaCorta(d)}: ${it.length}`} />;
                })}
              </div>
              <div className="s">
                <span>{din ? `${mcop(din)} M` : "—"}</span>
                <span className={nVenc ? "sev critico" : "sev pendiente"}>{nVenc ? `${nVenc} vencidos` : "al día"}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Tarea({ e, hoy }) {
  const dias = e.estado === "vencido" ? Math.round((Date.parse(hoy) - Date.parse(e.dia)) / 86400000) : null;
  return (
    <div className={"tarea " + (e.estado === "vencido" ? "critico" : e.estado === "cumplido" ? "" : "pendiente")}>
      <div className="dias">
        <div className="n">{dias != null ? dias : simb(e)}</div>
        <div className="u">{dias != null ? "DÍAS VENC." : FAM[e.familia]?.toUpperCase()}</div>
      </div>
      <div className="cuerpo">
        <div className="t">{e.estado === "cumplido" ? e.titulo : `${e.accion ?? "Atender"}: ${e.titulo}`}</div>
        <div className="code">
          {e.project_code && <Link href={`/proyectos/${encodeURIComponent(e.project_code)}`}>{e.display_code}</Link>}
          {e.contratista ? ` · ${e.contratista}` : ""}{e.monto_cop ? ` · ${cop(e.monto_cop)}` : ""}
          {e.estado === "cumplido" ? ` · ocurrió ${fechaCorta(e.dia)}` : e.fp && e.dia !== e.fp ? ` · previsto ${fechaCorta(e.fp)}` : ""}
        </div>
        <div className="d">Responsable: {e.dueno}{e.gestora && e.dueno !== e.gestora ? ` · gestora ${e.gestora}` : ""}</div>
      </div>
      <div className="lado" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <span className={"sev " + (e.estado === "vencido" ? "critico" : e.estado === "cumplido" ? "correcto" : "pendiente")}>{e.estado.replace("_", " ")}</span>
        {e.estado !== "cumplido" && e.ref && <Link className="accionbtn" href={e.ref}>{e.accion ?? "Ver"}</Link>}
      </div>
    </div>
  );
}

function Dia({ f, hoy, eventos, vencidos, qs }) {
  const delDia = eventos.filter((e) => e.dia === f && e.estado !== "cumplido");
  const hechos = eventos.filter((e) => e.dia === f && e.estado === "cumplido");
  const arrastrados = vencidos.filter((e) => e.dia < f).sort((a, b) => Number(b.monto_cop || 0) - Number(a.monto_cop || 0));
  const proximos = eventos.filter((e) => e.estado === "pendiente" && e.familia === "dinero" && e.dia > f)
    .map((e) => ({ ...e, dh: diasHabiles(f, e.dia) })).filter((e) => e.dh >= 1 && e.dh <= 3);
  const vacio = !delDia.length && !arrastrados.length && !proximos.length && !hechos.length;
  return (
    <>
      {vacio && (
        <section className="plancha"><div className="vacio">
          <div className="t">Nada que hacer el {fechaLarga(f)}.</div>
          <div className="d">Ni compromisos, ni vencidos arrastrados, ni dinero en los próximos tres días hábiles.</div>
        </div></section>
      )}
      {delDia.length > 0 && (
        <section className="plancha">
          <h2>{f === hoy ? "Hoy" : diaSemana(f) + " " + fechaCorta(f)} <span className="mid">{n0(delDia.length)} COMPROMISOS</span></h2>
          {delDia.map((e, i) => <Tarea key={i} e={e} hoy={hoy} />)}
        </section>
      )}
      {arrastrados.length > 0 && (
        <section className="plancha">
          <h2>Vencido y arrastrado <span className="mid">{n0(arrastrados.length)} · {cop(arrastrados.reduce((s, e) => s + Number(e.monto_cop || 0), 0))}</span></h2>
          {arrastrados.slice(0, 25).map((e, i) => <Tarea key={i} e={e} hoy={hoy} />)}
          {arrastrados.length > 25 && <p className="notaf" style={{ marginTop: 10 }}>Y {n0(arrastrados.length - 25)} MÁS — FILTRA POR GESTORA O PROYECTO PARA VERLOS TODOS</p>}
        </section>
      )}
      {proximos.length > 0 && (
        <section className="plancha">
          <h2>Dinero en los próximos tres días hábiles <span className="mid">ANTICIPACIÓN</span></h2>
          <div className="instr">
            {proximos.map((e, i) => (
              <div className="fila" key={i}>
                <span className="lab"><Link href={e.ref || "#"}>{e.titulo}</Link>
                  <span className="mono" style={{ marginLeft: 8 }}>{e.display_code}</span></span>
                <span className="mono">{diaSemana(e.dia)} {fechaCorta(e.dia)} · {e.dh} d.h.</span>
                <span className="val">{cop(e.monto_cop)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {hechos.length > 0 && (
        <section className="plancha">
          <h2>Ocurrió ese día <span className="mid">{n0(hechos.length)} · MEMORIA</span></h2>
          <div className="instr">
            {hechos.map((e, i) => (
              <div className="fila" key={i}>
                <span className="lab">{simb(e)} {e.titulo}<span className="mono" style={{ marginLeft: 8 }}>{e.display_code}</span></span>
                <span className="mono">{e.dueno}</span>
                <span className="val">{e.monto_cop ? cop(e.monto_cop) : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="notaf">
        <Link href={qs({ vista: "semana" })}>VER LA SEMANA</Link> · <Link href={qs({ vista: "mes" })}>VER EL MES</Link>
      </p>
    </>
  );
}

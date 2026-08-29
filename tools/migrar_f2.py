# -*- coding: utf-8 -*-
"""
F2 · ETL staging → núcleo transaccional, aplicando las decisiones de F0.

Idempotente por reconstrucción: limpia las tablas transaccionales (solo dev;
la fuente sigue siendo staging + hojas) y las repuebla. Al final imprime la
reconciliación contra staging y la escribe en data-quality/f2_reconciliacion.md.
"""
import os
import re
import sys
import unicodedata
from datetime import date

import pandas as pd
import psycopg2
import psycopg2.extras as ex

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env

MONEDAS = {"USD", "COP", "EUR", "CLP"}


def canon(code):
    s = str(code).strip().lower().replace(" ", "_").replace("-", "_")
    while "__" in s:
        s = s.replace("__", "_")
    return s


def strip_acc(s):
    s = unicodedata.normalize("NFD", str(s))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def d(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return v.date() if hasattr(v, "date") else v


def main():
    load_env()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor(cursor_factory=ex.RealDictCursor)
    rep = []

    def log(msg):
        print(msg)
        rep.append(msg)

    # ── 0 · reset (dev) ─────────────────────────────────────────────────────
    cur.execute("""
        TRUNCATE ledger.reconciliation, ledger.money_event, ledger.gl_account, ledger.period,
                 budget.release, budget.line, budget.version,
                 procurement.addendum, procurement.contract_payment, procurement.contract,
                 procurement.request_payment, procurement.request_service, procurement.hiring_request,
                 pii.contractor_contact, procurement.contractor,
                 infra.allocation_rule, infra.item, infra.subscription,
                 catalog.crosswalk, catalog.ihpsc_item, catalog.profile,
                 revenue.milestone,
                 core.project_costing, core.project_amount, core.project_alias, core.project,
                 core.framework_contract, core.app_user, core.client, core.org_entity,
                 core.service_line, core.country, core.document
        RESTART IDENTITY CASCADE""")

    def rows(sql, args=None):
        cur.execute(sql, args or [])
        return cur.fetchall()

    # ── 1 · maestros ────────────────────────────────────────────────────────
    P = rows("select * from staging.projects")
    for name in sorted({p["country"] for p in P if p["country"]}):
        cur.execute("insert into core.country values (%s) on conflict do nothing", (name,))
    for sl in sorted({p["service_line"] for p in P if p["service_line"]}):
        cur.execute("insert into core.service_line values (%s) on conflict do nothing", (sl,))
    ORG = {"InnovaHub Colombia SAS": "vehiculo", "InnovaHub LLC": "vehiculo",
           "LTA Wilmer": "lta", "LTA Oscar": "lta", "LTA Amagoia": "lta", "Terceros": "tercero"}
    for o, k in ORG.items():
        cur.execute("insert into core.org_entity values (%s,%s) on conflict do nothing", (o, k))
    PAYOR = {"SAS": "InnovaHub Colombia SAS", "LLC": "InnovaHub LLC", "SAs": "InnovaHub Colombia SAS"}

    clients = {}
    for c in sorted({p["partner_entity"] for p in P if p["partner_entity"]}):
        cur.execute("insert into core.client (name) values (%s) returning id", (c,))
        clients[c] = cur.fetchone()["id"]

    users = {}
    for u in rows("select * from staging.pm_users"):
        cur.execute("""insert into core.app_user (full_name, email, ih_role, app_role, active)
                       values (%s,%s,%s,%s,%s) returning id""",
                    (u["user"], u["mail"], u["ih_role"],
                     "admin" if u["app_role"] == "Admin" else "user", u["status"] == "Active"))
        users[u["user"]] = cur.fetchone()["id"]
    # partner managers que no son usuarios de la app
    for p in P:
        pm = p["partner_manager"]
        if pm and pm not in users:
            cur.execute("""insert into core.app_user (full_name, ih_role, app_role, active)
                           values (%s,'Partner Manager','user',true) returning id""", (pm,))
            users[pm] = cur.fetchone()["id"]

    for fc in rows("select * from staging.corp_contracts"):
        cur.execute("insert into core.framework_contract values (%s,%s,%s) on conflict do nothing",
                    (fc["contract_id"], fc["concept"], fc["url"]))
    fc_codes = {r["contract_id"] for r in rows("select contract_id from staging.corp_contracts")}
    log(f"core: {len(clients)} clientes · {len(users)} usuarios · {len(fc_codes)} contratos marco")

    # ── 2 · proyectos + alias ───────────────────────────────────────────────
    STATUS = {"Active": "active", "Completed": "completed", "Paused": "paused", "Cancelled": "cancelled"}
    proj = {}   # cualquier código/alias → id

    def crear_proyecto(code, display, kind, status, **kw):
        cur.execute("""insert into core.project
            (code, display_code, kind, client_id, country, service_line, org_entity,
             pm_id, partner_manager_id, framework_contract_code, status,
             start_date, closing_date, identifier, contract_url, proposal_url, remarks)
            values (%(code)s,%(display)s,%(kind)s,%(client)s,%(country)s,%(sl)s,%(org)s,
                    %(pm)s,%(pmg)s,%(fc)s,%(status)s,%(sd)s,%(cd)s,%(ident)s,%(curl)s,%(purl)s,%(rem)s)
            returning id""",
            dict(code=code, display=display, kind=kind, status=status,
                 client=kw.get("client"), country=kw.get("country"), sl=kw.get("sl"),
                 org=kw.get("org"), pm=kw.get("pm"), pmg=kw.get("pmg"), fc=kw.get("fc"),
                 sd=kw.get("sd"), cd=kw.get("cd"), ident=kw.get("ident"),
                 curl=kw.get("curl"), purl=kw.get("purl"), rem=kw.get("rem")))
        pid = cur.fetchone()["id"]
        proj[code] = pid
        if display != code:
            cur.execute("insert into core.project_alias values (%s,%s,%s) on conflict do nothing",
                        (display, pid, "grafía original del maestro"))
            proj[display] = pid
        return pid

    for p in P:
        code = canon(p["project_code"])
        org = p["contract_category"] if p["contract_category"] in ORG else None
        fc = p["contract_id"] if p["contract_id"] in fc_codes else None
        crear_proyecto(code, p["project_code"], "project",
                       STATUS.get(p["status"], "draft"),
                       client=clients.get(p["partner_entity"]), country=p["country"],
                       sl=p["service_line"], org=org,
                       pm=users.get(p["project_manager"]), pmg=users.get(p["partner_manager"]),
                       fc=fc, sd=d(p["start_date"]), cd=d(p["closing_date"]),
                       ident=p["identifier"], curl=p["contract"], purl=p["budge_proposal"],
                       rem=p["remarks"])

    # los alias se procesan al final: su destino puede ser un histórico creado aquí mismo
    alias_rows = sorted(rows("select * from ref.alias_projectcode"),
                        key=lambda a: a["accion"] == "alias")
    for a in alias_rows:
        origen, accion, target = a["codigo_origen"], a["accion"], a["codigo_canonico"]
        if accion == "alias":
            tid = proj.get(target) or proj.get(canon(target))
            if tid:
                cur.execute("insert into core.project_alias values (%s,%s,%s) on conflict do nothing",
                            (origen, tid, a["nota"]))
                proj[origen] = tid
        elif accion == "bolsa_contable":
            code = canon(target)
            pid = proj.get(code) or crear_proyecto(code, target, "pool", "active", rem=a["nota"])
            cur.execute("insert into core.project_alias values (%s,%s,%s) on conflict do nothing",
                        (origen, pid, a["nota"]))
            proj[origen] = pid
        else:  # crear_proyecto_fase | crear_proyecto_historico
            kind = "phase" if accion == "crear_proyecto_fase" else "historical"
            code = canon(target)
            pid = proj.get(code) or crear_proyecto(
                code, origen, kind, "active" if kind == "phase" else "completed", rem=a["nota"])
            proj[origen] = pid
            if origen != code:
                cur.execute("insert into core.project_alias values (%s,%s,%s) on conflict do nothing",
                            (origen, pid, "código original en contabilidad"))
    log(f"core.project: {len(rows('select 1 from core.project'))} "
        f"(144 maestro + fases/históricos/bolsas) · alias: {len(rows('select 1 from core.project_alias'))}")

    def rid(code):
        """Resuelve cualquier código a project_id (o None)."""
        if code is None:
            return None
        return proj.get(str(code)) or proj.get(canon(code))

    # ── 3 · montos y costeo (decisiones F0: CostingAmount manda) ────────────
    for p in P:
        pid = rid(p["project_code"])
        amt = float(p["contract_amount"] or 0)
        cost = float(p["costing_amount"] or 0)
        curcy = p["currency"] if p["currency"] in MONEDAS else "COP"
        if curcy == "COP":
            fx, kind = 1, "pactada"
            amt = amt or cost
        elif amt > 0 and cost > 0:
            fx, kind = cost / amt, "derivada"
        else:
            fx, kind = float(p["exchange_rate"] or 0) or 1, "pactada"
        cur.execute("""insert into core.project_amount
            (project_id, version, amount, currency, fx_rate, fx_kind, valid_from, reason)
            values (%s,1,%s,%s,%s,%s,%s,'migración F2 · F0: CostingAmount manda')""",
                    (pid, amt, curcy, round(fx, 6), kind, d(p["start_date"])))
        cur.execute("""insert into core.project_costing values
            (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (pid, p["p_margin"], p["p_ay_f"], p["p_unforeseen"], p["p_ica"],
                     p["p_commission"], p["base_team"], p["implementation_budget"],
                     p["implementation_reserve"], p["management_budget"],
                     p["internal_cost"], p["external_cost"]))

    # ── 4 · hitos de ingreso (fechas F0) ────────────────────────────────────
    SM = {"Scheduled": "scheduled", "Invoiced": "invoiced", "Credited": "credited", "Paid": "credited"}
    DC = {"EXTERNO": "externo", "INTERNO": "interno", "MIXTO": "mixto"}
    n_apx = 0
    for i in rows("select * from staging.income"):
        st = SM[i["status"]]
        exp, inv, cred = d(i["expected_date"]), d(i["invoice_date"]), d(i["credited_date"])
        apx = False
        if st == "credited" and (cred is None or cred < date(2022, 1, 1)):
            cred, apx = inv or exp, True
        if st in ("invoiced", "credited") and inv is None:
            inv, apx = cred or exp, True
        n_apx += apx
        dfree = str(i["delay_factors"] or "")
        dcat = next((v for k, v in DC.items() if dfree.upper().startswith(k)), "otro" if dfree else None)
        cur.execute("""insert into revenue.milestone
            (legacy_id, project_id, amount_cop, original_amount, contract_date, expected_date,
             state, invoice_date, invoice_url, credited_date, credited_date_approx,
             deliverables, remarks, delay_category, delay_note)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (i["id"], rid(i["project_code"]), i["expected_cop"], i["currency"],
                     d(i["contract_date"]), exp, st, inv, i["invoice"], cred, apx,
                     i["deliverables"], i["remarks"], dcat, dfree or None))
    log(f"revenue.milestone: {len(rows('select 1 from revenue.milestone'))} · fechas aproximadas (F0): {n_apx}")

    # ── 5 · contratistas (sin PII de contacto; nombres a pii) ───────────────
    ctr = {}
    for c in rows("select * from staging.contractors where contractor_id <> 0"):
        idn = str(int(c["contractor_id"]))
        nombre = c["company_name"] or " ".join(
            x for x in [c["contractor_first_name"], c["contractor_family_name1"]] if x) or idn
        cur.execute("""insert into procurement.contractor
            (id_number, id_type, display_name, profile, company_name)
            values (%s,%s,%s,%s,%s) returning id""",
                    (idn, c["contractor_idtype"], nombre.title(), c["profile"], c["company_name"]))
        cid = cur.fetchone()["id"]
        ctr[idn] = cid
        legal = " ".join(x for x in [c["contractor_first_name"], c["contractor_second_name"],
                                     c["contractor_family_name1"], c["contractor_family_name2"]] if x)
        cur.execute("insert into pii.contractor_contact (contractor_id, legal_name) values (%s,%s)",
                    (cid, legal or nombre))
    log(f"procurement.contractor: {len(ctr)} (excluido el registro de prueba)")

    # ── 6 · solicitudes 2026 ────────────────────────────────────────────────
    RS = {"Processed": "processed", "Requested": "requested", "Cancelled": "cancelled"}
    for r in rows("select * from staging.hiring_requests"):
        cur.execute("""insert into procurement.hiring_request
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (r["request_id"], rid(r["project_code"]),
                     ctr[str(int(float(r["contractor_id"])))],
                     users.get(r["project_maganer"]), r["ihcapacity"] in (True, "True"),
                     PAYOR.get(r["payor"]), r["category"], RS[r["status"]],
                     d(r["date_start"]), r["annotations"]))
    for s in rows("select * from staging.request_services"):
        cur.execute("insert into procurement.request_service values (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (s["service_id"], s["request_id"], s["service_description"],
                     s["service_unity"], s["service_quantity"], s["price_unitary"],
                     s["price_total"], s["service_deliverable"], d(s["service_date"])))
    for pr in rows("select * from staging.request_payments"):
        cur.execute("insert into procurement.request_payment values (%s,%s,%s,%s,%s)",
                    (pr["payment_id"], pr["request_id"], d(pr["date"]),
                     pr["payment_method"], pr["amount"]))

    # ── 7 · contratos y pagos (decisiones F0 + regla dura M8) ───────────────
    KP = rows("""select contract_code, sum(payment_amount) s from staging.contract_payments
                 group by 1""")
    sumas = {k["contract_code"]: float(k["s"]) for k in KP}
    n_otrosi = 0
    for c in rows("select * from staging.contracts"):
        ann = str(c["contract_annotations"] or "")
        amt = float(c["contract_amount"] or 0)
        nota = None
        if "OTROS" in ann.upper() and abs(sumas.get(c["contract_code"], amt) - amt) > 1:
            nota = f"F0: otrosí — monto := Σ pagos (contractual original {amt:,.0f})"
            amt = sumas[c["contract_code"]]
            n_otrosi += 1
        state = ("annulled" if "ANULADO" in ann.upper()
                 else "finished" if d(c["contract_end"]) and d(c["contract_end"]) < date.today()
                 else "active")
        cur.execute("""insert into procurement.contract
            (code, project_id, contractor_id, overseer_id, account_category, org_entity,
             internal_cost, amount, currency, start_date, end_date, state, annotations,
             folder_url, amount_note)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (c["contract_code"], rid(c["project_code"]),
                     ctr[str(int(float(c["contractor_id"])))], users.get(c["contract_overseer"]),
                     c["contract_account"], PAYOR.get(c["company"]),
                     c["internal_cost"] in (True, "True"), amt,
                     c["contract_currency"] if c["contract_currency"] in MONEDAS else "COP",
                     d(c["contract_start"]), d(c["contract_end"]), state, ann or None,
                     c["contract_link"], nota))
    n_exc = 0
    for cp in rows("select * from staging.contract_payments"):
        validado = cp["adm_validation"] == "Paid"
        exc = validado and cp["contractor_legal"] is None
        n_exc += exc
        cur.execute("""insert into procurement.contract_payment
            (legacy_id, contract_code, due_date, amount, authorized_at, adm_validated_at,
             dates_approx, invoice_url, legal_support_url, legacy_exception, annotations)
            values (%s,%s,%s,%s,%s,%s,true,%s,%s,%s,%s)""",
                    (cp["id"], cp["contract_code"], d(cp["payment_date"]), cp["payment_amount"],
                     d(cp["payment_date"]) if cp["payment_status"] == "Authorized" else None,
                     d(cp["payment_date"]) if validado else None,
                     cp["contractor_invoice"], cp["contractor_legal"], exc, cp["annotations"]))
    log(f"procurement: {len(sumas)+3} contratos · montos corregidos por otrosí (F0): {n_otrosi} "
        f"· pagos con excepción legada sin soporte: {n_exc}")

    # ── 8 · presupuesto ─────────────────────────────────────────────────────
    IMPL = {"Internal": "internal", "Exterrnal": "external", "External": "external"}
    vers = {}
    for b in rows("select * from staging.budget_lines"):
        pid = rid(b["project_code"])
        if pid not in vers:
            cur.execute("""insert into budget.version (project_id, version, state)
                           values (%s,1,'approved') returning id""", (pid,))
            vers[pid] = cur.fetchone()["id"]
        cur.execute("""insert into budget.line
            (legacy_id, version_id, legacy_code, description, unit, qty, unit_price,
             total, deploying, implementation, comments)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (b["id"], vers[pid], b["code_unique"], b["details"], b["unity"],
                     b["quantity"], b["unitary_price"], b["total_price"],
                     b["deploying"], IMPL.get(b["implementation"]), b["comments"]))

    # ── 9 · cuentas y catálogo IHPSC v3.1 ───────────────────────────────────
    refmap = {r["cuenta"]: r["categoria"] for r in rows("select * from ref.cuenta_categoria")}
    falmap = {}
    for a in rows("select * from staging.accounts where account is not null"):
        try:
            falmap[str(int(float(a["account"])))] = a["new_account"]
        except (TypeError, ValueError):
            pass
    for g in rows("select distinct account, account_name from staging.costs"):
        code = str(int(g["account"]))
        cur.execute("insert into ledger.gl_account values (%s,%s,%s) on conflict do nothing",
                    (code, g["account_name"], refmap.get(code) or falmap.get(code) or "Other"))

    src = os.environ.get("GAP_DATA_SRC")
    perf = pd.read_excel(os.path.join(src, "GAP_IHPSC_V3_1.xlsx"), "07_Perfiles").dropna(how="all")
    for _, r in perf.iterrows():
        cur.execute("insert into catalog.profile (name, provision) values (%s,%s) on conflict do nothing",
                    (r["Perfil responsable"], r["Tipo de provisión"]))
    mae = pd.read_excel(os.path.join(src, "GAP_IHPSC_V3_1.xlsx"), "08_Maestro").dropna(how="all")
    for _, r in mae.iterrows():
        prof = r["Perfil responsable"] if pd.notna(r["Perfil responsable"]) else None
        if prof:
            cur.execute("insert into catalog.profile (name) values (%s) on conflict do nothing", (prof,))
        cur.execute("""insert into catalog.ihpsc_item
            (ihp_id, code, name, description, unit, cost_driver, profile, modality,
             os_applicable, ref_cost, ref_currency, ref_source, state)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'activo')
            on conflict (ihp_id) do nothing""",
                    (r["ID"], r["Código IHPSC"], r["Denominación específica"],
                     r["Descripción detallada (alcance estándar)"], r["Unidad de medida"],
                     r["Driver de costo"], prof, r["Modalidad"],
                     r["OS aplicable"] == "Sí",
                     float(r["Costo ref. (COP)"]) if pd.notna(r["Costo ref. (COP)"]) else None,
                     "COP" if pd.notna(r["Costo ref. (COP)"]) else None,
                     r["Nota / origen del dato"] if pd.notna(r["Nota / origen del dato"]) else None))
    for cw in rows("select * from staging.codes_v1"):
        cur.execute("""insert into catalog.crosswalk (legacy_code, legacy_system, note)
                       values (%s,'v1','mapeo a v3.1 pendiente (taller)') on conflict do nothing""",
                    (cw["code"],))
    log(f"catalog: {len(rows('select 1 from catalog.ihpsc_item'))} ítems IHPSC v3.1 · "
        f"{len(rows('select 1 from catalog.profile'))} perfiles · crosswalk v1: 22")

    # ── 10 · infraestructura ────────────────────────────────────────────────
    for it in rows("select * from staging.infra_items"):
        cur.execute("insert into infra.item values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (str(it["id"]), rid(it["project_code"]), it["concept"], it["provider"],
                     it["link"], str(it["status"]).lower(), d(it["start_date"]), d(it["end_date"]),
                     it["monthly_budget"], it["currency"] if it["currency"] in MONEDAS else None,
                     it["payor"]))
    for sb in rows("select * from staging.subs_budget"):
        cur.execute("insert into infra.subscription values (%s,%s,%s,%s,%s,%s,%s,%s) on conflict do nothing",
                    (sb["code"], sb["provider"], sb["service"], sb["details"],
                     d(sb["start_date"]), d(sb["end_date"]), sb["full_budget"],
                     sb["currency"] if sb["currency"] in MONEDAS else None))

    # ── 11 · LEDGER: el libro único ─────────────────────────────────────────
    def moneda_pago(details, cost):
        if details in MONEDAS:
            return details
        c = float(cost or 0)
        return "USD" if c < 1000 else "COP" if c >= 10000 else "USD"

    ev = 0
    for g in rows("select * from staging.costs"):
        cur.execute("""insert into ledger.money_event
            (direction, kind, project_id, event_date, amount, currency, fx_rate,
             gl_account, source_table, source_id, note)
            values ('out','gl_accrual',%s,%s,%s,'COP',1,%s,'GAP_DATA_04_COSTS',%s,%s)""",
                    (rid(g["project_code"]) or proj.get("operaciones"),
                     d(g["trimming"]), g["amount"],
                     str(int(g["account"])), None, g["contractor"]))
        ev += 1
    for m in rows("select id, project_id, credited_date, amount_cop from revenue.milestone where state='credited'"):
        cur.execute("""insert into ledger.money_event
            (direction, kind, project_id, event_date, amount, currency, fx_rate,
             milestone_id, source_table)
            values ('in','revenue_credit',%s,%s,%s,'COP',1,%s,'revenue.milestone')""",
                    (m["project_id"], m["credited_date"], m["amount_cop"], m["id"]))
        ev += 1
    for cp in rows("""select cp.id, cp.adm_validated_at, cp.amount, c.project_id, c.contractor_id
                      from procurement.contract_payment cp
                      join procurement.contract c on c.code = cp.contract_code
                      where cp.adm_validated_at is not null"""):
        cur.execute("""insert into ledger.money_event
            (direction, kind, project_id, event_date, amount, currency, fx_rate,
             contractor_id, contract_payment_id, source_table)
            values ('out','contractor_payment',%s,%s,%s,'COP',1,%s,%s,'procurement.contract_payment')""",
                    (cp["project_id"], cp["adm_validated_at"], cp["amount"],
                     cp["contractor_id"], cp["id"]))
        ev += 1
    sin_fx = 0
    for pgo in rows("select * from staging.infra_payments"):
        mon = moneda_pago(pgo["details"], pgo["cost"])
        fx = 1 if mon == "COP" else None
        sin_fx += fx is None
        cur.execute("""insert into ledger.money_event
            (direction, kind, project_id, event_date, amount, currency, fx_rate,
             source_table, source_id, document_url, note)
            values ('out','infra_payment',%s,%s,%s,%s,%s,'GAP_DATA_05_PAYMENTS',%s,%s,%s)""",
                    (rid(pgo["project_code"]), d(pgo["date"]), pgo["cost"], mon, fx,
                     pgo["id"], pgo["invoice"], pgo["comment"]))
        ev += 1
    for pgo in rows("select * from staging.subs_payments"):
        mon = moneda_pago(pgo["details"], pgo["cost"])
        fx = 1 if mon == "COP" else None
        sin_fx += fx is None
        cur.execute("""insert into ledger.money_event
            (direction, kind, event_date, amount, currency, fx_rate,
             source_table, source_id, document_url, note)
            values ('out','subs_payment',%s,%s,%s,%s,'inf_data_costs',%s,%s,%s)""",
                    (d(pgo["date"]), pgo["cost"], mon, fx, pgo["id"], pgo["invoice"], pgo["comment"]))
        ev += 1
    log(f"ledger.money_event: {ev} eventos · sin TRM (moneda extranjera histórica): {sin_fx}")

    cur.execute("""insert into audit.event_log (actor, entity, entity_id, action, after)
                   values ('tools/migrar_f2.py','sistema','F2','migracion_staging_a_transaccional',
                           jsonb_build_object('eventos', %s))""", (ev,))

    # ── 12 · reconciliación ─────────────────────────────────────────────────
    log("")
    log("## Reconciliación transaccional vs staging")
    checks = [
        ("Proyectos (maestro)", "select count(*) v from core.project where kind='project'",
         "select count(*) v from staging.projects"),
        ("Hitos Σ COP", "select sum(amount_cop) v from revenue.milestone",
         "select sum(expected_cop) v from staging.income"),
        ("Acreditado Σ COP", "select sum(amount_cop) v from revenue.milestone where state='credited'",
         "select sum(expected_cop) v from staging.income where status in ('Credited','Paid')"),
        ("Costos Σ COP (ledger gl)", "select sum(amount) v from ledger.money_event where kind='gl_accrual'",
         "select sum(amount) v from staging.costs"),
        ("Contratos n", "select count(*) v from procurement.contract",
         "select count(*) v from staging.contracts"),
        ("Pagos contrato n", "select count(*) v from procurement.contract_payment",
         "select count(*) v from staging.contract_payments"),
        ("Pagos validados Σ", "select sum(amount) v from procurement.contract_payment where adm_validated_at is not null",
         "select sum(payment_amount) v from staging.contract_payments where adm_validation='Paid'"),
        ("Solicitudes n", "select count(*) v from procurement.hiring_request",
         "select count(*) v from staging.hiring_requests"),
    ]
    todo_ok = True
    for nombre, q1, q2 in checks:
        v1 = float(rows(q1)[0]["v"] or 0)
        v2 = float(rows(q2)[0]["v"] or 0)
        ok = abs(v1 - v2) < 1
        todo_ok &= ok
        log(f"- {nombre}: {v1:,.0f} vs {v2:,.0f} → {'OK' if ok else 'DIFIERE'}")
    huer = rows("""select count(*) v from staging.costs c
                   where c.project_code is not null and not exists
                     (select 1 from core.project p where p.code = lower(replace(c.project_code,' ','_')))
                     and not exists (select 1 from core.project_alias a where a.alias = c.project_code)""")
    log(f"- Códigos de costos sin resolver: {huer[0]['v']} → {'OK' if huer[0]['v']==0 else 'REVISAR'}")

    conn.commit()
    with open("data-quality/f2_reconciliacion.md", "w", encoding="utf-8") as f:
        f.write("# F2 · Reconciliación de la migración transaccional\n\n")
        f.write(f"Ejecutada: {date.today()} · `tools/migrar_f2.py`\n\n")
        f.write("\n".join(rep) + "\n")
    print("\nOK" if todo_ok else "\nREVISAR DIFERENCIAS", "— informe en data-quality/f2_reconciliacion.md")


if __name__ == "__main__":
    main()

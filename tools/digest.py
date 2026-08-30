# -*- coding: utf-8 -*-
"""
F1 · Digest diario de Cota — el correo de las 7:00 con la misma voz narrativa
de la plataforma: tesis, evidencia y verbo. Máximo un correo al día por persona.

Genera texto y HTML desde las vistas metrics.v0_*. Envío:
  - imprime en consola y guarda out/digest_YYYYMMDD.html
  - si existen SMTP_HOST/SMTP_USER/SMTP_PASS/DIGEST_TO en .env, envía por SMTP.

Uso: python tools/digest.py [--quien "Nombre"]   (filtra como el «ver como» de Mi día)
"""
import argparse
import os
import smtplib
import sys
from datetime import date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(__file__))
from migrate import load_env

MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
PAL = ["Cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve", "Diez"]


def cop(v):
    return "—" if v is None else "$ " + f"{round(float(v)):,}".replace(",", ".")


def mcop(v):
    return "—" if v is None else f"{round(float(v) / 1e6):,}".replace(",", ".")


def f(d):
    return f"{d.day} {MES[d.month - 1]}" if d else "—"


def responsable(dueno):
    import re
    m = re.search(r"(?::|\+)\s*(.+)$", str(dueno))
    return (m.group(1) if m else str(dueno)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quien", default=None)
    args = ap.parse_args()
    load_env()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("select * from metrics.v2_kpis")
    k = cur.fetchone()
    cur.execute("""select * from metrics.v2_semaforos
        where regla in ('hito_vencido','pago_contratista_vencido')
        order by monto_cop desc nulls last""")
    cola = [t for t in cur.fetchall()
            if not args.quien or responsable(t["dueno"]) == args.quien][:6]
    cur.execute("select * from metrics.v2_proximos_7d")
    prox = cur.fetchall()[:6]
    cur.execute("select * from metrics.v2_semaforos_dueno limit 5")
    duenos = cur.fetchall()

    n = len(cola)
    total = sum(float(t["monto_cop"] or 0) for t in cola)
    quien = f", {args.quien.split()[0]}" if args.quien else ""
    if n == 0:
        tesis = f"Todo al día{quien}: no hay cobros ni pagos vencidos a tu nombre."
    else:
        tesis = (f"{PAL[min(n, 10)]} {'cosa manda' if n == 1 else 'cosas mandan'} el día de hoy{quien}: "
                 f"concentran {mcop(total)} M COP.")

    hoy = date.today()
    asunto = f"Cota · {hoy.day} {MES[hoy.month - 1]} — " + (
        tesis.split(":")[0] if n else "todo al día")

    # ── texto plano ──────────────────────────────────────────────────────────
    lineas = [tesis, ""]
    for t in cola:
        verbo = "Registrar gestión de cobro" if t["regla"] == "hito_vencido" else "Validar pago"
        lineas.append(f"  {t['dias'] or '—':>3} d · {cop(t['monto_cop'])} · {t['project_code']}")
        lineas.append(f"        {t['detalle']} → {verbo} (resp. {responsable(t['dueno'])})")
    if prox:
        lineas += ["", "Vence en los próximos 7 días:"]
        for p in prox:
            lineas.append(f"  {f(p['fecha'])} · {cop(p['monto_cop'])} · {p['contraparte']} · {p['project_code']}")
    lineas += ["", f"Contexto: cartera vencida {mcop(k['cartera_vencida_cop'])} M de "
               f"{mcop(k['cartera_pendiente_cop'])} M · {k['pagos_terceros_pend_n']} pagos a terceros "
               f"pendientes · {k['pagos_sin_soporte_n']} sin soporte legal.",
               "", "Cota · InnovaHub — generado automáticamente. Un correo al día, nada más."]
    texto = "\n".join(lineas)

    # ── HTML (estilos en línea, sobrio, imprimible) ──────────────────────────
    filas = "".join(
        f"""<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #d8e0f1;border-left:3px solid #c62828;
                   font:600 20px Archivo,Helvetica,sans-serif;color:#c62828;text-align:center">{t['dias'] or '—'}<br>
            <span style="font:500 8px 'IBM Plex Mono',monospace;color:#5b6884">DÍAS</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #d8e0f1;font:14px Archivo,Helvetica,sans-serif;color:#101b3d">
            {t['detalle']}<br>
            <span style="font:11px 'IBM Plex Mono',monospace;color:#5b6884">{t['project_code']} · resp. {responsable(t['dueno'])}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #d8e0f1;font:600 14px Archivo,Helvetica,sans-serif;
                   color:#101b3d;text-align:right;white-space:nowrap">{cop(t['monto_cop'])}</td></tr>"""
        for t in cola)
    fprox = "".join(
        f"""<tr><td style="padding:6px 12px;font:13px Archivo,Helvetica,sans-serif;color:#3d4a6b">{p['contraparte']}
            <span style="font:11px 'IBM Plex Mono',monospace;color:#5b6884"> {p['project_code']}</span></td>
            <td style="padding:6px 12px;font:12px 'IBM Plex Mono',monospace;color:#5b6884;text-align:right">{f(p['fecha'])}</td>
            <td style="padding:6px 12px;font:600 13px Archivo,Helvetica,sans-serif;color:#101b3d;text-align:right">{cop(p['monto_cop'])}</td></tr>"""
        for p in prox)
    html = f"""<div style="background:#edf1f9;padding:24px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 32px">
    <div style="font:600 15px Archivo,Helvetica,sans-serif;letter-spacing:.13em;color:#101b3d">COTA</div>
    <div style="height:2px;width:64px;margin:6px 0 4px;background:linear-gradient(96deg,#7a3be8,#4f45e4 26%,#2c7be5 52%,#35c1e8 74%,#ff8a5b)"></div>
    <div style="font:10px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:#5b6884">
      DIGEST · {hoy.day} {MES[hoy.month-1].upper()} {hoy.year} · 07:00</div>
    <h1 style="font:700 24px Archivo,Helvetica,sans-serif;color:#101b3d;margin:18px 0 6px;letter-spacing:-.02em">{tesis}</h1>
    <table style="width:100%;border-collapse:collapse;margin-top:14px">{filas}</table>
    {"<div style='font:500 10px IBM Plex Mono,monospace;letter-spacing:.1em;color:#5b6884;margin:22px 0 6px'>VENCE EN LOS PRÓXIMOS 7 DÍAS</div><table style='width:100%;border-collapse:collapse'>" + fprox + "</table>" if prox else ""}
    <p style="font:12px Archivo,Helvetica,sans-serif;color:#3d4a6b;margin:20px 0 0">
      Contexto: cartera vencida {mcop(k['cartera_vencida_cop'])} M de {mcop(k['cartera_pendiente_cop'])} M ·
      {k['pagos_terceros_pend_n']} pagos a terceros pendientes · {k['pagos_sin_soporte_n']} sin soporte legal.</p>
    <p style="font:10px 'IBM Plex Mono',monospace;color:#5b6884;margin:16px 0 0;letter-spacing:.06em">
      INNOVAHUB · GENERADO AUTOMÁTICAMENTE · UN CORREO AL DÍA, NADA MÁS</p>
  </div></div>"""

    os.makedirs("out", exist_ok=True)
    ruta = f"out/digest_{hoy.strftime('%Y%m%d')}{'_' + args.quien.split()[0] if args.quien else ''}.html"
    open(ruta, "w", encoding="utf-8").write(html)
    print(asunto)
    print("=" * 60)
    print(texto)
    print("=" * 60)
    print("HTML:", ruta)

    host = os.environ.get("SMTP_HOST")
    if host and os.environ.get("DIGEST_TO"):
        msg = MIMEMultipart("alternative")
        msg["Subject"], msg["From"], msg["To"] = asunto, os.environ["SMTP_USER"], os.environ["DIGEST_TO"]
        msg.attach(MIMEText(texto, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", 587))) as s:
            s.starttls()
            s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
            s.send_message(msg)
        print("Enviado a", os.environ["DIGEST_TO"])
    else:
        print("(SMTP no configurado: no se envió — ver .env.example)")


if __name__ == "__main__":
    main()

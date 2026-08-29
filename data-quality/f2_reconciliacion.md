# F2 · Reconciliación de la migración transaccional

Ejecutada: 2026-08-29 · `tools/migrar_f2.py`

core: 21 clientes · 14 usuarios · 37 contratos marco
core.project: 179 (144 maestro + fases/históricos/bolsas) · alias: 16
revenue.milestone: 339 · fechas aproximadas (F0): 79
procurement.contractor: 72 (excluido el registro de prueba)
procurement: 221 contratos · montos corregidos por otrosí (F0): 4 · pagos con excepción legada sin soporte: 150
catalog: 308 ítems IHPSC v3.1 · 37 perfiles · crosswalk v1: 22
ledger.money_event: 5546 eventos · sin TRM (moneda extranjera histórica): 428

## Reconciliación transaccional vs staging
- Proyectos (maestro): 144 vs 144 → OK
- Hitos Σ COP: 6,619,987,381 vs 6,619,987,381 → OK
- Acreditado Σ COP: 5,282,559,919 vs 5,282,559,919 → OK
- Costos Σ COP (ledger gl): 2,523,325,222 vs 2,523,325,222 → OK
- Contratos n: 221 vs 221 → OK
- Pagos contrato n: 404 vs 404 → OK
- Pagos validados Σ: 548,237,092 vs 548,237,092 → OK
- Solicitudes n: 97 vs 97 → OK
- Códigos de costos sin resolver: 0 → OK

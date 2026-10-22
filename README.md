# Minka — tareas y agenda

Minka («trabajo en común» en quechua) lleva las tareas de un equipo (alta rápida en lenguaje natural, tablero, matriz
de Eisenhower, vínculos con lo que las origina) y su agenda (recurrencia, participantes, suscripción .ics), con lo que
se agenda solo y la programación del día. Es un módulo de [Tiqsi](https://github.com/achalmed/tiqsi): funciona solo,
con el anfitrión mínimo de Tiqsi, o dentro de una plataforma que lo monte por su manifiesto (como Qillqa).

**Recorrido interactivo:** <https://achalmed.github.io/minka/> (el código del sitio está en [`sitio/`](sitio/)).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -e '.[pruebas,sola]'   # requiere tiqsi
.venv/bin/python -m pytest -q tests
npm install && npm run web:construir && npm run web:pruebas
MINKA_DATABASE_URL=postgresql+asyncpg://…/minka JWT_SECRET=<32 o más caracteres> MINKA_WEB=web/dist \
  .venv/bin/uvicorn minka.sola:app --port 8032
```

Esta es una **versión de demostración**. Licencia: AGPL-3.0 (`LICENSE`).

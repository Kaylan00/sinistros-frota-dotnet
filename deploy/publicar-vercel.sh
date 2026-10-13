#!/usr/bin/env bash
# Publica o painel em modo demonstração (site estático) na Vercel.
# A Vercel não roda ASP.NET nem SQL Server: lá, /health responde {"status":"demo"}
# e o painel passa a usar a API simulada de wwwroot/js/demo.js.
# Uso (Git Bash no Windows ou Linux, com a Vercel CLI logada): deploy/publicar-vercel.sh
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
destino="$(mktemp -d)/sinistros-frota"
mkdir -p "$destino"
cp -r "$raiz/src/SinistrosFrota.Api/wwwroot/." "$destino/"
cp "$raiz/deploy/vercel/vercel.json" "$raiz/deploy/vercel/health.json" "$destino/"
cd "$destino"
# a pasta se chama sinistros-frota: é esse o nome do projeto criado na primeira publicação
npx --yes vercel@latest deploy --prod --yes

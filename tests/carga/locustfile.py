"""
Teste de carga da API de Frota e Sinistros com Locust.

Simula três perfis ao mesmo tempo, na proporção de uso real do painel:
- Painel (peso 6): a central atualizando a lista de motoboys e a fila de sinistros
- Relatorios (peso 2): alguém do backoffice abrindo os relatórios (API e tela Razor)
- Operacao (peso 1): um operador abrindo um sinistro e levando até o fim (stored procedures)

Critério de aprovação (o processo sai com código 1 se falhar, então quebra o CI):
- menos de 1% de requisições com erro
- p95 geral abaixo de LIMITE_P95_MS (padrão 300 ms)

Rodar (com a API no ar):
    locust -f tests/carga/locustfile.py --host http://localhost:5080 \
           --headless -u 50 -r 10 -t 2m --csv tests/carga/resultado --html tests/carga/relatorio.html
"""

import os
import random
from datetime import datetime, timedelta, timezone

from locust import HttpUser, between, events, task

LIMITE_P95_MS = int(os.getenv("LIMITE_P95_MS", "300"))
LIMITE_ERROS = float(os.getenv("LIMITE_ERROS", "0.01"))

# motoboys da seed com apólice vigente (o 8 está com a apólice vencida de propósito)
MOTORISTAS_COM_APOLICE = range(1, 8)
TIPOS = ["Acidente", "Roubo", "AvariaMoto", "AvariaBau"]


class Painel(HttpUser):
    weight = 6
    wait_time = between(1, 3)

    @task(3)
    def lista_de_motoboys(self):
        with self.client.get("/api/motoristas", catch_response=True) as r:
            if r.status_code != 200 or len(r.json()) == 0:
                r.failure(f"lista vazia ou status {r.status_code}")

    @task(2)
    def fila_em_aberto(self):
        self.client.get("/api/sinistros/em-aberto")

    @task(1)
    def detalhe_de_um_motoboy(self):
        self.client.get(f"/api/motoristas/{random.choice(MOTORISTAS_COM_APOLICE)}", name="/api/motoristas/[id]")


class Relatorios(HttpUser):
    weight = 2
    wait_time = between(2, 5)

    @task(2)
    def resumo_mensal_api(self):
        self.client.get(f"/api/relatorios/sinistros-por-mes?meses={random.choice([3, 6, 12])}",
                        name="/api/relatorios/sinistros-por-mes")

    @task(2)
    def tela_de_relatorios(self):
        with self.client.get("/relatorios", catch_response=True) as r:
            if "Sinistros por mês" not in r.text:
                r.failure("tela de relatórios sem o resumo")

    @task(1)
    def tela_filtrada_e_csv(self):
        tipo = random.choice(TIPOS)
        self.client.get(f"/relatorios?tipo={tipo}&meses=12", name="/relatorios?tipo=[tipo]")
        with self.client.get(f"/relatorios?handler=Csv&tipo={tipo}", name="/relatorios?handler=Csv",
                             catch_response=True) as r:
            if not r.text.lstrip("﻿").startswith("Sinistro;"):
                r.failure("CSV sem cabeçalho")


class Operacao(HttpUser):
    """Escrita: abre um sinistro, manda para análise e nega (fecha), para não acumular fila."""

    weight = 1
    wait_time = between(3, 6)

    @task
    def ciclo_de_um_sinistro(self):
        ocorrencia = datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))
        with self.client.post("/api/sinistros", name="/api/sinistros (abrir)", catch_response=True, json={
            "motoristaId": random.choice(MOTORISTAS_COM_APOLICE),
            "tipo": random.choice(TIPOS),
            "dataOcorrencia": ocorrencia.isoformat(),
            "descricao": "Gerado pelo teste de carga",
            "valorEstimado": random.randint(300, 5000),
        }) as r:
            if r.status_code != 201:
                r.failure(f"abrir devolveu {r.status_code}: {r.text[:120]}")
                return
            sinistro_id = r.json()["sinistro"]["id"]

        for novo in ("EmAnalise", "Negado"):
            self.client.post(f"/api/sinistros/{sinistro_id}/transicoes", json={"novoStatus": novo},
                             name="/api/sinistros/[id]/transicoes")


@events.quitting.add_listener
def criterio_de_aprovacao(environment, **_):
    total = environment.stats.total
    if total.num_requests == 0:
        print("REPROVADO: nenhuma requisição feita")
        environment.process_exit_code = 1
        return

    p95 = total.get_response_time_percentile(0.95)
    erros = total.fail_ratio
    print(f"Requisições: {total.num_requests} | erros: {erros:.2%} | "
          f"p50: {total.median_response_time:.0f} ms | p95: {p95:.0f} ms | "
          f"p99: {total.get_response_time_percentile(0.99):.0f} ms | req/s: {total.total_rps:.1f}")

    if erros > LIMITE_ERROS:
        print(f"REPROVADO: {erros:.2%} de erros (limite {LIMITE_ERROS:.0%})")
        environment.process_exit_code = 1
    elif p95 > LIMITE_P95_MS:
        print(f"REPROVADO: p95 de {p95:.0f} ms (limite {LIMITE_P95_MS} ms)")
        environment.process_exit_code = 1
    else:
        print("APROVADO")
        environment.process_exit_code = 0

# Teste de carga (Locust)

`locustfile.py` simula três perfis usando a API ao mesmo tempo, na proporção de um dia normal da central:

| Perfil | Peso | O que faz |
| --- | --- | --- |
| Painel | 6 | Atualiza a lista de motoboys, a fila em aberto e o detalhe de um motoboy |
| Relatorios | 2 | Resumo mensal pela API, tela `/relatorios` (Razor Pages + Dapper), filtro por tipo e CSV |
| Operacao | 1 | Abre um sinistro e leva até `Negado` passando pelas procedures (`sp_AbrirSinistro`, `sp_AlterarStatusSinistro`) |

As respostas são conferidas, não só o status HTTP: lista vazia, tela sem o resumo ou CSV sem cabeçalho contam como falha.

**Critério de aprovação:** menos de 1% de erro e p95 abaixo de 300 ms (`LIMITE_ERROS` e `LIMITE_P95_MS` mudam isso). Se reprovar, o Locust sai com código 1 e o workflow `Teste de carga` fica vermelho.

## Como rodar

```bash
# API no ar (docker compose up -d, ou dotnet run) e depois:
python3 -m venv .venv && .venv/bin/pip install locust==2.32.4
.venv/bin/locust -f tests/carga/locustfile.py --host http://localhost:5080 \
  --headless -u 50 -r 10 -t 2m --csv resultado --html relatorio.html
```

No GitHub Actions o workflow roda a cada push na `main` (50 usuários, 1 minuto) e aceita outros valores pelo botão *Run workflow*. O relatório HTML fica nos artefatos do job.

## Resultados (08/11/2026, WSL2, API publicada em Release + SQL Server 2022 em Docker, simulador da frota ligado)

| Cenário | Requisições | Erros | p50 | p95 | p99 | req/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 usuários, 2 min | 2.868 | 0% | 5 ms | 15 ms | 66 ms | 22 |
| 300 usuários, 2 min, **antes da correção** | 16.684 | 1 (0,01%) | 5 ms | 47 ms | 550 ms | 130 |
| 300 usuários, 3 min, **depois da correção** | 25.465 | 0% | 6 ms | 18 ms | 42 ms | 131 |

## O que o teste achou

Com 300 usuários apareceu um erro 500 na tela de relatórios. O log da API mostrou o SQL Server escolhendo a consulta como vítima de **deadlock** (erro 1205): a leitura da view `vw_SinistrosEmAberto` pedia lock compartilhado nas mesmas linhas que `sp_AbrirSinistro` e `sp_AlterarStatusSinistro` estavam alterando, em ordem diferente.

Correção: a base passou a usar `READ_COMMITTED_SNAPSHOT` (ligado pelo `BancoInicializador` na subida da API). A leitura lê a última versão confirmada da linha em vez de esperar o lock da escrita, e a escrita continua serializada pelos locks das procedures, então a regra de pagamento único não muda.

Para o erro não voltar, o teste de integração `Relatorio_nao_espera_lock_de_escrita_em_andamento` abre uma transação que altera um sinistro e, com ela ainda aberta, lê a fila pelo repositório com limite de 5 segundos. Sem o snapshot ele trava e falha (conferido desligando a opção); com o snapshot ele lê o valor confirmado na hora.

Rodando de novo o mesmo cenário de 300 usuários: 0 erros, e o p99 caiu de 550 ms para 42 ms, porque as leituras pararam de esperar as escritas.

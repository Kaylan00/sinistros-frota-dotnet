# Guia de estudo: Frota e Sinistros (para o Kaylan)

Este arquivo é para você estudar antes da entrevista de **Desenvolvedor SQL Júnior**. Não é para o recrutador. Leia com o código aberto, na ordem abaixo. A vaga é de SQL, então os capítulos 1 a 5 (banco) são os mais importantes.

## 0. O projeto em 5 linhas

- Uma rede de restaurantes tem motoboys próprios. A central vê, ao vivo, quem está disponível, em entrega, em pausa ou em ocorrência.
- Quando acontece algo com a moto (acidente, roubo, avaria), abre-se um **sinistro** que o seguro vai analisar e, se aprovar, pagar.
- O sinistro só anda assim: `Aberto → EmAnalise → Aprovado ou Negado`, e `Aprovado → Pago`. Negado e Pago são finais.
- Quem garante isso é o **SQL Server** (procedures com transação) e, antes dele, o **C#** (domínio testado com xUnit).
- A API em ASP.NET Core expõe tudo em REST e avisa a tela pelo **SignalR** quando algo muda.

Fluxo de um "aprovar sinistro":

```
tela (painel.js) -> POST /api/sinistros/12/transicoes
  -> SinistrosController -> SinistroService
     -> EF lê o sinistro e a apólice
     -> domínio C#: a transição é permitida? calcula franquia e indenização
     -> EXEC dbo.sp_AlterarStatusSinistro (transação, lock, valida de novo, grava histórico)
  -> SignalR avisa todas as telas abertas
  -> resposta 200 com o sinistro atualizado
(se der erro) -> TratadorDeErros -> ProblemDetails (404, 409 ou 422)
```

## 1. Modelagem (database/01_schema.sql)

Tabelas e o porquê de cada uma:

| Tabela | Guarda | Detalhe que vale citar |
| --- | --- | --- |
| `Motoristas` | o motoboy | `Cpf` com `UNIQUE` e `CHECK (Cpf NOT LIKE '%[^0-9]%')` (só dígitos) |
| `Veiculos` | a moto | FK para `Motoristas`, `Placa` `UNIQUE`, `CHECK` no ano |
| `Apolices` | o seguro da moto | `CHECK (FimVigencia >= InicioVigencia)`, cobertura e franquia |
| `Sinistros` | a ocorrência | `CHECK` de `Status` e `Tipo`; `CHECK`s de coerência entre colunas |
| `SinistroHistorico` | auditoria | uma linha por mudança de status: quem, quando, de onde para onde |
| `StatusMotorista` | log de status do motoboy | cada mudança é um `INSERT`; o atual é o mais recente |
| `TransicoesSinistro` | transições permitidas | a regra vira **dado**, não um monte de `IF` |

Conceitos:

- **PK (chave primária)**: identifica a linha. Aqui todas são `INT IDENTITY` (o banco gera 1, 2, 3...).
- **FK (chave estrangeira)**: garante que o `MotoristaId` do sinistro existe em `Motoristas`. Sem ela, daria para ter sinistro de motorista fantasma.
- **UNIQUE**: não deixa repetir (CPF, placa, número da apólice).
- **CHECK**: regra simples que o banco confere em todo INSERT/UPDATE. O mais interessante: `CK_Sinistros_PagoEm` diz que "se está Pago tem data de pagamento, se não está Pago não tem". Isso pega bug de qualquer sistema que escreva na tabela.
- **DEFAULT**: valor automático (`SYSUTCDATETIME()` para datas, `'Aberto'` para status).
- **Índice**: é como o índice de um livro. `IX_Sinistros_Status` acelera "me dá os sinistros em aberto". O `INCLUDE (...)` coloca colunas extras dentro do índice para a consulta nem precisar ir na tabela (índice de cobertura).
- **Idempotente**: o script pode rodar de novo sem quebrar (`IF OBJECT_ID(...) IS NULL CREATE TABLE`). A API roda os scripts toda vez que sobe.

Por que `DECIMAL(12,2)` para dinheiro e não `FLOAT`? Porque `FLOAT` é aproximado (0,1 + 0,2 não dá exatamente 0,3). Dinheiro precisa ser exato.

## 2. Views (database/02_views.sql)

View é um `SELECT` salvo com nome. Quem usa faz `SELECT * FROM vw_...` como se fosse uma tabela. Serve para esconder join complicado e dar uma "consulta oficial".

- `vw_MotoristasStatusAtual`: cada motoboy com a moto e o **último** status. Usa `OUTER APPLY (SELECT TOP 1 ... ORDER BY RegistradoEm DESC)`: para cada motorista, pega a linha mais recente do log. Com o índice `(MotoristaId, RegistradoEm DESC)` isso é uma busca direta (seek) por motorista.
  - Outro jeito de fazer (vale mostrar que você conhece): `ROW_NUMBER() OVER (PARTITION BY MotoristaId ORDER BY RegistradoEm DESC)` e filtrar `= 1`. Funciona, mas numera a tabela inteira. O script `ajuste_03` usa `ROW_NUMBER`.
  - `OUTER APPLY` é como um `LEFT JOIN` com uma subconsulta que "enxerga" a linha de fora. Motorista sem status ainda aparece (com `COALESCE(u.Status, 'Disponivel')`).
- `vw_SinistrosEmAberto`: a fila de trabalho. `JOIN` de quatro tabelas, filtro `Status IN ('Aberto','EmAnalise','Aprovado')` e `DATEDIFF(HOUR, AbertoEm, SYSUTCDATETIME())` para saber há quanto tempo está parado.
- `vw_ResumoSinistrosPorMes`: relatório com `GROUP BY` mês e tipo. O truque é `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` para contar só uma categoria dentro do grupo (quantos negados, quantos aprovados). `DATEFROMPARTS(ano, mês, 1)` transforma qualquer data no primeiro dia do mês, e aí dá para agrupar.

Diferença rápida: **WHERE** filtra linhas antes de agrupar; **HAVING** filtra grupos depois do `GROUP BY` (ex.: `HAVING COUNT(*) > 3`).

## 3. Procedures, transação e TRY/CATCH (database/03_procedures.sql)

Procedure é um bloco de T-SQL salvo no banco, com parâmetros. Vantagens: a regra fica num lugar só (qualquer sistema que chamar obedece), dá para controlar a transação e o plano de execução fica em cache.

O molde que as três seguem:

```sql
SET NOCOUNT ON;      -- não manda "1 row affected" de volta (menos tráfego)
SET XACT_ABORT ON;   -- qualquer erro derruba a transação inteira
BEGIN TRY
    -- validações que não precisam de transação (THROW se falhar)
    BEGIN TRAN;
        -- lê com lock, valida, UPDATE/INSERT, grava histórico
    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;   -- desfaz o que estava pela metade
    THROW;                          -- devolve o erro original para quem chamou
END CATCH
```

- **Transação**: "tudo ou nada". Abrir sinistro faz 3 INSERTs (sinistro, histórico, status do motoboy). Se o terceiro falhar, os dois primeiros são desfeitos. Isso é o **A** de **ACID** (atomicidade).
- **`@@TRANCOUNT`**: quantas transações estão abertas. Só faz `ROLLBACK` se houver alguma (senão dá outro erro).
- **`THROW 50003, 'mensagem', 1`**: lança erro de negócio. Números acima de 50000 são "nossos". A API olha o número e decide o HTTP (50003 = 409, 50002 = 422...).
- **`THROW` sozinho no CATCH**: relança o erro original, com número e mensagem. Melhor que `RAISERROR` para isso.
- **`SCOPE_IDENTITY()`**: o Id que acabou de ser gerado **neste** escopo. Melhor que `@@IDENTITY` (que pode pegar um Id gerado por trigger).
- **Parâmetro `OUTPUT`**: `sp_AbrirSinistro` devolve o Id criado em `@SinistroId OUTPUT`.

As três:

- `sp_AbrirSinistro`: valida valor, data no passado, motorista ativo, apólice existente, apólice da moto do próprio motorista e **vigência na data da ocorrência** (`CAST(@DataOcorrencia AS DATE) NOT BETWEEN @Inicio AND @Fim`). Depois grava sinistro + histórico + motoboy em "Ocorrencia".
- `sp_AlterarStatusSinistro`: lê o status atual `WITH (UPDLOCK, ROWLOCK)`, confere na tabela `TransicoesSinistro` se `De → Para` existe, exige valor indenizado positivo e até o teto da cobertura para aprovar, atualiza e grava histórico. Recusa `Pago` (pagamento tem procedure própria).
- `sp_PagarSinistro`: o mais crítico, porque é dinheiro.

## 4. Concorrência: por que não paga duas vezes

Cenário: o analista clica duas vezes em "Pagar", ou o sistema financeiro reenvia a chamada. Sem cuidado:

```
Chamada A: lê status = Aprovado     Chamada B: lê status = Aprovado
Chamada A: UPDATE para Pago         Chamada B: UPDATE para Pago   -> pagou duas vezes
```

O que a procedure faz:

1. `SELECT ... FROM dbo.Sinistros WITH (UPDLOCK, HOLDLOCK) WHERE Id = @SinistroId`
   - **UPDLOCK**: pega um lock de "vou atualizar". Duas chamadas não conseguem ter esse lock na mesma linha ao mesmo tempo: a segunda **espera**.
   - **HOLDLOCK**: segura o lock até o fim da transação (comportamento de `SERIALIZABLE` só para essa leitura).
   - Quando A faz `COMMIT`, B continua e lê `Pago`, então cai no `THROW 50004` ("já foi pago").
2. Cinto de segurança: `UPDATE ... WHERE Id = @SinistroId AND Status = 'Aprovado'` e conferir `@@ROWCOUNT = 1`. O `UPDATE` com condição já é atômico por si só.

O teste `Dez_pagamentos_simultaneos_do_mesmo_sinistro_so_um_passa` solta 10 requisições juntas e confere: 1 resposta 200, 9 respostas 409, e uma única linha "Pago" no histórico.

Palavras para saber explicar:

- **Lock compartilhado (S)**: leitura. Vários ao mesmo tempo.
- **Lock de atualização (U)**: "vou atualizar". Só um por vez; convive com S.
- **Lock exclusivo (X)**: escrita. Ninguém mais lê (no nível padrão) nem escreve.
- **Deadlock**: A espera B e B espera A. O SQL Server mata um dos dois (erro 1205). Pegar o `UPDLOCK` logo na leitura evita o deadlock clássico de "dois leram com S e os dois querem virar X".
- **Níveis de isolamento**: `READ UNCOMMITTED` (lê sujo, o famoso `NOLOCK`), `READ COMMITTED` (padrão), `REPEATABLE READ`, `SERIALIZABLE`, e `SNAPSHOT` (lê uma versão, não bloqueia). `NOLOCK` em relatório financeiro pode ler dado que vai sofrer rollback: evite.

## 5. Scripts de ajuste (database/ajustes/)

Isso é o dia a dia de sustentação: o cliente pede para corrigir um dado direto na base. O jeito seguro, que os três scripts seguem:

1. **Cabeçalho** com o chamado, o pedido e as travas.
2. **SELECT de conferência ANTES** (cola o resultado no chamado).
3. `BEGIN TRAN`.
4. `UPDATE` com **WHERE bem fechado**: não só o Id, mas também o valor errado e o status esperado. Se alguém já corrigiu, o WHERE não acha nada e nada muda.
5. `@@ROWCOUNT` guardado numa variável.
6. Linha no histórico dizendo que foi ajuste e qual chamado.
7. **SELECT DEPOIS**, ainda dentro da transação.
8. `COMMIT` se afetou exatamente o número esperado de linhas; senão `ROLLBACK`.

- `ajuste_01`: corrige valor digitado errado (7.500 em vez de 750). Rodar duas vezes não faz estrago: na segunda dá `ROLLBACK` (o teste confere isso).
- `ajuste_02`: reabre um sinistro negado. A procedure não deixa (Negado é final), e é de propósito: exceção autorizada vira script com registro.
- `ajuste_03`: expurgo do log de status com mais de 30 dias, **em lotes** (`DELETE TOP (5000)` dentro de um `WHILE`), sempre mantendo a linha mais recente de cada motorista (`ROW_NUMBER() ... > 1`). Lote pequeno = transação curta = não trava a tabela nem enche o log.

Regra de ouro para falar na entrevista: **nunca rodar UPDATE ou DELETE sem WHERE, sem transação e sem conferir antes e depois**.

## 6. A API em ASP.NET Core

- `Program.cs`: registra os serviços (injeção de dependência), configura JSON com enum em texto, ProblemDetails, Swagger, SignalR, arquivos estáticos, e roda o `BancoInicializador` (cria a base e aplica os scripts).
- `Controllers/`: só HTTP. Recebem o JSON, chamam o service, devolvem o resultado. `[ApiController]` faz a validação dos DTOs sozinho (400 automático se faltar campo ou o valor estiver fora do `[Range]`).
- `Services/SinistroService.cs`: o fluxo do sinistro (domínio primeiro, procedure depois, SignalR no fim).
- `Services/FrotaService.cs`: status dos motoboys e cadastro.
- `Erros/TratadorDeErros.cs`: um `IExceptionHandler` que transforma exceção em ProblemDetails. Exceção do domínio ou `SqlException` com número 50001-50099 viram 404/409/422; o resto é 500 (e só esse é logado como erro).
- `Contracts/Dtos.cs`: o formato de entrada e saída (records). Separado das entidades para não expor o banco direto.

**Injeção de dependência**: o controller pede `SinistroService` no construtor e o ASP.NET entrega pronto. `AddScoped` = um por requisição (o `DbContext` também é assim). `AddSingleton` = um só para a aplicação toda (o notificador do SignalR).

**Códigos HTTP usados**: 200 ok, 201 criado, 400 dados inválidos, 404 não existe, 409 conflito com o estado atual (transição inválida, já pago, CPF repetido), 422 dado bem formado mas a regra não aceita (apólice vencida, dano abaixo da franquia), 500 erro inesperado.

## 7. Entity Framework Core

- `Data/SinistrosDbContext.cs` mapeia as classes para as tabelas que **já existem** (não há migrations: quem manda no schema são os scripts SQL).
- Leitura: LINQ vira SQL. `AsNoTracking()` em toda consulta só de leitura (o EF não guarda cópia para detectar mudança, fica mais leve).
- Views: entidades sem chave (`HasNoKey().ToView("vw_...")`).
- Enums: gravados como texto (`HaveConversion<string>()`), iguais aos CHECKs.
- Cadastro de motorista: um `SaveChanges` com motorista + moto + status inicial = **uma transação**. O EF insere o pai primeiro e preenche o `MotoristaId` dos filhos.
- Procedures:
  - `ExecuteSqlAsync($"EXEC dbo.sp_AlterarStatusSinistro @SinistroId = {id}, ...")`: parece concatenação, mas não é. A string interpolada vira **parâmetros** (`@p0`, `@p1`). Isso impede SQL injection.
  - `ExecuteSqlRawAsync("EXEC ... @SinistroId OUTPUT", parametros)` com `SqlParameter` de `Direction = Output` para pegar o Id criado.
- **N+1**: erro clássico de ORM (busca 1 lista e depois faz 1 consulta por item). Aqui as listas usam `join` no LINQ, que vira um SQL só.

## 8. SignalR

- `Hubs/FrotaHub.cs`: o "canal" em `/hubs/frota`. A tela conecta uma vez e fica escutando.
- O servidor empurra dois eventos: `StatusMotoristaAlterado` e `SinistroAtualizado`. Quem dispara é o `NotificadorFrota` (usa `IHubContext<FrotaHub>`), chamado pelos services depois que o banco confirmou.
- Por baixo, o SignalR usa WebSocket e, se não der, cai para outras técnicas (Server-Sent Events, long polling). O teste de integração usa long polling porque roda em memória.
- `withAutomaticReconnect()` no JS: se a conexão cair, reconecta sozinho e a tela recarrega o estado.
- **Simulador** (`Simulation/SimuladorFrota.cs`): um `BackgroundService` que a cada 3 segundos muda o status de um motoboy, como se fosse o app dos entregadores. Liga com `Simulador:Ativo = true`. Usa `IServiceScopeFactory` porque o serviço de fundo é singleton e o `DbContext` é scoped (precisa criar um escopo por ciclo).

### O mapa 3D (wwwroot/js)

- **Three.js** desenha a cena no navegador com WebGL. Nada de arquivo 3D baixado: cada prédio, moto e árvore é montado com formas simples (caixa, cilindro, esfera, cone).
- A câmera é de perspectiva com ângulo fechado, o que dá o ar "isométrico" de jogo de estratégia. Arrastar move o alvo da câmera; a roda muda a distância.
- **As motos andam por uma malha de ruas** (grade de cruzamentos). Para ir de um ponto a outro, uma busca em largura (BFS) acha o caminho entre cruzamentos; o caminho é deslocado para a faixa da direita e as esquinas viram curvas (Bézier). Em cada quadro a moto anda `velocidade × tempo` ao longo desses pontos e inclina proporcional ao giro.
- **O status vem do SignalR**: quando chega `StatusMotoristaAlterado`, o painel atualiza a tela e manda a cena mudar o comportamento da moto (circular, voltar para o restaurante, encostar, parar tombada).
- Com `prefers-reduced-motion`, a moto pula direto para o destino: acessibilidade para quem passa mal com animação.
- **Modo demonstração** (o link da Vercel): a Vercel não roda .NET nem SQL Server, então o painel pergunta `/health` ao abrir. Sem back-end, usa `demo.js`, uma API falsa em memória com as mesmas rotas e regras. Se perguntarem na entrevista: "o link é a vitrine; o sistema de verdade, com banco, procedures e testes, roda com `docker compose up` e está no GitHub".

## 9. xUnit e TDD

**TDD** = escrever o teste antes do código. Ciclo: vermelho (teste falha) → verde (código mínimo que passa) → refatorar. No histórico do git dá para ver: o commit dos testes do domínio veio **antes** do commit do domínio.

`tests/SinistrosFrota.Tests` (39 testes, sem banco, rodam em milissegundos):

- `RegrasTransicaoTests`: `[Theory]` com `[InlineData]` testa todas as transições válidas e inválidas com um método só.
- `SinistroTests`: abrir com apólice vencida, ocorrência no futuro, fluxo completo, pagamento duplicado (erro próprio e a data do primeiro pagamento não muda).
- `CalculadoraIndenizacaoTests`: franquia percentual x mínima, teto da cobertura, dano menor que a franquia, roubo sem franquia, arredondamento.
- `[Fact]` = um caso. `[Theory]` = o mesmo teste com vários dados. Padrão **AAA**: Arrange (monta), Act (executa), Assert (confere).

`tests/SinistrosFrota.IntegrationTests` (17 testes, SQL Server real):

- `WebApplicationFactory<Program>` sobe a API inteira em memória. A base de teste é apagada e a API recria com os mesmos scripts de produção.
- Testa o fluxo pela API, os códigos HTTP, a procedure chamada direto no banco, os scripts de ajuste, a concorrência e o SignalR.

**Unitário x integração**: unitário testa uma regra isolada, rápido e sem infraestrutura. Integração testa as peças juntas (API + EF + procedure + banco), mais lento mas pega o que o unitário não vê (SQL errado, lock, constraint).

## 10. Docker e CI

- `docker-compose.yml`: `sqlserver` (porta 14330), `api` (porta 5080) e `sqlserver-test` (porta 14331, só com `--profile test`). O `healthcheck` com `sqlcmd` faz a API esperar o banco ficar pronto.
- `Dockerfile` multi-stage: o estágio `build` usa a imagem com SDK; o final usa só o runtime do ASP.NET. Imagem menor, sem compilador.
- `.github/workflows/ci.yml`: a cada push, build + unitários; depois integração com um SQL Server como **service container**; e build da imagem Docker.

## 11. Perguntas prováveis de entrevista (Dev SQL Júnior)

**1. Qual a diferença entre INNER JOIN e LEFT JOIN?**
INNER só traz quando acha par nas duas tabelas. LEFT traz todas as linhas da esquerda, com NULL onde não achou par. Na `vw_MotoristasStatusAtual` uso `OUTER APPLY` (equivalente a LEFT) para o motoboy sem status também aparecer.

**2. Para que serve uma transação? O que é ACID?**
Para um conjunto de comandos ser tudo ou nada. ACID: Atomicidade (tudo ou nada), Consistência (respeita as regras/constraints), Isolamento (uma transação não atrapalha a outra), Durabilidade (depois do COMMIT não se perde). No `sp_AbrirSinistro`, sinistro, histórico e status do motoboy entram juntos ou nenhum entra.

**3. Como você trata erro dentro de uma procedure?**
`BEGIN TRY ... BEGIN TRAN ... COMMIT END TRY BEGIN CATCH IF @@TRANCOUNT > 0 ROLLBACK; THROW; END CATCH`, com `SET XACT_ABORT ON`. Erro de negócio sai com `THROW 50xxx`, e a API traduz o número para HTTP.

**4. Diferença entre procedure e view? E function?**
View é só um SELECT salvo, sem parâmetro e sem mudar dado. Procedure aceita parâmetros, pode ter INSERT/UPDATE, transação e lógica. Function retorna valor ou tabela e pode ser usada dentro de um SELECT, mas não pode alterar dados.

**5. O que é índice? Clustered x nonclustered?**
Estrutura que acelera a busca. Clustered define a ordem física da tabela (só um por tabela, normalmente a PK). Nonclustered é uma estrutura separada que aponta para a linha (vários). Índice demais deixa INSERT/UPDATE mais lento. No projeto: `IX_Sinistros_Status` com `INCLUDE` para a fila de trabalho.

**6. Como evitar que o mesmo sinistro seja pago duas vezes?**
Lock na leitura (`UPDLOCK, HOLDLOCK`) dentro da transação, para a segunda chamada esperar e ler o status novo, mais o `UPDATE ... WHERE Status = 'Aprovado'` conferindo `@@ROWCOUNT`. Tenho teste com 10 pagamentos simultâneos: só 1 passa.

**7. Você precisa corrigir um dado em produção. Como faz?**
SELECT antes para conferir e guardar no chamado, `BEGIN TRAN`, UPDATE com WHERE bem restrito (Id + valor errado + status esperado), conferir `@@ROWCOUNT`, SELECT depois, COMMIT só se bateu o esperado, senão ROLLBACK. E registrar no histórico. São os scripts da pasta `ajustes/`.

**8. DELETE, TRUNCATE e DROP?**
DELETE apaga linhas (aceita WHERE, dispara trigger, registra cada linha no log). TRUNCATE esvazia a tabela inteira, rápido, reinicia o IDENTITY, não aceita WHERE e não funciona se houver FK apontando. DROP apaga a tabela. Para limpeza grande com critério, DELETE em lotes (como no `ajuste_03`).

**9. WHERE x HAVING?**
WHERE filtra linhas antes do GROUP BY; HAVING filtra os grupos depois. Ex.: meses com mais de 3 sinistros = `GROUP BY ... HAVING COUNT(*) > 3`.

**10. O que é deadlock e como reduzir?**
Duas transações esperando uma pela outra; o SQL Server mata uma (erro 1205). Reduzo com transação curta, acessando tabelas sempre na mesma ordem, índice certo (para travar menos linhas) e pegando o lock de atualização já na leitura (`UPDLOCK`).

**11. O que é SQL injection e como você evita?**
Quando o texto do usuário vira parte do comando SQL. Evito com parâmetros: no projeto, `ExecuteSqlAsync` com string interpolada gera `@p0, @p1`, e no ADO.NET uso `SqlParameter`. Nunca concatenar texto do usuário no SQL.

**12. Função de janela, conhece?**
Sim, `ROW_NUMBER() OVER (PARTITION BY MotoristaId ORDER BY RegistradoEm DESC)` numera as linhas de cada motorista da mais nova para a mais velha. Uso no expurgo para manter sempre a linha 1 (o status atual). Também existem `RANK`, `DENSE_RANK`, `LAG`, `LEAD` e `SUM() OVER` para total acumulado.

**13. Normalização?**
Separar os dados para não repetir informação: motorista, moto, apólice e sinistro em tabelas próprias ligadas por FK, em vez de repetir nome e placa em cada sinistro. 1FN: valores atômicos; 2FN: tudo depende da chave inteira; 3FN: nada depende de outra coluna que não seja a chave. Às vezes se desnormaliza de propósito para relatório.

**14. Por que regra no banco e também no C#?**
No C# dá erro rápido e é fácil de testar (TDD, 39 testes em milissegundos). No banco é a última barreira: vale para qualquer sistema ou script que escreva direto, e é só lá que dá para resolver concorrência de verdade. Tenho um teste que chama a procedure direto, sem a API, e ela barra a transição inválida.

**15. Quando usar EF e quando usar SQL direto/procedure?**
EF para CRUD e consultas comuns (produtividade, LINQ tipado). SQL/procedure quando a regra é crítica, precisa de lock e transação controlada, ou a consulta é pesada e precisa de ajuste fino. No projeto: EF para ler e cadastrar, procedures para mudar o status do sinistro.

## 12. Comandos para mostrar ao vivo

```bash
cp .env.example .env
docker compose up -d --build                 # banco + API + simulador
# painel: http://localhost:5080   swagger: http://localhost:5080/swagger

docker compose --profile test up -d sqlserver-test
dotnet test                                  # 39 unitários + 17 integração
```

Para rodar uma query no banco do container:

```bash
docker exec -it sinistros-frota-dotnet-sqlserver-1 /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'Sinistros!Dev2026' -C -d SinistrosFrota \
  -Q "SELECT * FROM dbo.vw_SinistrosEmAberto"
```

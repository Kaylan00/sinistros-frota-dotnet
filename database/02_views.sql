/* =============================================================================
   02_views.sql - Consultas prontas que a API e os relatórios usam
   CREATE OR ALTER: roda de novo sem erro e atualiza a definição.
   ============================================================================= */

/* Status atual de cada motoboy ativo, com a moto e quantos sinistros ainda não terminaram.
   OUTER APPLY + TOP 1 usa o índice IX_StatusMotorista_Ultimo (um seek por motorista),
   o que segura bem mesmo com o log de status crescendo. */
CREATE OR ALTER VIEW dbo.vw_MotoristasStatusAtual
AS
SELECT
    m.Id                                  AS MotoristaId,
    m.Nome,
    m.Restaurante,
    v.Placa,
    v.Modelo,
    COALESCE(u.Status, 'Disponivel')      AS Status,
    u.Observacao,
    u.RegistradoEm                        AS StatusDesde,
    (SELECT COUNT(*)
       FROM dbo.Sinistros s
      WHERE s.MotoristaId = m.Id
        AND s.Status IN ('Aberto', 'EmAnalise', 'Aprovado')) AS SinistrosAtivos
FROM dbo.Motoristas m
OUTER APPLY (SELECT TOP (1) sm.Status, sm.Observacao, sm.RegistradoEm
               FROM dbo.StatusMotorista sm
              WHERE sm.MotoristaId = m.Id
              ORDER BY sm.RegistradoEm DESC, sm.Id DESC) u
OUTER APPLY (SELECT TOP (1) ve.Placa, ve.Modelo
               FROM dbo.Veiculos ve
              WHERE ve.MotoristaId = m.Id
              ORDER BY ve.Id) v
WHERE m.Ativo = 1;
GO

/* Fila de trabalho: tudo que ainda não terminou (aprovado ainda espera o pagamento). */
CREATE OR ALTER VIEW dbo.vw_SinistrosEmAberto
AS
SELECT
    s.Id                                              AS SinistroId,
    s.Status,
    s.Tipo,
    s.DataOcorrencia,
    s.AbertoEm,
    s.AtualizadoEm,
    s.ValorEstimado,
    s.ValorIndenizado,
    m.Id                                              AS MotoristaId,
    m.Nome                                            AS Motorista,
    m.Restaurante,
    v.Placa,
    a.Numero                                          AS NumeroApolice,
    a.Seguradora,
    DATEDIFF(HOUR, s.AbertoEm, SYSUTCDATETIME())      AS HorasEmAberto
FROM dbo.Sinistros s
JOIN dbo.Motoristas m ON m.Id = s.MotoristaId
JOIN dbo.Apolices   a ON a.Id = s.ApoliceId
JOIN dbo.Veiculos   v ON v.Id = a.VeiculoId
WHERE s.Status IN ('Aberto', 'EmAnalise', 'Aprovado');
GO

/* Resumo mensal por tipo de sinistro (mês da ocorrência). */
CREATE OR ALTER VIEW dbo.vw_ResumoSinistrosPorMes
AS
SELECT
    DATEFROMPARTS(YEAR(s.DataOcorrencia), MONTH(s.DataOcorrencia), 1)            AS Mes,
    s.Tipo,
    COUNT(*)                                                                      AS Quantidade,
    SUM(CASE WHEN s.Status IN ('Aberto', 'EmAnalise') THEN 1 ELSE 0 END)          AS EmAndamento,
    SUM(CASE WHEN s.Status IN ('Aprovado', 'Pago')    THEN 1 ELSE 0 END)          AS Aprovados,
    SUM(CASE WHEN s.Status = 'Negado'                 THEN 1 ELSE 0 END)          AS Negados,
    SUM(s.ValorEstimado)                                                          AS ValorEstimadoTotal,
    SUM(CASE WHEN s.Status IN ('Aprovado', 'Pago') THEN s.ValorIndenizado ELSE 0 END) AS ValorIndenizadoTotal,
    SUM(CASE WHEN s.Status = 'Pago'                THEN s.ValorIndenizado ELSE 0 END) AS ValorPago
FROM dbo.Sinistros s
GROUP BY DATEFROMPARTS(YEAR(s.DataOcorrencia), MONTH(s.DataOcorrencia), 1), s.Tipo;
GO

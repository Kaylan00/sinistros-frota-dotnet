/* =============================================================================
   Ajuste 03 - Expurgo do log de status dos motoboys
   Chamado (exemplo): SUP-1090
   Pedido: a tabela StatusMotorista cresce a cada mudança de status (o simulador
           grava várias por minuto). Apagar o que tem mais de 30 dias, MAS manter
           sempre a linha mais recente de cada motorista (é ela que diz o status atual).

   Técnicas:
     - ROW_NUMBER() para marcar a linha mais recente de cada motorista;
     - DELETE em lotes de @Lote linhas, cada lote na sua transação curta,
       para não segurar lock na tabela inteira nem estourar o log de transação.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Corte    DATETIME2(3) = DATEADD(DAY, -30, SYSUTCDATETIME()),
        @Lote     INT          = 5000,
        @Apagadas INT          = 0,
        @Linhas   INT          = 1;

-- 1) Conferência ANTES
SELECT COUNT(*)                                              AS TotalLinhas,
       SUM(CASE WHEN RegistradoEm < @Corte THEN 1 ELSE 0 END) AS AntesDoCorte,
       COUNT(DISTINCT MotoristaId)                           AS Motoristas
  FROM dbo.StatusMotorista;

BEGIN TRY
    WHILE @Linhas > 0
    BEGIN
        BEGIN TRAN;

        WITH Marcadas AS (
            SELECT Id, RegistradoEm,
                   ROW_NUMBER() OVER (PARTITION BY MotoristaId ORDER BY RegistradoEm DESC, Id DESC) AS Ordem
              FROM dbo.StatusMotorista
        )
        DELETE TOP (@Lote) sm
          FROM dbo.StatusMotorista sm
          JOIN Marcadas mk ON mk.Id = sm.Id
         WHERE mk.RegistradoEm < @Corte
           AND mk.Ordem > 1;           -- nunca apaga o status atual

        SET @Linhas = @@ROWCOUNT;
        SET @Apagadas += @Linhas;

        COMMIT;
    END;

    PRINT CONCAT('Expurgo concluído: ', @Apagadas, ' linha(s) apagada(s).');
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;

-- 2) Conferência DEPOIS: todo motorista continua com pelo menos 1 linha
SELECT COUNT(*)                    AS TotalLinhas,
       COUNT(DISTINCT MotoristaId) AS Motoristas
  FROM dbo.StatusMotorista;

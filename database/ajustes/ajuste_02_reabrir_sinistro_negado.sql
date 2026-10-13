/* =============================================================================
   Ajuste 02 - Reabrir sinistro negado por engano
   Chamado (exemplo): SUP-1057
   Pedido: o sinistro 6 foi negado porque o boletim de ocorrência não tinha chegado.
           O segurado mandou o documento no recurso e a seguradora autorizou nova análise.

   Por que é script e não tela: Negado é status final, a procedure
   sp_AlterarStatusSinistro não deixa sair dele (de propósito). Reabrir é exceção
   autorizada, feita pela sustentação, com registro no histórico.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SinistroId      INT          = 6,
        @Chamado         NVARCHAR(20) = N'SUP-1057',
        @LinhasEsperadas INT          = 1,
        @Linhas          INT;

-- 1) Conferência ANTES: o sinistro e as últimas mudanças dele
SELECT Id, Status, ValorEstimado, ValorIndenizado, AtualizadoEm
  FROM dbo.Sinistros
 WHERE Id = @SinistroId;

SELECT TOP (5) StatusAnterior, StatusNovo, Observacao, Usuario, AlteradoEm
  FROM dbo.SinistroHistorico
 WHERE SinistroId = @SinistroId
 ORDER BY AlteradoEm DESC;

BEGIN TRY
    BEGIN TRAN;

    UPDATE dbo.Sinistros
       SET Status       = 'EmAnalise',
           AtualizadoEm = SYSUTCDATETIME()
     WHERE Id = @SinistroId
       AND Status = 'Negado';          -- só reabre se ainda estiver negado

    SET @Linhas = @@ROWCOUNT;

    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario)
    SELECT @SinistroId, 'Negado', 'EmAnalise',
           CONCAT(N'Ajuste ', @Chamado, N': reaberto para nova análise após recurso com B.O.'),
           N'ajuste_02'
     WHERE @Linhas = 1;

    -- 2) Conferência DEPOIS
    SELECT Id, Status, AtualizadoEm
      FROM dbo.Sinistros
     WHERE Id = @SinistroId;

    IF @Linhas = @LinhasEsperadas
    BEGIN
        COMMIT;
        PRINT CONCAT('COMMIT: sinistro ', @SinistroId, ' voltou para EmAnalise.');
    END
    ELSE
    BEGIN
        ROLLBACK;
        PRINT CONCAT('ROLLBACK: esperava ', @LinhasEsperadas, ' linha(s) e afetou ', @Linhas, '. Nada foi alterado.');
    END;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;

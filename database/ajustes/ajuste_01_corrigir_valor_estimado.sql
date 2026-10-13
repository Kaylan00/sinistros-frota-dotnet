/* =============================================================================
   Ajuste 01 - Corrigir valor estimado digitado errado
   Chamado (exemplo): SUP-1042
   Pedido: no sinistro 13 (fechadura do baú) a central digitou 7.500,00 no lugar
           de 750,00. A análise ainda não terminou, então o valor pode ser corrigido.

   Travas do UPDATE:
     - o Id do sinistro;
     - o valor errado exato (se alguém já corrigiu, não mexe de novo);
     - só sinistro ainda em Aberto/EmAnalise (aprovado já tem indenização calculada).
   Se o número de linhas afetadas não for o esperado, desfaz tudo.
   ============================================================================= */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @SinistroId      INT           = 13,
        @ValorErrado     DECIMAL(12,2) = 7500.00,
        @ValorCorreto    DECIMAL(12,2) = 750.00,
        @Chamado         NVARCHAR(20)  = N'SUP-1042',
        @LinhasEsperadas INT           = 1,
        @Linhas          INT;

-- 1) Conferência ANTES: guardar o resultado no chamado
SELECT Id, Status, Tipo, ValorEstimado, AtualizadoEm
  FROM dbo.Sinistros
 WHERE Id = @SinistroId;

BEGIN TRY
    BEGIN TRAN;

    UPDATE dbo.Sinistros
       SET ValorEstimado = @ValorCorreto,
           AtualizadoEm  = SYSUTCDATETIME()
     WHERE Id = @SinistroId
       AND ValorEstimado = @ValorErrado
       AND Status IN ('Aberto', 'EmAnalise');

    SET @Linhas = @@ROWCOUNT;

    -- trilha de auditoria do ajuste (status não muda, só registra)
    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario)
    SELECT Id, Status, Status,
           CONCAT(N'Ajuste ', @Chamado, N': valor estimado de ', @ValorErrado, N' para ', @ValorCorreto),
           N'ajuste_01'
      FROM dbo.Sinistros
     WHERE Id = @SinistroId
       AND @Linhas = 1;

    -- 2) Conferência DEPOIS (ainda dentro da transação)
    SELECT Id, Status, Tipo, ValorEstimado, AtualizadoEm
      FROM dbo.Sinistros
     WHERE Id = @SinistroId;

    IF @Linhas = @LinhasEsperadas
    BEGIN
        COMMIT;
        PRINT CONCAT('COMMIT: ', @Linhas, ' linha(s) ajustada(s).');
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

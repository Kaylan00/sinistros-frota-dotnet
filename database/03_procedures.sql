/* =============================================================================
   03_procedures.sql - Regras que mudam estado ficam no banco, dentro de transação.

   Padrão de todas as procedures:
     SET XACT_ABORT ON      -> qualquer erro derruba a transação inteira
     BEGIN TRY / BEGIN TRAN -> faz o trabalho
     COMMIT                 -> só se tudo deu certo
     BEGIN CATCH            -> ROLLBACK se ainda houver transação e THROW
                               (devolve o erro original para quem chamou)

   Códigos de erro de negócio (THROW 50xxx) que a API traduz para HTTP:
     50001 apólice não encontrada            -> 404
     50002 apólice fora de vigência          -> 422
     50003 transição de status não permitida -> 409
     50004 sinistro já pago                  -> 409
     50005 sinistro não encontrado           -> 404
     50006 valor inválido                    -> 422
     50007 motorista não encontrado/inativo  -> 404
     50008 apólice é de outro motorista      -> 422
     50009 uso errado da procedure           -> 422
   ============================================================================= */

/* Abre um sinistro. Só aceita se a apólice estava vigente no dia da ocorrência
   e se a apólice cobre a moto do próprio motorista. Grava o histórico e coloca
   o motoboy em "Ocorrencia" no quadro da frota, tudo na mesma transação. */
CREATE OR ALTER PROCEDURE dbo.sp_AbrirSinistro
    @ApoliceId       INT,
    @MotoristaId     INT,
    @Tipo            VARCHAR(12),
    @DataOcorrencia  DATETIME2(0),
    @Descricao       NVARCHAR(500),
    @ValorEstimado   DECIMAL(12,2),
    @Usuario         NVARCHAR(60),
    @SinistroId      INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        DECLARE @Msg NVARCHAR(300);

        IF @ValorEstimado IS NULL OR @ValorEstimado <= 0
            THROW 50006, N'O valor estimado do dano precisa ser positivo.', 1;

        IF @DataOcorrencia > SYSUTCDATETIME()
            THROW 50006, N'A data da ocorrência não pode estar no futuro.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.Motoristas WHERE Id = @MotoristaId AND Ativo = 1)
            THROW 50007, N'Motorista não encontrado ou inativo.', 1;

        DECLARE @Numero VARCHAR(20), @Inicio DATE, @Fim DATE, @DonoDaMoto INT;

        SELECT @Numero     = a.Numero,
               @Inicio     = a.InicioVigencia,
               @Fim        = a.FimVigencia,
               @DonoDaMoto = v.MotoristaId
          FROM dbo.Apolices a
          JOIN dbo.Veiculos v ON v.Id = a.VeiculoId
         WHERE a.Id = @ApoliceId;

        IF @Numero IS NULL
            THROW 50001, N'Apólice não encontrada.', 1;

        IF @DonoDaMoto <> @MotoristaId
            THROW 50008, N'A apólice informada cobre a moto de outro motorista.', 1;

        IF CAST(@DataOcorrencia AS DATE) NOT BETWEEN @Inicio AND @Fim
        BEGIN
            SET @Msg = CONCAT(N'A apólice ', @Numero, N' não estava vigente em ',
                              FORMAT(@DataOcorrencia, 'dd/MM/yyyy'), N'.');
            THROW 50002, @Msg, 1;
        END;

        BEGIN TRAN;

            INSERT INTO dbo.Sinistros (ApoliceId, MotoristaId, Tipo, Status, DataOcorrencia, Descricao, ValorEstimado)
            VALUES (@ApoliceId, @MotoristaId, @Tipo, 'Aberto', @DataOcorrencia, @Descricao, @ValorEstimado);

            SET @SinistroId = CAST(SCOPE_IDENTITY() AS INT);

            INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario)
            VALUES (@SinistroId, NULL, 'Aberto', N'Sinistro aberto', @Usuario);

            INSERT INTO dbo.StatusMotorista (MotoristaId, Status, Observacao)
            VALUES (@MotoristaId, 'Ocorrencia', CONCAT(N'Sinistro #', @SinistroId));

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

/* Muda o status seguindo a tabela TransicoesSinistro.
   UPDLOCK na leitura: duas pessoas mexendo no mesmo sinistro ao mesmo tempo
   ficam em fila, e a segunda já enxerga o status novo. */
CREATE OR ALTER PROCEDURE dbo.sp_AlterarStatusSinistro
    @SinistroId       INT,
    @NovoStatus       VARCHAR(10),
    @Usuario          NVARCHAR(60),
    @Observacao       NVARCHAR(300) = NULL,
    @ValorIndenizado  DECIMAL(12,2) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        DECLARE @Msg NVARCHAR(300);

        IF @NovoStatus = 'Pago'
            THROW 50009, N'Pagamento tem procedure própria: use sp_PagarSinistro.', 1;

        BEGIN TRAN;

            DECLARE @StatusAtual VARCHAR(10), @Cobertura DECIMAL(12,2);

            SELECT @StatusAtual = s.Status,
                   @Cobertura   = a.ValorCobertura
              FROM dbo.Sinistros s WITH (UPDLOCK, ROWLOCK)
              JOIN dbo.Apolices  a ON a.Id = s.ApoliceId
             WHERE s.Id = @SinistroId;

            IF @StatusAtual IS NULL
                THROW 50005, N'Sinistro não encontrado.', 1;

            IF NOT EXISTS (SELECT 1 FROM dbo.TransicoesSinistro WHERE De = @StatusAtual AND Para = @NovoStatus)
            BEGIN
                SET @Msg = CONCAT(N'Transição de ', @StatusAtual, N' para ', @NovoStatus, N' não é permitida.');
                THROW 50003, @Msg, 1;
            END;

            IF @NovoStatus = 'Aprovado'
               AND (@ValorIndenizado IS NULL OR @ValorIndenizado <= 0 OR @ValorIndenizado > @Cobertura)
                THROW 50006, N'Para aprovar, o valor indenizado precisa ser positivo e no máximo o valor de cobertura da apólice.', 1;

            UPDATE dbo.Sinistros
               SET Status          = @NovoStatus,
                   ValorIndenizado = CASE WHEN @NovoStatus = 'Aprovado' THEN @ValorIndenizado ELSE ValorIndenizado END,
                   AtualizadoEm    = SYSUTCDATETIME()
             WHERE Id = @SinistroId;

            INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario)
            VALUES (@SinistroId, @StatusAtual, @NovoStatus, @Observacao, @Usuario);

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

/* Paga um sinistro aprovado. Pagamento duplicado é o erro mais caro do sistema,
   então a proteção é dupla:
     1) UPDLOCK + HOLDLOCK na leitura: chamadas simultâneas para o mesmo sinistro
        esperam a primeira terminar e então leem 'Pago';
     2) o UPDATE só acontece WHERE Status = 'Aprovado' e o @@ROWCOUNT é conferido. */
CREATE OR ALTER PROCEDURE dbo.sp_PagarSinistro
    @SinistroId  INT,
    @Usuario     NVARCHAR(60),
    @Observacao  NVARCHAR(300) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRY
        DECLARE @Msg NVARCHAR(300);

        BEGIN TRAN;

            DECLARE @StatusAtual VARCHAR(10);

            SELECT @StatusAtual = Status
              FROM dbo.Sinistros WITH (UPDLOCK, HOLDLOCK)
             WHERE Id = @SinistroId;

            IF @StatusAtual IS NULL
                THROW 50005, N'Sinistro não encontrado.', 1;

            IF @StatusAtual = 'Pago'
            BEGIN
                SET @Msg = CONCAT(N'O sinistro ', @SinistroId, N' já foi pago.');
                THROW 50004, @Msg, 1;
            END;

            IF NOT EXISTS (SELECT 1 FROM dbo.TransicoesSinistro WHERE De = @StatusAtual AND Para = 'Pago')
            BEGIN
                SET @Msg = CONCAT(N'Transição de ', @StatusAtual, N' para Pago não é permitida.');
                THROW 50003, @Msg, 1;
            END;

            UPDATE dbo.Sinistros
               SET Status       = 'Pago',
                   PagoEm       = SYSUTCDATETIME(),
                   AtualizadoEm = SYSUTCDATETIME()
             WHERE Id = @SinistroId
               AND Status = 'Aprovado';

            IF @@ROWCOUNT <> 1
            BEGIN
                SET @Msg = CONCAT(N'O sinistro ', @SinistroId, N' já foi pago.');
                THROW 50004, @Msg, 1;
            END;

            INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario)
            VALUES (@SinistroId, 'Aprovado', 'Pago', COALESCE(@Observacao, N'Indenização paga'), @Usuario);

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        THROW;
    END CATCH
END
GO

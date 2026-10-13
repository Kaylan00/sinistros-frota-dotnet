/* =============================================================================
   01_schema.sql - Tabelas, chaves, constraints e índices
   Frota de motoboys de entrega de uma rede de restaurantes e os sinistros
   (acidente, roubo, avaria da moto ou do baú) cobertos pelo seguro.

   Idempotente: pode rodar de novo sem erro (cada CREATE checa se já existe).
   Datas em UTC (SYSUTCDATETIME), a tela converte para o horário local.
   ============================================================================= */

IF OBJECT_ID(N'dbo.Motoristas', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Motoristas (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Motoristas PRIMARY KEY,
        Nome         NVARCHAR(120)     NOT NULL,
        Cpf          CHAR(11)          NOT NULL CONSTRAINT UQ_Motoristas_Cpf UNIQUE,
        Telefone     VARCHAR(15)       NULL,
        Restaurante  NVARCHAR(80)      NOT NULL,
        Ativo        BIT               NOT NULL CONSTRAINT DF_Motoristas_Ativo DEFAULT (1),
        CriadoEm     DATETIME2(0)      NOT NULL CONSTRAINT DF_Motoristas_CriadoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_Motoristas_Cpf CHECK (Cpf NOT LIKE '%[^0-9]%')   -- só dígitos
    );
END
GO

IF OBJECT_ID(N'dbo.Veiculos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Veiculos (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Veiculos PRIMARY KEY,
        MotoristaId  INT               NOT NULL CONSTRAINT FK_Veiculos_Motoristas REFERENCES dbo.Motoristas (Id),
        Placa        CHAR(7)           NOT NULL CONSTRAINT UQ_Veiculos_Placa UNIQUE,
        Modelo       NVARCHAR(60)      NOT NULL,
        Ano          SMALLINT          NOT NULL CONSTRAINT CK_Veiculos_Ano CHECK (Ano BETWEEN 2000 AND 2100),
        TemBau       BIT               NOT NULL CONSTRAINT DF_Veiculos_TemBau DEFAULT (1)
    );
    CREATE INDEX IX_Veiculos_MotoristaId ON dbo.Veiculos (MotoristaId);
END
GO

IF OBJECT_ID(N'dbo.Apolices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Apolices (
        Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Apolices PRIMARY KEY,
        VeiculoId           INT               NOT NULL CONSTRAINT FK_Apolices_Veiculos REFERENCES dbo.Veiculos (Id),
        Numero              VARCHAR(20)       NOT NULL CONSTRAINT UQ_Apolices_Numero UNIQUE,
        Seguradora          NVARCHAR(80)      NOT NULL,
        InicioVigencia      DATE              NOT NULL,
        FimVigencia         DATE              NOT NULL,
        ValorCobertura      DECIMAL(12,2)     NOT NULL,
        FranquiaPercentual  DECIMAL(5,2)      NOT NULL,
        FranquiaMinima      DECIMAL(12,2)     NOT NULL CONSTRAINT DF_Apolices_FranquiaMinima DEFAULT (0),
        CONSTRAINT CK_Apolices_Vigencia   CHECK (FimVigencia >= InicioVigencia),
        CONSTRAINT CK_Apolices_Cobertura  CHECK (ValorCobertura > 0),
        CONSTRAINT CK_Apolices_Franquia   CHECK (FranquiaPercentual BETWEEN 0 AND 100 AND FranquiaMinima >= 0)
    );
    -- "qual a apólice vigente deste veículo?"
    CREATE INDEX IX_Apolices_Veiculo_Vigencia ON dbo.Apolices (VeiculoId, FimVigencia) INCLUDE (InicioVigencia);
END
GO

/* Transições permitidas do sinistro, como dado e não como IF espalhado.
   A procedure sp_AlterarStatusSinistro consulta esta tabela. */
IF OBJECT_ID(N'dbo.TransicoesSinistro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TransicoesSinistro (
        De    VARCHAR(10) NOT NULL,
        Para  VARCHAR(10) NOT NULL,
        CONSTRAINT PK_TransicoesSinistro PRIMARY KEY (De, Para)
    );
    INSERT INTO dbo.TransicoesSinistro (De, Para) VALUES
        ('Aberto',    'EmAnalise'),
        ('EmAnalise', 'Aprovado'),
        ('EmAnalise', 'Negado'),
        ('Aprovado',  'Pago');
END
GO

IF OBJECT_ID(N'dbo.Sinistros', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Sinistros (
        Id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Sinistros PRIMARY KEY,
        ApoliceId        INT               NOT NULL CONSTRAINT FK_Sinistros_Apolices   REFERENCES dbo.Apolices (Id),
        MotoristaId      INT               NOT NULL CONSTRAINT FK_Sinistros_Motoristas REFERENCES dbo.Motoristas (Id),
        Tipo             VARCHAR(12)       NOT NULL,
        Status           VARCHAR(10)       NOT NULL CONSTRAINT DF_Sinistros_Status DEFAULT ('Aberto'),
        DataOcorrencia   DATETIME2(0)      NOT NULL,
        Descricao        NVARCHAR(500)     NOT NULL,
        ValorEstimado    DECIMAL(12,2)     NOT NULL,
        ValorIndenizado  DECIMAL(12,2)     NULL,
        AbertoEm         DATETIME2(0)      NOT NULL CONSTRAINT DF_Sinistros_AbertoEm     DEFAULT (SYSUTCDATETIME()),
        AtualizadoEm     DATETIME2(0)      NOT NULL CONSTRAINT DF_Sinistros_AtualizadoEm DEFAULT (SYSUTCDATETIME()),
        PagoEm           DATETIME2(0)      NULL,
        CONSTRAINT CK_Sinistros_Tipo   CHECK (Tipo   IN ('Acidente', 'Roubo', 'AvariaMoto', 'AvariaBau')),
        CONSTRAINT CK_Sinistros_Status CHECK (Status IN ('Aberto', 'EmAnalise', 'Aprovado', 'Negado', 'Pago')),
        CONSTRAINT CK_Sinistros_ValorEstimado   CHECK (ValorEstimado > 0),
        CONSTRAINT CK_Sinistros_ValorIndenizado CHECK (ValorIndenizado IS NULL OR ValorIndenizado > 0),
        -- coerência entre colunas: só pago tem data de pagamento; aprovado/pago sempre tem valor
        CONSTRAINT CK_Sinistros_PagoEm      CHECK ((Status = 'Pago' AND PagoEm IS NOT NULL) OR (Status <> 'Pago' AND PagoEm IS NULL)),
        CONSTRAINT CK_Sinistros_Indenizacao CHECK (Status NOT IN ('Aprovado', 'Pago') OR ValorIndenizado IS NOT NULL)
    );
    -- fila de trabalho (filtra por status) sem ir na tabela para as colunas mais usadas
    CREATE INDEX IX_Sinistros_Status         ON dbo.Sinistros (Status) INCLUDE (MotoristaId, ApoliceId, ValorEstimado, AbertoEm);
    CREATE INDEX IX_Sinistros_MotoristaId    ON dbo.Sinistros (MotoristaId);
    CREATE INDEX IX_Sinistros_ApoliceId      ON dbo.Sinistros (ApoliceId);
    CREATE INDEX IX_Sinistros_DataOcorrencia ON dbo.Sinistros (DataOcorrencia) INCLUDE (Tipo, Status, ValorEstimado, ValorIndenizado);
END
GO

/* Auditoria: toda mudança de status (e todo ajuste manual) vira uma linha aqui. */
IF OBJECT_ID(N'dbo.SinistroHistorico', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SinistroHistorico (
        Id              BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SinistroHistorico PRIMARY KEY,
        SinistroId      INT                  NOT NULL CONSTRAINT FK_SinistroHistorico_Sinistros REFERENCES dbo.Sinistros (Id),
        StatusAnterior  VARCHAR(10)          NULL,
        StatusNovo      VARCHAR(10)          NOT NULL,
        Observacao      NVARCHAR(300)        NULL,
        Usuario         NVARCHAR(60)         NOT NULL,
        AlteradoEm      DATETIME2(3)         NOT NULL CONSTRAINT DF_SinistroHistorico_AlteradoEm DEFAULT (SYSUTCDATETIME())
    );
    CREATE INDEX IX_SinistroHistorico_Sinistro ON dbo.SinistroHistorico (SinistroId, AlteradoEm);
END
GO

/* Log de status do motoboy. Cada mudança é uma linha nova; o status atual é a
   linha mais recente de cada motorista (ver vw_MotoristasStatusAtual). */
IF OBJECT_ID(N'dbo.StatusMotorista', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StatusMotorista (
        Id            BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_StatusMotorista PRIMARY KEY,
        MotoristaId   INT                  NOT NULL CONSTRAINT FK_StatusMotorista_Motoristas REFERENCES dbo.Motoristas (Id),
        Status        VARCHAR(10)          NOT NULL,
        Observacao    NVARCHAR(200)        NULL,
        RegistradoEm  DATETIME2(3)         NOT NULL CONSTRAINT DF_StatusMotorista_RegistradoEm DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT CK_StatusMotorista_Status CHECK (Status IN ('Disponivel', 'EmEntrega', 'EmPausa', 'Ocorrencia'))
    );
    -- índice que deixa "último status de cada motorista" virar um seek por motorista
    CREATE INDEX IX_StatusMotorista_Ultimo ON dbo.StatusMotorista (MotoristaId, RegistradoEm DESC) INCLUDE (Status, Observacao);
END
GO

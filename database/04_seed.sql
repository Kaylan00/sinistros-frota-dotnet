/* =============================================================================
   04_seed.sql - Dados de demonstração (só roda se a base estiver vazia)
   Rede "Sabor de Casa": 4 unidades, 8 motoboys, 1 moto e 1 apólice cada.
   Datas relativas a hoje, para a demo sempre ter apólice vigente e histórico
   dos últimos 6 meses. CPFs e placas são fictícios.
   ============================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- RETURN encerra o lote inteiro (o script todo é um lote só, sem GO no meio)
IF EXISTS (SELECT 1 FROM dbo.Motoristas)
BEGIN
    PRINT 'Seed ignorado: a base já tem motoristas.';
    RETURN;
END;

BEGIN TRY
    BEGIN TRAN;

    DECLARE @Agora DATETIME2(0) = SYSUTCDATETIME();
    DECLARE @Hoje  DATE         = CAST(@Agora AS DATE);

    INSERT INTO dbo.Motoristas (Nome, Cpf, Telefone, Restaurante) VALUES
        (N'Rafael Monteiro',   '10000000001', '27999110001', N'Sabor de Casa - Centro'),
        (N'Jéssica Andrade',   '10000000002', '27999110002', N'Sabor de Casa - Centro'),
        (N'Thiago Ribeiro',    '10000000003', '27999110003', N'Sabor de Casa - Praia do Canto'),
        (N'Patrícia Lopes',    '10000000004', '27999110004', N'Sabor de Casa - Praia do Canto'),
        (N'Diego Fernandes',   '10000000005', '27999110005', N'Sabor de Casa - Jardim da Penha'),
        (N'Camila Barcelos',   '10000000006', '27999110006', N'Sabor de Casa - Jardim da Penha'),
        (N'Bruno Teixeira',    '10000000007', '27999110007', N'Sabor de Casa - Laranjeiras'),
        (N'Vanessa Coutinho',  '10000000008', '27999110008', N'Sabor de Casa - Laranjeiras');

    INSERT INTO dbo.Veiculos (MotoristaId, Placa, Modelo, Ano, TemBau)
    SELECT m.Id, v.Placa, v.Modelo, v.Ano, 1
      FROM (VALUES
            ('10000000001', 'RQB1A23', N'Honda CG 160 Cargo',  2023),
            ('10000000002', 'RQC4D56', N'Yamaha Factor 150',    2022),
            ('10000000003', 'RQD7E89', N'Honda CG 160 Cargo',  2024),
            ('10000000004', 'RQE2F34', N'Honda Biz 125',        2021),
            ('10000000005', 'RQF5G67', N'Yamaha Fazer 150',     2023),
            ('10000000006', 'RQG8H90', N'Honda Pop 110i',       2022),
            ('10000000007', 'RQH3J12', N'Honda CG 160 Fan',     2024),
            ('10000000008', 'RQJ6K45', N'Yamaha Factor 150',    2020)
           ) v (Cpf, Placa, Modelo, Ano)
      JOIN dbo.Motoristas m ON m.Cpf = v.Cpf;

    -- 7 apólices vigentes (começaram há 8 meses) e 1 vencida há 20 dias (a da Vanessa)
    INSERT INTO dbo.Apolices (VeiculoId, Numero, Seguradora, InicioVigencia, FimVigencia, ValorCobertura, FranquiaPercentual, FranquiaMinima)
    SELECT v.Id,
           CONCAT('MOTO-', YEAR(@Hoje), '-', RIGHT(CONCAT('000', v.Id), 4)),
           N'Seguradora Exemplo',
           CASE WHEN m.Cpf = '10000000008' THEN DATEADD(DAY, -20, DATEADD(YEAR, -1, @Hoje)) ELSE DATEADD(MONTH, -8, @Hoje) END,
           CASE WHEN m.Cpf = '10000000008' THEN DATEADD(DAY, -20, @Hoje)                     ELSE DATEADD(MONTH,  4, @Hoje) END,
           12000.00, 10.00, 400.00
      FROM dbo.Veiculos v
      JOIN dbo.Motoristas m ON m.Id = v.MotoristaId
     ORDER BY v.Id;

    /* Sinistros dos últimos meses. Valor indenizado já calculado pela regra da apólice
       (cobertura 12.000, franquia 10% com mínimo 400; roubo sem franquia).
       O sinistro da linha 13 tem o valor digitado errado de propósito (7.500 em vez de 750):
       é o caso que o script ajustes/ajuste_01 corrige. */
    DECLARE @S TABLE (
        Ordem INT PRIMARY KEY, Cpf CHAR(11), Tipo VARCHAR(12), Status VARCHAR(10), DiasAtras INT,
        Descricao NVARCHAR(500), ValorEstimado DECIMAL(12,2), ValorIndenizado DECIMAL(12,2) NULL);

    INSERT INTO @S VALUES
        ( 1, '10000000001', 'Acidente',   'Pago',      170, N'Colisão traseira em semáforo, para-lama e farol quebrados',   3200.00,  2800.00),
        ( 2, '10000000003', 'AvariaBau',  'Negado',    160, N'Tampa do baú rachada (dano abaixo da franquia)',                350.00,     NULL),
        ( 3, '10000000002', 'Roubo',      'Pago',      140, N'Moto levada durante entrega, com boletim de ocorrência',     13500.00, 12000.00),
        ( 4, '10000000005', 'Acidente',   'Pago',      120, N'Queda em pista molhada, carenagem e manete',                   5400.00,  4860.00),
        ( 5, '10000000008', 'AvariaMoto', 'Pago',      110, N'Retrovisor e pisca arrancados em manobra no estacionamento', 1900.00,  1500.00),
        ( 6, '10000000004', 'Acidente',   'Negado',     95, N'Colisão lateral com carro em conversão',                       2600.00,     NULL),
        ( 7, '10000000006', 'AvariaMoto', 'Pago',       80, N'Escapamento amassado por queda da moto parada',                2300.00,  1900.00),
        ( 8, '10000000001', 'AvariaBau',  'Pago',       62, N'Baú arrancado em batida leve',                                  900.00,   500.00),
        ( 9, '10000000007', 'Acidente',   'Pago',       50, N'Colisão com ônibus, roda e suspensão dianteira',               7800.00,  7020.00),
        (10, '10000000002', 'Acidente',   'Aprovado',   35, N'Fechada de carro, queda e tanque amassado',                    4100.00,  3690.00),
        (11, '10000000003', 'AvariaMoto', 'Aprovado',   21, N'Painel quebrado após tentativa de furto',                      1500.00,  1100.00),
        (12, '10000000005', 'Acidente',   'EmAnalise',   9, N'Batida em buraco, aro empenado e pneu cortado',                6200.00,     NULL),
        (13, '10000000006', 'AvariaBau',  'EmAnalise',   4, N'Fechadura do baú forçada',                                     7500.00,     NULL),
        (14, '10000000004', 'Acidente',   'Aberto',      1, N'Colisão leve com bicicleta, guidão torto',                     3000.00,     NULL),
        (15, '10000000007', 'AvariaMoto', 'Aberto',      0, N'Pneu traseiro furado por prego, câmara e pneu novos',           480.00,     NULL);

    INSERT INTO dbo.Sinistros (ApoliceId, MotoristaId, Tipo, Status, DataOcorrencia, Descricao, ValorEstimado, ValorIndenizado, AbertoEm, AtualizadoEm, PagoEm)
    SELECT a.Id, m.Id, s.Tipo, s.Status, x.Ocorrencia, s.Descricao, s.ValorEstimado, s.ValorIndenizado,
           DATEADD(HOUR, 1, x.Ocorrencia),
           CASE s.Status
                WHEN 'Aberto'    THEN DATEADD(HOUR, 1,  x.Ocorrencia)
                WHEN 'EmAnalise' THEN DATEADD(HOUR, 20, x.Ocorrencia)
                WHEN 'Pago'      THEN DATEADD(DAY,  7,  x.Ocorrencia)
                ELSE                  DATEADD(DAY,  3,  x.Ocorrencia)
           END,
           CASE WHEN s.Status = 'Pago' THEN DATEADD(DAY, 7, x.Ocorrencia) END
      FROM @S s
      JOIN dbo.Motoristas m ON m.Cpf = s.Cpf
      JOIN dbo.Veiculos   v ON v.MotoristaId = m.Id
      JOIN dbo.Apolices   a ON a.VeiculoId = v.Id
     CROSS APPLY (SELECT DATEADD(HOUR, -3 - (s.Ordem % 5), DATEADD(DAY, -s.DiasAtras, @Agora)) AS Ocorrencia) x
     ORDER BY s.Ordem;

    -- Histórico coerente com o status de cada sinistro
    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario, AlteradoEm)
    SELECT Id, NULL, 'Aberto', N'Sinistro aberto', N'central', AbertoEm
      FROM dbo.Sinistros;

    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario, AlteradoEm)
    SELECT Id, 'Aberto', 'EmAnalise', N'Vistoria agendada', N'analista.ana', DATEADD(HOUR, 20, DataOcorrencia)
      FROM dbo.Sinistros
     WHERE Status IN ('EmAnalise', 'Aprovado', 'Negado', 'Pago');

    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario, AlteradoEm)
    SELECT Id, 'EmAnalise',
           CASE WHEN Status = 'Negado' THEN 'Negado' ELSE 'Aprovado' END,
           CASE WHEN Status = 'Negado' THEN N'Negado após vistoria' ELSE N'Aprovado conforme laudo da oficina' END,
           N'analista.ana', DATEADD(DAY, 3, DataOcorrencia)
      FROM dbo.Sinistros
     WHERE Status IN ('Aprovado', 'Negado', 'Pago');

    INSERT INTO dbo.SinistroHistorico (SinistroId, StatusAnterior, StatusNovo, Observacao, Usuario, AlteradoEm)
    SELECT Id, 'Aprovado', 'Pago', N'Indenização paga', N'financeiro', PagoEm
      FROM dbo.Sinistros
     WHERE Status = 'Pago';

    -- Quadro inicial da frota
    INSERT INTO dbo.StatusMotorista (MotoristaId, Status, Observacao, RegistradoEm)
    SELECT m.Id, x.Status, x.Observacao, DATEADD(MINUTE, -x.MinutosAtras, @Agora)
      FROM (VALUES
            ('10000000001', 'EmEntrega',  NULL,                     12),
            ('10000000002', 'Disponivel', NULL,                      4),
            ('10000000003', 'EmEntrega',  NULL,                      7),
            ('10000000004', 'Ocorrencia', N'Colisão leve, aguardando guincho', 30),
            ('10000000005', 'EmPausa',    N'Almoço',                18),
            ('10000000006', 'Disponivel', NULL,                      2),
            ('10000000007', 'EmEntrega',  NULL,                      9),
            ('10000000008', 'Disponivel', NULL,                     25)
           ) x (Cpf, Status, Observacao, MinutosAtras)
      JOIN dbo.Motoristas m ON m.Cpf = x.Cpf;

    COMMIT;
    PRINT 'Seed aplicado.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH
GO

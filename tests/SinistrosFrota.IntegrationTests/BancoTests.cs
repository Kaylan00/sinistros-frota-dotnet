using System.Net.Http.Json;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

/// <summary>Views e scripts de ajuste rodando contra o SQL Server com o seed.</summary>
[Collection(ApiCollection.Nome)]
public class BancoTests(ApiFixture api)
{
    private static string Ajuste(string arquivo) => Path.Combine(ScriptsSql.PastaPadrao, "ajustes", arquivo);

    [Fact]
    public async Task View_da_frota_traz_um_status_por_motorista()
    {
        var frota = await api.Client.GetFromJsonAsync<List<MotoristaStatusAtual>>("/api/motoristas", ApiFixture.Json);

        Assert.True(frota!.Count >= 8);
        Assert.Equal(frota.Count, frota.Select(m => m.MotoristaId).Distinct().Count());
        Assert.All(frota, m => Assert.False(string.IsNullOrEmpty(m.Placa)));
    }

    [Fact]
    public async Task View_em_aberto_so_traz_o_que_nao_terminou()
    {
        var fila = await api.Client.GetFromJsonAsync<List<SinistroEmAberto>>("/api/sinistros/em-aberto", ApiFixture.Json);

        Assert.NotEmpty(fila!);
        Assert.All(fila!, s => Assert.Contains(s.Status, new[] { StatusSinistro.Aberto, StatusSinistro.EmAnalise, StatusSinistro.Aprovado }));
    }

    [Fact]
    public async Task Resumo_mensal_bate_com_a_tabela()
    {
        var resumo = await api.Client.GetFromJsonAsync<List<ResumoSinistrosMes>>("/api/relatorios/sinistros-por-mes?meses=12", ApiFixture.Json);
        var totalTabela = await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.Sinistros WHERE DataOcorrencia >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(SYSUTCDATETIME()), MONTH(SYSUTCDATETIME()), 1))");

        Assert.Equal(totalTabela, resumo!.Sum(r => r.Quantidade));
        Assert.All(resumo!, r => Assert.Equal(r.Quantidade, r.EmAndamento + r.Aprovados + r.Negados));
    }

    [Fact]
    public async Task Ajuste_01_corrige_uma_vez_e_na_segunda_faz_rollback()
    {
        await using var conexao = await api.AbrirConexaoAsync();

        await ScriptsSql.ExecutarArquivoAsync(conexao, Ajuste("ajuste_01_corrigir_valor_estimado.sql"));
        Assert.Equal(750m, await api.EscalarAsync<decimal>("SELECT ValorEstimado FROM dbo.Sinistros WHERE Id = 13"));

        // rodar de novo não pode mexer em nada (o WHERE exige o valor errado)
        await ScriptsSql.ExecutarArquivoAsync(conexao, Ajuste("ajuste_01_corrigir_valor_estimado.sql"));
        Assert.Equal(750m, await api.EscalarAsync<decimal>("SELECT ValorEstimado FROM dbo.Sinistros WHERE Id = 13"));
        Assert.Equal(1, await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.SinistroHistorico WHERE SinistroId = 13 AND Usuario = N'ajuste_01'"));
    }

    [Fact]
    public async Task Ajuste_02_reabre_o_negado_e_registra_no_historico()
    {
        await using var conexao = await api.AbrirConexaoAsync();

        await ScriptsSql.ExecutarArquivoAsync(conexao, Ajuste("ajuste_02_reabrir_sinistro_negado.sql"));

        Assert.Equal("EmAnalise", await api.EscalarAsync<string>("SELECT Status FROM dbo.Sinistros WHERE Id = 6"));
        Assert.Equal(1, await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.SinistroHistorico WHERE SinistroId = 6 AND Usuario = N'ajuste_02' AND StatusAnterior = 'Negado'"));
    }

    [Fact]
    public async Task Ajuste_03_expurga_o_log_antigo_mas_mantem_o_status_atual()
    {
        // um motorista com 3 registros antigos: só o mais recente deles pode sobrar
        const int motorista = 7;
        await using var conexao = await api.AbrirConexaoAsync();
        await using (var cmd = new Microsoft.Data.SqlClient.SqlCommand(
            """
            DELETE FROM dbo.StatusMotorista WHERE MotoristaId = @m;
            INSERT INTO dbo.StatusMotorista (MotoristaId, Status, RegistradoEm) VALUES
                (@m, 'Disponivel', DATEADD(DAY, -60, SYSUTCDATETIME())),
                (@m, 'EmEntrega',  DATEADD(DAY, -50, SYSUTCDATETIME())),
                (@m, 'EmPausa',    DATEADD(DAY, -40, SYSUTCDATETIME()));
            """, conexao))
        {
            cmd.Parameters.AddWithValue("@m", motorista);
            await cmd.ExecuteNonQueryAsync();
        }

        await ScriptsSql.ExecutarArquivoAsync(conexao, Ajuste("ajuste_03_expurgo_status_motorista.sql"));

        Assert.Equal(1, await api.EscalarAsync<int>("SELECT COUNT(*) FROM dbo.StatusMotorista WHERE MotoristaId = @m", ("@m", motorista)));
        Assert.Equal("EmPausa", await api.EscalarAsync<string>("SELECT Status FROM dbo.StatusMotorista WHERE MotoristaId = @m", ("@m", motorista)));
        // ninguém ficou sem status
        Assert.Equal(0, await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.Motoristas m WHERE NOT EXISTS (SELECT 1 FROM dbo.StatusMotorista s WHERE s.MotoristaId = m.Id) AND m.Id <= 8"));
    }
}
